import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const extensionDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(extensionDir, '..');
const bundleDir = resolve(extensionDir, 'bundle');
await mkdir(bundleDir, { recursive: true });
for (const [source, destination] of [
  ['core/rdap.js', 'rdap.js'],
  ['core/renderer.js', 'renderer.js'],
  ['core/viewer.css', 'viewer.css']
]) {
  await copyFile(resolve(rootDir, source), resolve(bundleDir, destination));
}
process.stdout.write('Bundled local core assets into extension/bundle/.\n');
