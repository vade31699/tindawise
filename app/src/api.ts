/**
 * Every API action — the on-device counterpart of api.php.
 *
 * The action names, payloads and response shapes are identical to the PHP
 * version, so the existing front-end JavaScript works unchanged. Each handler
 * resolves to the JSON body it used to return, and throws ValidationError for
 * anything the user needs to fix.
 */

import { all, begin as beginTx, commit as commitTx, db, exec, one, scalar, Row, ValidationError } from './db';
import { APP_NAME, CSV_HEADERS, DB_NAME, DEFAULT_CURRENCY, DEFAULT_LOW_STOCK } from './config';
import {
  lowStockThreshold,
  makeReference,
  normaliseProduct,
  num,
  qty as fmtQty,
  rollback,
  round,
  saveSetting,
  setting,
  stockStatus,
} from './helpers';
import {
  buildReport,
  dashboardStats,
  dateRange,
  lowStockItems,
  recentSales,
  reportTotals,
} from './reports';

export type Ctx = {
  /** Query-string values for GET-style actions. */
  query: Record<string, string>;
  /** Request body for POST actions. */
  body: Record<string, any>;
};

type Handler = (ctx: Ctx) => Promise<any>;

const handlers: Record<string, Handler> = {
  products_list: productsList,
  product_save: productSave,
  product_delete: productDelete,
  product_restock: productRestock,
  pos_checkout: posCheckout,
  sales_history: salesHistory,
  sale_detail: saleDetail,
  sale_void_item: saleVoidItem,
  report_summary: reportSummary,
  dashboard_stats: () => dashboardStats(),
  export_products: exportProducts,
  export_sales: exportSales,
  csv_template: csvTemplate,
  import_products: importProducts,
  backup_db: backupDb,
  settings_save: settingsSave,
  settings_get: settingsGet,
  app_stats: appStats,
};

/** Dispatches one action, exactly like the PHP switch statement did. */
export async function call(action: string, ctx: Ctx): Promise<any> {
  const handler = handlers[action];
  if (!handler) {
    throw new ValidationError(`Unknown action: ${action}`);
  }
  return handler(ctx);
}

/* ============================================================ formatting */

/** The configured currency symbol. */
async function currency(): Promise<string> {
  return setting('currency', DEFAULT_CURRENCY);
}

/** Currency symbol plus a thousands-separated, 2 decimal amount. */
async function money(amount: any): Promise<string> {
  return (await currency()) + num(amount, 2);
}

function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/* ============================================================== products */

/** Searchable product list. Query: q, category, status, limit. */
async function productsList({ query }: Ctx): Promise<any> {
  const q = (query.q ?? '').trim();
  const category = (query.category ?? '').trim();
  const status = query.status ?? '';
  const limit = Math.min(500, Math.max(1, Number(query.limit ?? 300) || 300));
  const lowStock = await lowStockThreshold();

  let sql = 'SELECT * FROM products WHERE 1 = 1';
  const params: any[] = [];

  if (q !== '') {
    sql += ' AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category !== '') {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (status === 'low') {
    sql += ' AND stock_qty > 0 AND stock_qty <= ?';
    params.push(lowStock);
  } else if (status === 'out') {
    sql += ' AND stock_qty <= 0';
  } else if (status === 'instock') {
    sql += ' AND stock_qty > ?';
    params.push(lowStock);
  }

  // `limit` is a validated integer, so interpolating it is injection-safe.
  sql += ` ORDER BY name COLLATE NOCASE LIMIT ${limit}`;

  const rows = await all(sql, params);

  const products = rows.map((row) => {
    const stockQty = Number(row.stock_qty);
    const cost = Number(row.cost_price);
    const selling = Number(row.selling_price);
    const state = stockStatus(stockQty, lowStock);

    return {
      id: Number(row.id),
      name: String(row.name),
      sku: String(row.sku ?? ''),
      category: String(row.category ?? ''),
      cost_price: cost,
      selling_price: selling,
      stock_qty: stockQty,
      pack_size: Number(row.pack_size),
      unit_profit: round(selling - cost),
      margin: selling > 0 ? round(((selling - cost) / selling) * 100, 1) : 0,
      status: state.key,
      status_label: state.label,
      stock_value: round(cost * stockQty),
    };
  });

  const categories = await all(
    "SELECT category FROM products WHERE category <> '' GROUP BY category ORDER BY category COLLATE NOCASE"
  );

  return {
    ok: true,
    products,
    categories: categories.map((r) => String(r.category)),
    count: products.length,
    totals: {
      stock_value: round(products.reduce((s, p) => s + p.stock_value, 0)),
      sell_value: round(products.reduce((s, p) => s + p.selling_price * p.stock_qty, 0)),
      low_stock: products.filter((p) => p.status === 'low').length,
      out_of_stock: products.filter((p) => p.status === 'out').length,
    },
  };
}

