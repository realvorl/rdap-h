const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Pages = require('../src/app.js');
const RDAP = require('../../core/rdap.js');

test('accepts complete HTTPS RDAP URLs across registry hosts', () => {
  assert.equal(Pages.validateEndpoint('https://rdap.arin.net/registry/ip/8.8.8.8').url, 'https://rdap.arin.net/registry/ip/8.8.8.8');
  assert.equal(Pages.validateEndpoint('https://rdap.db.ripe.net/ip/8.8.8.8').url, 'https://rdap.db.ripe.net/ip/8.8.8.8');
});

test('rejects incomplete, non-HTTP, and credentialed endpoint URLs', () => {
  for (const value of ['', 'rdap.arin.net/ip/8.8.8.8', 'javascript:alert(1)', 'ftp://example.test/', 'http://rdap.example/ip/8.8.8.8', 'https://user:pass@example.test/']) {
    assert.ok(Pages.validateEndpoint(value).error, value);
  }
});

test('detects and normalizes public IPv4 and IPv6 addresses', () => {
  const ipv4 = Pages.classifyInput(' 8.8.8.8 ');
  assert.equal(ipv4.type, 'ip');
  assert.equal(ipv4.family, 'ipv4');
  assert.equal(ipv4.address, '8.8.8.8');

  const ipv6 = Pages.classifyInput('2001:4860:4860::8888');
  assert.equal(ipv6.type, 'ip');
  assert.equal(ipv6.family, 'ipv6');
  assert.equal(ipv6.address, '2001:4860:4860::8888');
  assert.equal(Pages.parseIPv6('2001:0db8:0:0:0:0:0:1').address, '2001:db8::1');
  assert.equal(Pages.parseIPv6('::ffff:192.0.2.1').address, '::ffff:c000:201');
});

test('detects domains, subdomains, trailing dots, and internationalized names', () => {
  assert.deepEqual(Pages.classifyInput(' example.com '), { type: 'domain', domain: 'example.com' });
  assert.equal(Pages.classifyInput('www.example.co.uk').domain, 'www.example.co.uk');
  assert.equal(Pages.classifyInput('münich.de').domain, 'xn--mnich-kva.de');
  assert.equal(Pages.classifyInput('example.com.').domain, 'example.com');
  for (const value of ['bad..example', '-bad.example', 'bad_.example', 'example.com/path', 'example.com:443']) {
    assert.equal(Pages.classifyInput(value).type, undefined, value);
  }
});

test('detects ASNs and validates decimal range and reserved values', () => {
  assert.equal(Pages.classifyInput('AS15169').number, 15169);
  assert.equal(Pages.classifyInput(' 15169 ').number, 15169);
  assert.equal(Pages.classifyInput('AS1').number, 1);
  assert.match(Pages.classifyInput('AS0').error, /reserved/);
  assert.match(Pages.classifyInput('23456').error, /reserved/);
  assert.match(Pages.classifyInput('AS64512').error, /private use/);
  assert.match(Pages.classifyInput('AS4294967295').error, /reserved/);
  assert.match(Pages.classifyInput('4294967296').error, /between 1 and 4294967295/);
  assert.match(Pages.classifyInput('AS015169').error, /leading zeroes/);
});

test('reports malformed, private, and reserved IP inputs', () => {
  for (const [input, message] of [
    ['8.8.8.999', /valid IPv4/],
    ['2001:4860::zzzz', /valid IPv6/],
    ['not an address', /IPv4 or IPv6 address/],
    ['10.1.2.3', /private/],
    ['192.0.2.4', /reserved/],
    ['127.0.0.1', /reserved/],
    ['fc00::1', /private/],
    ['fe80::1', /link-local/],
    ['2001:db8::1', /reserved/]
  ]) assert.match(Pages.classifyInput(input).error, message, input);
  assert.match(Pages.classifyInput('8.8.8').error, /valid IPv4/);
  assert.equal(Pages.classifyInput('15169').type, 'asn', 'bare numeric ASNs must not be confused with malformed dotted IPs');
});

test('resolves IANA bootstrap prefixes with longest-prefix matching', () => {
  const ipv4Registry = { services: [
    [['8.0.0.0/8'], ['https://broad.example/']],
    [['8.8.8.0/24'], ['http://insecure.example/', 'https://specific.example/']]
  ] };
  assert.deepEqual(Pages.resolveBootstrapServices(ipv4Registry, 'ipv4', '8.8.8.8'), ['https://specific.example/']);

  const ipv6Registry = { services: [
    [['2001:4860::/32'], ['https://v6-broad.example/']],
    [['2001:4860:4860::/48'], ['https://v6-specific.example/']]
  ] };
  assert.deepEqual(Pages.resolveBootstrapServices(ipv6Registry, 'ipv6', '2001:4860:4860::8888'), ['https://v6-specific.example/']);
});

