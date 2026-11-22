(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RDAPSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function normalizeMode(value) { return value === 'onDemand' ? 'onDemand' : 'automatic'; }
  return Object.freeze({ normalizeMode });
});

if (typeof document !== 'undefined') {
  const api = globalThis.chrome;
  const form = document.getElementById('settings-form');
  const status = document.getElementById('save-status');
  const radios = Array.from(form.querySelectorAll('input[name="operatingMode"]'));
  api.storage.local.get('operatingMode', values => {
    const mode = RDAPSettings.normalizeMode(values.operatingMode);
    if (!values.operatingMode) api.storage.local.set({ operatingMode: mode });
    radios.find(radio => radio.value === mode).checked = true;
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const mode = RDAPSettings.normalizeMode(radios.find(radio => radio.checked)?.value);
    api.storage.local.set({ operatingMode: mode }, () => {
      status.textContent = 'Settings saved.';
      setTimeout(() => { status.textContent = ''; }, 1800);
    });
  });
}
