/* ==========================================================================
   Point of sale — cart, live change computation and checkout via fetch()
   ========================================================================== */
(function () {
  'use strict';

  const cfg = window.POS_CONFIG || {};
  App.currency = cfg.currency || App.currency;

  const els = {
    grid:     document.getElementById('pos-grid'),
    search:   document.getElementById('pos-search'),
    filters:  document.getElementById('pos-filters'),
    cartBar:  document.getElementById('cart-bar'),
    barCount: document.getElementById('cart-bar-count'),
    barTotal: document.getElementById('cart-bar-total'),
    lines:    document.getElementById('cart-lines'),
    cash:     document.getElementById('cash-received'),
    quick:    document.getElementById('quick-cash'),
    changeBox: document.getElementById('change-box'),
    changeValue: document.getElementById('change-value'),
    sumItems: document.getElementById('sum-items'),
    sumCost:  document.getElementById('sum-cost'),
    sumProfit: document.getElementById('sum-profit'),
    sumTotal: document.getElementById('sum-total'),
    checkout: document.getElementById('btn-checkout'),
    receiptBody: document.getElementById('receipt-body')
  };

  /** cart: Map<productId, {product, qty}> so a product only appears once. */
  const cart = new Map();
  let products = [];
  let filter = 'all';
  let query = '';

  /* --------------------------------------------------------------- loading */
  async function loadProducts() {
    try {
      const data = await App.api('products_list', undefined, { query: '&limit=500' });
      products = data.products;
      renderGrid();
    } catch (err) {
      els.grid.innerHTML = '<div class="skeleton">' + App.escape(err.message) + '</div>';
    }
  }

  function visibleProducts() {
    return products.filter((p) => {
      if (filter === 'available' && p.stock_qty <= 0) { return false; }
      if (query !== '') {
        const haystack = (p.name + ' ' + (p.sku || '') + ' ' + (p.category || '')).toLowerCase();
        if (haystack.indexOf(query) === -1) { return false; }
      }
      return true;
    });
  }

  function renderGrid() {
    const list = visibleProducts();
    if (!list.length) {
      els.grid.innerHTML = '<div class="skeleton">No items found.' +
        (products.length === 0 ? ' Add stock first in Inventory.' : '') + '</div>';
      return;
    }

    els.grid.innerHTML = list.map((p) => {
      const inCart = cart.get(p.id);
      const out = p.stock_qty <= 0;
      return '' +
        '<button class="product-card' + (out ? ' is-out' : '') + '" type="button" data-id="' + p.id + '">' +
          '<span class="product-card__name">' + App.escape(p.name) + '</span>' +
          '<span class="product-card__price">' + App.money(p.selling_price) + '</span>' +
          '<span class="product-card__meta">' +
            (out ? '<span class="badge badge--out">Out of stock</span>'
                 : App.qty(p.stock_qty) + ' pcs left') +
            (inCart ? ' · <span class="badge badge--ok">' + App.qty(inCart.qty) + ' in cart</span>' : '') +
          '</span>' +
        '</button>';
    }).join('');
  }

  /* ------------------------------------------------------------------ cart */
  function addToCart(productId) {
    const product = products.find((p) => p.id === productId);
    if (!product) { return; }

    const line = cart.get(productId);
    const qty = line ? line.qty + 1 : 1;

    if (!cfg.allowNegative && qty > product.stock_qty) {
      App.toast('Only ' + App.qty(product.stock_qty) + ' pc(s) of ' + product.name + ' in stock.', 'err');
      return;
    }

    cart.set(productId, { product: product, qty: qty });
    renderGrid();
    renderCart();
    if (navigator.vibrate) { navigator.vibrate(8); }
  }

  function setQty(productId, qty) {
    const line = cart.get(productId);
    if (!line) { return; }

    if (!cfg.allowNegative && qty > line.product.stock_qty) {
      qty = line.product.stock_qty;
      App.toast('That is all the stock you have for ' + line.product.name + '.', 'err');
    }

    if (qty <= 0) {
      cart.delete(productId);
    } else {
      cart.set(productId, { product: line.product, qty: Math.round(qty * 1000) / 1000 });
    }
    renderGrid();
    renderCart();
  }

  function totals() {
    let count = 0, revenue = 0, cost = 0;
    cart.forEach((line) => {
      count += line.qty;
      revenue += line.product.selling_price * line.qty;
      cost += line.product.cost_price * line.qty;
    });
    return {
      count: Math.round(count * 1000) / 1000,
      revenue: Math.round(revenue * 100) / 100,
      cost: Math.round(cost * 100) / 100,
      profit: Math.round((revenue - cost) * 100) / 100
    };
  }

  function renderCart() {
    const t = totals();

    els.barCount.textContent = t.count > 0 ? App.qty(t.count) + ' item(s)' : 'Cart is empty';
    els.barTotal.textContent = App.money(t.revenue);
    els.checkout.disabled = t.count <= 0;

    if (cart.size === 0) {
      els.lines.innerHTML = '<li class="empty"><span class="empty__icon">🛒</span>Tap items to add them here.</li>';
    } else {
      els.lines.innerHTML = Array.from(cart.values()).map((line) => '' +
        '<li class="cart-line" data-id="' + line.product.id + '">' +
          '<div class="list__body">' +
            '<div class="cart-line__name">' + App.escape(line.product.name) + '</div>' +
            '<div class="cart-line__sub">' + App.money(line.product.selling_price) + ' / pc · ' +
              App.money(line.product.selling_price * line.qty) + '</div>' +
          '</div>' +
          '<div class="stepper">' +
            '<button type="button" data-step="-1" data-id="' + line.product.id + '" aria-label="Less">−</button>' +
            '<input type="number" step="any" min="0" inputmode="decimal" value="' + line.qty + '" ' +
              'data-qty="' + line.product.id + '" aria-label="Quantity">' +
            '<button type="button" data-step="1" data-id="' + line.product.id + '" aria-label="More">＋</button>' +
          '</div>' +
        '</li>').join('');
    }

    els.sumItems.textContent = App.qty(t.count);
    els.sumCost.textContent = App.money(t.cost);
    els.sumProfit.textContent = App.money(t.profit);
    els.sumTotal.textContent = App.money(t.revenue);

    renderQuickCash(t.revenue);
    renderChange();
  }

  function renderQuickCash(total) {
    const notes = [20, 50, 100, 200, 500, 1000];
    const suggestions = notes.filter((n) => n >= total).slice(0, 4);
    const buttons = [];
    if (total > 0) { buttons.push('<button type="button" data-cash="' + total + '">Exact ' + App.money(total) + '</button>'); }
    suggestions.forEach((n) => {
      buttons.push('<button type="button" data-cash="' + n + '">' + App.money(n) + '</button>');
    });
    els.quick.innerHTML = buttons.join('');
  }

  function renderChange() {
    const t = totals();
    const cash = parseFloat(els.cash.value) || 0;
    const diff = Math.round((cash - t.revenue) * 100) / 100;
    const short = diff < 0 && t.revenue > 0;

    els.changeValue.textContent = App.money(short ? -diff : diff);
    els.changeBox.classList.toggle('is-short', short);
    els.changeBox.firstElementChild.textContent = short ? 'Still short' : 'Change';
    els.checkout.disabled = t.count <= 0 || short || cash <= 0;
  }

  /* --------------------------------------------------------------- receipt */
  function renderReceipt(sale) {
    const lines = sale.lines.map((l) => '' +
      '<div class="receipt__line"><span>' + App.escape(l.name) + ' × ' + App.qty(l.qty) + '</span>' +
      '<span>' + App.money(l.line_total) + '</span></div>').join('');

    els.receiptBody.innerHTML = '' +
      '<div class="center"><strong>' + App.escape(cfg.storeName) + '</strong></div>' +
      '<div class="center muted">Receipt ' + App.escape(sale.reference) + '</div>' +
      '<div class="center muted">' + App.escape(new Date().toLocaleString()) + '</div>' +
      '<div class="receipt__hr"></div>' +
      lines +
      '<div class="receipt__hr"></div>' +
      '<div class="receipt__line"><span>Item(s)</span><span>' + App.qty(sale.item_count) + '</span></div>' +
      '<div class="receipt__line"><strong>Total</strong><strong>' + App.money(sale.total_amount) + '</strong></div>' +
      '<div class="receipt__line"><span>Cash</span><span>' + App.money(sale.cash_received) + '</span></div>' +
      '<div class="receipt__line"><strong>Change</strong><strong>' + App.money(sale.change_due) + '</strong></div>' +
      '<div class="receipt__hr"></div>' +
      '<div class="receipt__line"><span>Profit (owner copy)</span><span>' + App.money(sale.profit) + '</span></div>' +
      (cfg.receiptFooter ? '<div class="center muted" style="margin-top:8px">' + App.escape(cfg.receiptFooter) + '</div>' : '');
  }

  /* -------------------------------------------------------------- checkout */
  async function checkout() {
    const t = totals();
    if (t.count <= 0) {
      App.toast('Add an item first.', 'err');
      return;
    }

    const cash = parseFloat(els.cash.value) || 0;
    const items = Array.from(cart.values()).map((line) => ({ product_id: line.product.id, qty: line.qty }));

    App.busy(els.checkout, true, 'Saving…');
    try {
      const data = await App.api('pos_checkout', { items: items, cash_received: cash });
      renderReceipt(data.sale);
      App.closeModal('cart-modal');
      App.openModal('receipt-modal');
      App.toast(data.message, 'ok');

      cart.clear();
      els.cash.value = '';
      renderCart();
      await loadProducts();   // refresh stock levels after the sale
    } catch (err) {
      App.toast(err.message, 'err');
    } finally {
      App.busy(els.checkout, false);
      renderChange();
    }
  }

  /* ------------------------------------------------------------- listeners */
  els.grid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-id]');
    if (card) { addToCart(parseInt(card.dataset.id, 10)); }
  });

  els.cartBar.addEventListener('click', () => {
    if (cart.size === 0) {
      App.toast('Tap an item to start a sale.');
      return;
    }
    App.openModal('cart-modal');
    renderCart();
  });

  els.lines.addEventListener('click', (event) => {
    const button = event.target.closest('[data-step]');
    if (!button) { return; }
    const id = parseInt(button.dataset.id, 10);
    const line = cart.get(id);
    if (!line) { return; }
    setQty(id, line.qty + parseInt(button.dataset.step, 10));
  });

  els.lines.addEventListener('change', (event) => {
    const input = event.target.closest('[data-qty]');
    if (!input) { return; }
    setQty(parseInt(input.dataset.qty, 10), parseFloat(input.value) || 0);
  });

  els.quick.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cash]');
    if (!button) { return; }
    els.cash.value = button.dataset.cash;
    renderChange();
  });

  els.cash.addEventListener('input', renderChange);
  els.search.addEventListener('input', App.debounce((event) => {
    query = event.target.value.trim().toLowerCase();
    renderGrid();
  }, 180));

  els.filters.addEventListener('click', (event) => {
    const pill = event.target.closest('[data-filter]');
    if (!pill) { return; }
    els.filters.querySelectorAll('.pill').forEach((p) => p.classList.remove('is-active'));
    pill.classList.add('is-active');
    filter = pill.dataset.filter;
    renderGrid();
  });

  document.getElementById('btn-clear-cart').addEventListener('click', () => {
    cart.clear();
    els.cash.value = '';
    renderGrid();
    renderCart();
    App.toast('Cart cleared.');
  });

  document.getElementById('btn-new-sale').addEventListener('click', () => {
    App.closeModal('receipt-modal');
    els.search.value = '';
    query = '';
    renderGrid();
    els.search.focus();
  });

  els.checkout.addEventListener('click', checkout);

  /* History state. This must sit above the listeners that use it: the handlers
     are attached at load time and reference these immediately, so declaring them
     further down the file would throw a temporal dead zone ReferenceError. */
  const historyEls = {
    modal:  document.getElementById('history-modal'),
    list:   document.getElementById('history-list'),
    search: document.getElementById('history-search'),
    detail: document.getElementById('history-detail')
  };

  let historyQuery = '';
  let openSaleId = 0;
  let voidTarget = null;

  /* ------------------------------------------------------ history listeners */
  document.getElementById('btn-history').addEventListener('click', () => {
    historyQuery = '';
    historyEls.search.value = '';
    showPane('list');
    App.openModal('history-modal');
    loadHistory();
  });

  historyEls.modal.addEventListener('click', (event) => {
    const sale = event.target.closest('[data-sale]');
    if (sale) { openSale(parseInt(sale.dataset.sale, 10)); return; }

    const remove = event.target.closest('[data-remove]');
    if (remove) { openVoidForm(remove); return; }

    const back = event.target.closest('[data-back]');
    if (back) {
      showPane(back.dataset.back);
      if (back.dataset.back === 'list') { loadHistory(); }
    }
  });

  historyEls.search.addEventListener('input', App.debounce((event) => {
    historyQuery = event.target.value.trim();
    loadHistory();
  }, 220));

  document.getElementById('void-qty').addEventListener('input', renderVoidSummary);
  document.getElementById('void-price').addEventListener('input', renderVoidSummary);
  document.getElementById('void-form').addEventListener('submit', submitVoid);

  // Keyboard shortcuts help when testing on a desktop browser.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && document.getElementById('cart-modal').classList.contains('is-open')) {
      if (document.activeElement === els.cash) { event.preventDefault(); checkout(); }
    }
  });

  /* --------------------------------------------- purchase history / removals */
  /** Show exactly one pane of the history sheet. */
  function showPane(name) {
    historyEls.modal.querySelectorAll('[data-pane]').forEach((pane) => {
      pane.classList.toggle('hidden', pane.dataset.pane !== name);
    });
  }

  async function loadHistory() {
    if (!historyEls.list) { return; }
    historyEls.list.innerHTML = '<li class="skeleton">Loading sales…</li>';

    try {
      const query = '&limit=50' + (historyQuery !== '' ? '&q=' + encodeURIComponent(historyQuery) : '');
      const data = await App.api('sales_history', undefined, { query: query });

      if (!data.sales.length) {
        historyEls.list.innerHTML =
          '<li class="empty"><span class="empty__icon">🧾</span>No sales found.</li>';
        return;
      }

      historyEls.list.innerHTML = data.sales.map((s) => '' +
        '<li class="list__item" data-sale="' + s.id + '" style="cursor:pointer">' +
          '<div class="list__body">' +
            '<div class="list__title">' + App.escape(s.reference) +
              (s.void_count
                ? ' <span class="badge badge--low">' + s.void_count + ' removed</span>'
                : '') +
            '</div>' +
            '<div class="list__sub">' + App.escape(s.sold_at) + ' · ' +
              App.qty(s.item_count) + ' item(s)' +
              (s.voided_amount > 0 ? ' · refunded ' + App.money(s.voided_amount) : '') +
            '</div>' +
          '</div>' +
          '<div class="list__trail">' + App.money(s.total_amount) +
            '<div class="list__sub" style="color:var(--profit)">+' + App.money(s.profit) + '</div>' +
          '</div>' +
        '</li>').join('');
    } catch (err) {
      historyEls.list.innerHTML = '<li class="empty">' + App.escape(err.message) + '</li>';
    }
  }

  async function openSale(saleId) {
    openSaleId = saleId;
    showPane('detail');
    historyEls.detail.innerHTML = '<div class="skeleton">Loading sale…</div>';

    try {
      const data = await App.api('sale_detail', undefined, { query: '&id=' + encodeURIComponent(saleId) });
      renderSaleDetail(data);
    } catch (err) {
      historyEls.detail.innerHTML = '<div class="empty">' + App.escape(err.message) + '</div>';
    }
  }

  function renderSaleDetail(data) {
    const s = data.sale;
    document.getElementById('history-detail-title').textContent = s.reference;

    const summary = '' +
      '<div class="card" style="box-shadow:none;border:1px solid var(--line);margin:0 0 14px">' +
        '<div class="totals">' +
          '<div class="totals__row"><span class="muted">Sold</span><span>' + App.escape(s.sold_at) + '</span></div>' +
          '<div class="totals__row"><span class="muted">Cash received</span><span>' +
            App.money(s.cash_received) + '</span></div>' +
          '<div class="totals__row"><span class="muted">Change given</span><span>' +
            App.money(s.change_due) + '</span></div>' +
          (s.voided_amount > 0
            ? '<div class="totals__row"><span style="color:var(--danger)">Refunded</span>' +
              '<span style="color:var(--danger)">−' + App.money(s.voided_amount) + '</span></div>'
            : '') +
          '<div class="totals__row totals__row--profit"><span>Profit</span><span>' +
            App.money(s.profit) + '</span></div>' +
          '<div class="totals__row totals__row--grand"><span>Total</span><span>' +
            App.money(s.total_amount) + '</span></div>' +
        '</div>' +
      '</div>';

    const lines = data.lines.length
      ? '<ul class="list" style="margin:0">' + data.lines.map((l) => '' +
          '<li class="cart-line">' +
            '<div class="list__body">' +
              '<div class="cart-line__name">' + App.escape(l.name) + '</div>' +
              '<div class="cart-line__sub">' + App.qty(l.qty) + ' pc × ' + App.money(l.selling_price) +
                ' = ' + App.money(l.line_total) + '</div>' +
            '</div>' +
            '<button class="btn btn--danger-ghost btn--sm" type="button" data-remove="' + l.id + '"' +
              ' data-name="' + App.escape(l.name) + '" data-maxqty="' + l.qty + '"' +
              ' data-price="' + l.selling_price + '">Remove</button>' +
          '</li>').join('') + '</ul>'
      : '<div class="empty"><span class="empty__icon">📦</span>Every item on this sale was removed.</div>';

    const voids = data.voids.length
      ? '<div class="card__head" style="margin:18px 0 8px"><h2>Removed items</h2></div>' +
        '<ul class="list" style="margin:0">' + data.voids.map((v) => '' +
          '<li class="list__item">' +
            '<div class="list__body">' +
              '<div class="list__title">' + App.escape(v.name) + '</div>' +
              '<div class="list__sub">' + App.escape(v.voided_at) + ' · ' + App.qty(v.qty) +
                ' pc × ' + App.money(v.unit_price) +
                (v.reason ? ' · ' + App.escape(v.reason) : '') + '</div>' +
            '</div>' +
            '<div class="list__trail" style="color:var(--danger)">−' + App.money(v.refund_amount) + '</div>' +
          '</li>').join('') + '</ul>'
      : '';

    historyEls.detail.innerHTML = summary + lines + voids;
  }

  function openVoidForm(button) {
    voidTarget = {
      saleId: openSaleId,
      itemId: parseInt(button.dataset.remove, 10),
      name: button.dataset.name,
      maxQty: parseFloat(button.dataset.maxqty),
      maxPrice: parseFloat(button.dataset.price)
    };

    document.getElementById('void-item').textContent = voidTarget.name + ' — ' +
      App.qty(voidTarget.maxQty) + ' pc on this sale at ' + App.money(voidTarget.maxPrice) + ' each.';

    const qtyInput = document.getElementById('void-qty');
    const priceInput = document.getElementById('void-price');
    qtyInput.value = voidTarget.maxQty;
    qtyInput.max = voidTarget.maxQty;
    priceInput.value = voidTarget.maxPrice;
    priceInput.max = voidTarget.maxPrice;
    document.getElementById('void-reason').value = '';

    renderVoidSummary();
    showPane('void');
  }

  /**
   * Hold a numeric field inside its allowed range the instant it changes, so a
   * refund can never be typed for more pieces than the customer actually bought.
   * Returns the clamped number, or null when the field is empty or unparseable.
   */
  function clampField(input, min, max) {
    const raw = parseFloat(input.value);
    if (!isFinite(raw)) { return null; }
    let v = Math.min(Math.max(raw, min), max);
    v = Math.round(v * 1000) / 1000;
    if (v !== raw) { input.value = String(v); }
    return v;
  }

  function renderVoidSummary() {
    const qtyInput = document.getElementById('void-qty');
    const priceInput = document.getElementById('void-price');
    const refundEl = document.getElementById('void-refund');
    const button = document.getElementById('void-submit');

    const maxQty = voidTarget ? voidTarget.maxQty : 0;
    const maxPrice = voidTarget ? voidTarget.maxPrice : 0;

    const qty = clampField(qtyInput, 0, maxQty);
    const price = clampField(priceInput, 0, maxPrice);

    // Nothing valid typed yet (field cleared mid-edit): no refund, no save.
    if (qty === null || price === null || qty <= 0) {
      refundEl.textContent = '—';
      button.disabled = true;
      return;
    }

    refundEl.textContent = App.money(Math.round(qty * price * 100) / 100);
    button.disabled = false;
  }

  async function submitVoid(event) {
    event.preventDefault();
    if (!voidTarget) { return; }

    const qty = parseFloat(document.getElementById('void-qty').value);
    const price = parseFloat(document.getElementById('void-price').value);

    // The inputs are clamped as you type; this guards a stale or scripted value.
    if (!(qty > 0) || qty > voidTarget.maxQty || !(price >= 0) || price > voidTarget.maxPrice) {
      App.toast('Enter 1 to ' + App.qty(voidTarget.maxQty) + ' pc at up to ' +
        App.money(voidTarget.maxPrice) + ' each.', 'err');
      renderVoidSummary();
      return;
    }

    const button = document.getElementById('void-submit');
    const payload = {
      transaction_id: voidTarget.saleId,
      item_id: voidTarget.itemId,
      qty: qty,
      unit_price: price,
      reason: document.getElementById('void-reason').value.trim()
    };

    App.busy(button, true, 'Saving…');
    try {
      const data = await App.api('sale_void_item', payload);
      voidTarget = null;
      App.toast(data.message, 'ok');
      await openSale(payload.transaction_id);
      await loadHistory();
      await loadProducts();   // returned pieces are back on the shelf
    } catch (err) {
      App.toast(err.message, 'err');
    } finally {
      App.busy(button, false);
    }
  }

  /* ----------------------------------------------------------------- boot */
  renderCart();
  loadProducts();
})();