test('resolves domain suffixes label-wise using the longest matching DNS suffix', () => {
  const registry = { services: [
    [[''], ['https://root.example/']],
    [['com'], ['https://tld.example/']],
    [['example.com'], ['http://insecure.example/', 'https://exact.example/']],
    [['ample.com'], ['https://wrong-label.example/']]
  ] };
  assert.deepEqual(Pages.resolveDomainBootstrapServices(registry, 'api.example.com'), ['https://exact.example/']);
  assert.deepEqual(Pages.resolveDomainBootstrapServices(registry, 'other.com'), ['https://tld.example/']);
  assert.deepEqual(Pages.resolveDomainBootstrapServices(registry, 'other.net'), ['https://root.example/']);
  assert.deepEqual(Pages.resolveDomainBootstrapServices({ services:[[['bücher.de'], ['https://idn.example/']]] }, 'shop.xn--bcher-kva.de'), ['https://idn.example/']);
});

test('resolves ASN ranges inclusively and keeps all HTTPS service URLs', () => {
  const registry = { services: [
    [['64496-64496', '64500-64510'], ['https://asn-one.example/','https://asn-two.example/']],
    [['64511-64511'], ['http://insecure.example/']]
  ] };
  assert.deepEqual(Pages.resolveAsnBootstrapServices(registry, 64496), ['https://asn-one.example/', 'https://asn-two.example/']);
  assert.deepEqual(Pages.resolveAsnBootstrapServices(registry, 64510), ['https://asn-one.example/', 'https://asn-two.example/']);
  assert.deepEqual(Pages.resolveAsnBootstrapServices(registry, 64511), []);
});

test('resolves IPs through the correct IANA bootstrap and constructs RDAP IP URLs', async () => {
  const calls = [];
  const cache = new Map();
  const fakeFetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({ services: [[['8.0.0.0/8'], ['https://rdap.example/']]] })
    };
  };
  const result = await Pages.resolveInput('8.8.8.8', fakeFetch, cache);
  assert.deepEqual(calls, ['https://data.iana.org/rdap/ipv4.json']);
  assert.equal(result.url, 'https://rdap.example/ip/8.8.8.8');
  assert.equal(result.type, 'ip');
  await Pages.resolveInput('8.8.8.9', fakeFetch, cache);
  assert.equal(calls.length, 1, 'cache the bootstrap response for this page session');

  let v6RegistryUrl;
  const v6 = await Pages.resolveInput('2001:4860:4860::8888', async url => {
    v6RegistryUrl = url;
    return { ok: true, json: async () => ({ services: [[['2001:4860::/32'], ['https://v6-rdap.example/']]] }) };
  }, new Map());
  assert.equal(v6RegistryUrl, 'https://data.iana.org/rdap/ipv6.json');
  assert.equal(v6.url, 'https://v6-rdap.example/ip/2001:4860:4860::8888');
});

test('resolves IDN domains and ASNs through their IANA registries using RFC 9082 paths', async () => {
  const calls = [];
  const cache = new Map();
  const fetchBootstrap = async url => {
    calls.push(url);
    if (url.endsWith('/dns.json')) return { ok: true, json: async () => ({ services: [[['de'], ['https://rdap.example/base/']]] }) };
    return { ok: true, json: async () => ({ services: [[['15100-15200'], ['https://asn.example/rdap']]] }) };
  };
  const domain = await Pages.resolveInput('münich.de', fetchBootstrap, cache);
  assert.equal(domain.url, 'https://rdap.example/base/domain/xn--mnich-kva.de');
  assert.deepEqual(domain.urls, [domain.url]);
  const asn = await Pages.resolveInput('AS15169', fetchBootstrap, cache);
  assert.equal(asn.url, 'https://asn.example/rdap/autnum/15169');
  assert.deepEqual(calls, ['https://data.iana.org/rdap/dns.json', 'https://data.iana.org/rdap/asn.json']);
});

test('keeps complete RDAP URL input on the existing path without bootstrap requests', async () => {
  const result = await Pages.resolveInput('https://rdap.arin.net/registry/ip/8.8.8.8', async () => {
    throw new Error('bootstrap must not be fetched for complete URLs');
  }, new Map());
  assert.equal(result.type, 'url');
  assert.equal(result.url, 'https://rdap.arin.net/registry/ip/8.8.8.8');
  assert.deepEqual(result.urls, [result.url]);
});

