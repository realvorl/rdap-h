const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Renderer = require('../renderer.js');
const R = require('../rdap.js');

test('shared renderer exports a browser mount point without requiring a framework', () => {
  assert.equal(typeof Renderer.mount, 'function');
  assert.equal(typeof Renderer.tokenizeJSON, 'function');
});

test('renderer restores and persists HUMAN/MACHINE and auto/light/dark preferences', () => {
  assert.deepEqual(Renderer.normalizePreferences({ theme: 'dark', machine: true }), { theme: 'dark', dark: true, machine: true });
  assert.deepEqual(Renderer.normalizePreferences({ theme: 'light', dark: false, machine: 'yes' }, true), { theme: 'light', dark: false, machine: false });
  assert.deepEqual(Renderer.normalizePreferences({}, true), { theme: 'auto', dark: true, machine: false });
  assert.deepEqual(Renderer.normalizePreferences({ dark: false }, true), { theme: 'light', dark: false, machine: false });
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.match(source, /onPreferencesChange\(\{ \.\.\.currentPreferences, machine \}\)/);
  assert.match(source, /createThemeControl\(actions, 'rdap-theme-select', screen/);
  assert.match(source, /\[\['auto', 'Auto'\], \['light', 'Light'\], \['dark', 'Dark'\]\]/);
  assert.match(source, /const toolbar = add\(wrap, el\('div', 'human-toolbar'\)\);\s*addKofiLink\(toolbar\);[\s\S]*const link = add\(toolbar, el\('a', 'toolbar-home', '← New lookup'\)\)/);
  assert.doesNotMatch(source, /addKofiLink\(actions\)/);
  assert.match(source, /const toolbar = add\(slot, el\('div', 'landing-toolbar'\)\);\s*addKofiLink\(toolbar\);\s*const themeControl = createThemeControl\(toolbar/);
  assert.match(source, /mountLandingToolbar\(slot, target/);
  assert.match(source, /title = 'Support this project on Ko-fi'/);
  assert.match(source, /aria-label', 'Support this project on Ko-fi'/);
  assert.match(source, /link\.target = '_blank'/);
  assert.match(source, /link\.rel = 'noopener noreferrer'/);
  assert.doesNotMatch(source, /\['Ko-fi', KOFI_URL\]/);
  assert.match(source, /onOriginalResponse/);
});

test('theme selector selects Auto, Light, and Dark; Auto tracks OS changes and overrides persist', () => {
  const listeners = new Map();
  const select = {
    value: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); }
  };
  const target = { dataset: {} };
  const systemListeners = new Set();
  const media = {
    matches: false,
    addEventListener(_type, listener) { systemListeners.add(listener); },
    removeEventListener(_type, listener) { systemListeners.delete(listener); }
  };
  const changes = [];
  const control = Renderer.createThemeSelector(select, target, { theme: 'auto' }, value => changes.push(value), media);
  assert.equal(select.value, 'auto');
  assert.equal(target.dataset.theme, 'light');
  media.matches = true;
  systemListeners.forEach(listener => listener({ matches: true }));
  assert.equal(target.dataset.theme, 'dark');

  select.value = 'light';
  listeners.get('change')();
  assert.deepEqual(control.state, { theme: 'light', dark: false });
  media.matches = false;
  systemListeners.forEach(listener => listener({ matches: false }));
  assert.equal(target.dataset.theme, 'light');

  select.value = 'dark';
  listeners.get('change')();
  assert.deepEqual(control.state, { theme: 'dark', dark: true });
  media.matches = false;
  systemListeners.forEach(listener => listener({ matches: false }));
  assert.equal(target.dataset.theme, 'dark');

  select.value = 'auto';
  listeners.get('change')();
  assert.equal(target.dataset.theme, 'light');
  media.matches = true;
  systemListeners.forEach(listener => listener({ matches: true }));
  assert.equal(target.dataset.theme, 'dark');
  assert.deepEqual(changes.map(change => change.theme), ['light', 'dark', 'auto']);
  control.destroy();
  assert.equal(listeners.size, 0);
  assert.equal(systemListeners.size, 0);
});

test('theme selector restores saved Light and Dark selections', () => {
  for (const [theme, expectedDark] of [['light', false], ['dark', true]]) {
    const select = { value: '', addEventListener() {}, removeEventListener() {} };
    const target = { dataset: {} };
    const control = Renderer.createThemeSelector(select, target, { theme }, () => {}, { matches: !expectedDark });
    assert.equal(select.value, theme);
    assert.equal(target.dataset.theme, expectedDark ? 'dark' : 'light');
    control.destroy();
  }
});

test('theme selector updates its inline SVG monitor, sun, and moon icons', () => {
  const previousDocument = global.document;
  global.document = {
    createElementNS(_namespace, tag) {
      return { tag, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    }
  };
  try {
    const listeners = new Map();
    const select = { value: '', addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); } };
    const icon = {
      dataset: {},
      children: [],
      get firstChild() { return this.children[0] || null; },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      appendChild(child) { this.children.push(child); }
    };
    const control = Renderer.createThemeSelector(select, { dataset: {} }, { theme: 'auto' }, () => {}, { matches: false }, icon);
    assert.equal(icon.dataset.themeIcon, 'auto');
    assert.deepEqual(icon.children.map(shape => shape.tag), ['rect', 'path']);
    select.value = 'light'; listeners.get('change')();
    assert.equal(icon.dataset.themeIcon, 'light');
    assert.deepEqual(icon.children.map(shape => shape.tag), ['circle', 'path']);
    select.value = 'dark'; listeners.get('change')();
    assert.equal(icon.dataset.themeIcon, 'dark');
    assert.deepEqual(icon.children.map(shape => shape.tag), ['path']);
    control.destroy();
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});

test('MACHINE display pretty prints JSON while copy retains exact response bytes', () => {
  const data = { objectClassName: 'ip network', entities: [{ handle: 'H' }] };
  const raw = ' \n{"objectClassName":"ip network","entities":[{"handle":"H"}]}\r\n';
  const output = Renderer.machineOutput(data, raw);
  assert.equal(output.display, JSON.stringify(data, null, 2));
  assert.notEqual(output.display, raw);
  assert.equal(output.clipboard, raw);
});

test('short and long JSON retain valid formatting and bounded display width', () => {
  for (const size of [1, 24000]) {
    const data = { objectClassName: 'domain', ldhName: 'example.test', note: 'x'.repeat(size) };
    const output = Renderer.machineOutput(data, JSON.stringify(data));
    assert.equal(output.display, JSON.stringify(data, null, 2));
    assert.equal(output.clipboard, JSON.stringify(data));
    assert.equal(Renderer.tokenizeJSON(output.display).map(token => token.value).join(''), output.display);
  }
});

test('expand and collapse actions reach deeply nested details and filtering restores open state', () => {
  const detail = (className, title, open) => ({ className, open, querySelector: () => ({ textContent: title }) });
  const before = [detail('section', 'Contacts', true), detail('entity-card', 'Org · H · admin', false), detail('nested-detail', 'Address', true)];
  const saved = Renderer.captureExpansion(before);
  Renderer.setExpanded(before, false);
  assert.deepEqual(before.map(x => x.open), [false, false, false]);
  Renderer.applyFilterExpansion(before, true, saved);
  assert.deepEqual(before.map(x => x.open), [true, true, true]);
  const rebuilt = [detail('section', 'Contacts', false), detail('entity-card', 'Org · H · admin', true), detail('nested-detail', 'Address', false)];
  Renderer.applyFilterExpansion(rebuilt, false, saved);
  assert.deepEqual(rebuilt.map(x => x.open), [true, false, true]);
  Renderer.setExpanded(rebuilt, true);
  assert.deepEqual(rebuilt.map(x => x.open), [true, true, true]);
});

test('expand and collapse support very deep disclosures without layout-dependent assumptions', () => {
  const nested = Array.from({ length: 256 }, (_, index) => ({ open: index % 2 === 0 }));
  Renderer.setExpanded(nested, false);
  assert.equal(nested.some(item => item.open), false);
  Renderer.setExpanded(nested, true);
  assert.equal(nested.every(item => item.open), true);
});

test('mode switch keeps shared controls available and hides HUMAN-only controls', () => {
  for (const size of [1, 48000]) {
    const data = { objectClassName: 'domain', ldhName: 'example.test', payload: 'x'.repeat(size) };
    assert.equal(Renderer.machineOutput(data).display, JSON.stringify(data, null, 2));
    const humanContent = { hidden: false };
    const recordHeader = { hidden: false };
    const machinePane = { hidden: true };
    const filterControls = { hidden: false };
    const expandControls = { hidden: false };
    const parts = { humanContent, recordHeader, machinePane, filterControls, expandControls };
    Renderer.applyMode(parts, true);
    assert.deepEqual([humanContent.hidden, recordHeader.hidden, machinePane.hidden, filterControls.hidden, expandControls.hidden], [true, true, false, true, true]);
    Renderer.applyMode(parts, false);
    assert.deepEqual([humanContent.hidden, recordHeader.hidden, machinePane.hidden, filterControls.hidden, expandControls.hidden], [false, false, true, false, false]);
  }
});

test('scrollbar gutter reservation is stable and restored on teardown', () => {
  const root = { style: { scrollbarGutter: 'auto' } };
  const restore = Renderer.reserveScrollbarGutter(root);
  assert.equal(root.style.scrollbarGutter, 'stable');
  restore();
  assert.equal(root.style.scrollbarGutter, 'auto');
});

test('renderer normalizes and restores a shrink-to-fit host container', () => {
  const container = { style: { display: 'flex', width: 'max-content', maxWidth: '700px', minWidth: '', boxSizing: '', margin: '4px', padding: '8px' } };
  const original = { ...container.style };
  const restore = Renderer.constrainContainer(container);
  assert.deepEqual(container.style, {
    display: 'block', width: '100%', maxWidth: 'none', minWidth: '0', boxSizing: 'border-box', margin: '0', padding: '0'
  });
  restore();
  assert.deepEqual(container.style, original);
});

test('HUMAN panels, toolbar, and MACHINE panel share one full-width box model', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'viewer.css'), 'utf8');
  const rule = selector => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] || '';
  for (const selector of ['.container', '.human-toolbar', '.section', '.machine-view']) {
    assert.match(rule(selector), /width:100%/);
    assert.match(rule(selector), /box-sizing:border-box/);
  }
  assert.doesNotMatch(rule('.container'), /max-width/);
  assert.match(css, /padding:22px clamp\(14px,2vw,24px\) 24px/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8'), /scrollbarGutter = 'stable'/);
});

