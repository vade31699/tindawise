<?php
/**
 * Sales aggregation helpers shared by the pages and the API.
 * All amounts come straight from the SQLite tables, so reports, the dashboard
 * and the POS receipt can never disagree with each other.
 */

declare(strict_types=1);

require_once __DIR__ . '/functions.php';

/** Totals, per-day series, best sellers and recent sales for a date range. */
function build_report(string $from, string $to): array
{
    $pdo = db();

    $stmt = $pdo->prepare(
        'SELECT sale_date, COUNT(*) AS transactions, SUM(item_count) AS items,
                SUM(total_amount) AS revenue, SUM(total_cost) AS cost, SUM(profit) AS profit
         FROM transactions WHERE sale_date BETWEEN :from AND :to
         GROUP BY sale_date ORDER BY sale_date ASC'
    );
    $stmt->execute([':from' => $from, ':to' => $to]);

    $byDate = [];
    foreach ($stmt->fetchAll() as $row) {
        $byDate[$row['sale_date']] = [
            'date'         => $row['sale_date'],
            'transactions' => (int) $row['transactions'],
            'items'        => (float) $row['items'],
            'revenue'      => round((float) $row['revenue'], 2),
            'cost'         => round((float) $row['cost'], 2),
            'profit'       => round((float) $row['profit'], 2),
        ];
    }

    // Walk every calendar day so charts and tables have no gaps.
    $daily = [];
    for ($ts = strtotime($from); $ts <= strtotime($to); $ts = strtotime('+1 day', $ts)) {
        $key     = date('Y-m-d', $ts);
        $daily[] = $byDate[$key] ?? [
            'date' => $key, 'transactions' => 0, 'items' => 0.0,
            'revenue' => 0.0, 'cost' => 0.0, 'profit' => 0.0,
        ];
    }

    $totals = array_reduce($daily, static function (array $carry, array $day): array {
        $carry['transactions'] += $day['transactions'];
        $carry['items']        += $day['items'];
        $carry['revenue']      += $day['revenue'];
        $carry['cost']         += $day['cost'];
        $carry['profit']       += $day['profit'];
        return $carry;
    }, ['transactions' => 0, 'items' => 0.0, 'revenue' => 0.0, 'cost' => 0.0, 'profit' => 0.0]);

    $totals['transactions'] = (int) $totals['transactions'];
    $totals['items']        = round($totals['items'], 3);
    $totals['revenue']      = round($totals['revenue'], 2);
    $totals['cost']         = round($totals['cost'], 2);
    $totals['profit']       = round($totals['profit'], 2);
    $totals['average_sale'] = $totals['transactions'] > 0
        ? round($totals['revenue'] / $totals['transactions'], 2) : 0.0;
    $totals['margin']       = $totals['revenue'] > 0
        ? round(($totals['profit'] / $totals['revenue']) * 100, 1) : 0.0;

    $top = $pdo->prepare(
        'SELECT ti.product_name, SUM(ti.qty) AS qty, SUM(ti.line_total) AS revenue, SUM(ti.line_profit) AS profit
         FROM transaction_items ti
         JOIN transactions t ON t.id = ti.transaction_id
         WHERE t.sale_date BETWEEN :from AND :to
         GROUP BY ti.product_name
         ORDER BY qty DESC, revenue DESC LIMIT 8'
    );
    $top->execute([':from' => $from, ':to' => $to]);
    $topProducts = array_map(static fn(array $r): array => [
        'name'    => $r['product_name'],
        'qty'     => round((float) $r['qty'], 3),
        'revenue' => round((float) $r['revenue'], 2),
        'profit'  => round((float) $r['profit'], 2),
    ], $top->fetchAll());

    return [
        'from'            => $from,
        'to'              => $to,
        'totals'          => $totals,
        'daily'           => $daily,
        'top_products'    => $topProducts,
        'recent_sales'    => recent_sales(8, $from, $to),
        'low_stock_items' => low_stock_items(6),
    ];
}

/** Just the totals block for a range (cheap enough to reuse at this scale). */
function report_totals(string $from, string $to): array
{
    return build_report($from, $to)['totals'];
}

/** Products at or below the low-stock threshold. */
function low_stock_items(int $limit = 6): array
{
    $lowStock = (float) setting('low_stock', (string) DEFAULT_LOW_STOCK);

    $stmt = db()->prepare(
        'SELECT name, stock_qty FROM products WHERE stock_qty <= :low
         ORDER BY stock_qty ASC, name COLLATE NOCASE LIMIT ' . max(1, $limit)
    );
    $stmt->execute([':low' => $lowStock]);

    return array_map(static function (array $r) use ($lowStock): array {
        [$key, $label] = stock_status((float) $r['stock_qty'], $lowStock);
        return [
            'name'         => $r['name'],
            'stock_qty'    => (float) $r['stock_qty'],
            'status'       => $key,
            'status_label' => $label,
        ];
    }, $stmt->fetchAll());
}

/** Latest sales, optionally limited to a date window. */
function recent_sales(int $limit = 6, ?string $from = null, ?string $to = null): array
{
    if ($from !== null && $to !== null) {
        $stmt = db()->prepare(
            'SELECT reference, total_amount, profit, sold_at, item_count FROM transactions
             WHERE sale_date BETWEEN :from AND :to
             ORDER BY sold_at DESC, id DESC LIMIT ' . max(1, $limit)
        );
        $stmt->execute([':from' => $from, ':to' => $to]);
    } else {
        $stmt = db()->query(
            'SELECT reference, total_amount, profit, sold_at, item_count FROM transactions
             ORDER BY sold_at DESC, id DESC LIMIT ' . max(1, $limit)
        );
    }

    return array_map(static fn(array $r): array => [
        'reference'    => $r['reference'],
        'total_amount' => round((float) $r['total_amount'], 2),
        'profit'       => round((float) $r['profit'], 2),
        'sold_at'      => $r['sold_at'],
        'item_count'   => (int) $r['item_count'],
    ], $stmt->fetchAll());
}
