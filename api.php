<?php
/**
 * Single JSON/CSV endpoint for the whole app.
 *
 * Usage from the UI:  api.php?action=pos_checkout   (POST, JSON body)
 *                     api.php?action=export_sales   (GET, streams a CSV file)
 *
 * Every action answers with { ok: true, ... } or { ok: false, error: "..." }.
 */

declare(strict_types=1);

require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/reports.php';

/** Column order used by the inventory CSV export / import / template. */
const CSV_HEADERS = ['name', 'sku', 'category', 'cost_price', 'selling_price', 'stock_qty', 'pack_size'];

$action = (string) ($_GET['action'] ?? '');

try {
    switch ($action) {
        // ---------------------------------------------------------- products
        case 'products_list':   products_list();   break;
        case 'product_save':    product_save();    break;
        case 'product_delete':  product_delete();  break;
        case 'product_restock': product_restock(); break;

        // -------------------------------------------------------------- sales
        case 'pos_checkout': pos_checkout(); break;

        // ------------------------------------------------------------ reports
        case 'report_summary':  report_summary();  break;
        case 'dashboard_stats': dashboard_stats(); break;

        // -------------------------------------------------------- csv transfer
        case 'export_products': export_products(); break;
        case 'export_sales':    export_sales();    break;
        case 'import_products': import_products(); break;
        case 'csv_template':    csv_template();    break;
        case 'backup_db':       backup_db();       break;

        // ----------------------------------------------------------- settings
        case 'settings_save': settings_save(); break;

        default:
            json_error('Unknown action: ' . $action, 404);
    }
} catch (InvalidArgumentException $e) {
    json_error($e->getMessage(), 422);
} catch (Throwable $e) {
    json_error('Server error: ' . $e->getMessage(), 500);
}

/* =========================================================================
   Products
   ========================================================================= */

/** Searchable product list. Query params: q, category, status, limit. */
function products_list(): void
{
    $pdo      = db();
    $q        = trim((string) ($_GET['q'] ?? ''));
    $category = trim((string) ($_GET['category'] ?? ''));
    $status   = (string) ($_GET['status'] ?? '');
    $limit    = min(500, max(1, (int) ($_GET['limit'] ?? 300)));
    $lowStock = (float) setting('low_stock', (string) DEFAULT_LOW_STOCK);

    $sql    = 'SELECT * FROM products WHERE 1 = 1';
    $params = [];

    if ($q !== '') {
        $sql .= ' AND (name LIKE :q OR sku LIKE :q OR category LIKE :q)';
        $params[':q'] = '%' . $q . '%';
    }
    if ($category !== '') {
        $sql .= ' AND category = :category';
        $params[':category'] = $category;
    }
    if ($status === 'low') {
        $sql .= ' AND stock_qty > 0 AND stock_qty <= :low';
        $params[':low'] = $lowStock;
    } elseif ($status === 'out') {
        $sql .= ' AND stock_qty <= 0';
    } elseif ($status === 'instock') {
        $sql .= ' AND stock_qty > :low';
        $params[':low'] = $lowStock;
    }

    $sql .= ' ORDER BY name COLLATE NOCASE LIMIT ' . $limit;

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $products = array_map(static function (array $row) use ($lowStock): array {
        [$statusKey, $statusLabel] = stock_status((float) $row['stock_qty'], $lowStock);
        $cost    = (float) $row['cost_price'];
        $selling = (float) $row['selling_price'];

        return [
            'id'            => (int) $row['id'],
            'name'          => $row['name'],
            'sku'           => (string) $row['sku'],
            'category'      => (string) $row['category'],
            'cost_price'    => $cost,
            'selling_price' => $selling,
            'stock_qty'     => (float) $row['stock_qty'],
            'pack_size'     => (int) $row['pack_size'],
            'unit_profit'   => round($selling - $cost, 2),
            'margin'        => $selling > 0 ? round((($selling - $cost) / $selling) * 100, 1) : 0.0,
            'status'        => $statusKey,
            'status_label'  => $statusLabel,
            'stock_value'   => round($cost * (float) $row['stock_qty'], 2),
        ];
    }, $stmt->fetchAll());

    $sellValue = array_sum(array_map(
        static fn(array $p): float => $p['selling_price'] * $p['stock_qty'],
        $products
    ));

    json_response([
        'ok'         => true,
        'products'   => $products,
        'categories' => $pdo->query(
            "SELECT category FROM products WHERE category <> '' GROUP BY category ORDER BY category COLLATE NOCASE"
        )->fetchAll(PDO::FETCH_COLUMN),
        'count'      => count($products),
        'totals'     => [
            'stock_value'  => round(array_sum(array_column($products, 'stock_value')), 2),
            'sell_value'   => round($sellValue, 2),
            'low_stock'    => count(array_filter($products, static fn(array $p): bool => $p['status'] === 'low')),
            'out_of_stock' => count(array_filter($products, static fn(array $p): bool => $p['status'] === 'out')),
        ],
    ]);
}

