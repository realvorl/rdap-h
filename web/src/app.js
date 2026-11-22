/* Static web frontend: URL entry, fetching and browser history. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RDAPWeb = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function validateEndpoint(value) {
    try {
      const url = new URL(String(value).trim());
      if (!['http:', 'https:'].includes(url.protocol)) return { error: 'Enter an RDAP URL beginning with https:// or http://.' };
      if (!url.hostname || url.username || url.password) return { error: 'Enter a public RDAP URL without embedded credentials.' };
      return { url: url.href };
    } catch { return { error: 'Enter a complete RDAP URL, such as https://rdap.arin.net/registry/ip/8.8.8.8.' }; }
  }
  function parseResponse(text, rdap) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('The endpoint returned an empty response.');
    if (text.length > 5 * 1024 * 1024) throw new Error('The RDAP response is larger than the 5 MB display limit.');
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('The endpoint did not return valid JSON.'); }
    const kind = rdap.detect(data);
    if (!kind) throw new Error('The URL did not return a recognized RDAP JSON response.');
    return { data, kind, raw: text };
  }
  function shareUrl(base, endpoint) {
    const url = new URL(base);
    url.searchParams.set('url', endpoint);
    return url.href;
  }
  return Object.freeze({ validateEndpoint, parseResponse, shareUrl });
});

if (typeof document !== 'undefined') {
  const form = document.getElementById('lookup-form');
  const input = document.getElementById('rdap-url');
  const error = document.getElementById('lookup-error');
  const landing = document.getElementById('landing');
  const viewerRoot = document.getElementById('viewer-root');
  const script = document.currentScript;
  const coreRoot = script?.dataset.coreRoot || '../core/';
  let rendererInstance = null;
  let requestController = null;
  let requestNumber = 0;

  function resetView() {
    requestNumber++;
    requestController?.abort();
    requestController = null;
    rendererInstance?.destroy();
    rendererInstance = null;
    viewerRoot.hidden = true;
    landing.hidden = false;
    document.body.style.display = '';
    document.body.style.padding = '';
  }
  function showError(message, networkError = false) {
    error.textContent = message + (networkError ? ' This may be a network problem or an RDAP server CORS restriction.' : '');
    error.hidden = false;
    landing.hidden = false;
    viewerRoot.hidden = true;
  }
  async function loadEndpoint(endpoint) {
    resetView();
    const requestId = requestNumber;
    input.value = endpoint;
    error.hidden = true;
    const checked = RDAPWeb.validateEndpoint(endpoint);
    if (checked.error) { showError(checked.error); return; }
    requestController = new AbortController();
    try {
      const response = await fetch(checked.url, {
        signal: requestController.signal,
        headers: { Accept: 'application/rdap+json, application/json' }
      });
      if (!response.ok) throw new Error(`The RDAP server returned HTTP ${response.status}.`);
      const parsed = RDAPWeb.parseResponse(await response.text(), RDAPHuman);
      if (requestId !== requestNumber) return;
      viewerRoot.hidden = false;
      document.body.style.display = 'block';
      document.body.style.padding = '0';
      rendererInstance = RDAPRenderer.mount({
        data: parsed.data,
        kind: parsed.kind,
        raw: parsed.raw,
        sourceUrl: checked.url,
        container: viewerRoot,
        stylesheetUrl: coreRoot + 'viewer.css'
      });
      landing.hidden = true;
    } catch (fetchError) {
      if (fetchError.name === 'AbortError' || requestId !== requestNumber) return;
      showError(fetchError.message || 'Unable to load this RDAP response.', fetchError instanceof TypeError);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const checked = RDAPWeb.validateEndpoint(input.value);
    if (checked.error) { showError(checked.error); input.focus(); return; }
    const href = RDAPWeb.shareUrl(location.href, checked.url);
    history.pushState({}, '', href);
    loadEndpoint(checked.url);
  });
  window.addEventListener('popstate', () => {
    const endpoint = new URL(location.href).searchParams.get('url');
    if (endpoint) loadEndpoint(endpoint);
    else { resetView(); input.value = ''; error.hidden = true; }
  });

  const initialUrl = new URL(location.href).searchParams.get('url');
  if (initialUrl) loadEndpoint(initialUrl);
  else input.focus({ preventScroll: true });
}
