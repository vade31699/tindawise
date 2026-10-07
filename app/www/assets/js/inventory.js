/* ==========================================================================
   Inventory page — live search, filters, add/update, restock and CSV transfer
   ========================================================================== */
(function () {
  'use strict';

  const cfg = window.INVENTORY_CONFIG || {};
  App.currency = cfg.currency || App.currency;

  const els = {
    list:      document.getElementById('product-list'),
    search:    document.getElementById('inventory-search'),
    filters:   document.getElementById('status-filters'),
    category:  document.getElementById('category-filter'),
    count:     document.getElementById('result-count'),
    datalist:  document.getElementById('category-options'),
    itemModal: document.getElementById('item-modal'),
    itemForm:  document.getElementById('item-form'),
    restockModal: document.getElementById('restock-modal'),
    restockForm:  document.getElementById('restock-form'),
    csvModal:  document.getElementById('csv-modal'),
    confirmModal: document.getElementById('confirm-modal')
  };

  const state = {
    q: '',
    status: cfg.initialStatus || 'all',
    category: cfg.initialCategory || '',
    products: [],
    byId: {}
  };

  /* ------------------------------------------------------------ rendering */
  function renderTotals(totals, count) {
    const set = (key, value) => {
      const el = document.querySelector('[data-kpi="' + key + '"]');
      if (el) { el.textContent = value; }
    };
    set('count', count);
    set('stock_value', App.money(totals.stock_value));
    set('sell_value', App.money(totals.sell_value));
    set('potential', 'Profit ' + App.money(totals.sell_value - totals.stock_value) + ' if all sold');
    set('alerts', totals.low_stock + totals.out_of_stock);
    set('alerts-note', totals.low_stock + ' low · ' + totals.out_of_stock + ' out of stock');
    els.count.textContent = count + (count === 1 ? ' item' : ' items');
  }

  function renderProduct(product) {
    const margin = product.margin > 0 ? product.margin + '% margin' : 'no margin set';
    const meta = [product.sku, product.category].filter(Boolean).join(' · ');
    const packSize = parseInt(product.pack_size, 10) || 1;
    const packInfo = packSize > 1
      ? ' · ' + packSize + ' pcs/pack' +
        (product.pack_price > 0 ? ' · ' + App.money(product.pack_price) + '/pack' : '')
      : '';
    const priceLine = product.selling_price > 0
      ? App.money(product.selling_price) + ' / pc'
      : 'No price yet';

    return '' +
      '<li class="list__item" data-id="' + product.id + '">' +
        '<div class="list__body">' +
          '<div class="list__title">' + App.escape(product.name) + '</div>' +
          '<div class="list__sub">' +
            App.escape(priceLine + packInfo + ' · ' + margin + (meta ? ' · ' + meta : '')) +
          '</div>' +
        '</div>' +
        '</div>' +
        '<div class="list__trail">' +
          App.qty(product.stock_qty) + ' pcs' +
          '<div class="list__sub"><span class="badge badge--' + product.status + '">' +
            App.escape(product.status_label) + '</span></div>' +
          '<div class="row" style="gap:6px;justify-content:flex-end;margin-top:8px">' +
            '<button class="btn btn--sm btn--soft" data-act="restock" data-id="' + product.id + '">＋ Stock</button>' +
            '<button class="btn btn--sm btn--ghost" data-act="edit" data-id="' + product.id + '">Edit</button>' +
            '<button class="btn btn--sm btn--danger-ghost" data-act="delete" data-id="' + product.id + '" aria-label="Delete ' + App.escape(product.name) + '">🗑</button>' +
          '</div>' +
        '</div>' +
      '</li>';
  }

  function renderProducts(products) {
    if (!products.length) {
      const filtered = state.q !== '' || state.status !== 'all' || state.category !== '';
      els.list.innerHTML =
        '<li class="empty"><span class="empty__icon">📦</span>' +
        (filtered ? 'No items match this search.' : 'No items yet — tap “New item” to add your first product.') +
        '</li>';
      return;
    }
    els.list.innerHTML = products.map(renderProduct).join('');
  }

  function renderCategories(categories) {
    const current = els.category.value;
    els.category.innerHTML = '<option value="">All categories</option>' +
      categories.map((c) => '<option value="' + App.escape(c) + '">' + App.escape(c) + '</option>').join('');
    els.category.value = current;

    els.datalist.innerHTML = categories.map((c) => '<option value="' + App.escape(c) + '">').join('');
  }

  /* --------------------------------------------------------------- loading */
  async function load() {
    const query = '&q=' + encodeURIComponent(state.q) +
                  '&status=' + encodeURIComponent(state.status) +
                  '&category=' + encodeURIComponent(state.category);
    try {
      const data = await App.api('products_list', undefined, { query: query });
      state.products = data.products;
      state.byId = {};
      data.products.forEach((p) => { state.byId[p.id] = p; });

      renderProducts(data.products);
      renderCategories(data.categories);
      renderTotals(data.totals, data.count);
    } catch (err) {
      els.list.innerHTML = '<li class="empty"><span class="empty__icon">⚠️</span>' + App.escape(err.message) + '</li>';
      els.count.textContent = 'Error';
    }
  }

  /* ------------------------------------------------------------ item modal */
  const packRow = document.getElementById('pack-price-row');
  const packPriceInput = document.getElementById('f-pack-price');
  const packHint = document.getElementById('pack-price-hint');

  // The price-per-pack field only exists for items that are sold in packs;
  // a 0 pack price keeps the item per-piece only.
  function updatePackRow() {
    const form = els.itemForm;
    const pack = parseInt(form.querySelector('[name="pack_size"]').value, 10) || 1;
    const cost = parseFloat(form.querySelector('[name="cost_price"]').value) || 0;
    const selling = parseFloat(form.querySelector('[name="selling_price"]').value) || 0;

    packRow.hidden = pack < 2;
    if (pack < 2) {
      packPriceInput.value = 0;
      packHint.textContent = '—';
      return;
    }
    packHint.textContent = App.money(selling * pack) + ' selling · ' + App.money(cost * pack) + ' buying';
  }

  function openItemModal(product) {
    const form = els.itemForm;
    form.reset();
    form.querySelector('[name="id"]').value = product ? product.id : '';
    document.getElementById('item-modal-title').textContent = product ? 'Edit item' : 'New item';

    if (product) {
      form.querySelector('[name="name"]').value = product.name;
      form.querySelector('[name="sku"]').value = product.sku || '';
      form.querySelector('[name="category"]').value = product.category || '';
      form.querySelector('[name="cost_price"]').value = product.cost_price;
      form.querySelector('[name="selling_price"]').value = product.selling_price;
      form.querySelector('[name="stock_qty"]').value = product.stock_qty;
      form.querySelector('[name="pack_size"]').value = product.pack_size;
      packPriceInput.value = product.pack_price || 0;
    } else {
      form.querySelector('[name="pack_size"]').value = 1;
      form.querySelector('[name="stock_qty"]').value = 0;
      packPriceInput.value = 0;
    }

    updateMarginPreview();
    updatePackRow();
    App.openModal('item-modal');
  }

  function updateMarginPreview() {
    const cost = parseFloat(els.itemForm.querySelector('[name="cost_price"]').value) || 0;
    const selling = parseFloat(els.itemForm.querySelector('[name="selling_price"]').value) || 0;
    const out = els.itemForm.querySelector('[data-margin="per-piece"]');
    const diff = selling - cost;
    out.textContent = App.money(diff) + (selling > 0 ? ' (' + ((diff / selling) * 100).toFixed(1) + '%)' : '');
    out.parentElement.style.background = diff < 0 ? 'var(--danger-soft)' : '';
  }

  els.itemForm.addEventListener('input', (event) => {
    if (event.target.name === 'cost_price' || event.target.name === 'selling_price') {
      updateMarginPreview();
      updatePackRow();
    }
    if (event.target.name === 'pack_size') {
      updatePackRow();
    }
  });

  els.itemForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('item-submit');
    const form = event.target;

    const packSize = parseInt(form.querySelector('[name="pack_size"]').value, 10) || 1;
    const product = {
      id: parseInt(form.querySelector('[name="id"]').value, 10) || 0,
      name: form.querySelector('[name="name"]').value.trim(),
      sku: form.querySelector('[name="sku"]').value.trim(),
      category: form.querySelector('[name="category"]').value.trim(),
      cost_price: form.querySelector('[name="cost_price"]').value,
      selling_price: form.querySelector('[name="selling_price"]').value,
      stock_qty: form.querySelector('[name="stock_qty"]').value || 0,
      pack_size: packSize,
      pack_price: packSize > 1 ? (parseFloat(form.querySelector('[name="pack_price"]').value) || 0) : 0
    };

    if (!product.name) {
      App.toast('Give the item a name.', 'err');
      return;
    }
    if (parseFloat(product.selling_price) < parseFloat(product.cost_price)) {
      App.toast('Selling price is below the buying price — profit will be negative.', 'err');
    }

    App.busy(button, true, 'Saving…');
    try {
      const data = await App.api('product_save', product);
      App.closeModal('item-modal');
      App.toast(data.message, 'ok');
      await load();
    } catch (err) {
      App.toast(err.message, 'err');
    } finally {
      App.busy(button, false);
    }
  });

  /* --------------------------------------------------------- restock modal */
  function openRestockModal(product) {
    const form = els.restockForm;
    form.reset();
    form.querySelector('[name="id"]').value = product.id;
    form.querySelector('[name="packs"]').value = 1;
    document.getElementById('restock-item').textContent =
      product.name + ' — currently ' + App.qty(product.stock_qty) + ' pcs on hand.';
    App.openModal('restock-modal');
  }

  els.restockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('restock-submit');
    const form = event.target;

    const payload = {
      id: parseInt(form.querySelector('[name="id"]').value, 10),
      packs: parseFloat(form.querySelector('[name="packs"]').value) || 0
    };

    App.busy(button, true, 'Saving…');
    try {
      const data = await App.api('product_restock', payload);
      App.closeModal('restock-modal');
      App.toast(data.message, 'ok');
      await load();
    } catch (err) {
      App.toast(err.message, 'err');
    } finally {
      App.busy(button, false);
    }
  });

  /* -------------------------------------------------------------- deleting */
  let pendingDeleteId = null;

  function openDeleteModal(product) {
    pendingDeleteId = product.id;
    document.getElementById('confirm-text').textContent =
      '“' + product.name + '” will be removed from the catalog. Sales already recorded stay in your reports.';
    App.openModal('confirm-modal');
  }

  document.getElementById('confirm-delete').addEventListener('click', async (event) => {
    if (!pendingDeleteId) { return; }
    App.busy(event.target, true, 'Deleting…');
    try {
      const data = await App.api('product_delete', { id: pendingDeleteId });
      App.closeModal('confirm-modal');
      App.toast(data.message, 'ok');
      pendingDeleteId = null;
      await load();
    } catch (err) {
      App.toast(err.message, 'err');
    } finally {
      App.busy(event.target, false);
    }
  });

  /* ------------------------------------------------------- list delegation */
  els.list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) { return; }
    const product = state.byId[button.dataset.id];
    if (!product) { return; }

    if (button.dataset.act === 'edit') { openItemModal(product); }
    if (button.dataset.act === 'restock') { openRestockModal(product); }
    if (button.dataset.act === 'delete') { openDeleteModal(product); }
  });

  /* ------------------------------------------------------ search & filters */
  els.search.addEventListener('input', App.debounce((event) => {
    state.q = event.target.value.trim();
    load();
  }, 220));

  els.filters.addEventListener('click', (event) => {
    const pill = event.target.closest('[data-status]');
    if (!pill) { return; }
    els.filters.querySelectorAll('.pill').forEach((p) => p.classList.remove('is-active'));
    pill.classList.add('is-active');
    state.status = pill.dataset.status;
    load();
  });

  els.category.addEventListener('change', (event) => {
    state.category = event.target.value;
    load();
  });

  document.getElementById('btn-add-item').addEventListener('click', () => openItemModal(null));
  document.getElementById('btn-open-csv').addEventListener('click', () => App.openModal('csv-modal'));

  /* ------------------------------------------------------------ csv tools */
  document.getElementById('btn-export-products').addEventListener('click', () => App.download('export_products'));
  document.getElementById('btn-export-sales').addEventListener('click', () => App.download('export_sales'));

  document.getElementById('import-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('import-submit');
    const result = document.getElementById('import-result');
    const fileInput = document.getElementById('import-file');
    const mode = event.target.querySelector('[name="mode"]:checked').value;

    if (!fileInput.files.length) {
      App.toast('Choose a CSV file first.', 'err');
      return;
    }
    if (mode === 'replace' && !window.confirm('This deletes every existing item before importing. Continue?')) {
      return;
    }

    const body = new FormData();
    body.append('file', fileInput.files[0]);
    body.append('mode', mode);

    App.busy(button, true, 'Uploading…');
    try {
      const data = await App.api('import_products', body);
      result.className = '';
      result.innerHTML =
        '<div class="card" style="box-shadow:none;border:1px solid var(--line);margin:0">' +
          '<strong>' + App.escape(data.message) + '</strong>' +
          '<div class="muted" style="font-size:13px;margin-top:6px">' +
            data.inserted + ' added · ' + data.updated + ' updated' +
          '</div>' +
          (data.errors.length
            ? '<div class="muted" style="font-size:12.5px;margin-top:8px">Skipped rows:<br>' +
                data.errors.map(App.escape).join('<br>') + '</div>'
            : '') +
        '</div>';
      App.toast(data.message, 'ok');
      fileInput.value = '';
      await load();
    } catch (err) {
      App.toast(err.message, 'err');
    } finally {
      App.busy(button, false);
    }
  });

  /* ----------------------------------------------------------------- boot */
  load().then(() => {
    if (cfg.openNew) { openItemModal(null); }
  });
})();