test('clipboard helper copies the exact supplied response and reports failures', async () => {
  const raw = ' \n{"x":1}\r\n';
  let copied;
  assert.equal(await Renderer.copyToClipboard(raw, { writeText: async text => { copied = text; } }), true);
  assert.equal(copied, raw);
  assert.equal(await Renderer.copyToClipboard(raw, { writeText: async () => { throw new Error('blocked'); } }), false);
});

test('APNIC network fixture retains nested contacts and registry extensions', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/apnic-ip-123-11-12-13.json'), 'utf8'));
  assert.equal(fixture.objectClassName, 'ip network');
  assert.equal(fixture.apnic_ext.queryAddress, '123.11.12.13');
  assert.equal(fixture.entities[0].apnic_ext.registrationStatus, 'ALLOCATED PORTABLE');
  assert.equal(R.detect(fixture).type, 'ip network');
  const contacts = R.contactFields(fixture.entities[0].vcardArray);
  assert.equal(contacts.filter(field => field.key === 'email').length, 2);
  assert.deepEqual(contacts.filter(field => field.key === 'email').map(field => field.label), ['Work Email', 'Abuse Email']);
  assert.match(contacts.find(field => field.key === 'adr').value, /South Brisbane/);
  assert.match(fixture.remarks[0].description[0], /APNIC-managed/);
});