test('reports unavailable bootstrap registries and unallocated address ranges', async () => {
  await assert.rejects(
    Pages.resolveInput('8.8.8.8', async () => { throw new TypeError('offline'); }, new Map()),
    /IANA IPV4 RDAP bootstrap registry is unavailable/
  );
  await assert.rejects(
    Pages.resolveInput('8.8.8.8', async () => ({ ok: true, json: async () => ({ services: [] }) }), new Map()),
    /IANA has no HTTPS RDAP server listed/
  );
  await assert.rejects(Pages.resolveInput('example.com', async () => { throw new TypeError('offline'); }, new Map()), /IANA DNS RDAP bootstrap registry is unavailable/);
  await assert.rejects(Pages.resolveInput('AS15169', async () => ({ok:true,json:async()=>({services:[]})}), new Map()), /IANA has no HTTPS RDAP server listed for AS15169/);
});

test('expires cached bootstrap responses and supports a bounded registry cache', async () => {
  const cache = new Map();
  let calls = 0;
  const fakeFetch = async () => ({ ok:true, headers:{get:()=>'max-age=60'}, json:async()=>({services:[]}) });
  await Pages.getBootstrap('dns', async (...args) => { calls++; return fakeFetch(...args); }, cache);
  assert.equal(cache.size, 1);
  cache.get('dns').expiresAt = 0;
  await Pages.getBootstrap('dns', async (...args) => { calls++; return fakeFetch(...args); }, cache);
  assert.equal(calls, 2);
  for (const name of ['ipv4', 'ipv6', 'asn']) await Pages.getBootstrap(name, async (...args) => { calls++; return fakeFetch(...args); }, cache);
  assert.ok(cache.size <= 4);
});

test('falls back across failed HTTPS service URLs and rejects insecure redirects', async () => {
  const calls = [];
  const result = await Pages.fetchResolved(['https://first.example/domain/example.com', 'https://second.example/domain/example.com'], async url => {
    calls.push(url);
    if (calls.length === 1) return { ok:false, status:503, url };
    return { ok:true, url, text:async()=>'{"objectClassName":"domain","ldhName":"example.com"}' };
  }, RDAP);
  assert.equal(result.endpoint, 'https://second.example/domain/example.com');
  assert.equal(calls.length, 2);
  await assert.rejects(Pages.fetchResolved('https://secure.example/ip/8.8.8.8', async url => ({
    ok:true, url:'http://insecure.example/ip/8.8.8.8', text:async()=>'{"objectClassName":"ip network"}'
  }), RDAP), /redirected to an insecure/);
});

test('reports CORS-like failures after trying every selected RDAP service', async () => {
  const attempted = [];
  await assert.rejects(Pages.fetchResolved(['https://one.example/ip/8.8.8.8', 'https://two.example/ip/8.8.8.8'], async url => {
    attempted.push(url);
    throw new TypeError('Failed to fetch');
  }, RDAP), error => {
    assert.match(error.message, /All 2 RDAP service URLs failed/);
    assert.equal(error.networkError, true);
    return true;
  });
  assert.equal(attempted.length, 2);
});

test('parses Retry-After seconds, HTTP dates, expired dates, and rejects invalid values', () => {
  const now = Date.parse('Sun, 06 Nov 1994 08:49:00 GMT');
  assert.deepEqual(Pages.parseRetryAfter('12', now), { retryAt: now + 12000, waitMs: 12000 });
  const date = Pages.parseRetryAfter('Sun, 06 Nov 1994 08:50:00 GMT', now);
  assert.deepEqual(date, { retryAt: now + 60000, waitMs: 60000 });
  assert.deepEqual(Pages.parseRetryAfter('Sun, 06 Nov 1994 08:48:00 GMT', now), { retryAt: now - 60000, waitMs: 0 });
  for (const value of [null, '', 'later', '-3', '999999999999999999999999']) assert.equal(Pages.parseRetryAfter(value, now), null, String(value));
  assert.equal(Pages.retryAllowed(date.retryAt, now), false);
  assert.equal(Pages.retryAllowed(date.retryAt, date.retryAt), true);
  assert.equal(Pages.retryAllowed(null, now), true, 'missing or CORS-hidden headers should permit a user initiated retry');
});

test('HTTP 429 is reported before JSON parsing and does not trigger service fallback', async () => {
  const calls = [];
  await assert.rejects(Pages.fetchResolved(['https://one.example/ip/8.8.8.8', 'https://two.example/ip/8.8.8.8'], async url => {
    calls.push(url);
    return { ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: name => name.toLowerCase() === 'retry-after' ? '30' : null }, text: async () => '<not JSON>' };
  }, RDAP, { now: 1000 }), error => {
    assert.equal(error.rateLimited, true);
    assert.equal(error.retryAt, 31000);
    assert.match(error.message, /HTTP 429/);
    assert.match(error.message, /30 seconds/);
    return true;
  });
  assert.deepEqual(calls, ['https://one.example/ip/8.8.8.8']);
});

