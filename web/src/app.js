/* Static web frontend: URL entry, fetching and browser history. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RDAPWeb = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BOOTSTRAP_URLS = Object.freeze({
    ipv4: 'https://data.iana.org/rdap/ipv4.json',
    ipv6: 'https://data.iana.org/rdap/ipv6.json',
    dns: 'https://data.iana.org/rdap/dns.json',
    asn: 'https://data.iana.org/rdap/asn.json'
  });
  const ASN_MAX = 4294967295n;
  const BOOTSTRAP_TTL = 6 * 60 * 60 * 1000;
  const BOOTSTRAP_MAX_AGE = 24 * 60 * 60 * 1000;
  const MAX_BOOTSTRAPS = 4;
  const bootstrapCache = new Map();

  function validateEndpoint(value) {
    try {
      const url = new URL(String(value).trim());
      if (url.protocol !== 'https:') return { error: 'Enter an RDAP URL beginning with https://.' };
      if (!url.hostname || url.username || url.password) return { error: 'Enter a public RDAP URL without embedded credentials.' };
      return { url: url.href };
    } catch { return { error: 'Enter a complete HTTPS RDAP URL, such as https://rdap.arin.net/registry/ip/8.8.8.8.' }; }
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
  function parseASN(value) {
    const match = String(value).match(/^(?:AS)?(\d+)$/i);
    if (!match || (match[1].length > 1 && match[1][0] === '0')) return null;
    let number;
    try { number = BigInt(match[1]); } catch { return null; }
    if (number > ASN_MAX) return { error: 'An ASN must be a decimal number between 1 and 4294967295.' };
    if (number === 0n || number === 23456n || number === 65535n || number === 4294967295n) {
      return { error: `AS${number} is reserved and cannot be looked up as a public autonomous system.` };
    }
    if ((number >= 64496n && number <= 64511n) || (number >= 64512n && number <= 65534n) ||
        (number >= 65536n && number <= 65551n) || (number >= 4200000000n && number <= 4294967294n)) {
      return { error: `AS${number} is reserved for documentation or private use.` };
    }
    return { type: 'asn', number: Number(number), value: number };
  }
  function parseDomain(value) {
    const text = String(value).trim();
    if (!text || /[\s\/#?@:%\\]/u.test(text)) return null;
    try {
      const ascii = new URL(`https://${text}/`).hostname.toLowerCase().replace(/\.$/, '');
      const labels = ascii.split('.');
      if (!ascii || ascii.length > 253 || labels.some(label => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
      if (parseIPv4(ascii)) return null;
      return { type: 'domain', domain: ascii };
    } catch { return null; }
  }
  function classifyInput(value) {
    const text = String(value ?? '').trim();
    if (!text) return { error: 'Enter an IPv4 or IPv6 address, domain name, ASN, or complete HTTPS RDAP URL.' };
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      const checked = validateEndpoint(text);
      return checked.error ? checked : { type: 'url', url: checked.url };
    }
    let ip = parseIPv4(text);
    if (!ip && /^[\d.]+$/.test(text) && text.includes('.')) return { error: 'Enter a valid IPv4 address with four decimal octets.' };
    if (!ip && text.includes(':')) {
      ip = parseIPv6(text);
      if (!ip) return { error: 'Enter a valid IPv6 address using hexadecimal groups.' };
    }
    if (ip) {
      const reason = nonPublicReason(ip);
      if (reason) return { error: `This ${ip.family === 'ipv4' ? 'IPv4' : 'IPv6'} address is ${reason}; only public addresses can be looked up.` };
      return { type: 'ip', ...ip };
    }
    const asn = parseASN(text);
    if (asn) return asn;
    if (/^(?:AS)?\d+$/i.test(text)) return { error: 'Enter an ASN between 1 and 4294967295, without leading zeroes.' };
    if (/^AS/i.test(text)) return { error: 'Enter an ASN as AS followed by decimal digits, such as AS15169.' };
    const domain = parseDomain(text);
    if (domain) return domain;
    return { error: 'Enter a valid IPv4 or IPv6 address, domain name, ASN, or complete HTTPS RDAP URL.' };
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
          urls.push(...serviceURLs(service[1]));
        }
      }
    }
    return [...new Set(urls)];
  }
  function serviceURLs(candidates) {
    const urls = [];
    if (!Array.isArray(candidates)) return urls;
    for (const candidate of candidates) {
      try {
        const base = new URL(candidate);
        if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) continue;
        if (!base.pathname.endsWith('/')) base.pathname += '/';
        if (!urls.includes(base.href)) urls.push(base.href);
      } catch { /* Ignore malformed or non-HTTPS bootstrap entries. */ }
    }
    return urls;
  }
  function resolveDomainBootstrapServices(registry, domain) {
    const target = String(domain).toLowerCase().replace(/\.$/, '');
    if (!target || !Array.isArray(registry?.services)) return [];
    let longest = -1;
    const urls = [];
    for (const service of registry.services) {
      if (!Array.isArray(service) || !Array.isArray(service[0]) || !Array.isArray(service[1])) continue;
      for (const entry of service[0]) {
        if (typeof entry !== 'string') continue;
        const suffix = entry === '' ? '' : parseDomain(entry)?.domain;
        if (suffix === undefined) continue;
        if (suffix && target !== suffix && !target.endsWith('.' + suffix)) continue;
        const labels = suffix ? suffix.split('.').length : 0;
        if (labels < longest) continue;
        if (labels > longest) { longest = labels; urls.length = 0; }
        urls.push(...serviceURLs(service[1]));
      }
    }
    return [...new Set(urls)];
  }
  function resolveAsnBootstrapServices(registry, asn) {
    let number;
    try { number = typeof asn === 'bigint' ? asn : BigInt(asn); } catch { return []; }
    if (!Array.isArray(registry?.services)) return [];
    const urls = [];
    for (const service of registry.services) {
      if (!Array.isArray(service) || !Array.isArray(service[0]) || !Array.isArray(service[1])) continue;
      for (const range of service[0]) {
        const match = typeof range === 'string' && range.match(/^(\d+)-(\d+)$/);
        if (!match) continue;
        const start = BigInt(match[1]), end = BigInt(match[2]);
        if (start <= number && number <= end) urls.push(...serviceURLs(service[1]));
      }
    }
    return [...new Set(urls)];
  }
  function lookupURLs(bases, operation, target) {
    const urls = [];
    for (const base of bases) {
      try {
        const segment = operation === 'ip' && String(target).includes(':') ? String(target) : encodeURIComponent(String(target));
        const url = new URL(`${operation}/${segment}`, base);
        if (url.protocol === 'https:' && !url.username && !url.password) urls.push(url.href);
      } catch { /* Ignore invalid constructed endpoints. */ }
    }
    return [...new Set(urls)];
  }
  function bootstrapExpiry(response) {
    const now = Date.now();
    let lifetime = BOOTSTRAP_TTL;
    const cacheControl = response.headers?.get?.('cache-control') || '';
    const maxAge = cacheControl.match(/(?:^|,)\s*max-age=(\d+)/i);
    if (/\bno-store\b|\bno-cache\b/i.test(cacheControl)) lifetime = 0;
    else if (maxAge) lifetime = Math.min(BOOTSTRAP_MAX_AGE, Number(maxAge[1]) * 1000);
    else {
      const expires = Date.parse(response.headers?.get?.('expires') || '');
      if (Number.isFinite(expires)) lifetime = Math.min(BOOTSTRAP_MAX_AGE, Math.max(0, expires - now));
    }
    return now + lifetime;
  }
  async function getBootstrap(name, fetchImpl = globalThis.fetch, cache = bootstrapCache, options = {}) {
    const cached = cache.get(name);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    if (cached) cache.delete(name);
    const entry = { expiresAt: Infinity, promise: null };
    entry.promise = (async () => {
      let response;
      try { response = await fetchImpl(BOOTSTRAP_URLS[name], { signal: options.signal, headers: { Accept: 'application/json' }, cache: 'default', redirect: 'follow' }); }
      catch (error) { if (error.name === 'AbortError') throw error; throw new Error(`The IANA ${name.toUpperCase()} RDAP bootstrap registry is unavailable. Check your connection or CORS access, or enter a complete HTTPS RDAP URL.`); }
      if (response.url && new URL(response.url).protocol !== 'https:') throw new Error(`The IANA ${name.toUpperCase()} RDAP bootstrap registry redirected to an insecure URL.`);
      if (!response.ok) throw new Error(`The IANA ${name.toUpperCase()} RDAP bootstrap registry returned HTTP ${response.status}.`);
      try {
        const registry = await response.json();
        if (!Array.isArray(registry?.services)) throw new Error('Invalid bootstrap data');
        entry.expiresAt = bootstrapExpiry(response);
        return registry;
      } catch (error) {
        if (error.message?.startsWith('The IANA')) throw error;
        throw new Error(`The IANA ${name.toUpperCase()} RDAP bootstrap registry returned invalid data.`);
      }
    })();
    cache.set(name, entry);
    while (cache.size > MAX_BOOTSTRAPS) cache.delete(cache.keys().next().value);
    try { return await entry.promise; }
    catch (error) { if (cache.get(name) === entry) cache.delete(name); throw error; }
  }
  async function resolveInput(value, fetchImpl = globalThis.fetch, cache = bootstrapCache, options = {}) {
    const input = classifyInput(value);
    if (input.error) throw new Error(input.error);
    if (input.type === 'url') return { url: input.url, urls: [input.url], type: 'url' };
    const registryName = input.type === 'ip' ? input.family : input.type === 'domain' ? 'dns' : 'asn';
    const registry = await getBootstrap(registryName, fetchImpl, cache, options);
    let bases;
    let operation;
    let target;
    if (input.type === 'ip') {
      bases = resolveBootstrapServices(registry, input.family, input.value);
      operation = 'ip'; target = input.address;
    } else if (input.type === 'domain') {
      bases = resolveDomainBootstrapServices(registry, input.domain);
      operation = 'domain'; target = input.domain;
    } else {
      bases = resolveAsnBootstrapServices(registry, input.value);
      operation = 'autnum'; target = input.number;
    }
    const urls = lookupURLs(bases, operation, target);
    if (!urls.length) {
      const label = input.type === 'ip' ? input.address : input.type === 'domain' ? input.domain : `AS${input.number}`;
      throw new Error(`IANA has no HTTPS RDAP server listed for ${label}. The registry may not support this lookup yet; try a complete HTTPS RDAP URL if you have one.`);
    }
    return { url: urls[0], urls, type: input.type, ...(input.type === 'ip' ? { address: input.address, family: input.family } : input.type === 'domain' ? { domain: input.domain } : { number: input.number }) };
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
  function parseRetryAfter(value, now = Date.now()) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const text = String(value).trim();
    let retryAt;
    if (/^\d+$/.test(text)) {
      const seconds = Number(text);
      if (!Number.isSafeInteger(seconds)) return null;
      retryAt = now + seconds * 1000;
    } else {
      const httpDate = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/;
      if (!httpDate.test(text)) return null;
      retryAt = Date.parse(text);
      if (!Number.isFinite(retryAt)) return null;
    }
    return Number.isFinite(retryAt) ? { retryAt, waitMs: Math.max(0, retryAt - now) } : null;
  }
  function rateLimitError(response, now = Date.now()) {
    let header = null;
    try { header = response.headers?.get?.('Retry-After') ?? response.headers?.get?.('retry-after') ?? null; }
    catch { /* CORS may make this response header unavailable. */ }
    const retry = parseRetryAfter(header, now);
    const error = new Error(retry
      ? `The RDAP registry is temporarily limiting requests (HTTP 429). ${retry.waitMs > 0 ? `Please wait ${formatWait(retry.waitMs)} before retrying.` : 'You can retry now.'}`
      : 'The RDAP registry is temporarily limiting requests (HTTP 429). Retry manually later; no retry time was provided or exposed.');
    error.rateLimited = true;
    error.retryAt = retry?.retryAt ?? null;
    error.retryAfterMs = retry?.waitMs ?? null;
    return error;
  }
  function formatWait(milliseconds) {
    const seconds = Math.ceil(milliseconds / 1000);
    if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  function retryAllowed(retryAt, now = Date.now()) { return retryAt === null || retryAt === undefined || retryAt <= now; }
  async function fetchResolved(endpoints, fetchImpl = globalThis.fetch, rdap, options = {}) {
    const candidates = [...new Set((Array.isArray(endpoints) ? endpoints : [endpoints]).filter(Boolean))];
    if (!candidates.length) throw new Error('No HTTPS RDAP service is available for this lookup.');
    const failures = [];
    for (const endpoint of candidates) {
      const checked = validateEndpoint(endpoint);
      if (checked.error) { failures.push(new Error(checked.error)); continue; }
      try {
        const response = await fetchImpl(checked.url, {
          signal: options.signal,
          headers: { Accept: 'application/rdap+json, application/json' },
          redirect: 'follow'
        });
        if (response.url) {
          const finalUrl = validateEndpoint(response.url);
          if (finalUrl.error) throw new Error('The RDAP service redirected to an insecure or invalid URL.');
        }
        if (response.status === 429) throw rateLimitError(response, options.now ?? Date.now());
        if (!response.ok) throw new Error(`The RDAP server returned HTTP ${response.status} ${response.statusText || 'error'}.`);
        const parsed = parseResponse(await response.text(), rdap);
        return { ...parsed, endpoint: checked.url, finalUrl: response.url || checked.url };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        if (error.rateLimited) throw error;
        failures.push(error);
        if (options.signal?.aborted) throw error;
      }
    }
    const last = failures[failures.length - 1] || new Error('The RDAP services did not return a usable response.');
    const failure = candidates.length === 1 ? new Error(last.message) : new Error(`All ${candidates.length} RDAP service URLs failed. ${last.message}`);
    failure.networkError = failures.some(error => error instanceof TypeError || error.networkError);
    throw failure;
  }
  function shareUrl(base, endpoint) {
    const url = new URL(base);
    url.searchParams.set('url', endpoint);
    return url.href;
  }
  function landingUrl(current) {
    const url = new URL(current);
    url.searchParams.delete('url');
    url.hash = '';
    if (!url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
    return url.pathname + url.search;
  }
  return Object.freeze({ validateEndpoint, parseIPv4, parseIPv6, parseASN, parseDomain, classifyInput, resolveBootstrapServices, resolveDomainBootstrapServices, resolveAsnBootstrapServices, getBootstrap, resolveInput, lookupURLs, parseResponse, parseRetryAfter, retryAllowed, fetchResolved, shareUrl, landingUrl });
});

