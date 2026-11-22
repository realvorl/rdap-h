import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const webDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(webDir, '..');
const outputDir = resolve(rootDir, 'site');
await rm(outputDir, { recursive: true, force: true });
await mkdir(resolve(outputDir, 'src'), { recursive: true });
await mkdir(resolve(outputDir, 'core'), { recursive: true });

const index = (await readFile(resolve(webDir, 'index.html'), 'utf8')).replaceAll('../core/', 'core/');
await writeFile(resolve(outputDir, 'index.html'), index);
await cp(resolve(webDir, 'src/app.js'), resolve(outputDir, 'src/app.js'));
for (const file of ['rdap.js', 'renderer.js', 'viewer.css']) {
  await cp(resolve(rootDir, 'core', file), resolve(outputDir, 'core', file));
}
process.stdout.write('Prepared the local development web app and shared core assets in site/.\n');
