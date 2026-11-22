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

test('generates a directly shareable URL and preserves unrelated query parameters', () => {
  assert.equal(
    Pages.shareUrl('https://rdap-h.de/?source=bookmark', 'https://rdap.db.ripe.net/domain/example.test'),
    'https://rdap-h.de/?source=bookmark&url=https%3A%2F%2Frdap.db.ripe.net%2Fdomain%2Fexample.test'
  );
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