/** Create or update a product. */
function product_save(): void
{
    $input = request_input();
    $data  = normalise_product($input);
    $id    = (int) ($input['id'] ?? 0);
    $pdo   = db();

    if ($data['sku'] !== '') {
        $check = $pdo->prepare('SELECT id FROM products WHERE sku = :sku AND id <> :id');
        $check->execute([':sku' => $data['sku'], ':id' => $id]);
        if ($check->fetchColumn()) {
            json_error('That SKU / barcode is already used by another item.', 409);
        }
    }

    if ($id > 0) {
        $stmt = $pdo->prepare(
            "UPDATE products SET name = :name, sku = :sku, category = :category,
                    cost_price = :cost, selling_price = :selling, stock_qty = :stock,
                    pack_size = :pack, updated_at = datetime('now','localtime')
             WHERE id = :id"
        );
        $stmt->execute([
            ':name' => $data['name'], ':sku' => $data['sku'], ':category' => $data['category'],
            ':cost' => $data['cost_price'], ':selling' => $data['selling_price'],
            ':stock' => $data['stock_qty'], ':pack' => $data['pack_size'], ':id' => $id,
        ]);
        $message = 'Item updated.';
    } else {
        $stmt = $pdo->prepare(
            'INSERT INTO products (name, sku, category, cost_price, selling_price, stock_qty, pack_size)
             VALUES (:name, :sku, :category, :cost, :selling, :stock, :pack)'
        );
        $stmt->execute([
            ':name' => $data['name'], ':sku' => $data['sku'], ':category' => $data['category'],
            ':cost' => $data['cost_price'], ':selling' => $data['selling_price'],
            ':stock' => $data['stock_qty'], ':pack' => $data['pack_size'],
        ]);
        $id      = (int) $pdo->lastInsertId();
        $message = 'Item added.';
    }

    json_response(['ok' => true, 'id' => $id, 'message' => $message]);
}

/** Remove a product. Past sales keep their own copy of the item name. */
function product_delete(): void
{
    $id = (int) (request_input()['id'] ?? $_GET['id'] ?? 0);
    if ($id <= 0) {
        json_error('Missing item id.');
    }

    $stmt = db()->prepare('DELETE FROM products WHERE id = :id');
    $stmt->execute([':id' => $id]);

    if ($stmt->rowCount() === 0) {
        json_error('Item not found.', 404);
    }
    json_response(['ok' => true, 'message' => 'Item deleted.']);
}

