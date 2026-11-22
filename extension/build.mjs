import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const extensionDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(extensionDir, '..');
const bundleDir = resolve(extensionDir, 'bundle');
const lookupDir = resolve(extensionDir, 'lookup');
await mkdir(bundleDir, { recursive: true });
await mkdir(lookupDir, { recursive: true });
for (const [source, destination] of [
  ['core/rdap.js', 'rdap.js'],
  ['core/renderer.js', 'renderer.js'],
  ['core/viewer.css', 'viewer.css']
]) {
  await copyFile(resolve(rootDir, source), resolve(bundleDir, destination));
}
await copyFile(resolve(rootDir, 'web/src/app.js'), resolve(lookupDir, 'app.js'));
process.stdout.write('Bundled local core assets and extension lookup frontend.\n');
