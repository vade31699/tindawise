/**
 * Sales aggregation — the on-device counterpart of includes/reports.php.
 *
 * Every amount comes straight from the SQLite tables, so reports, the dashboard
 * and the POS receipt can never disagree with each other.
 */

import { all, one } from './db';
import { lowStockThreshold, localDate, parseDate, round, stockStatus } from './helpers';

export type Totals = {
  transactions: number;
  items: number;
  revenue: number;
  cost: number;
  profit: number;
  average_sale: number;
  margin: number;
};

export type DailyRow = {
  date: string;
  transactions: number;
  items: number;
  revenue: number;
  cost: number;
  profit: number;
};

export type TopProduct = {
  name: string;
  qty: number;
  revenue: number;
  profit: number;
};

export type RecentSale = {
  reference: string;
  total_amount: number;
  profit: number;
  sold_at: string;
  item_count: number;
};

export type LowStockItem = {
  name: string;
  stock_qty: number;
  status: string;
  status_label: string;
};

export type Report = {
  from: string;
  to: string;
  totals: Totals;
  daily: DailyRow[];
  top_products: TopProduct[];
  recent_sales: RecentSale[];
  low_stock_items: LowStockItem[];
};

/** Normalises a from/to pair, defaulting to today and ordering them. */
export function dateRange(from?: any, to?: any): [string, string] {
  const isDate = (v: any): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

  let start = isDate(from) ? from : localDate(new Date());
  let end = isDate(to) ? to : start;

  if (parseDate(end).getTime() < parseDate(start).getTime()) {
    [start, end] = [end, start];
  }

  return [start, end];
}

/** Totals, per-day series, best sellers and recent sales for a date range. */
export async function buildReport(from: string, to: string): Promise<Report> {
  const rows = await all(
    `SELECT sale_date, COUNT(*) AS transactions, SUM(item_count) AS items,
            SUM(total_amount) AS revenue, SUM(total_cost) AS cost, SUM(profit) AS profit
     FROM transactions WHERE sale_date BETWEEN ? AND ?
     GROUP BY sale_date ORDER BY sale_date ASC`,
    [from, to]
  );

  const byDate = new Map<string, DailyRow>();
  for (const row of rows) {
    byDate.set(String(row.sale_date), {
      date: String(row.sale_date),
      transactions: Number(row.transactions),
      items: Number(row.items),
      revenue: round(Number(row.revenue)),
      cost: round(Number(row.cost)),
      profit: round(Number(row.profit)),
    });
  }

  // Walk every calendar day so charts and tables have no gaps.
  const daily: DailyRow[] = [];
  const cursor = parseDate(from);
  const last = parseDate(to).getTime();
  while (cursor.getTime() <= last) {
    const key = localDate(cursor);
    daily.push(
      byDate.get(key) ?? {
        date: key,
        transactions: 0,
        items: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
      }
    );
    cursor.setDate(cursor.getDate() + 1);
  }

  const summed = daily.reduce(
    (carry, day) => {
      carry.transactions += day.transactions;
      carry.items += day.items;
      carry.revenue += day.revenue;
      carry.cost += day.cost;
      carry.profit += day.profit;
      return carry;
    },
    { transactions: 0, items: 0, revenue: 0, cost: 0, profit: 0 }
  );

  const totals: Totals = {
    transactions: summed.transactions,
    items: round(summed.items, 3),
    revenue: round(summed.revenue),
    cost: round(summed.cost),
    profit: round(summed.profit),
    average_sale:
      summed.transactions > 0 ? round(summed.revenue / summed.transactions) : 0,
    margin: summed.revenue > 0 ? round((summed.profit / summed.revenue) * 100, 1) : 0,
  };

  // Quantities are reported in single pieces, so pack lines are converted
  // using the pack size recorded on the product.
  const topRows = await all(
    `SELECT ti.product_name,
            SUM(ti.qty * CASE WHEN ti.unit = 'pack'
                              THEN MAX(1, COALESCE(p.pack_size, 1))
                              ELSE 1 END) AS qty,
            SUM(ti.line_total) AS revenue,
            SUM(ti.line_profit) AS profit
     FROM transaction_items ti
     JOIN transactions t ON t.id = ti.transaction_id
     LEFT JOIN products p ON p.id = ti.product_id
     WHERE t.sale_date BETWEEN ? AND ?
     GROUP BY ti.product_name
     ORDER BY qty DESC, revenue DESC LIMIT 8`,
    [from, to]
  );

  const topProducts: TopProduct[] = topRows.map((r) => ({
    name: String(r.product_name),
    qty: round(Number(r.qty), 3),
    revenue: round(Number(r.revenue)),
    profit: round(Number(r.profit)),
  }));

  return {
    from,
    to,
    totals,
    daily,
    top_products: topProducts,
    recent_sales: await recentSales(8, from, to),
    low_stock_items: await lowStockItems(6),
  };
}

