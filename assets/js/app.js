/* ==========================================================================
   Store POS — shared front-end helpers (vanilla JS, no build step, offline safe)
   ========================================================================== */
(function () {
  'use strict';

  const App = window.App = window.App || {};

  /** Global currency symbol, injected by each page. */
  App.currency = App.currency || '$';

  /* ------------------------------------------------------------- fetch API */
  /**
   * Talk to a PHP endpoint. Returns parsed JSON, throws Error on failure.
   * Sends Accept: application/json so PHP can detect an AJAX call.
   */
  App.api = async function (action, payload, options) {
    options = options || {};
    const init = {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    };

    if (payload instanceof FormData) {
      init.body = payload;
    } else if (payload !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(payload);
    }

    const url = 'api.php?action=' + encodeURIComponent(action) + (options.query || '');
    let response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new Error('Cannot reach the local server. Is PHP still running?');
    }

    let data = null;
    try { data = await response.json(); } catch (err) { data = null; }

    if (!response.ok || !data || data.ok === false) {
      throw new Error((data && data.error) || 'Request failed (' + response.status + ')');
    }
    return data;
  };

  /* ---------------------------------------------------------------- toasts */
  App.toast = function (message, kind) {
    const host = document.getElementById('toast-host');
    if (!host) { return; }
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .2s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 220);
    }, 2400);
  };

  /* ---------------------------------------------------------------- modals */
  App.openModal = function (id) {
    const modal = document.getElementById(id);
    if (!modal) { return; }
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    const focusable = modal.querySelector('input, select, textarea, button');
    if (focusable) { setTimeout(function () { focusable.focus(); }, 80); }
  };

  App.closeModal = function (id) {
    const modal = typeof id === 'string' ? document.getElementById(id) : id;
    if (!modal) { return; }
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  };

  // Tap the dark backdrop or any [data-close] control to dismiss a sheet.
  document.addEventListener('click', function (event) {
    if (event.target.classList && event.target.classList.contains('modal')) {
      App.closeModal(event.target);
    }
    const closer = event.target.closest && event.target.closest('[data-close]');
    if (closer) {
      const modal = closer.closest('.modal');
      if (modal) { App.closeModal(modal); }
    }
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      document.querySelectorAll('.modal.is-open').forEach(App.closeModal);
    }
  });

  /* ------------------------------------------------------------ formatting */
  App.money = function (value) {
    const n = Number(value) || 0;
    return App.currency + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  App.qty = function (value) {
    const n = Number(value) || 0;
    return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
  };

  App.escape = function (value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /** Debounce helper for live search inputs. */
  App.debounce = function (fn, wait) {
    let timer = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 220);
    };
  };

  /** Trigger a browser download for an API endpoint that streams a file. */
  App.download = function (action, query) {
    window.location.href = 'api.php?action=' + encodeURIComponent(action) + (query || '');
  };

  /** Enable/disable a button while an async action runs. */
  App.busy = function (button, isBusy, busyLabel) {
    if (!button) { return; }
    if (isBusy) {
      button.dataset.label = button.innerHTML;
      button.disabled = true;
      button.innerHTML = busyLabel || 'Working…';
    } else {
      button.disabled = false;
      if (button.dataset.label) { button.innerHTML = button.dataset.label; }
    }
  };
})();