/** Create or update a product. */
async function productSave({ body }: Ctx): Promise<any> {
  const data = normaliseProduct(body);
  const id = Math.trunc(Number(body.id ?? 0)) || 0;

  if (data.sku !== '') {
    const clash = await one('SELECT id FROM products WHERE sku = ? AND id <> ?', [data.sku, id]);
    if (clash) {
      throw new ValidationError('That SKU / barcode is already used by another item.');
    }
  }

  if (id > 0) {
    const res = await exec(
      `UPDATE products SET name = ?, sku = ?, category = ?, cost_price = ?,
              selling_price = ?, stock_qty = ?, pack_size = ?, updated_at = datetime('now','localtime')
       WHERE id = ?`,
      [
        data.name,
        data.sku,
        data.category,
        data.cost_price,
        data.selling_price,
        data.stock_qty,
        data.pack_size,
        id,
      ]
    );
    if (res.changes === 0) {
      const exists = await one('SELECT id FROM products WHERE id = ?', [id]);
      if (!exists) throw new ValidationError('Item not found.');
    }
    return { ok: true, id, message: 'Item updated.' };
  }

  const res = await exec(
    `INSERT INTO products (name, sku, category, cost_price, selling_price, stock_qty, pack_size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      data.sku,
      data.category,
      data.cost_price,
      data.selling_price,
      data.stock_qty,
      data.pack_size,
    ]
  );

  return { ok: true, id: res.lastId, message: 'Item added.' };
}

/** Remove a product. Past sales keep their own copy of the item name. */
async function productDelete({ body, query }: Ctx): Promise<any> {
  const id = Math.trunc(Number(body.id ?? query.id ?? 0));
  if (id <= 0) {
    throw new ValidationError('Missing item id.');
  }

  const res = await exec('DELETE FROM products WHERE id = ?', [id]);
  if (res.changes === 0) {
    throw new ValidationError('Item not found.');
  }
  return { ok: true, message: 'Item deleted.' };
}

/** Receive stock: packs × pack_size single pieces added to an item. */
async function productRestock({ body }: Ctx): Promise<any> {
  const id = Math.trunc(Number(body.id ?? 0));
  const packs = Number(body.packs ?? 0);

  if (id <= 0 || !(packs > 0)) {
    throw new ValidationError('Enter how many packs or pieces were received.');
  }

  const product = await one('SELECT * FROM products WHERE id = ?', [id]);
  if (!product) {
    throw new ValidationError('Item not found.');
  }

  const pieces = round(packs * Math.max(1, Number(product.pack_size)), 3);
  await exec(
    `UPDATE products SET stock_qty = stock_qty + ?, updated_at = datetime('now','localtime')
     WHERE id = ?`,
    [pieces, id]
  );

  return {
    ok: true,
    added: pieces,
    message: `Received ${fmtQty(pieces)} pcs of ${product.name}.`,
  };
}

/* ========================================================== point of sale */

/**
 * Records a sale. Every amount is recomputed from the database, so a tampered
 * client cannot change prices, profit or stock levels.
 */
async function posCheckout({ body }: Ctx): Promise<any> {
  const items: any[] = Array.isArray(body.items) ? body.items : [];
  const cashReceived = round(Number(body.cash_received ?? 0));
  const allowNegative = (await setting('allow_negative_stock', '0')) === '1';

  if (items.length === 0) {
    throw new ValidationError('The cart is empty.');
  }

  const conn = await db();
  await beginTx(conn);

  try {
    const saleDate = await localToday();
    let total = 0;
    let cost = 0;
    let count = 0;
    const lines: any[] = [];

    // One row per product: merge duplicate taps into a single quantity.
    const merged = new Map<number, number>();
    for (const item of items) {
      const productId = Math.trunc(Number(item?.product_id ?? 0));
      const quantity = round(Number(item?.qty ?? 0), 3);
      if (productId <= 0 || !(quantity > 0)) continue;
      merged.set(productId, (merged.get(productId) ?? 0) + quantity);
    }

    if (merged.size === 0) {
      throw new ValidationError('Add at least one item with a quantity.');
    }

    const reference = await makeReference(saleDate);

    const inserted = await exec(
      `INSERT INTO transactions
          (reference, item_count, total_amount, total_cost, profit, cash_received, change_due,
           sold_at, sale_date)
       VALUES (?, 0, 0, 0, 0, ?, 0, datetime('now','localtime'), ?)`,
      [reference, cashReceived, saleDate]
    );
    const transactionId = inserted.lastId;

    for (const [productId, quantity] of merged) {
      const product = await one('SELECT * FROM products WHERE id = ?', [productId]);
      if (!product) {
        throw new ValidationError('An item in the cart no longer exists.');
      }

      const available = Number(product.stock_qty);
      if (!allowNegative && quantity > available) {
        throw new ValidationError(
          `Not enough stock for ${product.name} — only ${fmtQty(available)} left.`
        );
      }

      const unitCost = Number(product.cost_price);
      const unitSelling = Number(product.selling_price);
      const lineTotal = round(unitSelling * quantity);
      const lineProfit = round(lineTotal - unitCost * quantity);

      await exec(
        `INSERT INTO transaction_items
            (transaction_id, product_id, product_name, qty, cost_price, selling_price,
             discount, line_total, line_profit)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          transactionId,
          productId,
          String(product.name),
          quantity,
          unitCost,
          unitSelling,
          lineTotal,
          lineProfit,
        ]
      );

      await exec(
        `UPDATE products SET stock_qty = stock_qty - ?, updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [quantity, productId]
      );

      total = round(total + lineTotal);
      cost = round(cost + unitCost * quantity);
      count += Math.ceil(quantity);

      lines.push({
        product_id: productId,
        name: String(product.name),
        qty: quantity,
        selling_price: unitSelling,
        line_total: lineTotal,
        line_profit: lineProfit,
        stock_left: round(available - quantity, 3),
      });
    }

    total = round(total);
    cost = round(cost);
    const profit = round(total - cost);

    if (!(cashReceived > 0)) {
      throw new ValidationError('Enter the cash received from the customer.');
    }
    if (cashReceived < total) {
      throw new ValidationError(
        `Cash received is short by ${await money(round(total - cashReceived))}.`
      );
    }

    const change = round(cashReceived - total);

    await exec(
      `UPDATE transactions SET item_count = ?, total_amount = ?, total_cost = ?,
              profit = ?, change_due = ? WHERE id = ?`,
      [count, total, cost, profit, change, transactionId]
    );

    await commitTx(conn);

    return {
      ok: true,
      sale: {
        id: transactionId,
        reference,
        sold_at: localDateTime(),
        item_count: count,
        total_amount: total,
        total_cost: cost,
        profit,
        cash_received: cashReceived,
        change_due: change,
        lines,
      },
      message: `Sale saved. Change ${await money(change)}.`,
      store: await setting('store_name', APP_NAME),
      cashier: await setting('owner_name', ''),
      receipt_footer: await setting('receipt_footer', ''),
    };
  } catch (err) {
    await rollback();
    throw err;
  }
}

/* ================================================ purchase history / voids */

/** Completed sales with their voided totals, newest first. */
async function salesHistory({ query }: Ctx): Promise<any> {
  const q = (query.q ?? '').trim();
  const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50) || 50));

  let sql = `SELECT t.id, t.reference, t.sold_at, t.sale_date, t.item_count,
                    t.total_amount, t.total_cost, t.profit, t.cash_received, t.change_due,
                    (SELECT COUNT(*) FROM transaction_items ti WHERE ti.transaction_id = t.id) AS line_count,
                    COALESCE((SELECT SUM(v.refund_amount) FROM sale_voids v
                              WHERE v.transaction_id = t.id), 0) AS voided_amount,
                    COALESCE((SELECT COUNT(*) FROM sale_voids v
                              WHERE v.transaction_id = t.id), 0) AS void_count
             FROM transactions t WHERE 1 = 1`;
  const params: any[] = [];

  if (q !== '') {
    sql += ' AND t.reference LIKE ?';
    params.push(`%${q}%`);
  }

  sql += ` ORDER BY t.sold_at DESC, t.id DESC LIMIT ${limit}`;

  const rows = await all(sql, params);

  return {
    ok: true,
    sales: rows.map((r) => ({
      id: Number(r.id),
      reference: String(r.reference),
      sold_at: String(r.sold_at),
      sale_date: String(r.sale_date),
      item_count: Number(r.item_count),
      line_count: Number(r.line_count),
      total_amount: round(Number(r.total_amount)),
      total_cost: round(Number(r.total_cost)),
      profit: round(Number(r.profit)),
      cash_received: round(Number(r.cash_received)),
      change_due: round(Number(r.change_due)),
      voided_amount: round(Number(r.voided_amount)),
      void_count: Number(r.void_count),
    })),
  };
}

/** One sale with the items still on it, plus every removal logged against it. */
async function saleDetail({ query }: Ctx): Promise<any> {
  const id = Math.trunc(Number(query.id ?? 0));

  const sale = await one('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!sale) {
    throw new ValidationError('Sale not found.');
  }

  const lines = await all(
    `SELECT id, product_id, product_name, qty, cost_price, selling_price, line_total, line_profit
     FROM transaction_items WHERE transaction_id = ? ORDER BY id ASC`,
    [id]
  );

  const voids = await all(
    `SELECT id, item_id, product_name, qty, unit_price, refund_amount, cost_price, reason, voided_at
     FROM sale_voids WHERE transaction_id = ? ORDER BY id DESC`,
    [id]
  );

  const voidRows = voids.map((r) => ({
    id: Number(r.id),
    item_id: r.item_id !== null && r.item_id !== undefined ? Number(r.item_id) : null,
    name: String(r.product_name),
    qty: round(Number(r.qty), 3),
    unit_price: round(Number(r.unit_price)),
    refund_amount: round(Number(r.refund_amount)),
    cost_price: round(Number(r.cost_price)),
    reason: String(r.reason ?? ''),
    voided_at: String(r.voided_at),
  }));

  return {
    ok: true,
    sale: {
      id: Number(sale.id),
      reference: String(sale.reference),
      sold_at: String(sale.sold_at),
      sale_date: String(sale.sale_date),
      item_count: Number(sale.item_count),
      total_amount: round(Number(sale.total_amount)),
      total_cost: round(Number(sale.total_cost)),
      profit: round(Number(sale.profit)),
      cash_received: round(Number(sale.cash_received)),
      change_due: round(Number(sale.change_due)),
      voided_amount: round(voidRows.reduce((s, r) => s + r.refund_amount, 0)),
    },
    lines: lines.map((r) => ({
      id: Number(r.id),
      product_id: r.product_id !== null && r.product_id !== undefined ? Number(r.product_id) : null,
      name: String(r.product_name),
      qty: round(Number(r.qty), 3),
      cost_price: round(Number(r.cost_price)),
      selling_price: round(Number(r.selling_price)),
      line_total: round(Number(r.line_total)),
      line_profit: round(Number(r.line_profit)),
    })),
    voids: voidRows,
  };
}

/**
 * Take part or all of an item back from a completed sale.
 *
 * The pieces go back on the shelf, the sale keeps the reduced total so every
 * report stays net of refunds, and the removal is appended to sale_voids.
 */
async function saleVoidItem({ body }: Ctx): Promise<any> {
  const saleId = Math.trunc(Number(body.transaction_id ?? 0));
  const itemId = Math.trunc(Number(body.item_id ?? 0));
  const quantity = round(Number(body.qty ?? 0), 3);
  const unit = round(Number(body.unit_price ?? 0));
  const reason = String(body.reason ?? '').trim();

  if (saleId <= 0 || itemId <= 0) {
    throw new ValidationError('Missing sale or item.');
  }
  if (!(quantity > 0)) {
    throw new ValidationError('Enter how many pieces are being returned.');
  }
  if (unit < 0) {
    throw new ValidationError('The refund price cannot be negative.');
  }

  const conn = await db();
  await beginTx(conn);

  try {
    const sale = await one('SELECT * FROM transactions WHERE id = ?', [saleId]);
    if (!sale) {
      throw new ValidationError('Sale not found.');
    }

    const item = await one(
      'SELECT * FROM transaction_items WHERE id = ? AND transaction_id = ?',
      [itemId, saleId]
    );
    if (!item) {
      throw new ValidationError('That item is not part of this sale.');
    }

    const lineQty = round(Number(item.qty), 3);
    const unitCost = round(Number(item.cost_price));
    const unitSell = round(Number(item.selling_price));

    if (quantity > lineQty) {
      throw new ValidationError(
        `Only ${fmtQty(lineQty)} pcs of ${item.product_name} are still on this sale.`
      );
    }
    if (unit > unitSell) {
      throw new ValidationError(
        `The refund cannot exceed the ${await money(unitSell)} charged for each piece.`
      );
    }

    const refund = round(unit * quantity);
    const costBack = round(unitCost * quantity);

    // The whole line is gone, drop it; otherwise shrink what is left.
    if (quantity >= lineQty) {
      await exec('DELETE FROM transaction_items WHERE id = ?', [itemId]);
    } else {
      const leftQty = round(lineQty - quantity, 3);
      const leftTotal = round(unitSell * leftQty);
      const leftProfit = round(leftTotal - unitCost * leftQty);
      await exec(
        'UPDATE transaction_items SET qty = ?, line_total = ?, line_profit = ? WHERE id = ?',
        [leftQty, leftTotal, leftProfit, itemId]
      );
    }

    // The goods come back on the shelf, unless the product was deleted since.
    if (item.product_id !== null && item.product_id !== undefined) {
      await exec(
        `UPDATE products SET stock_qty = stock_qty + ?, updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [quantity, Number(item.product_id)]
      );
    }

    const total = round(Number(sale.total_amount) - refund);
    const cost = round(Number(sale.total_cost) - costBack);
    const profit = round(total - cost);
    const count = Math.max(0, Number(sale.item_count) - Math.ceil(quantity));

    await exec(
      `UPDATE transactions SET item_count = ?, total_amount = ?, total_cost = ?, profit = ?
       WHERE id = ?`,
      [count, total, cost, profit, saleId]
    );

    await exec(
      `INSERT INTO sale_voids
          (transaction_id, item_id, product_name, qty, unit_price, refund_amount, cost_price, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        saleId,
        itemId,
        String(item.product_name),
        quantity,
        unit,
        refund,
        unitCost,
        reason,
      ]
    );

    await commitTx(conn);

    return {
      ok: true,
      message: `Returned ${fmtQty(quantity)} × ${item.product_name} and refunded ${await money(
        refund
      )}.`,
      sale: {
        id: saleId,
        item_count: count,
        total_amount: total,
        total_cost: cost,
        profit,
        refund_amount: refund,
      },
    };
  } catch (err) {
    await rollback();
    throw err;
  }
}

/* ================================================================ reports */

/** Totals, daily series, best sellers and stock alerts for a date range. */
async function reportSummary({ query }: Ctx): Promise<any> {
  const [from, to] = dateRange(query.from, query.to);
  return { ok: true, ...(await buildReport(from, to)) };
}

/* ============================================================ csv transfer */

/** Builds the full product catalogue as a CSV string. */
async function exportProducts(): Promise<any> {
  const rows = await all(
    `SELECT name, sku, category, cost_price, selling_price, stock_qty, pack_size
     FROM products ORDER BY name COLLATE NOCASE`
  );

  const out: any[][] = [[...CSV_HEADERS, 'stock_value', 'unit_profit', 'margin_percent']];

  for (const row of rows) {
    const cost = Number(row.cost_price);
    const selling = Number(row.selling_price);
    const stock = Number(row.stock_qty);

    out.push([
      String(row.name),
      String(row.sku ?? ''),
      String(row.category ?? ''),
      num(cost, 2),
      num(selling, 2),
      fmtQty(stock),
      Number(row.pack_size),
      num(cost * stock, 2),
      num(selling - cost, 2),
      selling > 0 ? num(((selling - cost) / selling) * 100, 1) : '0.0',
    ]);
  }

  return {
    filename: `inventory-${stamp()}.csv`,
    mime: 'text/csv',
    content: toCsv(out),
  };
}

/** The sales log as CSV: one row per sale, or one row per line item. */
async function exportSales({ query }: Ctx): Promise<any> {
  const [from, to] = dateRange(query.from, query.to);
  const detailed = (query.detail ?? '0') === '1';

  if (detailed) {
    const rows = await all(
      `SELECT t.sold_at, t.reference, ti.product_name, ti.qty, ti.cost_price, ti.selling_price,
              ti.line_total, ti.line_profit
       FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id
       WHERE t.sale_date BETWEEN ? AND ?
       ORDER BY t.sold_at ASC, ti.id ASC`,
      [from, to]
    );

    const out: any[][] = [
      ['sold_at', 'reference', 'item', 'qty', 'unit_cost', 'unit_price', 'line_total', 'line_profit'],
      ...rows.map((r) => [
        String(r.sold_at),
        String(r.reference),
        String(r.product_name),
        fmtQty(r.qty),
        num(r.cost_price, 2),
        num(r.selling_price, 2),
        num(r.line_total, 2),
        num(r.line_profit, 2),
      ]),
    ];

    return {
      filename: `sales-items-${from}_to_${to}.csv`,
      mime: 'text/csv',
      content: toCsv(out),
    };
  }

  const rows = await all(
    `SELECT sold_at, reference, item_count, total_amount, total_cost, profit, cash_received, change_due
     FROM transactions WHERE sale_date BETWEEN ? AND ? ORDER BY sold_at ASC`,
    [from, to]
  );

  const out: any[][] = [
    ['sold_at', 'reference', 'items', 'total_amount', 'total_cost', 'profit', 'cash_received', 'change_due'],
    ...rows.map((r) => [
      String(r.sold_at),
      String(r.reference),
      Number(r.item_count),
      num(r.total_amount, 2),
      num(r.total_cost, 2),
      num(r.profit, 2),
      num(r.cash_received, 2),
      num(r.change_due, 2),
    ]),
  ];

  return {
    filename: `sales-${from}_to_${to}.csv`,
    mime: 'text/csv',
    content: toCsv(out),
  };
}

/** An empty CSV showing the expected columns. */
async function csvTemplate(): Promise<any> {
  return {
    filename: 'inventory-template.csv',
    mime: 'text/csv',
    content: toCsv([
      [...CSV_HEADERS],
      ['Bear Brand 300ml', 'BB300', 'Drinks', '21.50', '26.00', '24', '6'],
      ['Lucky Me Pancit Canton', 'LM-PC', 'Noodles', '10.00', '15.00', '48', '12'],
    ]),
  };
}

/** Serialises every table into one restorable JSON backup file. */
async function backupDb(): Promise<any> {
  const conn = await db();
  const dump = await conn.exportToJson('full', false);

  return {
    filename: `store-pos-backup-${stamp()}.json`,
    mime: 'application/json',
    content: JSON.stringify(
      { app: APP_NAME, database: DB_NAME, exported_at: localDateTime(), dump },
      null,
      2
    ),
  };
}

/**
 * Bulk upload inventory from CSV text.
 * mode=merge (default) adds and updates; mode=replace clears the catalog first.
 */
async function importProducts({ body }: Ctx): Promise<any> {
  const raw = String(body.csv ?? '');
  const mode = body.mode === 'replace' ? 'replace' : 'merge';

  if (raw.trim() === '') {
    throw new ValidationError('Choose a CSV file to upload.');
  }

  const records = parseCsv(raw);
  if (records.length === 0) {
    throw new ValidationError('The CSV file is empty.');
  }

  const header = records[0].map((h) => h.replace(/ /g, '_').toLowerCase().trim());
  if (!header.includes('name')) {
    throw new ValidationError(
      'The CSV needs a header row with at least a "name" column — download the template to see the format.'
    );
  }

  const number = (value: any): number => Number(String(value ?? '').replace(/[, ₱$]/g, '')) || 0;

  const conn = await db();
  await beginTx(conn);

  try {
    if (mode === 'replace') {
      await exec('DELETE FROM products');
    }

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let index = 1; index < records.length; index++) {
      const line = index + 1; // 1-based, counting the header
      const cells = records[index];

      // Skip blank lines.
      if (cells.length === 0 || (cells.length === 1 && cells[0].trim() === '')) continue;

      const record: Record<string, string> = {};
      header.forEach((column, i) => {
        record[column] = cells[i] ?? '';
      });

      let data;
      try {
        data = normaliseProduct({
          name: record.name ?? '',
          sku: record.sku ?? record.barcode ?? '',
          category: record.category ?? '',
          cost_price: number(record.cost_price ?? record.cost ?? 0),
          selling_price: number(record.selling_price ?? record.price ?? 0),
          stock_qty: number(record.stock_qty ?? record.stock ?? record.quantity ?? 0),
          pack_size: Math.trunc(Number(record.pack_size ?? 1)),
        });
      } catch (err) {
        errors.push(`Line ${line}: ${(err as Error).message}`);
        continue;
      }

      let existingId = 0;
      if (data.sku !== '') {
        const found = await one("SELECT id FROM products WHERE sku = ? AND sku <> ''", [data.sku]);
        if (found) existingId = Number(found.id);
      }

      if (existingId) {
        await exec(
          `UPDATE products SET name = ?, category = ?, cost_price = ?, selling_price = ?,
                  stock_qty = ?, pack_size = ?, updated_at = datetime('now','localtime')
           WHERE id = ?`,
          [
            data.name,
            data.category,
            data.cost_price,
            data.selling_price,
            data.stock_qty,
            data.pack_size,
            existingId,
          ]
        );
        updated++;
      } else {
        await exec(
          `INSERT INTO products (name, sku, category, cost_price, selling_price, stock_qty, pack_size)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            data.name,
            data.sku,
            data.category,
            data.cost_price,
            data.selling_price,
            data.stock_qty,
            data.pack_size,
          ]
        );
        inserted++;
      }
    }

    await commitTx(conn);

    return {
      ok: true,
      inserted,
      updated,
      errors: errors.slice(0, 12),
      message: `Imported ${inserted} new and updated ${updated} item(s).`,
    };
  } catch (err) {
    await rollback();
    throw err;
  }
}