test('compact entity headings and event rows include contact identity and roles', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/apnic-ip-123-11-12-13.json'), 'utf8'));
  assert.equal(R.entityHeading(fixture.entities[0]), 'APNIC Network Abuse · IRT-APNIC-AP · abuse');
  assert.equal(R.eventLabel(fixture.events[0]), 'Registration · 1993-05-01T00:00:00Z');
});

test('JSON tokenizer preserves nested formatting and separates keys from repeated string values', () => {
  const source = '{\n  "same": "same",\n  "quote": "a \\"quoted\\" snow 雪 \\u96ea",\n  "number": -1.25e+9,\n  "yes": true,\n  "no": false,\n  "empty": null,\n  "nested": [false, {"same": "value"}]\n}\n';
  const tokens = Renderer.tokenizeJSON(source);
  assert.equal(tokens.map(token => token.value).join(''), source);
  assert.ok(tokens.some(token => token.type === 'key' && token.value === '"same"'));
  assert.ok(tokens.some(token => token.type === 'string' && token.value === '"same"'));
  assert.ok(tokens.some(token => token.type === 'string' && token.value.includes('\\"quoted\\"')));
  assert.ok(tokens.some(token => token.type === 'number' && token.value === '-1.25e+9'));
  assert.equal(tokens.filter(token => token.type === 'boolean').length, 3);
  assert.equal(tokens.filter(token => token.type === 'null').length, 1);
  assert.ok(tokens.some(token => token.type === 'whitespace' && token.value === '\n  '));
});

