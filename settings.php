<?php
/**
 * Settings — store identity, currency, stock warnings and a local backup.
 */

declare(strict_types=1);

require_once __DIR__ . '/includes/functions.php';

$productCount = (int) db()->query('SELECT COUNT(*) FROM products')->fetchColumn();
$saleCount    = (int) db()->query('SELECT COUNT(*) FROM transactions')->fetchColumn();
$dbSize       = is_file(DB_FILE) ? (int) filesize(DB_FILE) : 0;

$page_title    = 'Settings';
$page_subtitle = 'Store details and offline data';
$active_nav    = 'settings.php';
$page_scripts  = ['assets/js/settings.js'];
require __DIR__ . '/includes/header.php';
?>

<form class="card" id="settings-form">
  <div class="card__head"><h2>Store details</h2></div>

  <div class="field">
    <label for="store_name">Store name</label>
    <input class="input" id="store_name" name="store_name" value="<?= e(setting('store_name')) ?>" required>
  </div>

  <div class="field">
    <label for="owner_name">Owner / cashier name</label>
    <input class="input" id="owner_name" name="owner_name" value="<?= e(setting('owner_name')) ?>"
           placeholder="Shown on receipts">
  </div>

  <div class="grid-2">
    <div class="field">
      <label for="currency">Currency symbol</label>
      <input class="input" id="currency" name="currency" maxlength="4" value="<?= e(setting('currency')) ?>">
    </div>
    <div class="field">
      <label for="low_stock">Low stock level</label>
      <input class="input" id="low_stock" name="low_stock" type="number" step="1" min="0"
             value="<?= e(setting('low_stock')) ?>">
    </div>
  </div>

  <div class="field">
    <label for="receipt_footer">Receipt footer</label>
    <input class="input" id="receipt_footer" name="receipt_footer" value="<?= e(setting('receipt_footer')) ?>">
  </div>

  <label class="row" style="gap:10px;font-size:14px">
    <input type="checkbox" name="allow_negative_stock" value="1"
      <?= setting('allow_negative_stock', '0') === '1' ? 'checked' : '' ?>>
    Allow selling items with zero stock (stock can go negative)
  </label>

  <button class="btn btn--block" type="submit" id="settings-submit" style="margin-top:16px">Save settings</button>
</form>

<section class="card">
  <div class="card__head"><h2>Offline data</h2></div>
  <ul class="list" style="margin:-6px 0 0">
    <li class="list__item">
      <div class="list__body">
        <div class="list__title">Database file</div>
        <div class="list__sub" style="white-space:normal"><?= e(DB_FILE) ?></div>
      </div>
      <div class="list__trail"><?= e(number_format($dbSize / 1024, 1)) ?> KB</div>
    </li>
    <li class="list__item">
      <div class="list__body">
        <div class="list__title">Products</div>
        <div class="list__sub">items in the catalog</div>
      </div>
      <div class="list__trail"><?= $productCount ?></div>
    </li>
    <li class="list__item">
      <div class="list__body">
        <div class="list__title">Transactions</div>
        <div class="list__sub">recorded sales</div>
      </div>
      <div class="list__trail"><?= $saleCount ?></div>
    </li>
  </ul>

  <div class="btn-row" style="margin-top:14px">
    <button class="btn btn--ghost" type="button" id="btn-backup">💾 Back up database</button>
    <button class="btn btn--ghost" type="button" id="btn-export-products">⬇ Inventory CSV</button>
  </div>
</section>

<section class="card">
  <div class="card__head"><h2>This installation</h2></div>
  <div class="table-wrap">
    <table class="data">
      <tbody>
        <tr><td>App version</td><td class="num"><?= e(APP_VERSION) ?></td></tr>
        <tr><td>PHP version</td><td class="num"><?= e(PHP_VERSION) ?></td></tr>
        <tr><td>SQLite engine</td><td class="num"><?= e((string) db()->query('SELECT sqlite_version()')->fetchColumn()) ?></td></tr>
        <tr><td>Server time</td><td class="num"><?= e(date('M j, Y g:i A')) ?></td></tr>
      </tbody>
    </table>
  </div>
</section>

<script>
  window.SETTINGS_CONFIG = {
    currency: <?= json_encode(currency()) ?>
  };
</script>

<?php require __DIR__ . '/includes/footer.php'; ?>
