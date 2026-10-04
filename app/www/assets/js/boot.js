/* ==========================================================================
   Boots the on-device backend before any page script runs.

   The PHP version injected window.*_CONFIG and rendered the first screenful of
   numbers while producing the page. With no server, this file does that job:
   it opens the SQLite database, reads the settings, fills in whatever the PHP
   page used to render server-side, then loads the page's own script.
   ========================================================================== */
(function () {
  'use strict';

  const boot = window.BOOT || { page: 'home' };

  const PAGE_SCRIPT = {
    home: 'assets/js/dashboard.js',
    inventory: 'assets/js/inventory.js',
    pos: 'assets/js/pos.js',
    reports: 'assets/js/reports.js',
    settings: 'assets/js/settings.js'
  };

  /* ------------------------------------------------------------- utilities */
  function query() {
    const out = {};
    String(window.location.search || '')
      .replace(/^[?]/, '')
      .split('&')
      .forEach(function (pair) {
        if (!pair) { return; }
        const eq = pair.indexOf('=');
        const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
        const raw = eq === -1 ? '' : pair.slice(eq + 1);
        out[key] = decodeURIComponent(raw.replace(/\+/g, ' '));
      });
    return out;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.body.appendChild(el);
    });
  }

  function text(selector, value) {
    const el = document.querySelector(selector);
    if (el) { el.textContent = value; }
  }

  function iso(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function fail(message) {
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div class="boot-error">' + App.escape(message) + '</div>'
    );
  }

  /* ------------------------------------------------- server-rendered parts */

  /** Header subtitle: "My Store · Sun, Oct 4". */
  function paintHeader(storeName) {
    const now = new Date();
    const subtitle = storeName + ' · ' + now.toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric'
    });
    const el = document.querySelector('.app-header__titles span');
    if (el) { el.textContent = subtitle; }
    document.title = (document.querySelector('.app-header__titles h1')?.textContent || '') +
      ' · ' + storeName;
  }

  /** Dashboard: week/month KPIs, the 7-day chart and the first-run hint. */
  async function paintDashboard() {
    const data = await App.api('dashboard_stats');
    const daily = data.week_daily || [];
    const maxRevenue = Math.max(1, ...daily.map(function (d) { return d.revenue; }));

    const week = data.week;
    text('#week-revenue', App.money(week.revenue));
    text('#week-profit', App.money(week.profit));
    text('#week-chart-profit', App.money(week.profit));
    text('#month-revenue', App.money(data.month.revenue));
    text('#month-profit', App.money(data.month.profit));

    const chart = document.getElementById('week-chart');
    if (chart && daily.length) {
      chart.innerHTML = daily.map(function (day, index) {
        const height = Math.max(3, Math.round((day.revenue / maxRevenue) * 100));
        const isToday = index === daily.length - 1;
        const when = new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', year: 'numeric'
        });
        const dow = new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
        return '<div class="chart__col" title="' + App.escape(when + ': ' + App.money(day.revenue)) + '">' +
          '<div class="chart__bar' + (isToday ? ' chart__bar--today' : '') +
            '" style="height:' + height + '%"></div>' +
          '<div class="chart__label">' + (isToday ? 'Today' : App.escape(dow)) + '</div>' +
          '</div>';
      }).join('');
    }

    // The stock alerts and recent sales lists are painted by dashboard.js.
    const stats = await App.api('app_stats');
    const hint = document.getElementById('first-run-hint');
    if (hint) { hint.classList.toggle('hidden', stats.products > 0); }
  }

  /** Settings page: fill the form and the two info cards. */
  async function paintSettings(config) {
    const set = function (name, value) {
      const el = document.querySelector('[name="' + name + '"]');
      if (!el) { return; }
      if (el.type === 'checkbox') { el.checked = !!value; } else { el.value = value; }
    };

    set('store_name', config.store_name);
    set('owner_name', config.owner_name);
    set('currency', config.currency);
    set('low_stock', config.low_stock);
    set('receipt_footer', config.receipt_footer);
    set('allow_negative_stock', config.allow_negative_stock);

    const stats = await App.api('app_stats');
    text('#db-path', window.AppDB ? 'On this device (app private storage)' : '—');
    text('#db-size', (Math.round((stats.bytes / 1024) * 10) / 10).toLocaleString(undefined, {
      minimumFractionDigits: 1, maximumFractionDigits: 1
    }) + ' KB');
    text('#stat-products', String(stats.products));
    text('#stat-sales', String(stats.sales));

    const ready = window.AppDB ? await window.AppDB.ready() : { version: '—' };
    text('#stat-version', ready.version);
    text('#stat-integrity', ready.integrity || '—');
    text('#stat-journal', ready.pragmas ? String(ready.pragmas.journal_mode || '—') : '—');
    text('#stat-engine', stats.sqlite_version || '—');
    text('#stat-time', new Date(stats.server_time.replace(' ', 'T')).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    }));
  }

  /* ----------------------------------------------------------- page set-up */

  /** Controls that were plain <a href="api.php?..."> links in the PHP pages. */
  function wireStaticControls() {
    const template = document.getElementById('btn-csv-template');
    if (template) {
      template.addEventListener('click', function () { App.download('csv_template'); });
    }
  }

  /** Highlights the status pill that matches ?status= in the URL. */
  function markStatusPill(status) {
    document.querySelectorAll('#status-filters .pill').forEach(function (pill) {
      pill.classList.toggle('is-active', pill.dataset.status === status);
    });
  }

  async function start() {
    const config = await App.api('settings_get');
    App.currency = config.currency;
    paintHeader(config.store_name);
    wireStaticControls();

    const params = query();

    switch (boot.page) {
      case 'home':
        window.SETTINGS_CONFIG = window.SETTINGS_CONFIG || {};
        await paintDashboard();
        break;

      case 'inventory':
        window.INVENTORY_CONFIG = {
          currency: config.currency,
          lowStock: config.low_stock,
          initialStatus: ['all', 'low', 'out', 'instock'].indexOf(params.status) >= 0 ? params.status : 'all',
          initialCategory: params.category || '',
          openNew: 'new' in params
        };
        markStatusPill(window.INVENTORY_CONFIG.initialStatus);
        break;

      case 'pos':
        window.POS_CONFIG = {
          currency: config.currency,
          lowStock: config.low_stock,
          allowNegative: config.allow_negative_stock,
          storeName: config.store_name,
          receiptFooter: config.receipt_footer
        };
        // Zeroed totals the checkout sheet shows before the first tap.
        ['#cart-bar-total', '#sum-cost', '#sum-profit', '#sum-total', '#change-value']
          .forEach(function (sel) { text(sel, App.money(0)); });
        break;

      case 'reports':
        window.REPORTS_CONFIG = { currency: config.currency, lowStock: config.low_stock };
        (function () {
          const now = new Date();
          const first = new Date(now.getFullYear(), now.getMonth(), 1);
          const from = document.getElementById('from-date');
          const to = document.getElementById('to-date');
          if (from) { from.value = iso(first); }
          if (to) { to.value = iso(now); }
        })();
        break;

      case 'settings':
        window.SETTINGS_CONFIG = { currency: config.currency };
        await paintSettings(config);
        break;
    }

    const script = PAGE_SCRIPT[boot.page];
    if (script) { await loadScript(script); }
  }

  start().catch(function (err) {
    console.error(err);
    fail((err && err.message) || 'The local database could not be opened.');
  });
})();