if (typeof document !== 'undefined') {
  const form = document.getElementById('lookup-form');
  const input = document.getElementById('rdap-url');
  const error = document.getElementById('lookup-error');
  const status = document.getElementById('lookup-status');
  const retryButton = document.getElementById('retry-lookup');
  const permissionButton = document.getElementById('grant-service-access');
  const landing = document.getElementById('landing');
  const landingAttribution = document.getElementById('landing-attribution');
  const viewerRoot = document.getElementById('viewer-root');
  const script = document.currentScript;
  const coreRoot = script?.dataset.coreRoot || '../core/';
  const extensionMode = script?.dataset.extension === 'true';
  const extensionApi = extensionMode ? globalThis.chrome : null;
  let rendererInstance = null;
  let requestController = null;
  let resolutionController = null;
  let requestNumber = 0;
  let resolutionNumber = 0;
  let retryTimer = null;
  let retryEndpoints = null;
  let retryAt = null;
  let pendingLookup = null;
  let preferences = {};

  function persistPreferences(next) {
    preferences = { ...preferences, ...next };
    if (extensionMode) extensionApi.storage.local.set({ theme: preferences.theme, dark: preferences.dark, machine: preferences.machine });
    else {
      try { localStorage.setItem('rdap-human-viewer-preferences', JSON.stringify({ theme: preferences.theme, machine: preferences.machine })); }
      catch { /* Local preference storage may be unavailable in private browsing. */ }
    }
  }

  function resetView() {
    requestNumber++;
    requestController?.abort();
    resolutionController?.abort();
    requestController = null;
    resolutionController = null;
    clearTimeout(retryTimer);
    retryAt = null;
    pendingLookup = null;
    if (permissionButton) permissionButton.hidden = true;
    rendererInstance?.destroy();
    rendererInstance = null;
    viewerRoot.hidden = true;
    landing.hidden = false;
    if (landingAttribution) landingAttribution.hidden = false;
    document.body.style.display = '';
    document.body.style.padding = '';
  }
  function showError(message, networkError = false) {
    clearTimeout(retryTimer);
    status.hidden = true;
    status.textContent = '';
    error.textContent = message + (networkError ? ' This may be a network problem or an RDAP server CORS restriction.' : '');
    error.hidden = false;
    retryButton.hidden = true;
  }
  function showRateLimit(rateError) {
    showError(rateError.message);
    retryButton.hidden = false;
    retryButton.disabled = !RDAPWeb.retryAllowed(rateError.retryAt);
    retryAt = rateError.retryAt;
    if (retryButton.disabled) {
      retryButton.title = 'Retry is available after the registry retry time.';
      const enableWhenReady = () => {
        const remaining = retryAt - Date.now();
        if (remaining <= 0) { retryButton.disabled = false; retryButton.title = ''; return; }
        retryTimer = setTimeout(enableWhenReady, Math.min(remaining, 2147483647));
      };
      enableWhenReady();
    } else retryButton.title = '';
    landing.hidden = false;
    viewerRoot.hidden = true;
  }
  async function loadEndpoint(endpoint) {
    input.value = endpoint;
    const id = ++resolutionNumber;
    return continueResolved({ url: endpoint, urls: [endpoint], type: 'url' }, id, false);
  }
  function permissionOrigins(urls) {
    return [...new Set(urls.map(value => new URL(value).origin + '/*'))];
  }
  function checkOrigins(origins) {
    if (!extensionMode) return Promise.resolve(true);
    return new Promise(resolve => extensionApi.permissions.contains({ origins }, resolve));
  }
  function requestOrigins(origins) {
    if (!extensionMode) return Promise.resolve(true);
    return new Promise(resolve => extensionApi.permissions.request({ origins }, resolve));
  }
  async function continueResolved(resolved, id, pushHistory) {
    if (id !== resolutionNumber) return;
    const endpoints = resolved.urls || [resolved.url];
    for (const endpoint of endpoints) {
      const checked = RDAPWeb.validateEndpoint(endpoint);
      if (checked.error) { showError(checked.error); return; }
    }
    if (extensionMode && !await checkOrigins(permissionOrigins(endpoints))) {
      pendingLookup = { resolved, id, pushHistory };
      error.textContent = 'Allow this extension to contact the RDAP service selected by IANA to continue.';
      error.hidden = false;
      status.hidden = true;
      if (permissionButton) permissionButton.hidden = false;
      landing.hidden = false;
      viewerRoot.hidden = true;
      return;
    }
    if (pushHistory) history.pushState({}, '', RDAPWeb.shareUrl(location.href, resolved.url));
    loadEndpoints(endpoints);
  }
  permissionButton?.addEventListener('click', async () => {
    const pending = pendingLookup;
    if (!pending || pending.id !== resolutionNumber) return;
    try {
      const granted = await requestOrigins(permissionOrigins(pending.resolved.urls || [pending.resolved.url]));
      if (pending.id !== resolutionNumber) return;
      if (!granted) throw new Error('Permission was not granted. The lookup remains available after service access is allowed.');
      pendingLookup = null;
      if (permissionButton) permissionButton.hidden = true;
      await continueResolved(pending.resolved, pending.id, pending.pushHistory);
    } catch (permissionError) { if (pending.id === resolutionNumber) showError(permissionError.message || 'Could not obtain RDAP service access.'); }
  });
  async function loadEndpoints(endpoints) {
    resetView();
    const requestId = requestNumber;
    const candidates = Array.isArray(endpoints) ? endpoints : [endpoints];
    retryEndpoints = candidates;
    retryButton.hidden = true;
    error.hidden = true;
    status.textContent = candidates.length > 1 ? `Trying ${candidates.length} RDAP services…` : 'Loading RDAP response…';
    status.hidden = false;
    requestController = new AbortController();
    try {
      const parsed = await RDAPWeb.fetchResolved(candidates, fetch, RDAPHuman, { signal: requestController.signal });
      if (requestId !== requestNumber) return;
      if (parsed.endpoint !== candidates[0] && new URL(location.href).searchParams.has('url')) {
        history.replaceState({}, '', RDAPWeb.shareUrl(location.href, parsed.endpoint));
      }
      viewerRoot.hidden = false;
      document.body.style.display = 'block';
      document.body.style.padding = '0';
      rendererInstance = RDAPRenderer.mount({
        data: parsed.data,
        kind: parsed.kind,
        raw: parsed.raw,
        sourceUrl: parsed.finalUrl,
        newLookupHref: extensionMode ? extensionApi.runtime.getURL('lookup/index.html') : RDAPWeb.landingUrl(location.href),
        container: viewerRoot,
        stylesheetUrl: coreRoot + 'viewer.css',
        themeStylesheetUrl: coreRoot + 'theme.css',
        preferences,
        onPreferencesChange: persistPreferences
      });
      status.hidden = true;
      status.textContent = '';
      landing.hidden = true;
      if (landingAttribution) landingAttribution.hidden = true;
    } catch (fetchError) {
      if (fetchError.name === 'AbortError' || requestId !== requestNumber) return;
      status.hidden = true;
      status.textContent = '';
      if (fetchError.rateLimited) showRateLimit(fetchError);
      else showError(fetchError.message || 'Unable to load this RDAP response.', fetchError instanceof TypeError || fetchError.networkError);
    }
  }

  retryButton.addEventListener('click', () => {
    if (retryButton.disabled || !retryEndpoints) return;
    loadEndpoints(retryEndpoints);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const resolutionId = ++resolutionNumber;
    resetView();
    retryEndpoints = null;
    retryAt = null;
    retryButton.hidden = true;
    const typed = input.value;
    const detected = RDAPWeb.classifyInput(typed);
    if (detected.error) { showError(detected.error); input.focus(); return; }
    error.hidden = true;
    error.textContent = '';
    status.hidden = true;
    status.textContent = '';
    resolutionController = new AbortController();
    try {
      if (extensionMode) {
        const requiredOrigins = detected.type === 'url' ? permissionOrigins([detected.url]) : ['https://data.iana.org/*'];
        const granted = await requestOrigins(requiredOrigins);
        if (!granted) throw new Error('The lookup needs permission to contact IANA or the HTTPS RDAP service. No request was sent.');
        if (resolutionId !== resolutionNumber) return;
      }
      if (['ip', 'domain', 'asn'].includes(detected.type)) {
        const target = detected.type === 'ip' ? detected.address : detected.type === 'domain' ? detected.domain : `AS${detected.number}`;
        status.textContent = `Finding the RDAP server for ${target} in IANA’s bootstrap registry…`;
        status.hidden = false;
      }
      const resolved = await RDAPWeb.resolveInput(typed, fetch, undefined, { signal: resolutionController.signal });
      if (resolutionId !== resolutionNumber) return;
      await continueResolved(resolved, resolutionId, true);
    } catch (resolveError) {
      if (resolveError.name === 'AbortError' || resolutionId !== resolutionNumber) return;
      showError(resolveError.message || 'Unable to resolve this RDAP lookup.', resolveError instanceof TypeError);
    }
  });
  window.addEventListener('popstate', () => {
    resolutionNumber++;
    resetView();
    retryEndpoints = null;
    pendingLookup = null;
    if (permissionButton) permissionButton.hidden = true;
    retryButton.hidden = true;
    const endpoint = new URL(location.href).searchParams.get('url');
    if (endpoint) loadEndpoint(endpoint);
    else { resetView(); input.value = ''; error.hidden = true; status.hidden = true; }
  });

  const initialUrl = new URL(location.href).searchParams.get('url');
  function startInitialView() {
    const landingTheme = document.getElementById('landing-theme');
    if (landingTheme) RDAPRenderer.createThemeSelector(landingTheme, document.documentElement, preferences, persistPreferences);
    if (initialUrl) loadEndpoint(initialUrl);
    else input.focus({ preventScroll: true });
  }
  if (extensionMode) {
    extensionApi.storage.local.get(['theme', 'dark', 'machine'], stored => {
      preferences = { theme: stored.theme, dark: stored.dark, machine: stored.machine === true };
      startInitialView();
    });
  } else {
    try { preferences = JSON.parse(localStorage.getItem('rdap-human-viewer-preferences') || '{}'); }
    catch { preferences = { theme: 'auto', machine: false }; }
    startInitialView();
  }
}
