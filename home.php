<?php
/**
 * Dashboard — today's numbers at a glance, plus stock warnings and the
 * latest sales. Everything is rendered from the local SQLite database.
 */

declare(strict_types=1);

require_once __DIR__ . '/includes/functions.php';
require_once __DIR__ . '/includes/reports.php';

$today  = date('Y-m-d');
$week   = build_report(date('Y-m-d', strtotime('-6 days')), $today);
$month  = report_totals(date('Y-m-01'), $today);
$daily  = $week['daily'];

// The last day of the 7-day range is always today.
$todayRow   = end($daily) ?: ['revenue' => 0, 'profit' => 0, 'transactions' => 0, 'items' => 0];
$maxRevenue = max(1.0, max(array_column($daily, 'revenue')));
$lowStock   = low_stock_items(6);
$recent     = recent_sales(6);

$productCount = (int) db()->query('SELECT COUNT(*) FROM products')->fetchColumn();

$page_title    = 'Dashboard';
$page_subtitle = setting('store_name', APP_NAME) . ' · ' . date('D, M j');
$active_nav    = 'home.php';
$page_scripts  = ['assets/js/dashboard.js'];
require __DIR__ . '/includes/header.php';
?>

<section class="kpi-grid">
  <div class="kpi kpi--primary">
    <div class="kpi__label">Today's sales</div>
    <div class="kpi__value" id="kpi-revenue"><?= e(money($todayRow['revenue'])) ?></div>
    <div class="kpi__note" id="kpi-revenue-note"><?= (int) $todayRow['transactions'] ?> transaction(s)</div>
  </div>
  <div class="kpi kpi--profit">
    <div class="kpi__label">Profit today</div>
    <div class="kpi__value" id="kpi-profit"><?= e(money($todayRow['profit'])) ?></div>
    <div class="kpi__note" id="kpi-profit-note">
      <?= e(number_format((float) $todayRow['profit'] > 0 && (float) $todayRow['revenue'] > 0
            ? ((float) $todayRow['profit'] / (float) $todayRow['revenue']) * 100 : 0, 1)) ?>% margin
    </div>
  </div>
  <div class="kpi">
    <div class="kpi__label">This week</div>
    <div class="kpi__value"><?= e(money($week['totals']['revenue'])) ?></div>
    <div class="kpi__note">Profit <?= e(money($week['totals']['profit'])) ?></div>
  </div>
  <div class="kpi">
    <div class="kpi__label">This month</div>
    <div class="kpi__value"><?= e(money($month['revenue'])) ?></div>
    <div class="kpi__note">Profit <?= e(money($month['profit'])) ?></div>
  </div>
</section>

<div class="btn-row" style="margin-bottom:14px">
  <a class="btn" href="pos.php">🛒 New sale</a>
  <a class="btn btn--ghost" href="inventory.php?new=1">＋ Add item</a>
</div>

<section class="card">
  <div class="card__head">
    <h2>Last 7 days</h2>
    <span class="muted" style="font-size:12px">Profit <?= e(money($week['totals']['profit'])) ?></span>
  </div>
  <div class="chart" id="week-chart">
    <?php foreach ($daily as $index => $day): ?>
      <?php
        $height   = (int) max(3, round(((float) $day['revenue'] / $maxRevenue) * 100));
        $isToday  = $day['date'] === $today;
      ?>
      <div class="chart__col" title="<?= e(nice_date($day['date']) . ': ' . money($day['revenue'])) ?>">
        <div class="chart__bar <?= $isToday ? 'chart__bar--today' : '' ?>" style="height:<?= $height ?>%"></div>
        <div class="chart__label"><?= $isToday ? 'Today' : e(date('D', strtotime($day['date']))) ?></div>
      </div>
    <?php endforeach; ?>
  </div>
</section>

<section class="card card--flush">
  <div class="card__head card__head--pad">
    <h2>Stock alerts</h2>
    <a class="badge badge--muted" href="inventory.php?status=low"><?= count($lowStock) ?> item(s)</a>
  </div>
  <ul class="list" id="low-stock-list">
    <?php if ($lowStock === []): ?>
      <li class="empty"><span class="empty__icon">✅</span>All items are well stocked.</li>
    <?php else: ?>
      <?php foreach ($lowStock as $item): ?>
        <li class="list__item">
          <div class="list__body">
            <div class="list__title"><?= e($item['name']) ?></div>
            <div class="list__sub">Only <?= e(qty($item['stock_qty'])) ?> pcs left</div>
          </div>
          <span class="badge badge--<?= e($item['status']) ?>"><?= e($item['status_label']) ?></span>
        </li>
      <?php endforeach; ?>
    <?php endif; ?>
  </ul>
</section>

<section class="card card--flush">
  <div class="card__head card__head--pad">
    <h2>Recent sales</h2>
    <a class="badge badge--muted" href="reports.php">Reports</a>
  </div>
  <ul class="list" id="recent-sales">
    <?php if ($recent === []): ?>
      <li class="empty">
        <span class="empty__icon">🧾</span>
        No sales yet.  <?= $productCount === 0 ? 'Add items, then ring up your first sale.' : 'Tap POS to start selling.' ?>
      </li>
    <?php else: ?>
      <?php foreach ($recent as $sale): ?>
        <li class="list__item">
          <div class="list__body">
            <div class="list__title"><?= e($sale['reference']) ?></div>
            <div class="list__sub"><?= e(date('M j, g:i A', strtotime($sale['sold_at']))) ?> · <?= (int) $sale['item_count'] ?> item(s)</div>
          </div>
          <div class="list__trail">
            <?= e(money($sale['total_amount'])) ?>
            <div class="list__sub" style="color:var(--profit)">+<?= e(money($sale['profit'])) ?></div>
          </div>
        </li>
      <?php endforeach; ?>
    <?php endif; ?>
  </ul>
</section>

<?php if ($productCount === 0): ?>
  <section class="card">
    <div class="card__head"><h2>First time here?</h2></div>
    <p class="muted" style="font-size:13.5px">
      Add your items one by one in Inventory, or bulk-upload your price list from a CSV file —
      everything is stored offline in this device's SQLite database.
    </p>
    <div class="btn-row">
      <a class="btn" href="inventory.php?new=1">＋ Add item</a>
      <a class="btn btn--ghost" href="reports.php#csv">Import CSV</a>
    </div>
  </section>
<?php endif; ?>

<?php require __DIR__ . '/includes/footer.php'; ?>
