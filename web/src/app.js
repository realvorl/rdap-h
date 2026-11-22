/* Static web frontend: URL entry, fetching and browser history. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RDAPWeb = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BOOTSTRAP_URLS = Object.freeze({
    ipv4: 'https://data.iana.org/rdap/ipv4.json',
    ipv6: 'https://data.iana.org/rdap/ipv6.json'
  });
  const bootstrapCache = new Map();

  function validateEndpoint(value) {
    try {
      const url = new URL(String(value).trim());
      if (!['http:', 'https:'].includes(url.protocol)) return { error: 'Enter an RDAP URL beginning with https:// or http://.' };
      if (!url.hostname || url.username || url.password) return { error: 'Enter a public RDAP URL without embedded credentials.' };
      return { url: url.href };
    } catch { return { error: 'Enter a complete RDAP URL, such as https://rdap.arin.net/registry/ip/8.8.8.8.' }; }
  }
  function parseIPv4(value) {
    const parts = String(value).split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || (part.length > 1 && part[0] === '0') || Number(part) > 255)) return null;
    const octets = parts.map(Number);
    return { family: 'ipv4', address: octets.join('.'), value: octets.reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n) };
  }
  function parseIPv6(value) {
    let text = String(value).toLowerCase();
    if (!text.includes(':') || text.includes('%')) return null;
    if (text.includes('.')) {
      const lastColon = text.lastIndexOf(':');
      const ipv4 = parseIPv4(text.slice(lastColon + 1));
      if (!ipv4) return null;
      const high = Number((ipv4.value >> 16n) & 0xffffn).toString(16);
      const low = Number(ipv4.value & 0xffffn).toString(16);
      text = text.slice(0, lastColon + 1) + high + ':' + low;
    }
    const compressionAt = text.indexOf('::');
    if (compressionAt !== text.lastIndexOf('::')) return null;
    const compressed = compressionAt !== -1;
    const halves = compressed ? text.split('::') : [text];
    const left = halves[0] ? halves[0].split(':') : [];
    const right = compressed && halves[1] ? halves[1].split(':') : [];
    const explicitGroups = left.length + right.length;
    if (compressed && explicitGroups >= 8) return null;
    const groups = [...left, ...Array(compressed ? 8 - left.length - right.length : 0).fill('0'), ...right];
    if (groups.length !== 8 || groups.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
    const numbers = groups.map(part => parseInt(part, 16));
    const numeric = numbers.reduce((acc, part) => (acc << 16n) | BigInt(part), 0n);
    return { family: 'ipv6', address: formatIPv6(numbers), value: numeric };
  }
  function formatIPv6(groups) {
    let bestStart = -1, bestLength = 1;
    for (let i = 0; i < groups.length;) {
      if (groups[i] !== 0) { i++; continue; }
      let end = i;
      while (end < groups.length && groups[end] === 0) end++;
      if (end - i > bestLength) { bestStart = i; bestLength = end - i; }
      i = end;
    }
    const hex = groups.map(group => group.toString(16));
    if (bestStart === -1) return hex.join(':');
    const left = hex.slice(0, bestStart).join(':');
    const right = hex.slice(bestStart + bestLength).join(':');
    return left && right ? left + '::' + right : left ? left + '::' : '::' + right;
  }
  function parseCidr(value, family) {
    const parts = String(value).split('/');
    if (parts.length > 2) return null;
    const [addressText, prefixText] = parts;
    const parsed = family === 'ipv4' ? parseIPv4(addressText) : parseIPv6(addressText);
    const width = family === 'ipv4' ? 32 : 128;
    if (!parsed || (prefixText !== undefined && !/^\d+$/.test(prefixText))) return null;
    const bits = prefixText === undefined ? width : Number(prefixText);
    if (bits < 0 || bits > width) return null;
    return { value: parsed.value, bits, width };
  }
  function prefixMatches(address, prefix) {
    return (address >> BigInt(prefix.width - prefix.bits)) === (prefix.value >> BigInt(prefix.width - prefix.bits));
  }
  function nonPublicReason(ip) {
    const ranges = ip.family === 'ipv4'
      ? [
          ['10.0.0.0/8', 'private'], ['172.16.0.0/12', 'private'], ['192.168.0.0/16', 'private'],
          ['100.64.0.0/10', 'private or shared'], ['0.0.0.0/8', 'reserved'], ['127.0.0.0/8', 'reserved'],
          ['169.254.0.0/16', 'reserved'], ['192.0.0.0/24', 'reserved'], ['192.0.2.0/24', 'reserved'],
          ['192.88.99.0/24', 'reserved'], ['198.18.0.0/15', 'reserved'], ['198.51.100.0/24', 'reserved'],
          ['203.0.113.0/24', 'reserved'], ['224.0.0.0/4', 'reserved'], ['240.0.0.0/4', 'reserved']
        ]
      : [
          ['fc00::/7', 'private'], ['fe80::/10', 'private or link-local'], ['ff00::/8', 'reserved'],
          ['2001:db8::/32', 'reserved'], ['2001:2::/48', 'reserved'], ['2001::/23', 'reserved'],
          ['2002::/16', 'reserved'], ['3fff::/20', 'reserved']
        ];
    if (ip.family === 'ipv4' && ['192.0.0.9', '192.0.0.10'].some(address => parseIPv4(address).value === ip.value)) return null;
    for (const [range, reason] of ranges) if (prefixMatches(ip.value, parseCidr(range, ip.family))) return reason;
    if (ip.family === 'ipv6' && !prefixMatches(ip.value, parseCidr('2000::/3', 'ipv6'))) return 'reserved or non-public';
    return null;
  }
  function classifyInput(value) {
    const text = String(value ?? '').trim();
    if (!text) return { error: 'Enter an IPv4 address, IPv6 address, or complete HTTPS RDAP URL.' };
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      const checked = validateEndpoint(text);
      return checked.error ? checked : { type: 'url', url: checked.url };
    }
    let ip = parseIPv4(text);
    if (!ip && /^[\d.]+$/.test(text)) return { error: 'Enter a valid IPv4 address with four decimal octets.' };
    if (!ip && text.includes(':')) {
      ip = parseIPv6(text);
      if (!ip) return { error: 'Enter a valid IPv6 address using hexadecimal groups.' };
    }
    if (!ip) return { error: 'Enter an IPv4 address, IPv6 address, or complete HTTPS RDAP URL.' };
    const reason = nonPublicReason(ip);
    if (reason) return { error: `This ${ip.family === 'ipv4' ? 'IPv4' : 'IPv6'} address is ${reason}; only public addresses can be looked up.` };
    return { type: 'ip', ...ip };
  }
  function resolveBootstrapServices(registry, family, address) {
    const parsedAddress = typeof address === 'bigint' ? address : (family === 'ipv4' ? parseIPv4(address) : parseIPv6(address))?.value;
    if (parsedAddress === undefined || parsedAddress === null || !Array.isArray(registry?.services)) return [];
    let longest = -1;
    const urls = [];
    for (const service of registry.services) {
      if (!Array.isArray(service) || !Array.isArray(service[0]) || !Array.isArray(service[1])) continue;
      for (const entry of service[0]) {
        const prefix = parseCidr(entry, family);
        if (!prefix || !prefixMatches(parsedAddress, prefix)) continue;
        if (prefix.bits > longest) { longest = prefix.bits; urls.length = 0; }
        if (prefix.bits === longest) {
          for (const candidate of service[1]) {
            try {
              const base = new URL(candidate);
              if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) continue;
              if (!base.pathname.endsWith('/')) base.pathname += '/';
              if (!urls.includes(base.href)) urls.push(base.href);
            } catch { /* Ignore malformed bootstrap entries. */ }
          }
        }
      }
    }
    return urls;
  }
  async function getBootstrap(family, fetchImpl = globalThis.fetch, cache = bootstrapCache) {
    if (cache.has(family)) return cache.get(family);
    const promise = (async () => {
      let response;
      try { response = await fetchImpl(BOOTSTRAP_URLS[family], { headers: { Accept: 'application/json' }, cache: 'default' }); }
      catch { throw new Error(`The IANA ${family.toUpperCase()} RDAP bootstrap registry is unavailable. Check your connection or CORS access, or enter a complete HTTPS RDAP URL.`); }
      if (!response.ok) throw new Error(`The IANA ${family.toUpperCase()} RDAP bootstrap registry returned HTTP ${response.status}.`);
      try {
        const registry = await response.json();
        if (!Array.isArray(registry?.services)) throw new Error('Invalid bootstrap data');
        return registry;
      } catch { throw new Error(`The IANA ${family.toUpperCase()} RDAP bootstrap registry returned invalid data.`); }
    })();
    cache.set(family, promise);
    try { return await promise; }
    catch (error) { cache.delete(family); throw error; }
  }
  async function resolveInput(value, fetchImpl = globalThis.fetch, cache = bootstrapCache) {
    const input = classifyInput(value);
    if (input.error) throw new Error(input.error);
    if (input.type === 'url') return { url: input.url, type: 'url' };
    const registry = await getBootstrap(input.family, fetchImpl, cache);
    const bases = resolveBootstrapServices(registry, input.family, input.value);
    if (!bases.length) throw new Error(`IANA has no HTTPS RDAP server listed for ${input.address}. The address may be unallocated; try a complete HTTPS RDAP URL if you have one.`);
    return { url: new URL('ip/' + input.address, bases[0]).href, type: 'ip', address: input.address, family: input.family };
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
  return Object.freeze({ validateEndpoint, parseIPv4, parseIPv6, classifyInput, resolveBootstrapServices, resolveInput, parseResponse, shareUrl });
});