test('JSON tokenizer handles a large object and reconstructs every source character', () => {
  const object = Object.fromEntries(Array.from({ length: 12000 }, (_, i) => [`field${i}`, i]));
  const source = JSON.stringify(object, null, 2);
  const tokens = Renderer.tokenizeJSON(source);
  assert.equal(tokens.map(token => token.value).join(''), source);
  assert.equal(tokens.filter(token => token.type === 'key').length, 12000);
  assert.equal(tokens.filter(token => token.type === 'number').length, 12000);
});

test('shared stylesheet contains the common filter, theme, and standards affordances', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'viewer.css'), 'utf8');
  const themeCSS = fs.readFileSync(path.join(__dirname, '..', 'theme.css'), 'utf8');
  assert.match(themeCSS, /\.theme-select\{/);
  assert.match(themeCSS, /\.theme-control\{[^}]*--theme-text:var\(--text/);
  assert.match(themeCSS, /\.landing-toolbar\{[^}]*justify-content:space-between/);
  assert.match(themeCSS, /\.landing-toolbar\{[^}]*flex-wrap:wrap/);
  assert.match(themeCSS, /\.landing-toolbar \.theme-control\{margin-left:auto\}/);
  assert.match(themeCSS, /\.theme-label\{[^}]*color:var\(--theme-text/);
  assert.match(themeCSS, /\.theme-icon\{[^}]*color:var\(--theme-text/);
  assert.match(themeCSS, /\.toolbar-kofi:focus-visible\{outline:2px solid/);
  const landingCss = fs.readFileSync(path.join(__dirname, '..', '..', 'web/index.html'), 'utf8');
  assert.match(landingCss, /:root\[data-theme="dark"\]\{[^}]*--text:#e9f2fa/);
  for (const selector of ['.human-toolbar', '.filter-input', '.app[data-theme="dark"]', '.info', '.toolbar-button', '.copy-raw']) {
    assert.ok(css.includes(selector), selector);
  }
  for (const variable of ['--json-key:', '--json-string:', '--json-number:', '--json-boolean:', '--json-null:']) {
    assert.ok(css.includes(variable), variable);
  }
  assert.match(css, /\.app\[data-theme="dark"\] \.machine-view/);
  assert.match(css, /\.app\[data-theme="dark"\]\{[^}]*--text:#e9f2fa/);
  assert.match(css, /\.machine-json\{[^}]*white-space:pre-wrap/);
  assert.match(css, /\.machine-json\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.machine-json\{[^}]*max-width:100%/);
  assert.match(css, /\.machine-view\{[^}]*overflow-x:hidden/);
  assert.match(css, /\.human-toolbar\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.toolbar-actions\{[^}]*justify-content:flex-end/);
  assert.match(css, /\.app\{[^}]*min-width:0/);
  assert.match(css, /:host\{[^}]*width:100%/);
  assert.match(css, /\.app \[hidden\]\{display:none!important\}/);
  assert.match(css, /\.machine-json\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.detail-grid\{[^}]*minmax\(0,1fr\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8'), /scrollbarGutter = 'stable'/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.doesNotMatch(css, /\.mode-toggle\{position:fixed/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8'), /\.innerHTML\s*=/);
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.match(renderer, /Technical details/);
  assert.doesNotMatch(renderer, /JSON\.stringify\(p\.params\)/);
});
