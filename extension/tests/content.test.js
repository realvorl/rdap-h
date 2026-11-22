const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RDAP = require('../../core/rdap.js');
const Extension = require('../src/content.js');

test('extension runs only on top-level RDAP JSON documents', () => {
  assert.equal(Extension.shouldRun('https://rdap.arin.net/registry/ip/8.8.8.8', 'application/json', true, RDAP), true);
  assert.equal(Extension.shouldRun('https://rdap.arin.net/registry/ip/8.8.8.8', 'text/html', true, RDAP), false);
  assert.equal(Extension.shouldRun('https://rdap-h.de/?url=https%3A%2F%2Frdap.arin.net%2Fip%2F8.8.8.8', 'text/html', true, RDAP), false);
  assert.equal(Extension.shouldRun('https://example.org/', 'application/json', true, RDAP), false);
  assert.equal(Extension.shouldRun('https://rdap.arin.net/registry/ip/8.8.8.8', 'application/json', false, RDAP), false);
});

test('extension parses supported data and leaves unrelated JSON untouched', () => {
  const raw = ' \n{"objectClassName":"domain","ldhName":"example.test"}\n';
  const parsed = Extension.parseDocument(raw, RDAP);
  assert.equal(parsed.kind.type, 'domain');
  assert.equal(parsed.raw, raw);
  assert.equal(Extension.parseDocument('{"hello":"world"}', RDAP), null);
  assert.equal(Extension.parseDocument('<html></html>', RDAP), null);
});

test('extension manifest points at the local generated core bundle', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.content_scripts[0].js, ['bundle/rdap.js', 'bundle/renderer.js', 'src/content.js']);
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ['bundle/viewer.css']);
  for (const file of manifest.content_scripts[0].js) assert.ok(fs.existsSync(path.join(__dirname, '..', file)), file);
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'bundle', 'rdap.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', '..', 'core', 'rdap.js'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'bundle', 'renderer.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', '..', 'core', 'renderer.js'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'bundle', 'viewer.css'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', '..', 'core', 'viewer.css'), 'utf8'));
});