/** Just the totals block for a range (cheap enough to reuse at this scale). */
export async function reportTotals(from: string, to: string): Promise<Totals> {
  return (await buildReport(from, to)).totals;
}

/** Products at or below the low-stock threshold. */
export async function lowStockItems(limit = 6): Promise<LowStockItem[]> {
  const lowStock = await lowStockThreshold();
  const rows = await all(
    `SELECT name, stock_qty FROM products WHERE stock_qty <= ?
     ORDER BY stock_qty ASC, name COLLATE NOCASE LIMIT ?`,
    [lowStock, Math.max(1, limit)]
  );

  return rows.map((r) => {
    const status = stockStatus(Number(r.stock_qty), lowStock);
    return {
      name: String(r.name),
      stock_qty: Number(r.stock_qty),
      status: status.key,
      status_label: status.label,
    };
  });
}

/** Latest sales, optionally limited to a date window. */
export async function recentSales(
  limit = 6,
  from?: string,
  to?: string
): Promise<RecentSale[]> {
  const bounded = from !== undefined && to !== undefined;
  const sql = `SELECT reference, total_amount, profit, sold_at, item_count FROM transactions
               ${bounded ? 'WHERE sale_date BETWEEN ? AND ?' : ''}
               ORDER BY sold_at DESC, id DESC LIMIT ?`;

  const rows = await all(sql, bounded ? [from, to, Math.max(1, limit)] : [Math.max(1, limit)]);

  return rows.map((r) => ({
    reference: String(r.reference),
    total_amount: round(Number(r.total_amount)),
    profit: round(Number(r.profit)),
    sold_at: String(r.sold_at),
    item_count: Number(r.item_count),
  }));
}

/** Dashboard snapshot: today, last 7 days, this month. */
export async function dashboardStats() {
  const day = localDate(new Date());
  const weekStart = await shift(-6);
  const month = day.slice(0, 8) + '01';

  // `week` is just the totals (as in the PHP version); `week_daily` is the
  // per-day series the dashboard chart needs.
  const weekReport = await buildReport(weekStart, day);

  const [monthTotals, lowStock, recent] = await Promise.all([
    reportTotals(month, day),
    lowStockItems(6),
    recentSales(6),
  ]);

  return {
    ok: true,
    today: buildToday(weekReport),
    week: weekReport.totals,
    week_daily: weekReport.daily,
    month: monthTotals,
    low_stock_items: lowStock,
    recent_sales: recent,
  };
}

/** Today's report, reusing the week report when today is inside the range. */
function buildToday(weekReport: Report): Report {
  const last = weekReport.daily[weekReport.daily.length - 1];
  const empty: DailyRow = {
    date: weekReport.to,
    transactions: 0,
    items: 0,
    revenue: 0,
    cost: 0,
    profit: 0,
  };
  const today = last ?? empty;

  const totals: Totals = {
    transactions: today.transactions,
    items: round(today.items, 3),
    revenue: round(today.revenue),
    cost: round(today.cost),
    profit: round(today.profit),
    average_sale:
      today.transactions > 0 ? round(today.revenue / today.transactions) : 0,
    margin: today.revenue > 0 ? round((today.profit / today.revenue) * 100, 1) : 0,
  };

  return {
    from: weekReport.to,
    to: weekReport.to,
    totals,
    daily: [today],
    top_products: [],
    recent_sales: weekReport.recent_sales,
    low_stock_items: weekReport.low_stock_items,
  };
}

async function shift(days: number): Promise<string> {
  const row = await one("SELECT date('now','localtime',?) AS d", [`${days} days`]);
  return String(row?.d ?? localDate(new Date()));
}