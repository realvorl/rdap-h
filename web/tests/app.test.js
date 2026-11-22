const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Pages = require('../src/app.js');
const RDAP = require('../../core/rdap.js');

test('accepts full HTTP and HTTPS RDAP URLs across registry hosts', () => {
  assert.equal(Pages.validateEndpoint('https://rdap.arin.net/registry/ip/8.8.8.8').url, 'https://rdap.arin.net/registry/ip/8.8.8.8');
  assert.equal(Pages.validateEndpoint('https://rdap.db.ripe.net/ip/8.8.8.8').url, 'https://rdap.db.ripe.net/ip/8.8.8.8');
  assert.equal(Pages.validateEndpoint('http://example.test/custom/rdap').url, 'http://example.test/custom/rdap');
});

test('rejects incomplete, non-HTTP, and credentialed endpoint URLs', () => {
  for (const value of ['', 'rdap.arin.net/ip/8.8.8.8', 'javascript:alert(1)', 'ftp://example.test/', 'https://user:pass@example.test/']) {
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

test('reports malformed, private, and reserved IP inputs', () => {
  for (const [input, message] of [
    ['8.8.8.999', /valid IPv4/],
    ['2001:4860::zzzz', /valid IPv6/],
    ['not an address', /IPv4 address, IPv6 address/],
    ['10.1.2.3', /private/],
    ['192.0.2.4', /reserved/],
    ['127.0.0.1', /reserved/],
    ['fc00::1', /private/],
    ['fe80::1', /link-local/],
    ['2001:db8::1', /reserved/]
  ]) assert.match(Pages.classifyInput(input).error, message, input);
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

test('keeps complete RDAP URL input on the existing path without bootstrap requests', async () => {
  const result = await Pages.resolveInput('https://rdap.arin.net/registry/ip/8.8.8.8', async () => {
    throw new Error('bootstrap must not be fetched for complete URLs');
  }, new Map());
  assert.equal(result.type, 'url');
  assert.equal(result.url, 'https://rdap.arin.net/registry/ip/8.8.8.8');
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
});

test('generates a directly shareable URL and preserves unrelated query parameters', () => {
  assert.equal(
    Pages.shareUrl('https://rdap-h.de/?source=bookmark', 'https://rdap.db.ripe.net/domain/example.test'),
    'https://rdap-h.de/?source=bookmark&url=https%3A%2F%2Frdap.db.ripe.net%2Fdomain%2Fexample.test'
  );
});

test('new lookup navigation clears the RDAP URL and respects deployment base paths', () => {
  const cases = [
    ['https://rdap-h.de/?source=bookmark&url=https%3A%2F%2Frdap.example%2Fip%2F8.8.8.8', '/?source=bookmark'],
    ['http://localhost:8000/web/?url=https%3A%2F%2Frdap.example%2Fip%2F8.8.8.8', '/web/'],
    ['https://veo.github.io/rdap-human-viewer/?url=https%3A%2F%2Frdap.example%2Fip%2F8.8.8.8', '/rdap-human-viewer/'],
    ['https://veo.github.io/rdap-human-viewer/index.html?url=https%3A%2F%2Frdap.example%2Fip%2F8.8.8.8', '/rdap-human-viewer/']
  ];
  for (const [current, expected] of cases) assert.equal(Pages.landingUrl(current), expected);
});

test('web passes a base-aware landing link to the shared renderer without changing history navigation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/app.js'), 'utf8');
  assert.match(source, /newLookupHref:\s*RDAPWeb\.landingUrl\(location\.href\)/);
  assert.match(source, /history\.pushState\(\{\}, '', href\)/);
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
  assert.match(html, /type="text"[^>]*IPv4 address/);
  assert.match(html, /src="\.\.\/core\/rdap\.js"/);
  assert.match(html, /src="\.\.\/core\/renderer\.js"/);
  assert.match(html, /src="src\/app\.js"/);
  assert.doesNotMatch(html, /https?:[^"']+\.js/);
});

test('web build contains only the web frontend and required shared core assets', () => {
  const site = path.join(__dirname, '..', '..', 'site');
  for (const file of ['index.html', 'src/app.js', 'CNAME', 'core/rdap.js', 'core/renderer.js', 'core/viewer.css']) {
    assert.ok(fs.existsSync(path.join(site, file)), file);
  }
  assert.ok(!fs.existsSync(path.join(site, 'extension')));
  const builtHtml = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  assert.match(builtHtml, /src="core\/rdap\.js"/);
  assert.match(builtHtml, /data-core-root="core\/"/);
});