test('HTTP 429 without an exposed Retry-After header gives guidance without inventing a wait', async () => {
  await assert.rejects(Pages.fetchResolved('https://rdap.example/ip/8.8.8.8', async url => ({
    ok: false, status: 429, statusText: 'Too Many Requests', url, headers: { get: () => null }, text: async () => '{broken'
  }), RDAP), error => {
    assert.equal(error.rateLimited, true);
    assert.equal(error.retryAt, null);
    assert.match(error.message, /no retry time was provided or exposed/);
    return true;
  });
});

test('aborts an obsolete lookup and never starts a second endpoint after cancellation', async () => {
  const controller = new AbortController();
  let calls = 0;
  const lookup = Pages.fetchResolved(['https://one.example/ip/8.8.8.8', 'https://two.example/ip/8.8.8.8'], (url, options) => {
    calls++;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
      const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
    }, { once: true }));
  }, RDAP, { signal: controller.signal });
  controller.abort();
  await assert.rejects(lookup, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('website landing and shared result renderer show exact registry attribution and support links', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', '..', 'core/renderer.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src/app.js'), 'utf8');
  const attribution = 'Registration data is provided by the respective RDAP registries. RDAP, but for Humans is an independent project and is not affiliated with those registries.';
  assert.ok(html.includes(attribution));
  assert.ok(renderer.includes(attribution));
  assert.match(renderer, /renderRegistryAttribution\(screen, sourceUrl\)/);
  assert.match(html, /id="landing-attribution"/);
  assert.match(html, /https:\/\/github\.com\/realvorl\/rdap-h/);
  assert.match(html, /https:\/\/github\.com\/realvorl\/rdap-h\/issues/);
  assert.doesNotMatch(html, /https:\/\/ko-fi\.com\/realvorl/);
  assert.match(renderer, /KOFI_URL = 'https:\/\/ko-fi\.com\/realvorl'/);
  assert.match(renderer, /Source RDAP endpoint/);
  const extensionSource = fs.readFileSync(path.join(__dirname, '..', '..', 'extension/src/content.js'), 'utf8');
  assert.doesNotMatch(extensionSource, /websiteAttribution/);
});

