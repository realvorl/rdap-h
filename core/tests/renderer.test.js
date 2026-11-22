const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Renderer = require('../renderer.js');

test('shared renderer exports a browser mount point without requiring a framework', () => {
  assert.equal(typeof Renderer.mount, 'function');
  assert.equal(typeof Renderer.tokenizeJSON, 'function');
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
  for (const selector of ['.filter-bar', '.filter-input', '.app[data-theme="dark"]', '.info', '.mode-toggle']) {
    assert.ok(css.includes(selector), selector);
  }
  for (const variable of ['--json-key:', '--json-string:', '--json-number:', '--json-boolean:', '--json-null:']) {
    assert.ok(css.includes(variable), variable);
  }
  assert.match(css, /\.machine-view\[data-theme="dark"\]/);
  assert.match(css, /\.machine-json\{[^}]*white-space:pre-wrap/);
  assert.match(css, /\.machine-json\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.machine-json\{[^}]*max-width:100%/);
  assert.match(css, /\.machine-view\{[^}]*overflow-x:hidden/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8'), /\.innerHTML\s*=/);
});
