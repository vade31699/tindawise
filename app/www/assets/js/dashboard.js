/* ==========================================================================
   Dashboard — quietly refreshes today's numbers while the page stays open
   ========================================================================== */
(function () {
  'use strict';

  const REFRESH_MS = 60000;

  function setText(selector, value) {
    const el = document.querySelector(selector);
    if (el) { el.textContent = value; }
  }

  function renderLowStock(items) {
    const list = document.getElementById('low-stock-list');
    if (!list) { return; }

    if (!items.length) {
      list.innerHTML = '<li class="empty"><span class="empty__icon">✅</span>All items are well stocked.</li>';
      return;
    }
    list.innerHTML = items.map((item) => '' +
      '<li class="list__item">' +
        '<div class="list__body">' +
          '<div class="list__title">' + App.escape(item.name) + '</div>' +
          '<div class="list__sub">Only ' + App.qty(item.stock_qty) + ' pcs left</div>' +
        '</div>' +
        '<span class="badge badge--' + item.status + '">' + App.escape(item.status_label) + '</span>' +
      '</li>').join('');
  }

  function renderRecent(sales) {
    const list = document.getElementById('recent-sales');
    if (!list || !sales.length) { return; }

    list.innerHTML = sales.map((sale) => '' +
      '<li class="list__item">' +
        '<div class="list__body">' +
          '<div class="list__title">' + App.escape(sale.reference) + '</div>' +
          '<div class="list__sub">' + App.escape(sale.sold_at) + ' · ' + sale.item_count + ' item(s)</div>' +
        '</div>' +
        '<div class="list__trail">' + App.money(sale.total_amount) +
          '<div class="list__sub" style="color:var(--profit)">+' + App.money(sale.profit) + '</div>' +
        '</div>' +
      '</li>').join('');
  }

  async function refresh() {
    try {
      const data = await App.api('dashboard_stats');
      const today = data.today.totals;

      setText('#kpi-revenue', App.money(today.revenue));
      setText('#kpi-revenue-note', today.transactions + ' transaction(s)');
      setText('#kpi-profit', App.money(today.profit));
      setText('#kpi-profit-note', today.margin + '% margin');

      renderLowStock(data.low_stock_items);
      renderRecent(data.recent_sales);
    } catch (err) {
      // Offline pages should never shout at the owner: keep the last numbers.
      console.warn('Dashboard refresh failed:', err.message);
    }
  }

  const timer = setInterval(refresh, REFRESH_MS);

  // Refresh immediately when the owner returns to the tab, then resume polling.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { refresh(); }
  });
  window.addEventListener('beforeunload', () => clearInterval(timer));
})();
