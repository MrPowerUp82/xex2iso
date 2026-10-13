import {
  ATTR_DIRECTORY, PARTITION_OFFSET_CANDIDATES, SECTOR_SIZE, VOLUME_DESCRIPTOR_OFFSET,
  compareNames, decodeEntry, decodeVolumeDescriptor, sectorToOffset,
} from './format.js';

const MAX_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 64;

export class NotXisoError extends Error {
  constructor(message = 'Este arquivo não é uma ISO Xbox válida.') {
    super(message);
    this.name = 'NotXisoError';
  }
}

export class CorruptIsoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CorruptIsoError';
  }
}

async function readBytes(blob, start, length) {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

export async function openIso(blob) {
  for (const partitionOffset of PARTITION_OFFSET_CANDIDATES) {
    const at = partitionOffset + VOLUME_DESCRIPTOR_OFFSET;
    if (at + SECTOR_SIZE > blob.size) continue;
    const descriptor = decodeVolumeDescriptor(await readBytes(blob, at, SECTOR_SIZE));
    if (descriptor) return { blob, partitionOffset, ...descriptor };
  }
  throw new NotXisoError();
}

function assertInside(iso, sector, size, what) {
  const end = iso.partitionOffset + sectorToOffset(sector) + size;
  if (end > iso.blob.size) throw new CorruptIsoError(`${what} aponta para além do fim da imagem.`);
}

function assertSafeName(name) {
  if (name === '' || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new CorruptIsoError(`Nome de entrada inválido na imagem: ${JSON.stringify(name)}.`);
  }
}

async function readDirectory(iso, sector, size, counter) {
  if (size > MAX_DIRECTORY_BYTES) throw new CorruptIsoError('Diretório grande demais.');
  assertInside(iso, sector, size, 'Diretório');
  const data = await readBytes(iso.blob, iso.partitionOffset + sectorToOffset(sector), size);
  // Outras ferramentas gravam pasta vazia como um setor de 0xFF: a árvore já começa no padding.
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xff && data[2] === 0xff && data[3] === 0xff) return [];
  const visited = new Set();
  const pending = [0];
  const entries = [];
  while (pending.length > 0) {
    const offset = pending.pop();
    if (visited.has(offset)) throw new CorruptIsoError('Árvore de diretório com ciclo.');
    visited.add(offset);
    if (++counter.seen > counter.max) throw new CorruptIsoError('Imagem com entradas demais.');
    const entry = decodeEntry(data, offset);
    if (!entry) throw new CorruptIsoError('Entrada de diretório inválida.');
    entries.push(entry);
    if (entry.left) pending.push(entry.left * 4);
    if (entry.right) pending.push(entry.right * 4);
  }
  return entries.sort((a, b) => compareNames(a.name, b.name));
}

export async function listEntries(iso, { maxEntries = 1_000_000 } = {}) {
  const counter = { seen: 0, max: maxEntries };
  const result = [];

  const walk = async (sector, size, prefix, depth) => {
    if (depth > MAX_DEPTH) throw new CorruptIsoError('Pastas aninhadas demais.');
    if (size === 0) return;
    for (const raw of await readDirectory(iso, sector, size, counter)) {
      assertSafeName(raw.name);
      const path = prefix + raw.name;
      if ((raw.attributes & ATTR_DIRECTORY) !== 0) {
        result.push({ path, name: raw.name, isDirectory: true, size: 0, sector: raw.sector });
        await walk(raw.sector, raw.size, path + '/', depth + 1);
      } else {
        if (raw.size > 0) assertInside(iso, raw.sector, raw.size, `O arquivo ${path}`);
        result.push({ path, name: raw.name, isDirectory: false, size: raw.size, sector: raw.sector });
      }
    }
  };
  await walk(iso.rootSector, iso.rootSize, '', 0);
  return result;
}

export function readFile(iso, entry) {
  const start = iso.partitionOffset + sectorToOffset(entry.sector);
  return iso.blob.slice(start, start + entry.size);
}

export function findRootFile(entries, name) {
  const wanted = name.toUpperCase();
  return entries.find((e) => !e.isDirectory && e.path.toUpperCase() === wanted) ?? null;
}
