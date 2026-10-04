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
  <button class="btn btn--ghost pos-history-btn" id="btn-history" type="button">🧾 Sales history</button>
</section>

<div class="pill-row" id="pos-filters" style="margin-bottom:12px">
  <button class="pill is-active" data-filter="all">All items</button>
  <button class="pill" data-filter="available">In stock</button>
</div>

<section class="pos-grid" id="pos-grid">
  <div class="skeleton" style="grid-column:1/-1">Loading your items…</div>
</section>

<!-- Cart summary bar, sits above the bottom navigation. -->
<button class="btn btn--block cart-bar" id="cart-bar" type="button">
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

<!-- ============================================ purchase history / item removal -->
<!-- One sheet with three panes (list / detail / remove) so only a single modal
     is ever open and the body scroll lock stays correct. -->
<div class="modal" id="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
  <div class="modal__sheet">

    <div data-pane="list">
      <div class="modal__head">
        <h2 id="history-title">Purchase history</h2>
        <button class="modal__close" type="button" data-close aria-label="Close">✕</button>
      </div>

      <div class="search-wrap">
        <input class="input input--search" type="search" id="history-search" autocomplete="off"
               inputmode="search" placeholder="Search a receipt number…" aria-label="Search receipts">
      </div>

      <ul class="list" id="history-list" style="margin:12px 0 0">
        <li class="skeleton">Loading sales…</li>
      </ul>
    </div>

    <div data-pane="detail" class="hidden">
      <div class="modal__head">
        <button class="btn btn--ghost btn--sm" type="button" data-back="list">‹ Back</button>
        <h2 id="history-detail-title">Sale</h2>
        <button class="modal__close" type="button" data-close aria-label="Close">✕</button>
      </div>
      <div id="history-detail"></div>
    </div>

    <form data-pane="void" class="hidden" id="void-form" autocomplete="off" novalidate>
      <div class="modal__head">
        <button class="btn btn--ghost btn--sm" type="button" data-back="detail">‹ Back</button>
        <h2 id="void-title">Remove item</h2>
        <button class="modal__close" type="button" data-close aria-label="Close">✕</button>
      </div>

      <p class="muted" id="void-item" style="font-size:13.5px"></p>

      <div class="grid-2">
        <div class="field">
          <label for="void-qty">Pieces returned</label>
          <input class="input" id="void-qty" name="qty" type="number" step="any" min="0.001"
                 inputmode="decimal" required>
        </div>
        <div class="field">
          <label for="void-price">Refund per piece</label>
          <input class="input" id="void-price" name="unit_price" type="number" step="0.01" min="0"
                 inputmode="decimal" required>
        </div>
      </div>

      <div class="change-box" id="void-summary">
        <span>Cash to hand back</span>
        <span class="change-box__value" id="void-refund">—</span>
      </div>

      <div class="field" style="margin-top:14px">
        <label for="void-reason">Reason (optional)</label>
        <input class="input" id="void-reason" name="reason" maxlength="120"
               placeholder="Customer changed their mind">
      </div>

      <div class="btn-row" style="margin-top:14px">
        <button class="btn btn--ghost" type="button" data-back="detail">Cancel</button>
        <button class="btn btn--danger" type="submit" id="void-submit">Remove &amp; refund</button>
      </div>
    </form>

  </div>
</div>

<?php require __DIR__ . '/includes/footer.php'; ?>
