const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RDAP = require('../../core/rdap.js');
const Extension = require('../src/content.js');
const Settings = require('../src/settings.js');
const Background = require('../src/background.js');

test('extension runs only on top-level RDAP JSON documents', () => {
  assert.equal(Extension.shouldRun('https://rdap.arin.net/registry/ip/8.8.8.8', 'application/json', true, RDAP), true);
  assert.equal(Extension.shouldRun('https://rdap.arin.net/registry/ip/8.8.8.8', 'text/html', true, RDAP), false);
  assert.equal(Extension.shouldRun('https://viewer.example/?url=https%3A%2F%2Frdap.arin.net%2Fip%2F8.8.8.8', 'text/html', true, RDAP), false);
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

test('automatic mode renders RDAP documents while on-demand mode stays passive', () => {
  const rdapUrl = 'https://rdap.arin.net/registry/ip/8.8.8.8';
  assert.equal(Extension.shouldAutoDisplay('automatic', rdapUrl, 'application/json', true, RDAP), true);
  assert.equal(Extension.shouldAutoDisplay('onDemand', rdapUrl, 'application/json', true, RDAP), false);
  assert.equal(Extension.shouldAutoDisplay('automatic', 'https://example.org/', 'application/json', true, RDAP), false);
  assert.equal(Extension.shouldAutoDisplay('automatic', rdapUrl, 'text/html', true, RDAP), false);
});

test('settings default to Automatic, normalize unknown values, and persist the selected mode', () => {
  assert.equal(Settings.normalizeMode(undefined), 'automatic');
  assert.equal(Settings.normalizeMode('automatic'), 'automatic');
  assert.equal(Settings.normalizeMode('onDemand'), 'onDemand');
  assert.equal(Settings.normalizeMode('unexpected'), 'automatic');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/settings.js'), 'utf8');
  assert.match(source, /storage\.local\.get/);
  assert.match(source, /storage\.local\.set\(\{ operatingMode: mode \}/);
});

test('toolbar action opens lookup when no RDAP page responded and toggles a detected RDAP page', () => {
  assert.equal(Background.shouldOpenLookup({ rdap: true }), false);
  assert.equal(Background.shouldOpenLookup({ rdap: false }), true);
  assert.equal(Background.shouldOpenLookup(undefined), true);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/background.js'), 'utf8');
  assert.match(source, /RDAP_VIEWER_ACTION/);
  assert.match(source, /lookup\/index\.html/);
  assert.match(source, /RDAP_MODE_CHANGED/);
  const integration = fs.readFileSync(path.join(__dirname, '..', 'src/content.js'), 'utf8');
  assert.match(integration, /if \(RDAPExtension\.shouldAutoDisplay\(mode/);
  assert.match(integration, /renderer\.setMachineMode\(false\)/);
  assert.match(integration, /onOriginalResponse\(\)/);
  assert.match(integration, /storage\?\.get\(\['operatingMode', 'theme', 'dark', 'machine'\]/);
  assert.match(integration, /storage\?\.set\(\{ theme: next\.theme, dark: next\.dark, machine: next\.machine \}\)/);
});

test('extension manifest points at the local generated core bundle', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.content_scripts[0].js, ['bundle/rdap.js', 'bundle/renderer.js', 'src/content.js']);
  assert.deepEqual(manifest.web_accessible_resources[0].resources, ['bundle/viewer.css', 'bundle/theme.css']);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.equal(manifest.action.default_title, 'RDAP Human Viewer');
  assert.equal(manifest.options_ui.page, 'settings.html');
  assert.equal(manifest.background.service_worker, 'src/background.js');
  assert.deepEqual(manifest.background.scripts, ['src/background.js']);
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '121.0');
  assert.equal(manifest.minimum_chrome_version, '121');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'lookup', 'index.html')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'lookup', 'app.js')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'bundle', 'theme.css')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'settings.html')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'settings.js')));
  const lookupHtml = fs.readFileSync(path.join(__dirname, '..', 'lookup', 'index.html'), 'utf8');
  assert.match(lookupHtml, /src="\.\.\/bundle\/rdap\.js"/);
  assert.match(lookupHtml, /src="\.\.\/bundle\/renderer\.js"/);
  assert.doesNotMatch(lookupHtml, /https?:[^"']+\.(?:js|css)/);
  for (const file of manifest.content_scripts[0].js) assert.ok(fs.existsSync(path.join(__dirname, '..', file)), file);
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'bundle', 'rdap.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', '..', 'core', 'rdap.js'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'bundle', 'renderer.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', '..', 'core', 'renderer.js'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'bundle', 'viewer.css'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', '..', 'core', 'viewer.css'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'bundle', 'theme.css'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', '..', 'core', 'theme.css'), 'utf8'));
  const landingHtml = fs.readFileSync(path.join(__dirname, '..', 'lookup', 'index.html'), 'utf8');
  assert.match(landingHtml, /<select id="landing-theme"[^>]*aria-label="Color theme"/);
  assert.match(landingHtml, /<option value="auto">Auto<\/option><option value="light">Light<\/option><option value="dark">Dark<\/option>/);
});

test('extension requests optional service origins only from its local lookup flow', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src/app.js'), 'utf8');
  assert.match(app, /permissions\.request\(\{ origins \}/);
  assert.match(app, /https:\/\/data\.iana\.org\/\*/);
  assert.match(app, /permissionOrigins\(endpoints\)/);
});