test('manual retry is user-triggered and preserves the current resolved endpoint candidates', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/app.js'), 'utf8');
  assert.match(source, /retryButton\.addEventListener\('click'/);
  assert.match(source, /loadEndpoints\(retryEndpoints\)/);
  assert.match(source, /retryButton\.disabled = !RDAPWeb\.retryAllowed/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test('extension lookup waits for stored view and theme preferences before rendering a shared link', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/app.js'), 'utf8');
  const storageRead = source.indexOf("extensionApi.storage.local.get(['theme', 'dark', 'machine']");
  const preferencesRestore = source.indexOf('preferences = { theme: stored.theme, dark: stored.dark, machine: stored.machine === true }');
  const initialStart = source.indexOf('startInitialView();', storageRead);
  assert.ok(storageRead >= 0 && preferencesRestore > storageRead && initialStart > preferencesRestore);
  assert.match(source, /function startInitialView\(\)/);
});

test('generates a directly shareable URL and preserves unrelated query parameters', () => {
  assert.equal(
    Pages.shareUrl('https://viewer.example/?source=bookmark', 'https://rdap.db.ripe.net/domain/example.test'),
    'https://viewer.example/?source=bookmark&url=https%3A%2F%2Frdap.db.ripe.net%2Fdomain%2Fexample.test'
  );
});

test('new lookup navigation clears the RDAP URL and respects deployment base paths', () => {
  const cases = [
    ['https://viewer.example/?source=bookmark&url=https%3A%2F%2Frdap.example%2Fip%2F8.8.8.8', '/?source=bookmark'],
    ['http://localhost:8000/web/?url=https%3A%2F%2Frdap.example%2Fip%2F8.8.8.8', '/web/'],
    ['https://code.example/viewer/?url=https%3A%2F%2Frdap.example%2Fip%2F8.8.8.8', '/viewer/'],
    ['https://code.example/viewer/index.html?url=https%3A%2F%2Frdap.example%2Fip%2F8.8.8.8', '/viewer/']
  ];
  for (const [current, expected] of cases) assert.equal(Pages.landingUrl(current), expected);
});

test('web passes a base-aware landing link to the shared renderer without changing history navigation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/app.js'), 'utf8');
  assert.match(source, /newLookupHref:\s*extensionMode\s*\?/);
  assert.match(source, /RDAPWeb\.landingUrl\(location\.href\)/);
  assert.match(source, /history\.pushState\(\{\}, '', RDAPWeb\.shareUrl/);
  assert.match(source, /window\.addEventListener\('popstate'/);
  const extensionSource = fs.readFileSync(path.join(__dirname, '..', '..', 'extension/src/content.js'), 'utf8');
  assert.doesNotMatch(extensionSource, /newLookupHref/);
});

test('parses recognized RDAP JSON with surrounding whitespace', () => {
  const result = Pages.parseResponse(' \n{"objectClassName":"domain","ldhName":"example.test"}\n', RDAP);
  assert.equal(result.kind.type, 'domain');
  assert.equal(result.data.ldhName, 'example.test');
  assert.equal(result.raw, ' \n{"objectClassName":"domain","ldhName":"example.test"}\n');
});

test('reports empty, malformed, non-RDAP, and oversized responses', () => {
  for (const value of ['', '  ']) assert.throws(() => Pages.parseResponse(value, RDAP), /empty response/);
  assert.throws(() => Pages.parseResponse('<html>no</html>', RDAP), /valid JSON/);
  assert.throws(() => Pages.parseResponse('{"hello":"world"}', RDAP), /recognized RDAP/);
  assert.throws(() => Pages.parseResponse('x'.repeat(5 * 1024 * 1024 + 1), RDAP), /5 MB/);
});

test('web entry point loads shared modules through local relative paths', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /type="text"[^>]*domain name, ASN/);
  assert.match(html, /src="\.\.\/core\/rdap\.js"/);
  assert.match(html, /src="\.\.\/core\/renderer\.js"/);
  assert.match(html, /src="src\/app\.js"/);
  assert.match(html, /href="\.\.\/core\/theme\.css"/);
  assert.match(html, /type="image\/svg\+xml" href="\.\.\/assets\/icon-small\.svg"/);
  assert.match(html, /sizes="48x48" href="\.\.\/assets\/icon-48\.png"/);
  assert.match(html, /sizes="128x128" href="\.\.\/assets\/icon-128\.png"/);
  assert.match(html, /id="landing-toolbar-slot" class="landing-toolbar-slot"/);
  assert.doesNotMatch(html, /https:\/\/ko-fi\.com\/realvorl/);
  const renderer = fs.readFileSync(path.join(__dirname, '..', '..', 'core/renderer.js'), 'utf8');
  assert.match(renderer, /\[\['auto', 'Auto'\], \['light', 'Light'\], \['dark', 'Dark'\]\]/);
  assert.doesNotMatch(html, /https?:[^"']+\.js/);
});

test('standalone landing theme uses the shared selector and persists locally', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src/app.js'), 'utf8');
  assert.match(app, /RDAPRenderer\.mountLandingToolbar\(landingToolbarSlot, document\.documentElement, preferences, persistPreferences\)/);
  assert.match(app, /localStorage\.setItem\('rdap-human-viewer-preferences'/);
  assert.match(app, /localStorage\.getItem\('rdap-human-viewer-preferences'/);
  assert.match(app, /themeStylesheetUrl: coreRoot \+ 'theme\.css'/);
  const renderer = fs.readFileSync(path.join(__dirname, '..', '..', 'core/renderer.js'), 'utf8');
  assert.match(renderer, /href = KOFI_URL/);
  assert.match(renderer, /title = 'Support this project on Ko-fi'/);
  assert.match(renderer, /aria-label', 'Support this project on Ko-fi'/);
});

test('web build contains only the web frontend and required shared core assets', () => {
  const site = path.join(__dirname, '..', '..', 'site');
  for (const file of ['index.html', 'src/app.js', 'core/rdap.js', 'core/renderer.js', 'core/viewer.css', 'core/theme.css', 'assets/icon.svg', 'assets/icon-small.svg', 'assets/icon-48.png', 'assets/icon-128.png']) {
    assert.ok(fs.existsSync(path.join(site, file)), file);
  }
  assert.ok(!fs.existsSync(path.join(site, 'extension')));
  const builtHtml = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  assert.match(builtHtml, /src="core\/rdap\.js"/);
  assert.match(builtHtml, /data-core-root="core\/"/);
  assert.match(builtHtml, /href="assets\/icon-small\.svg"/);
  assert.match(builtHtml, /href="assets\/icon-48\.png"/);
  assert.match(builtHtml, /href="assets\/icon-128\.png"/);
});
