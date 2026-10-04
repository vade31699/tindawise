/* ==========================================================================
   Store POS — shared front-end helpers (vanilla JS, no build step, offline safe)
   ========================================================================== */
(function () {
  'use strict';

  const App = window.App = window.App || {};

  /** Global currency symbol, injected by each page. */
  App.currency = App.currency || '$';

  /* ------------------------------------------------------------ on-device API */
  /**
   * Runs an action against the app's own SQLite database.
   *
   * The on-device backend (backend.js) exposes the same action names, payloads
   * and response bodies as the PHP api.php, so every page script below works
   * unchanged. Falls back to the PHP endpoint when opened in a plain browser.
   */
  App.native = function () { return !!window.AppDB; };

  App.api = async function (action, payload, options) {
    options = options || {};

    const query = App.parseQuery(options.query);

    if (App.native()) {
      // A file upload arrives as FormData; the backend wants plain text.
      if (payload instanceof FormData) {
        const body = {};
        for (const [key, value] of payload.entries()) {
          if (value instanceof File) {
            body[key] = await value.text();
          } else {
            body[key] = value;
          }
        }
        return window.AppDB.call(action, body, query);
      }
      return window.AppDB.call(action, payload === undefined ? {} : payload, query);
    }

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

  /** Parses an "&a=1&b=2" fragment into a plain object. */
  App.parseQuery = function (query) {
    const out = {};
    if (!query) { return out; }

    String(query).replace(/^[?&]/, '').split('&').forEach(function (pair) {
      if (!pair) { return; }
      const eq = pair.indexOf('=');
      const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
      const raw = eq === -1 ? '' : pair.slice(eq + 1);
      out[key] = decodeURIComponent(raw.replace(/\+/g, ' '));
    });
    return out;
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

  /** Hands an export to the share sheet on-device, or downloads it in a browser. */
  App.download = async function (action, query) {
    if (App.native()) {
      try {
        const filename = await window.AppDB.download(action, App.parseQuery(query));
        App.toast('Saved ' + filename, 'ok');
      } catch (err) {
        App.toast(err.message, 'err');
      }
      return;
    }
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
