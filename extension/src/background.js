/* Toolbar action and mode-change broadcast for Chrome and Edge MV3. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RDAPBackground = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function shouldOpenLookup(response) { return !response?.rdap; }
  return Object.freeze({ shouldOpenLookup });
});

if (typeof chrome !== 'undefined' && chrome.action) {
  const extensionApi = chrome;
  function openLookupPage() {
    extensionApi.tabs.create({ url: extensionApi.runtime.getURL('lookup/index.html') });
  }
  extensionApi.action.onClicked.addListener(tab => {
    if (!tab.id) { openLookupPage(); return; }
    extensionApi.tabs.sendMessage(tab.id, { type: 'RDAP_VIEWER_ACTION' }, response => {
      if (extensionApi.runtime.lastError || RDAPBackground.shouldOpenLookup(response)) openLookupPage();
    });
  });
  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.operatingMode) return;
    const mode = changes.operatingMode.newValue === 'onDemand' ? 'onDemand' : 'automatic';
    extensionApi.tabs.query({}, tabs => tabs.forEach(tab => {
      if (tab.id && /^https?:/i.test(tab.url || '')) {
        extensionApi.tabs.sendMessage(tab.id, { type: 'RDAP_MODE_CHANGED', mode }, () => void extensionApi.runtime.lastError);
      }
    }));
  });
}
