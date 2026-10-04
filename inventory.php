<?php
/**
 * Inventory management — searchable product list, add/update modal,
 * quick restock and CSV transfer. All queries run through api.php (PHP + SQLite).
 */

declare(strict_types=1);

require_once __DIR__ . '/includes/functions.php';

$lowStock    = (float) setting('low_stock', (string) DEFAULT_LOW_STOCK);
$status      = in_array($_GET['status'] ?? '', ['all', 'low', 'out', 'instock'], true) ? (string) $_GET['status'] : 'all';
$openNewForm = isset($_GET['new']);

$page_title   = 'Inventory';
$page_subtitle = 'Items, costs and stock on hand';
$active_nav   = 'inventory.php';
$page_scripts = ['assets/js/inventory.js'];
require __DIR__ . '/includes/header.php';
?>

<section class="kpi-grid" id="inventory-kpis">
  <div class="kpi">
    <div class="kpi__label">Items</div>
    <div class="kpi__value" data-kpi="count">—</div>
    <div class="kpi__note">in the catalog</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Stock value</div>
    <div class="kpi__value" data-kpi="stock_value">—</div>
    <div class="kpi__note">at cost price</div>
  </div>
  <div class="kpi kpi--profit">
    <div class="kpi__label">Sell value</div>
    <div class="kpi__value" data-kpi="sell_value">—</div>
    <div class="kpi__note" data-kpi="potential">—</div>
  </div>
  <div class="kpi">
    <div class="kpi__label">Needs restocking</div>
    <div class="kpi__value" data-kpi="alerts">—</div>
    <div class="kpi__note" data-kpi="alerts-note">low or out of stock</div>
  </div>
</section>

<section class="card">
  <div class="search-wrap">
    <input class="input input--search" type="search" id="inventory-search"
           placeholder="Search item name, SKU or category…" autocomplete="off"
           inputmode="search" aria-label="Search items">
  </div>

  <div class="pill-row" id="status-filters" style="margin-top:12px">
    <button class="pill <?= $status === 'all' ? 'is-active' : '' ?>" data-status="all">All</button>
    <button class="pill <?= $status === 'instock' ? 'is-active' : '' ?>" data-status="instock">In stock</button>
    <button class="pill <?= $status === 'low' ? 'is-active' : '' ?>" data-status="low">Low stock</button>
    <button class="pill <?= $status === 'out' ? 'is-active' : '' ?>" data-status="out">Out of stock</button>
  </div>

  <div class="row" style="margin-top:12px">
    <select class="select grow" id="category-filter" aria-label="Filter by category">
      <option value="">All categories</option>
    </select>
  </div>
</section>

<div class="btn-row" style="margin-bottom:14px">
  <button class="btn" id="btn-add-item" type="button">＋ New item</button>
  <button class="btn btn--ghost" id="btn-open-csv" type="button">⇅ CSV</button>
</div>

<section class="card card--flush">
  <div class="card__head card__head--pad">
    <h2>Products</h2>
    <span class="badge badge--muted" id="result-count">Loading…</span>
  </div>
  <ul class="list" id="product-list">
    <li class="skeleton">Loading items…</li>
  </ul>
</section>

<!-- ================================================== add / edit item modal -->
<div class="modal" id="item-modal" role="dialog" aria-modal="true" aria-labelledby="item-modal-title">
  <form class="modal__sheet" id="item-form" autocomplete="off">
    <div class="modal__head">
      <h2 id="item-modal-title">New item</h2>
      <button class="modal__close" type="button" data-close aria-label="Close">✕</button>
    </div>

    <input type="hidden" name="id" value="">

    <div class="field">
      <label for="f-name">Item name *</label>
      <input class="input" id="f-name" name="name" required placeholder="e.g. Bear Brand 300ml">
    </div>

    <div class="grid-2">
      <div class="field">
        <label for="f-sku">SKU / barcode</label>
        <input class="input" id="f-sku" name="sku" placeholder="optional">
      </div>
      <div class="field">
        <label for="f-category">Category</label>
        <input class="input" id="f-category" name="category" list="category-options" placeholder="e.g. Drinks">
        <datalist id="category-options"></datalist>
      </div>
    </div>

    <div class="grid-2">
      <div class="field">
        <label for="f-cost">Buying price (per pc) *</label>
        <input class="input" id="f-cost" name="cost_price" type="number" step="0.01" min="0"
               inputmode="decimal" required placeholder="0.00">
      </div>
      <div class="field">
        <label for="f-selling">Selling price (per pc) *</label>
        <input class="input" id="f-selling" name="selling_price" type="number" step="0.01" min="0"
               inputmode="decimal" required placeholder="0.00">
      </div>
    </div>

    <div class="grid-2">
      <div class="field">
        <label for="f-stock">Stock on hand (pcs)</label>
        <input class="input" id="f-stock" name="stock_qty" type="number" step="1" min="0"
               inputmode="decimal" value="0">
      </div>
      <div class="field">
        <label for="f-pack">Pieces per pack</label>
        <input class="input" id="f-pack" name="pack_size" type="number" step="1" min="1" value="1">
      </div>
    </div>

    <div class="change-box" id="margin-preview">
      <span>Profit per piece</span>
      <span class="change-box__value" data-margin="per-piece">—</span>
    </div>

    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn--ghost" type="button" data-close>Cancel</button>
      <button class="btn" type="submit" id="item-submit">Save item</button>
    </div>
  </form>