/* ================================================================ settings */

async function settingsSave({ body }: Ctx): Promise<any> {
  if (body.store_name !== undefined) {
    await saveSetting('store_name', String(body.store_name).trim() || APP_NAME);
  }
  if (body.owner_name !== undefined) {
    await saveSetting('owner_name', String(body.owner_name).trim());
  }
  if (body.currency !== undefined) {
    await saveSetting('currency', String(body.currency).trim() || DEFAULT_CURRENCY);
  }
  if (body.low_stock !== undefined) {
    await saveSetting('low_stock', String(Math.max(0, Number(body.low_stock) || 0)));
  }
  if (body.receipt_footer !== undefined) {
    await saveSetting('receipt_footer', String(body.receipt_footer).trim());
  }
  if (body.allow_negative_stock !== undefined) {
    await saveSetting('allow_negative_stock', body.allow_negative_stock ? '1' : '0');
  }

  return { ok: true, message: 'Settings saved.' };
}

/**
 * Reads every setting at once. The PHP pages used to inject these into
 * window.*_CONFIG while rendering; the app boots from this instead.
 */
async function settingsGet(): Promise<any> {
  const rows = await all('SELECT key, value FROM settings');
  const store: Record<string, string> = {};
  for (const row of rows) {
    store[String(row.key)] = String(row.value);
  }

  return {
    ok: true,
    settings: store,
    store_name: store.store_name || APP_NAME,
    owner_name: store.owner_name || '',
    currency: store.currency || DEFAULT_CURRENCY,
    receipt_footer: store.receipt_footer || '',
    low_stock: Number(store.low_stock ?? DEFAULT_LOW_STOCK) || 0,
    allow_negative_stock: store.allow_negative_stock === '1',
  };
}

