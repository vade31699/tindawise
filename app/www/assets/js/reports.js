/* ==========================================================================
   Reports page — date-range aggregation, charts and CSV export triggers
   ========================================================================== */
(function () {
  'use strict';

  const cfg = window.REPORTS_CONFIG || {};
  App.currency = cfg.currency || App.currency;

  const els = {
    pills:    document.getElementById('range-pills'),
    custom:   document.getElementById('custom-range'),
    from:     document.getElementById('from-date'),
    to:       document.getElementById('to-date'),
    label:    document.getElementById('range-label'),
    chart:    document.getElementById('report-chart'),
    chartNote: document.getElementById('chart-note'),
    dailyBody: document.querySelector('#daily-table tbody'),
    topBody:  document.querySelector('#top-table tbody'),
    salesList: document.getElementById('sales-list')
  };

  let range = { from: '', to: '', preset: 'week' };

  /* ---------------------------------------------------------------- helpers */
  function iso(date) {
    const d = new Date(date);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function presetRange(preset) {
    const today = new Date();
    if (preset === 'today') {
      return { from: iso(today), to: iso(today) };
    }
    if (preset === 'yesterday') {
      const y = new Date(today.getTime() - 86400000);
      return { from: iso(y), to: iso(y) };
    }
    if (preset === 'week') {
      return { from: iso(new Date(today.getTime() - 6 * 86400000)), to: iso(today) };
    }
    if (preset === 'month') {
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    }
    return { from: els.from.value, to: els.to.value };
  }

  function setKpi(key, value) {
    const el = document.querySelector('[data-kpi="' + key + '"]');
    if (el) { el.textContent = value; }
  }

  function emptyRow(cols, message) {
    return '<tr><td colspan="' + cols + '" class="muted center" style="padding:18px">' + App.escape(message) + '</td></tr>';
  }

  /* --------------------------------------------------------------- loading */
  async function load() {
    els.label.textContent = 'Loading…';
    try {
      const data = await App.api('report_summary', undefined, {
        query: '&from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to)
      });
      render(data);
    } catch (err) {
      els.label.textContent = err.message;
      els.dailyBody.innerHTML = emptyRow(5, err.message);
    }
  }

  function render(data) {
    const t = data.totals;

    setKpi('revenue', App.money(t.revenue));
    setKpi('revenue-note', t.items > 0 ? App.qty(t.items) + ' item(s) sold' : 'no sales in this range');
    setKpi('profit', App.money(t.profit));
    setKpi('profit-note', t.margin + '% margin');
    setKpi('cost', App.money(t.cost));
    setKpi('transactions', t.transactions);
    setKpi('average', 'avg ' + App.money(t.average_sale) + ' per sale');

    els.label.textContent = data.from === data.to
      ? 'Showing ' + App.escape(data.from)
      : 'Showing ' + App.escape(data.from) + ' → ' + App.escape(data.to);

    renderChart(data.daily);
    renderDaily(data.daily, t);
    renderTop(data.top_products);
    renderSales(data.recent_sales);
  }

  function renderChart(daily) {
    const max = Math.max(1, ...daily.map((d) => d.revenue));
    const step = daily.length > 14 ? Math.ceil(daily.length / 7) : 1;
    const today = iso(new Date());

    els.chart.innerHTML = daily.map((day, index) => {
      const height = Math.max(3, Math.round((day.revenue / max) * 100));
      const showLabel = index % step === 0 || day.date === today;
      const cls = day.date === today ? 'chart__bar chart__bar--today' : 'chart__bar';
      const label = day.date === today ? 'Today' : day.date.slice(5).replace('-', '/');

      return '<div class="chart__col" title="' + App.escape(day.date + ': ' + App.money(day.revenue)) + '">' +
        '<div class="' + cls + '" style="height:' + height + '%"></div>' +
        '<div class="chart__label">' + (showLabel ? App.escape(label) : '') + '</div>' +
      '</div>';
    }).join('');

    const best = daily.reduce((a, b) => (b.revenue > a.revenue ? b : a), daily[0] || { revenue: 0, date: '—' });
    els.chartNote.textContent = best.revenue > 0
      ? 'Best: ' + best.date.slice(5) + ' (' + App.money(best.revenue) + ')'
      : 'No sales yet';
  }

  function renderDaily(daily, totals) {
    const rows = daily.slice().reverse().map((day) => '' +
      '<tr>' +
        '<td>' + App.escape(niceDate(day.date)) + '</td>' +
        '<td class="num">' + day.transactions + '</td>' +
        '<td class="num">' + App.qty(day.items) + '</td>' +
        '<td class="num">' + App.money(day.revenue) + '</td>' +
        '<td class="num profit">' + App.money(day.profit) + '</td>' +
      '</tr>').join('');

    const totalRow = '<tr style="background:#f7f9fc;font-weight:700">' +
      '<td>Total</td>' +
      '<td class="num">' + totals.transactions + '</td>' +
      '<td class="num">' + App.qty(totals.items) + '</td>' +
      '<td class="num">' + App.money(totals.revenue) + '</td>' +
      '<td class="num profit">' + App.money(totals.profit) + '</td>' +
    '</tr>';

    els.dailyBody.innerHTML = daily.length ? rows + totalRow : emptyRow(5, 'No sales in this range.');
  }

  function renderTop(products) {
    if (!products.length) {
      els.topBody.innerHTML = emptyRow(4, 'Nothing sold in this range yet.');
      return;
    }
    els.topBody.innerHTML = products.map((p) => '' +
      '<tr>' +
        '<td>' + App.escape(p.name) + '</td>' +
        '<td class="num">' + App.qty(p.qty) + '</td>' +
        '<td class="num">' + App.money(p.revenue) + '</td>' +
        '<td class="num profit">' + App.money(p.profit) + '</td>' +
      '</tr>').join('');
  }

  function renderSales(sales) {
    if (!sales.length) {
      els.salesList.innerHTML = '<li class="empty"><span class="empty__icon">🧾</span>No transactions in this range.</li>';
      return;
    }
    els.salesList.innerHTML = sales.map((s) => '' +
      '<li class="list__item">' +
        '<div class="list__body">' +
          '<div class="list__title">' + App.escape(s.reference) + '</div>' +
          '<div class="list__sub">' + App.escape(s.sold_at) + ' · ' + s.item_count + ' item(s)</div>' +
        '</div>' +
        '<div class="list__trail">' + App.money(s.total_amount) +
          '<div class="list__sub" style="color:var(--profit)">+' + App.money(s.profit) + '</div>' +
        '</div>' +
      '</li>').join('');
  }

  function niceDate(value) {
    const parts = value.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    return weekday + ' ' + parts[1] + '/' + parts[2];
  }

  /* ------------------------------------------------------------- listeners */
  els.pills.addEventListener('click', (event) => {
    const pill = event.target.closest('[data-range]');
    if (!pill) { return; }
    els.pills.querySelectorAll('.pill').forEach((p) => p.classList.remove('is-active'));
    pill.classList.add('is-active');

    range.preset = pill.dataset.range;
    els.custom.classList.toggle('hidden', range.preset !== 'custom');

    const next = presetRange(range.preset);
    range.from = next.from;
    range.to = next.to;
    els.from.value = next.from;
    els.to.value = next.to;

    if (range.preset !== 'custom' || (range.from && range.to)) { load(); }
  });

  els.from.addEventListener('change', () => {
    range.from = els.from.value || range.from;
    if (range.preset === 'custom') { load(); }
  });

  els.to.addEventListener('change', () => {
    range.to = els.to.value || range.to;
    if (range.preset === 'custom') { load(); }
  });

  document.getElementById('btn-refresh').addEventListener('click', load);

  document.getElementById('btn-export-sales').addEventListener('click', () =>
    App.download('export_sales', '&from=' + range.from + '&to=' + range.to));
  document.getElementById('btn-export-items').addEventListener('click', () =>
    App.download('export_sales', '&from=' + range.from + '&to=' + range.to + '&detail=1'));
  document.getElementById('btn-export-products').addEventListener('click', () => App.download('export_products'));

  document.getElementById('import-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('import-submit');
    const result = document.getElementById('import-result');
    const fileInput = document.getElementById('import-file');

    if (!fileInput.files.length) {
      App.toast('Choose a CSV file first.', 'err');
      return;
    }

    const body = new FormData();
    body.append('file', fileInput.files[0]);
    body.append('mode', 'merge');

    App.busy(button, true, 'Uploading…');
    try {
      const data = await App.api('import_products', body);
      result.className = '';
      result.innerHTML =
        '<div class="card" style="box-shadow:none;border:1px solid var(--line);margin:0">' +
          '<strong>' + App.escape(data.message) + '</strong>' +
          '<div class="muted" style="font-size:13px;margin-top:6px">' +
            data.inserted + ' added · ' + data.updated + ' updated</div>' +
          (data.errors.length
            ? '<div class="muted" style="font-size:12.5px;margin-top:8px">Skipped rows:<br>' +
                data.errors.map(App.escape).join('<br>') + '</div>'
            : '') +
        '</div>';
      App.toast(data.message, 'ok');
      fileInput.value = '';
      load();
    } catch (err) {
      App.toast(err.message, 'err');
    } finally {
      App.busy(button, false);
    }
  });

  /* ----------------------------------------------------------------- boot */
  const initial = presetRange('week');
  range.from = initial.from;
  range.to = initial.to;
  els.from.value = initial.from;
  els.to.value = initial.to;
  load();
})();
