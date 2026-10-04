/* ==========================================================================
   Settings page — save store preferences and trigger a local backup
   ========================================================================== */
(function () {
  'use strict';

  const cfg = window.SETTINGS_CONFIG || {};
  App.currency = cfg.currency || App.currency;

  const form = document.getElementById('settings-form');
  const submit = document.getElementById('settings-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      store_name: form.querySelector('[name="store_name"]').value.trim(),
      owner_name: form.querySelector('[name="owner_name"]').value.trim(),
      currency: form.querySelector('[name="currency"]').value.trim(),
      low_stock: form.querySelector('[name="low_stock"]').value || 0,
      receipt_footer: form.querySelector('[name="receipt_footer"]').value.trim(),
      allow_negative_stock: form.querySelector('[name="allow_negative_stock"]').checked ? 1 : 0
    };

    App.busy(submit, true, 'Saving…');
    try {
      const data = await App.api('settings_save', payload);
      App.toast(data.message, 'ok');
      App.currency = payload.currency || App.currency;
    } catch (err) {
      App.toast(err.message, 'err');
    } finally {
      App.busy(submit, false);
    }
  });

  document.getElementById('btn-backup').addEventListener('click', () => App.download('backup_db'));
  document.getElementById('btn-export-products').addEventListener('click', () => App.download('export_products'));
})();