if (typeof document !== 'undefined') {
  const form = document.getElementById('lookup-form');
  const input = document.getElementById('rdap-url');
  const error = document.getElementById('lookup-error');
  const status = document.getElementById('lookup-status');
  const landing = document.getElementById('landing');
  const viewerRoot = document.getElementById('viewer-root');
  const script = document.currentScript;
  const coreRoot = script?.dataset.coreRoot || '../core/';
  let rendererInstance = null;
  let requestController = null;
  let requestNumber = 0;
  let resolutionNumber = 0;

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
    status.hidden = true;
    status.textContent = '';
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
    status.textContent = 'Loading RDAP response…';
    status.hidden = false;
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
      status.hidden = true;
      status.textContent = '';
      landing.hidden = true;
    } catch (fetchError) {
      if (fetchError.name === 'AbortError' || requestId !== requestNumber) return;
      status.hidden = true;
      status.textContent = '';
      showError(fetchError.message || 'Unable to load this RDAP response.', fetchError instanceof TypeError);
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const resolutionId = ++resolutionNumber;
    const typed = input.value;
    const detected = RDAPWeb.classifyInput(typed);
    if (detected.error) { showError(detected.error); input.focus(); return; }
    error.hidden = true;
    error.textContent = '';
    status.hidden = true;
    status.textContent = '';
    try {
      if (detected.type === 'ip') {
        status.textContent = `Finding the RDAP server for ${detected.address} in IANA’s bootstrap registry…`;
        status.hidden = false;
      }
      const resolved = await RDAPWeb.resolveInput(typed);
      if (resolutionId !== resolutionNumber) return;
      const href = RDAPWeb.shareUrl(location.href, resolved.url);
      history.pushState({}, '', href);
      loadEndpoint(resolved.url);
    } catch (resolveError) {
      if (resolutionId !== resolutionNumber) return;
      showError(resolveError.message || 'Unable to resolve this RDAP lookup.', resolveError instanceof TypeError);
    }
  });
  window.addEventListener('popstate', () => {
    resolutionNumber++;
    const endpoint = new URL(location.href).searchParams.get('url');
    if (endpoint) loadEndpoint(endpoint);
    else { resetView(); input.value = ''; error.hidden = true; status.hidden = true; }
  });

  const initialUrl = new URL(location.href).searchParams.get('url');
  if (initialUrl) loadEndpoint(initialUrl);
  else input.focus({ preventScroll: true });
}
