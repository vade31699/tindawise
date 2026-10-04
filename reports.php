<?php
/**
 * Reports — daily sales, revenue and net profit aggregated from the local
 * SQLite database, plus the CSV import/export toolbox.
 */

declare(strict_types=1);

require_once __DIR__ . '/includes/functions.php';

$from = date('Y-m-01');
$to   = date('Y-m-d');

$page_title    = 'Reports';
$page_subtitle = 'Revenue, profit and best sellers';
$active_nav    = 'reports.php';
$page_scripts  = ['assets/js/reports.js'];
require __DIR__ . '/includes/header.php';
?>

<section class="card">
  <div class="field mb-0">
    <span class="field-label">Date range</span>
    <div class="pill-row" id="range-pills">
      <button class="pill" data-range="today">Today</button>
      <button class="pill" data-range="yesterday">Yesterday</button>
      <button class="pill is-active" data-range="week">Last 7 days</button>
      <button class="pill" data-range="month">This month</button>
      <button class="pill" data-range="custom">Custom</button>
    </div>
  </div>

  <div class="grid-2 hidden" id="custom-range" style="margin-top:12px">
    <div class="field mb-0">
      <label for="from-date">From</label>
      <input class="input" type="date" id="from-date" value="<?= e($from) ?>">
    </div>
    <div class="field mb-0">
      <label for="to-date">To</label>
      <input class="input" type="date" id="to-date" value="<?= e($to) ?>">
    </div>
  </div>

  <div class="row row--between" style="margin-top:12px">
    <span class="muted" style="font-size:12.5px" id="range-label">Loading…</span>
    <button class="btn btn--sm btn--ghost" type="button" id="btn-refresh">↻ Refresh</button>
  </div>
</section>

<section class="kpi-grid" id="report-kpis">
  <div class="kpi kpi--primary">
    <div class="kpi__label">Revenue</div>
    <div class="kpi__value" data-kpi="revenue">—</div>
    <div class="kpi__note" data-kpi="revenue-note">—</div>
  </div>
  <div class="kpi kpi--profit">
    <div class="kpi__label">Net profit</div>
    <div class="kpi__value" data-kpi="profit">—</div>
    <div class="kpi__note" data-kpi="profit-note">—</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Cost of goods</div>
    <div class="kpi__value" data-kpi="cost">—</div>
    <div class="kpi__note">what you paid for the sold stock</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Transactions</div>
    <div class="kpi__value" data-kpi="transactions">—</div>
    <div class="kpi__note" data-kpi="average">—</div>
  </div>
</section>

<section class="card">
  <div class="card__head">
    <h2>Sales per day</h2>
    <span class="muted" style="font-size:12px" id="chart-note"></span>
  </div>
  <div class="chart" id="report-chart"><div class="skeleton">Loading…</div></div>
</section>

<section class="card card--flush">
  <div class="card__head card__head--pad"><h2>Daily breakdown</h2></div>
  <div class="table-wrap">
    <table class="data" id="daily-table">
      <thead>
        <tr>
          <th>Date</th>
          <th class="num">Sales</th>
          <th class="num">Items</th>
          <th class="num">Revenue</th>
          <th class="num">Profit</th>
        </tr>
      </thead>
      <tbody><tr><td colspan="5" class="muted">Loading…</td></tr></tbody>
    </table>
  </div>
</section>

<section class="card card--flush">
  <div class="card__head card__head--pad"><h2>Best sellers</h2></div>
  <div class="table-wrap">
    <table class="data" id="top-table">
      <thead>
        <tr>
          <th>Item</th>
          <th class="num">Qty</th>
          <th class="num">Revenue</th>
          <th class="num">Profit</th>
        </tr>
      </thead>
      <tbody><tr><td colspan="4" class="muted">Loading…</td></tr></tbody>
    </table>
  </div>
</section>

<section class="card card--flush">
  <div class="card__head card__head--pad"><h2>Latest transactions</h2></div>
  <ul class="list" id="sales-list"><li class="skeleton">Loading…</li></ul>
</section>

<section class="card" id="csv">
  <div class="card__head"><h2>CSV import / export</h2></div>
  <p class="muted" style="font-size:13px">
    Download your performance log or bulk-load an inventory list straight from
    this device. Files are read and written locally by PHP — no internet needed.
  </p>

  <div class="field">
    <span class="field-label">Export</span>
    <div class="btn-row" style="margin-bottom:10px">
      <button class="btn btn--ghost" type="button" id="btn-export-sales">⬇ Sales (range)</button>
      <button class="btn btn--ghost" type="button" id="btn-export-items">⬇ Line items</button>
    </div>
    <button class="btn btn--ghost btn--block" type="button" id="btn-export-products">⬇ Full inventory</button>
  </div>

  <hr>

  <form id="import-form">
    <div class="field">
      <label for="import-file">Import inventory (CSV)</label>
      <input class="input" id="import-file" name="file" type="file" accept=".csv,text/csv" required>
      <div class="field-hint">Existing SKUs are updated, new rows are added.</div>
    </div>
    <div class="btn-row">
      <a class="btn btn--ghost" href="api.php?action=csv_template">⬇ Template</a>
      <button class="btn" type="submit" id="import-submit">Upload CSV</button>
    </div>
  </form>

  <div id="import-result" class="hidden" style="margin-top:14px"></div>
</section>

<script>
  window.REPORTS_CONFIG = {
    currency: <?= json_encode(currency()) ?>,
    lowStock: <?= json_encode((float) setting('low_stock', (string) DEFAULT_LOW_STOCK)) ?>
  };
</script>

<?php require __DIR__ . '/includes/footer.php'; ?>
