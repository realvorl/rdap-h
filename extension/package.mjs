import { deflateRawSync } from 'node:zlib';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const extensionDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(extensionDir, '..');
await import('./build.mjs');
const manifest = JSON.parse(await readFile(resolve(extensionDir, 'manifest.json'), 'utf8'));
const required = new Set([
  'LICENSE', 'manifest.json', 'settings.html', 'lookup/index.html', 'lookup/app.js',
  'src/background.js', 'src/content.js', 'src/settings.js',
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.background?.scripts || []),
  ...(manifest.background?.service_worker ? [manifest.background.service_worker] : []),
  ...(manifest.options_ui?.page ? [manifest.options_ui.page] : []),
  ...(manifest.content_scripts || []).flatMap(script => script.js || []),
  ...(manifest.web_accessible_resources || []).flatMap(resource => resource.resources || [])
]);
const files = [...required].sort();
const entries = [];
for (const name of files) {
  const path = name === 'LICENSE' ? resolve(rootDir, 'LICENSE') : resolve(extensionDir, name);
  await access(path);
  entries.push({ name, data: await readFile(path) });
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipTimestamp() {
  return { time: 0, date: (1 << 9) | (1 << 5) | 1 };
}

function createZip(sourceEntries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const stamp = zipTimestamp();
  for (const entry of sourceEntries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'));
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sourceEntries.length, 8);
  end.writeUInt16LE(sourceEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function listZipEntries(zip) {
  for (let pos = zip.length - 22; pos >= Math.max(0, zip.length - 65557); pos--) {
    if (zip.readUInt32LE(pos) !== 0x06054b50) continue;
    const count = zip.readUInt16LE(pos + 10);
    let cursor = zip.readUInt32LE(pos + 16);
    const names = [];
    for (let index = 0; index < count; index++) {
      if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid extension archive central directory.');
      const nameLength = zip.readUInt16LE(cursor + 28);
      const extraLength = zip.readUInt16LE(cursor + 30);
      const commentLength = zip.readUInt16LE(cursor + 32);
      names.push(zip.toString('utf8', cursor + 46, cursor + 46 + nameLength));
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return names.sort();
  }
  throw new Error('Invalid extension archive end record.');
}

const archiveEntries = entries.map(entry => ({ name: entry.name, data: entry.data }));
const archiveData = createZip(archiveEntries);
if (JSON.stringify(listZipEntries(archiveData)) !== JSON.stringify(files)) throw new Error('Extension archive contains unexpected or missing files.');
const version = manifest.version;
const distDir = resolve(rootDir, 'dist');
await mkdir(distDir, { recursive: true });
const archive = resolve(distDir, `rdap-human-viewer-v${version}.zip`);
await rm(archive, { force: true });
await writeFile(archive, archiveData);
process.stdout.write(`Created and validated ${archive}\n`);

export { createZip, listZipEntries };
