/* Passive RDAP page detection and browser-rendered response integration. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RDAPExtension = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function shouldRun(url, mime, isTopFrame, rdap) {
    const type = String(mime || '').toLowerCase();
    return isTopFrame && rdap.looksLikeRdapUrl(url) && !(type.includes('html') || type.includes('xml') || type.includes('pdf'));
  }
  function shouldAutoDisplay(mode, url, mime, isTopFrame, rdap) {
    return mode !== 'onDemand' && shouldRun(url, mime, isTopFrame, rdap);
  }
  function parseDocument(raw, rdap) {
    if (typeof raw !== 'string' || !raw.trimStart().startsWith('{') || raw.length > 5 * 1024 * 1024) return null;
    try {
      const data = JSON.parse(raw);
      const kind = rdap.detect(data);
      return kind ? { data, kind, raw } : null;
    } catch { return null; }
  }
  return Object.freeze({ shouldRun, shouldAutoDisplay, parseDocument });
});

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const R = globalThis.RDAPHuman;
  const Renderer = globalThis.RDAPRenderer;
  const api = globalThis.chrome || globalThis.browser;
  const runtime = api?.runtime;
  const storage = api?.storage?.local;
  let mode = 'automatic';
  let preferences = {};
  let renderer = null;
  let original = null;
  let originalBodyStyle = null;
  let viewerBodyStyle = null;
  let showingOriginal = false;

  function parsedPage(force = false) {
    if (!R || window.top !== window) return null;
    if (!force && !RDAPExtension.shouldRun(location.href, document.contentType, true, R)) return null;
    return RDAPExtension.parseDocument(document.body?.textContent || '', R);
  }
  function setBodyStyle(value) {
    if (value === null) document.body.removeAttribute('style');
    else document.body.setAttribute('style', value);
  }
  function showOriginal(show) {
    if (!renderer || !original) return;
    if (show === showingOriginal) return;
    showingOriginal = show;
    if (show) {
      renderer.host.remove();
      while (document.body.firstChild) original.appendChild(document.body.firstChild);
      document.body.appendChild(original);
    } else {
      renderer.setMachineMode(false);
      while (document.body.firstChild) original.appendChild(document.body.firstChild);
      document.body.appendChild(renderer.host);
    }
    setBodyStyle(show ? originalBodyStyle : viewerBodyStyle);
  }
  function display(parsed) {
    if (renderer) { showOriginal(false); return true; }
    if (!parsed || !Renderer) return false;
    const body = document.body;
    originalBodyStyle = body.getAttribute('style');
    original = document.createDocumentFragment();
    while (body.firstChild) original.appendChild(body.firstChild);
    renderer = Renderer.mount({
      data: parsed.data,
      kind: parsed.kind,
      raw: parsed.raw,
      sourceUrl: location.href,
      container: body,
      stylesheetUrl: runtime.getURL('bundle/viewer.css'),
      themeStylesheetUrl: runtime.getURL('bundle/theme.css'),
      preferences: { theme: preferences.theme, dark: preferences.dark, machine: false },
      onPreferencesChange(next) {
        preferences = next;
        storage?.set({ theme: next.theme, dark: next.dark, machine: next.machine });
      },
      onOriginalResponse() { showOriginal(true); }
    });
    viewerBodyStyle = body.getAttribute('style');
    return true;
  }
  function action() {
    if (renderer) { showOriginal(!showingOriginal); return true; }
    const parsed = parsedPage(true);
    if (!parsed) return false;
    return display(parsed);
  }

  runtime?.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'RDAP_VIEWER_ACTION') {
      sendResponse({ rdap: action() });
      return false;
    }
    if (message?.type === 'RDAP_MODE_CHANGED') {
      mode = message.mode === 'onDemand' ? 'onDemand' : 'automatic';
      if (mode === 'automatic') display(parsedPage());
      else if (renderer) showOriginal(true);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  storage?.get(['operatingMode', 'theme', 'dark', 'machine'], settings => {
    mode = settings.operatingMode === 'onDemand' ? 'onDemand' : 'automatic';
    preferences = { theme: settings.theme, dark: settings.dark, machine: settings.machine === true };
    if (RDAPExtension.shouldAutoDisplay(mode, location.href, document.contentType, window.top === window, R)) display(parsedPage());
  });
}
