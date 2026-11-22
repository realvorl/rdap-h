const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('extension ZIP contains only manifest-required production assets and its license', async () => {
  const packager = await import('../extension/package.mjs');
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
  const expected = new Set([
    'LICENSE', 'manifest.json', 'settings.html', 'lookup/index.html', 'lookup/app.js',
    'src/background.js', 'src/content.js', 'src/settings.js',
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action.default_icon || {}),
    ...(manifest.background.scripts || []), manifest.background.service_worker,
    manifest.options_ui.page,
    ...manifest.content_scripts.flatMap(script => script.js),
    ...manifest.web_accessible_resources.flatMap(resource => resource.resources)
  ]);
  const archive = await fs.readFile(path.join(root, `dist/rdap-human-viewer-v${manifest.version}.zip`));
  const names = packager.listZipEntries(archive);
  assert.deepEqual(names, [...expected].sort());
  assert.ok(!names.some(name => /(?:tests?|docker|web\/src|build\.mjs)/i.test(name)));
});

test('Docker package serves the built static web app without logging query URLs', async () => {
  const root = path.join(__dirname, '..');
  const [dockerfile, nginx, ignore, compose] = await Promise.all([
    fs.readFile(path.join(root, 'docker/Dockerfile'), 'utf8'),
    fs.readFile(path.join(root, 'docker/nginx.conf'), 'utf8'),
    fs.readFile(path.join(root, '.dockerignore'), 'utf8'),
    fs.readFile(path.join(root, 'compose.yaml'), 'utf8')
  ]);
  assert.match(dockerfile, /FROM node:24\.22\.3-alpine3\.24 AS web-build/);
  assert.match(dockerfile, /FROM nginx:1\.30\.7-alpine3\.24/);
  assert.match(dockerfile, /USER 101:101/);
  assert.match(dockerfile, /COPY assets \.\/assets/);
  assert.match(dockerfile, /COPY --from=web-build \/src\/site\//);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /ENTRYPOINT \["nginx"\]/);
  assert.match(nginx, /listen 8080/);
  assert.match(nginx, /access_log off/);
  assert.match(nginx, /location = \/healthz/);
  assert.match(ignore, /extension/);
  assert.match(compose, /8080:8080/);
  assert.match(compose, /read_only: true/);
  for (const file of ['index.html', 'src/app.js', 'core/rdap.js', 'core/renderer.js', 'core/viewer.css', 'core/theme.css', 'assets/icon.svg', 'assets/icon-small.svg', 'assets/icon-48.png', 'assets/icon-128.png']) {
    assert.ok(await fs.stat(path.join(root, 'site', file)), `site/${file}`);
  }
  const html = await fs.readFile(path.join(root, 'site/index.html'), 'utf8');
  assert.match(html, /RDAP, but for Humans is an independent project/);
  assert.match(html, /https:\/\/github\.com\/realvorl\/rdap-h\/issues/);
  assert.doesNotMatch(html, /https:\/\/ko-fi\.com\/realvorl/);
  const renderer = await fs.readFile(path.join(root, 'site/core/renderer.js'), 'utf8');
  assert.match(renderer, /KOFI_URL = 'https:\/\/ko-fi\.com\/realvorl'/);
  assert.match(renderer, /Support this project on Ko-fi/);
  assert.match(html, /href="assets\/icon-small\.svg"/);
  assert.match(html, /href="assets\/icon-48\.png"/);
  assert.match(html, /href="assets\/icon-128\.png"/);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
});

test('CI and release workflows validate both products and never deploy GitHub Pages', async () => {
  const root = path.join(__dirname, '..');
  const [ci, extensionRelease, dockerRelease] = await Promise.all([
    fs.readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8'),
    fs.readFile(path.join(root, '.github/workflows/extension-release.yml'), 'utf8'),
    fs.readFile(path.join(root, '.github/workflows/docker-release.yml'), 'utf8')
  ]);
  assert.match(ci, /node --test/);
  assert.match(ci, /node --check/);
  assert.match(ci, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(extensionRelease, /upload-artifact@v4/);
  assert.match(extensionRelease, /m\.version/);
  assert.match(dockerRelease, /packages: write/);
  assert.match(dockerRelease, /type=raw,value=latest/);
  assert.match(dockerRelease, /push: true/);
  assert.deepEqual((await fs.readdir(path.join(root, '.github/workflows'))).sort(), ['ci.yml', 'docker-release.yml', 'extension-release.yml']);
});