/** Receive stock: packs × pack_size single pieces added to an item. */
function product_restock(): void
{
    $input = request_input();
    $id    = (int) ($input['id'] ?? 0);
    $packs = (float) ($input['packs'] ?? 0);

    if ($id <= 0 || $packs <= 0) {
        json_error('Enter how many packs or pieces were received.');
    }

    $pdo  = db();
    $stmt = $pdo->prepare('SELECT * FROM products WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $product = $stmt->fetch();

    if (!$product) {
        json_error('Item not found.', 404);
    }

    $pieces = round($packs * max(1, (int) $product['pack_size']), 3);
    $update = $pdo->prepare(
        "UPDATE products SET stock_qty = stock_qty + :pieces,
                updated_at = datetime('now','localtime') WHERE id = :id"
    );
    $update->execute([':pieces' => $pieces, ':id' => $id]);

    json_response([
        'ok'      => true,
        'added'   => $pieces,
        'message' => 'Received ' . qty($pieces) . ' pcs of ' . $product['name'] . '.',
    ]);
}

/* =========================================================================
   Point of sale
   ========================================================================= */

/**
 * Records a sale. The server recomputes every amount from the database, so a
 * tampered client cannot change prices, profit or stock levels.
 */
function pos_checkout(): void
{
    $input         = request_input();
    $items         = $input['items'] ?? [];
    $cashReceived  = round((float) ($input['cash_received'] ?? 0), 2);
    $allowNegative = setting('allow_negative_stock', '0') === '1';

    if (!is_array($items) || $items === []) {
        json_error('The cart is empty.');
    }

    $pdo = db();
    $pdo->beginTransaction();

    try {
        $saleDate = date('Y-m-d');
        $total    = 0.0;
        $cost     = 0.0;
        $count    = 0;
        $lines    = [];

        $productStmt = $pdo->prepare('SELECT * FROM products WHERE id = :id');
        $insertItem  = $pdo->prepare(
            'INSERT INTO transaction_items
                (transaction_id, product_id, product_name, qty, cost_price, selling_price, discount, line_total, line_profit)
             VALUES (:transaction_id, :product_id, :product_name, :qty, :cost_price, :selling_price, :discount, :line_total, :line_profit)'
        );
        $updateStock = $pdo->prepare(
            "UPDATE products SET stock_qty = stock_qty - :qty, updated_at = datetime('now','localtime') WHERE id = :id"
        );

        // One row per product: merge duplicate taps into a single quantity.
        $merged = [];
        foreach ($items as $item) {
            $productId = (int) ($item['product_id'] ?? 0);
            $qty       = round((float) ($item['qty'] ?? 0), 3);
            if ($productId <= 0 || $qty <= 0) {
                continue;
            }
            $merged[$productId] = ($merged[$productId] ?? 0) + $qty;
        }

        if ($merged === []) {
            throw new InvalidArgumentException('Add at least one item with a quantity.');
        }

        $reference = make_reference($pdo, $saleDate);

        $transaction = $pdo->prepare(
            "INSERT INTO transactions
                (reference, item_count, total_amount, total_cost, profit, cash_received, change_due, sold_at, sale_date)
             VALUES (:reference, 0, 0, 0, 0, :cash, 0, datetime('now','localtime'), :sale_date)"
        );
        $transaction->execute([
            ':reference' => $reference,
            ':cash'      => $cashReceived,
            ':sale_date' => $saleDate,
        ]);
        $transactionId = (int) $pdo->lastInsertId();

        foreach ($merged as $productId => $qty) {
            $productStmt->execute([':id' => $productId]);
            $product = $productStmt->fetch();
            if (!$product) {
                throw new InvalidArgumentException('An item in the cart no longer exists.');
            }

            $available = (float) $product['stock_qty'];
            if (!$allowNegative && $qty > $available) {
                throw new InvalidArgumentException(
                    'Not enough stock for ' . $product['name'] . ' — only ' . qty($available) . ' left.'
                );
            }

            $unitCost    = (float) $product['cost_price'];
            $unitSelling = (float) $product['selling_price'];
            $lineTotal   = round($unitSelling * $qty, 2);
            $lineProfit  = round($lineTotal - ($unitCost * $qty), 2);

            $insertItem->execute([
                ':transaction_id' => $transactionId,
                ':product_id'     => $productId,
                ':product_name'   => $product['name'],
                ':qty'            => $qty,
                ':cost_price'     => $unitCost,
                ':selling_price'  => $unitSelling,
                ':discount'       => 0,
                ':line_total'     => $lineTotal,
                ':line_profit'    => $lineProfit,
            ]);
            $updateStock->execute([':qty' => $qty, ':id' => $productId]);

            $total += $lineTotal;
            $cost  += $unitCost * $qty;
            $count += (int) ceil($qty);

            $lines[] = [
                'product_id'    => $productId,
                'name'          => $product['name'],
                'qty'           => $qty,
                'selling_price' => $unitSelling,
                'line_total'    => $lineTotal,
                'line_profit'   => $lineProfit,
                'stock_left'    => round($available - $qty, 3),
            ];
        }

        $total  = round($total, 2);
        $cost   = round($cost, 2);
        $profit = round($total - $cost, 2);

        if ($cashReceived <= 0) {
            throw new InvalidArgumentException('Enter the cash received from the customer.');
        }
        if ($cashReceived < $total) {
            throw new InvalidArgumentException(
                'Cash received is short by ' . money(round($total - $cashReceived, 2)) . '.'
            );
        }

        $change = round($cashReceived - $total, 2);

        $finalise = $pdo->prepare(
            'UPDATE transactions SET item_count = :count, total_amount = :total, total_cost = :cost,
                    profit = :profit, change_due = :change WHERE id = :id'
        );
        $finalise->execute([
            ':count' => $count, ':total' => $total, ':cost' => $cost,
            ':profit' => $profit, ':change' => $change, ':id' => $transactionId,
        ]);

        $pdo->commit();

        json_response([
            'ok'   => true,
            'sale' => [
                'id'            => $transactionId,
                'reference'     => $reference,
                'sold_at'       => date('Y-m-d H:i:s'),
                'item_count'    => $count,
                'total_amount'  => $total,
                'total_cost'    => $cost,
                'profit'        => $profit,
                'cash_received' => $cashReceived,
                'change_due'    => $change,
                'lines'         => $lines,
            ],
            'message'   => 'Sale saved. Change ' . money($change) . '.',
            'store'     => setting('store_name', APP_NAME),
            'cashier'   => setting('owner_name', ''),
            'receipt_footer' => setting('receipt_footer', ''),
        ]);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

/* =========================================================================
   Reports
   ========================================================================= */

/** Totals, daily series, best sellers and stock alerts for a date range. */
function report_summary(): void
{
    [$from, $to] = date_range($_GET['from'] ?? null, $_GET['to'] ?? null);
    json_response(['ok' => true] + build_report($from, $to));
}

/** Snapshot used by the dashboard: today, last 7 days, this month. */
function dashboard_stats(): void
{
    $today      = date('Y-m-d');
    $weekStart  = date('Y-m-d', strtotime('-6 days'));
    $monthStart = date('Y-m-01');

    json_response([
        'ok'              => true,
        'today'           => build_report($today, $today),
        'week'            => report_totals($weekStart, $today),
        'month'           => report_totals($monthStart, $today),
        'low_stock_items' => low_stock_items(6),
        'recent_sales'    => recent_sales(6),
    ]);
}

/* =========================================================================
   CSV import / export (plain PHP file handling — no internet required)
   ========================================================================= */

/** Stream every product as a CSV download. */
function export_products(): void
{
    $rows = db()->query(
        'SELECT name, sku, category, cost_price, selling_price, stock_qty, pack_size
         FROM products ORDER BY name COLLATE NOCASE'
    )->fetchAll();

    $csv = fopen('php://temp', 'r+');
    fputcsv($csv, array_merge(CSV_HEADERS, ['stock_value', 'unit_profit', 'margin_percent']));

    foreach ($rows as $row) {
        $cost    = (float) $row['cost_price'];
        $selling = (float) $row['selling_price'];
        $stock   = (float) $row['stock_qty'];

        fputcsv($csv, [
            $row['name'], $row['sku'], $row['category'],
            number_format($cost, 2, '.', ''),
            number_format($selling, 2, '.', ''),
            qty($stock),
            (int) $row['pack_size'],
            number_format($cost * $stock, 2, '.', ''),
            number_format($selling - $cost, 2, '.', ''),
            $selling > 0 ? number_format((($selling - $cost) / $selling) * 100, 1, '.', '') : '0.0',
        ]);
    }
    rewind($csv);
    stream_csv($csv, 'inventory-' . date('Ymd-His') . '.csv');
}

/** Stream the sales log: one row per sale, or one row per line item. */
function export_sales(): void
{
    [$from, $to] = date_range($_GET['from'] ?? null, $_GET['to'] ?? null);
    $detailed    = ($_GET['detail'] ?? '0') === '1';
    $pdo         = db();
    $csv         = fopen('php://temp', 'r+');

    if ($detailed) {
        $stmt = $pdo->prepare(
            'SELECT t.sold_at, t.reference, ti.product_name, ti.qty, ti.cost_price, ti.selling_price,
                    ti.line_total, ti.line_profit
             FROM transaction_items ti JOIN transactions t ON t.id = ti.transaction_id
             WHERE t.sale_date BETWEEN :from AND :to
             ORDER BY t.sold_at ASC, ti.id ASC'
        );
        $stmt->execute([':from' => $from, ':to' => $to]);

        fputcsv($csv, ['sold_at', 'reference', 'item', 'qty', 'unit_cost', 'unit_price', 'line_total', 'line_profit']);
        foreach ($stmt->fetchAll() as $r) {
            fputcsv($csv, [
                $r['sold_at'], $r['reference'], $r['product_name'], qty($r['qty']),
                number_format((float) $r['cost_price'], 2, '.', ''),
                number_format((float) $r['selling_price'], 2, '.', ''),
                number_format((float) $r['line_total'], 2, '.', ''),
                number_format((float) $r['line_profit'], 2, '.', ''),
            ]);
        }
        rewind($csv);
        stream_csv($csv, 'sales-items-' . $from . '_to_' . $to . '.csv');
        return;
    }

    $stmt = $pdo->prepare(
        'SELECT sold_at, reference, item_count, total_amount, total_cost, profit, cash_received, change_due
         FROM transactions WHERE sale_date BETWEEN :from AND :to ORDER BY sold_at ASC'
    );
    $stmt->execute([':from' => $from, ':to' => $to]);

    fputcsv($csv, ['sold_at', 'reference', 'items', 'total_amount', 'total_cost', 'profit', 'cash_received', 'change_due']);
    foreach ($stmt->fetchAll() as $r) {
        fputcsv($csv, [
            $r['sold_at'], $r['reference'], (int) $r['item_count'],
            number_format((float) $r['total_amount'], 2, '.', ''),
            number_format((float) $r['total_cost'], 2, '.', ''),
            number_format((float) $r['profit'], 2, '.', ''),
            number_format((float) $r['cash_received'], 2, '.', ''),
            number_format((float) $r['change_due'], 2, '.', ''),
        ]);
    }
    rewind($csv);
    stream_csv($csv, 'sales-' . $from . '_to_' . $to . '.csv');
}

/** Download an empty CSV that shows the expected columns. */
function csv_template(): void
{
    $csv = fopen('php://temp', 'r+');
    fputcsv($csv, CSV_HEADERS);
    fputcsv($csv, ['Bear Brand 300ml', 'BB300', 'Drinks', '21.50', '26.00', '24', '6']);
    fputcsv($csv, ['Lucky Me Pancit Canton', 'LM-PC', 'Noodles', '10.00', '15.00', '48', '12']);
    rewind($csv);
    stream_csv($csv, 'inventory-template.csv');
}

/**
 * Stream a copy of the SQLite file so the owner can keep an offline backup
 * (USB drive, cloud-synced folder, ...).
 */
function backup_db(): void
{
    // Merge the write-ahead log into the main file so the copy is complete.
    db()->exec('PRAGMA wal_checkpoint(TRUNCATE)');

    if (!is_file(DB_FILE)) {
        json_error('Database file not found.', 404);
    }

    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="store-pos-backup-' . date('Ymd-His') . '.sqlite"');
    header('Content-Length: ' . filesize(DB_FILE));
    header('Cache-Control: no-store');
    readfile(DB_FILE);
    exit;
}

/**
 * Bulk upload inventory from a CSV file.
 * mode=merge (default) adds and updates; mode=replace clears the catalog first.
 */
function import_products(): void
{
    $file = $_FILES['file'] ?? null;
    if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_error('Choose a CSV file to upload.');
    }
    if (!is_uploaded_file($file['tmp_name'])) {
        json_error('Upload failed. Please try again.');
    }
    if ((int) $file['size'] > 5 * 1024 * 1024) {
        json_error('The file is larger than 5 MB.');
    }

    $mode = ($_POST['mode'] ?? 'merge') === 'replace' ? 'replace' : 'merge';
    $pdo  = db();

    $handle = fopen($file['tmp_name'], 'r');
    if ($handle === false) {
        json_error('Could not read the uploaded file.');
    }

    // Spreadsheet exports often start with a UTF-8 BOM: drop it before parsing.
    $firstBytes = (string) fread($handle, 3);
    rewind($handle);
    if ($firstBytes === "\xEF\xBB\xBF") {
        fseek($handle, 3);
    }

    $header = fgetcsv($handle);
    if ($header === false) {
        fclose($handle);
        json_error('The CSV file is empty.');
    }
    $header = array_map(
        static fn($h): string => str_replace(' ', '_', strtolower(trim((string) $h))),
        $header
    );

    if (!in_array('name', $header, true)) {
        fclose($handle);
        json_error('The CSV needs a header row with at least a "name" column — download the template to see the format.');
    }

    $inserted = 0;
    $updated  = 0;
    $errors   = [];
    $line     = 1;

    $findBySku = $pdo->prepare("SELECT id FROM products WHERE sku = :sku AND sku <> ''");
    $insert    = $pdo->prepare(
        'INSERT INTO products (name, sku, category, cost_price, selling_price, stock_qty, pack_size)
         VALUES (:name, :sku, :category, :cost, :selling, :stock, :pack)'
    );
    $update    = $pdo->prepare(
        "UPDATE products SET name = :name, category = :category, cost_price = :cost,
                selling_price = :selling, stock_qty = :stock, pack_size = :pack,
                updated_at = datetime('now','localtime')
         WHERE id = :id"
    );

    $pdo->beginTransaction();
    try {
        if ($mode === 'replace') {
            $pdo->exec('DELETE FROM products');
        }

        while (($row = fgetcsv($handle)) !== false) {
            $line++;
            if ($row === [null] || (count($row) === 1 && trim((string) $row[0]) === '')) {
                continue;   // skip blank lines
            }

            $record = [];
            foreach ($header as $index => $column) {
                $record[$column] = $row[$index] ?? '';
            }

            $number = static fn($value): float => (float) str_replace([',', ' ', '₱', '$'], '', (string) $value);

            try {
                $data = normalise_product([
                    'name'          => $record['name'] ?? '',
                    'sku'           => $record['sku'] ?? ($record['barcode'] ?? ''),
                    'category'      => $record['category'] ?? '',
                    'cost_price'    => $number($record['cost_price'] ?? ($record['cost'] ?? 0)),
                    'selling_price' => $number($record['selling_price'] ?? ($record['price'] ?? 0)),
                    'stock_qty'     => $number($record['stock_qty'] ?? ($record['stock'] ?? ($record['quantity'] ?? 0))),
                    'pack_size'     => (int) ($record['pack_size'] ?? 1),
                ]);
            } catch (InvalidArgumentException $e) {
                $errors[] = 'Line ' . $line . ': ' . $e->getMessage();
                continue;
            }

            $existingId = false;
            if ($data['sku'] !== '') {
                $findBySku->execute([':sku' => $data['sku']]);
                $existingId = $findBySku->fetchColumn();
            }

            if ($existingId) {
                $update->execute([
                    ':name' => $data['name'], ':category' => $data['category'],
                    ':cost' => $data['cost_price'], ':selling' => $data['selling_price'],
                    ':stock' => $data['stock_qty'], ':pack' => $data['pack_size'],
                    ':id' => (int) $existingId,
                ]);
                $updated++;
            } else {
                $insert->execute([
                    ':name' => $data['name'], ':sku' => $data['sku'], ':category' => $data['category'],
                    ':cost' => $data['cost_price'], ':selling' => $data['selling_price'],
                    ':stock' => $data['stock_qty'], ':pack' => $data['pack_size'],
                ]);
                $inserted++;
            }
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fclose($handle);
        json_error('Import stopped at line ' . $line . ': ' . $e->getMessage(), 500);
    }

    fclose($handle);

    json_response([
        'ok'       => true,
        'inserted' => $inserted,
        'updated'  => $updated,
        'errors'   => array_slice($errors, 0, 12),
        'message'  => sprintf('Imported %d new and updated %d item(s).', $inserted, $updated),
    ]);
}

/* =========================================================================
   Settings
   ========================================================================= */

function settings_save(): void
{
    $input = request_input();

    if (isset($input['store_name'])) {
        save_setting('store_name', trim((string) $input['store_name']) ?: APP_NAME);
    }
    if (isset($input['owner_name'])) {
        save_setting('owner_name', trim((string) $input['owner_name']));
    }
    if (isset($input['currency'])) {
        save_setting('currency', trim((string) $input['currency']) ?: DEFAULT_CURRENCY);
    }
    if (isset($input['low_stock'])) {
        save_setting('low_stock', (string) max(0, (float) $input['low_stock']));
    }
    if (isset($input['receipt_footer'])) {
        save_setting('receipt_footer', trim((string) $input['receipt_footer']));
    }
    if (isset($input['allow_negative_stock'])) {
        save_setting('allow_negative_stock', !empty($input['allow_negative_stock']) ? '1' : '0');
    }

    json_response(['ok' => true, 'message' => 'Settings saved.']);
}

/* =========================================================================
   Small shared utilities
   ========================================================================= */

/** Normalise a from/to date pair, defaulting to today and ordering them. */
function date_range(?string $from, ?string $to): array
{
    $isDate = static fn($d): bool => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) === 1;

    $from = $isDate($from) ? $from : date('Y-m-d');
    $to   = $isDate($to) ? $to : $from;

    if (strtotime($to) < strtotime($from)) {
        [$from, $to] = [$to, $from];
    }

    return [$from, $to];
}

/** Unique receipt number, retried in case two sales are saved in the same second. */
function make_reference(PDO $pdo, string $saleDate): string
{
    for ($attempt = 0; $attempt < 5; $attempt++) {
        $reference = next_reference($pdo, $saleDate);
        if ($attempt > 0) {
            $reference .= '-' . random_int(1, 9);
        }
        $check = $pdo->prepare('SELECT 1 FROM transactions WHERE reference = :r');
        $check->execute([':r' => $reference]);
        if (!$check->fetchColumn()) {
            return $reference;
        }
    }
    return $saleDate . '-' . bin2hex(random_bytes(3));
}

/** Send a CSV handle to the browser as a file download (UTF-8 BOM for Excel). */
function stream_csv($handle, string $filename): void
{
    $content = (string) stream_get_contents($handle);
    fclose($handle);

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . (strlen($content) + (str_starts_with($content, "\xEF\xBB\xBF") ? 0 : 3)));
    header('Cache-Control: no-store');

    if (!str_starts_with($content, "\xEF\xBB\xBF")) {
        echo "\xEF\xBB\xBF";   // Excel needs this to read UTF-8 correctly
    }
    echo $content;
    exit;
}
