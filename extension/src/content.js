/* Extension-specific page detection and original-document integration. */
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
  function parseDocument(raw, rdap) {
    if (typeof raw !== 'string' || !raw.trimStart().startsWith('{') || raw.length > 5 * 1024 * 1024) return null;
    try {
      const data = JSON.parse(raw);
      const kind = rdap.detect(data);
      return kind ? { data, kind, raw } : null;
    } catch { return null; }
  }
  return Object.freeze({ shouldRun, parseDocument });
});

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const R = globalThis.RDAPHuman;
  const Renderer = globalThis.RDAPRenderer;
  const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
  if (R && Renderer && RDAPExtension.shouldRun(location.href, document.contentType, window.top === window, R) && !document.getElementById('rdap-human-viewer-host')) {
    const parsed = RDAPExtension.parseDocument(document.body?.textContent || '', R);
    if (parsed) {
      const body = document.body;
      const original = document.createDocumentFragment();
      body.style.margin = '0';
      while (body.firstChild) original.appendChild(body.firstChild);
      Renderer.mount({
        data: parsed.data,
        kind: parsed.kind,
        raw: parsed.raw,
        sourceUrl: location.href,
        container: body,
        stylesheetUrl: runtime.getURL('bundle/viewer.css')
      });
    }
  }
}