/** Row counts and on-disk size for the Settings page's "Offline data" card. */
async function appStats(): Promise<any> {
  const [products, sales, pageCount, pageSize, version] = await Promise.all([
    scalar('SELECT COUNT(*) FROM products'),
    scalar('SELECT COUNT(*) FROM transactions'),
    scalar('PRAGMA page_count'),
    scalar('PRAGMA page_size'),
    scalar('SELECT sqlite_version()'),
  ]);

  return {
    ok: true,
    products: Number(products ?? 0),
    sales: Number(sales ?? 0),
    bytes: (Number(pageCount ?? 0) || 0) * (Number(pageSize ?? 0) || 0),
    sqlite_version: String(version ?? ''),
    server_time: localDateTime(),
  };
}

/* ==================================================================== csv */

/** Serialises rows the way PHP's fputcsv() does. */
function toCsv(rows: any[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

function csvField(value: any): string {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Minimal RFC-4180 reader, tolerant of a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];

  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // Swallow CR; the LF that follows ends the record.
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/* ================================================================== dates */

function localDateTime(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

/** SQLite's own local clock, so the sale date always matches sold_at. */
async function localToday(): Promise<string> {
  const row = await one("SELECT date('now','localtime') AS d");
  return String(row?.d ?? localDateTime().slice(0, 10));
}

export type { Row };
export { lowStockItems, recentSales, reportTotals };