</div>

<!-- ======================================================= restock modal -->
<div class="modal" id="restock-modal" role="dialog" aria-modal="true" aria-labelledby="restock-title">
  <form class="modal__sheet" id="restock-form" autocomplete="off">
    <div class="modal__head">
      <h2 id="restock-title">Receive stock</h2>
      <button class="modal__close" type="button" data-close aria-label="Close">✕</button>
    </div>

    <input type="hidden" name="id" value="">
    <p class="muted" id="restock-item" style="font-size:13.5px"></p>

    <div class="field">
      <label for="f-packs">Packs received</label>
      <input class="input" id="f-packs" name="packs" type="number" step="1" min="1" value="1" inputmode="numeric">
    </div>

    <div class="btn-row">
      <button class="btn btn--ghost" type="button" data-close>Cancel</button>
      <button class="btn btn--profit" type="submit" id="restock-submit">Add to stock</button>
    </div>
  </form>
</div>

<!-- ========================================================= csv modal -->
<div class="modal" id="csv-modal" role="dialog" aria-modal="true" aria-labelledby="csv-title">
  <div class="modal__sheet">
    <div class="modal__head">
      <h2 id="csv-title">CSV import / export</h2>
      <button class="modal__close" type="button" data-close aria-label="Close">✕</button>
    </div>

    <div class="field">
      <span class="field-label">Export</span>
      <div class="btn-row">
        <button class="btn btn--ghost" type="button" id="btn-export-products">⬇ Inventory CSV</button>
        <button class="btn btn--ghost" type="button" id="btn-export-sales">⬇ Sales CSV</button>
      </div>
    </div>

    <hr>

    <form id="import-form">
      <div class="field">
        <label for="import-file">Import inventory (CSV)</label>
        <input class="input" id="import-file" name="file" type="file" accept=".csv,text/csv" required>
      </div>

      <div class="field">
        <span class="field-label">Import mode</span>
        <label class="row" style="gap:8px;font-size:14px">
          <input type="radio" name="mode" value="merge" checked> Add &amp; update existing items
        </label>
        <label class="row" style="gap:8px;font-size:14px;margin-top:6px">
          <input type="radio" name="mode" value="replace"> Replace the whole catalog
        </label>
      </div>

      <div class="btn-row">
        <a class="btn btn--ghost" href="api.php?action=csv_template">⬇ Template</a>
        <button class="btn" type="submit" id="import-submit">Upload CSV</button>
      </div>
    </form>

    <div id="import-result" class="hidden" style="margin-top:14px"></div>
  </div>
</div>

<!-- ====================================================== confirm modal -->
<div class="modal" id="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
  <div class="modal__sheet">
    <div class="modal__head">
      <h2 id="confirm-title">Delete item?</h2>
      <button class="modal__close" type="button" data-close aria-label="Close">✕</button>
    </div>
    <p class="muted" id="confirm-text" style="font-size:14px"></p>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn--ghost" type="button" data-close>Keep item</button>
      <button class="btn btn--danger" type="button" id="confirm-delete">Delete</button>
    </div>
  </div>
</div>

<script>
  // Server-side defaults handed to the JS module.
  window.INVENTORY_CONFIG = {
    currency: <?= json_encode(currency()) ?>,
    lowStock: <?= json_encode($lowStock) ?>,
    initialStatus: <?= json_encode($status) ?>,
    initialCategory: <?= json_encode((string) ($_GET['category'] ?? '')) ?>,
    openNew: <?= $openNewForm ? 'true' : 'false' ?>
  };
</script>

<?php require __DIR__ . '/includes/footer.php'; ?>
