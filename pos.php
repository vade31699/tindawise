<?php
/**
 * Point of sale — tap items to build a cart, type the cash received and see the
 * change instantly. Totals, profit and stock are recalculated by api.php.
 */

declare(strict_types=1);

require_once __DIR__ . '/includes/functions.php';

$lowStock = (float) setting('low_stock', (string) DEFAULT_LOW_STOCK);

$page_title    = 'Point of sale';
$page_subtitle = 'Tap an item to add it to the cart';
$active_nav    = 'pos.php';
$body_class    = 'has-cart-bar';
$page_scripts  = ['assets/js/pos.js'];
require __DIR__ . '/includes/header.php';
?>

<section class="pos-search">
  <div class="search-wrap">
    <input class="input input--search" type="search" id="pos-search" autocomplete="off"
           inputmode="search" placeholder="Search an item to sell…" aria-label="Search items">
  </div>
</section>

<div class="pill-row" id="pos-filters" style="margin-bottom:12px">
  <button class="pill is-active" data-filter="all">All items</button>
  <button class="pill" data-filter="available">In stock</button>
</div>

<section class="pos-grid" id="pos-grid">
  <div class="skeleton" style="grid-column:1/-1">Loading your items…</div>
</section>

<!-- Cart summary bar, sits above the bottom navigation. -->
<button class="btn btn--block" id="cart-bar" type="button"
        style="position:fixed;left:16px;right:16px;bottom:calc(var(--nav-height) + 14px);max-width:688px;margin:0 auto;z-index:45;min-height:54px;justify-content:space-between;padding:0 18px">
  <span id="cart-bar-count">Cart is empty</span>
  <span id="cart-bar-total"><?= e(money(0)) ?></span>
</button>

<!-- ======================================================== cart / checkout -->
<div class="modal" id="cart-modal" role="dialog" aria-modal="true" aria-labelledby="cart-title">
  <div class="modal__sheet">
    <div class="modal__head">
      <h2 id="cart-title">Checkout</h2>
      <button class="modal__close" type="button" data-close aria-label="Close">✕</button>
    </div>

    <ul class="list" id="cart-lines" style="margin:-6px 0 0"></ul>

    <div class="card" style="box-shadow:none;border:1px solid var(--line);margin:14px 0 0">
      <div class="totals">
        <div class="totals__row"><span class="muted">Items</span><span id="sum-items">0</span></div>
        <div class="totals__row"><span class="muted">Subtotal (cost)</span><span id="sum-cost"><?= e(money(0)) ?></span></div>
        <div class="totals__row totals__row--profit"><span>Profit</span><span id="sum-profit"><?= e(money(0)) ?></span></div>
        <div class="totals__row totals__row--grand"><span>Total</span><span id="sum-total"><?= e(money(0)) ?></span></div>
      </div>
    </div>

    <div class="field" style="margin-top:14px">
      <label for="cash-received">Cash received</label>
      <input class="input" id="cash-received" type="number" step="0.01" min="0" inputmode="decimal"
             placeholder="0.00" value="">
      <div class="quick-cash" id="quick-cash"></div>
    </div>

    <div class="change-box" id="change-box">
      <span>Change</span>
      <span class="change-box__value" id="change-value"><?= e(money(0)) ?></span>
    </div>

    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn--ghost" type="button" id="btn-clear-cart">Clear</button>
      <button class="btn btn--profit" type="button" id="btn-checkout">Complete sale</button>
    </div>
  </div>
</div>

<!-- ============================================================== receipt  -->
<div class="modal" id="receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
  <div class="modal__sheet">
    <div class="modal__head">
      <h2 id="receipt-title">Sale complete</h2>
      <button class="modal__close" type="button" data-close aria-label="Close">✕</button>
    </div>

    <div class="receipt" id="receipt-body"></div>

    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn--ghost" type="button" onclick="window.print()">🖨 Print</button>
      <button class="btn" type="button" id="btn-new-sale">New sale</button>
    </div>
  </div>
</div>

<script>
  window.POS_CONFIG = {
    currency: <?= json_encode(currency()) ?>,
    lowStock: <?= json_encode($lowStock) ?>,
    allowNegative: <?= setting('allow_negative_stock', '0') === '1' ? 'true' : 'false' ?>,
    storeName: <?= json_encode(setting('store_name', APP_NAME)) ?>,
    receiptFooter: <?= json_encode(setting('receipt_footer', '')) ?>
  };
</script>

<?php require __DIR__ . '/includes/footer.php'; ?>
