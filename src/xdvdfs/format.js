export const SECTOR_SIZE = 2048;
export const MAGIC = 'MICROSOFT*XBOX*MEDIA';
export const VOLUME_DESCRIPTOR_SECTOR = 32;
export const VOLUME_DESCRIPTOR_OFFSET = VOLUME_DESCRIPTOR_SECTOR * SECTOR_SIZE;
export const ATTR_DIRECTORY = 0x10;
export const ATTR_ARCHIVE = 0x20;
export const MAX_FILE_SIZE = 0xffffffff;
export const MAX_NAME_BYTES = 255;
export const MAX_ENTRY_OFFSET_DWORDS = 0xffff;
// A CONFIRMAR contra ISOs/fontes de referência (ver spec, seção 3).
export const PARTITION_OFFSET_CANDIDATES = [0, 0x18300000, 0x0fd90000, 0x02080000, 0x89d80000];

const MAGIC_TAIL_OFFSET = 0x7ec;
const ENTRY_HEADER = 14;
const FILETIME_UNIX_EPOCH = 116444736000000000n;

export function latin1Bytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) return null;
    out[i] = code;
  }
  return out;
}

export function latin1String(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

// Só a-z sobem para maiúsculas; os demais bytes Latin-1 ficam crus. toUpperCase() do JS mapeia
// ß→SS e µ→U+039C, o que gera duplicatas falsas e uma ordem que nenhuma ferramenta de disco usa.
export const nameKey = (name) => name.replace(/[a-z]+/g, (letters) => letters.toUpperCase());

export function compareNames(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export const entrySize = (nameLength) => (ENTRY_HEADER + nameLength + 3) & ~3;

// Multiplicação (não <<): imagens e posições passam de 2^32 bytes.
export const sectorToOffset = (sector) => sector * SECTOR_SIZE;

export const dateToFiletime = (date) => BigInt(date.getTime()) * 10000n + FILETIME_UNIX_EPOCH;

export function encodeVolumeDescriptor({ rootSector, rootSize, filetime }) {
  const bytes = new Uint8Array(SECTOR_SIZE);
  const view = new DataView(bytes.buffer);
  const magic = latin1Bytes(MAGIC);
  bytes.set(magic, 0);
  view.setUint32(0x14, rootSector, true);
  view.setUint32(0x18, rootSize, true);
  view.setBigUint64(0x1c, filetime, true);
  bytes.set(magic, MAGIC_TAIL_OFFSET);
  return bytes;
}

export function decodeVolumeDescriptor(bytes) {
  if (bytes.length < SECTOR_SIZE) return null;
  const magic = latin1Bytes(MAGIC);
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i] || bytes[MAGIC_TAIL_OFFSET + i] !== magic[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    rootSector: view.getUint32(0x14, true),
    rootSize: view.getUint32(0x18, true),
    filetime: view.getBigUint64(0x1c, true),
  };
}

export function encodeEntry(bytes, offset, { left, right, sector, size, attributes, nameBytes }) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(offset, left, true);
  view.setUint16(offset + 2, right, true);
  view.setUint32(offset + 4, sector, true);
  view.setUint32(offset + 8, size, true);
  bytes[offset + 12] = attributes;
  bytes[offset + 13] = nameBytes.length;
  bytes.set(nameBytes, offset + ENTRY_HEADER);
}

export function decodeEntry(bytes, offset) {
  if (offset + ENTRY_HEADER > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(offset, true) === 0xffffffff) return null;
  const nameLength = bytes[offset + 13];
  if (offset + ENTRY_HEADER + nameLength > bytes.length) return null;
  return {
    left: view.getUint16(offset, true),
    right: view.getUint16(offset + 2, true),
    sector: view.getUint32(offset + 4, true),
    size: view.getUint32(offset + 8, true),
    attributes: bytes[offset + 12],
    name: latin1String(bytes.subarray(offset + ENTRY_HEADER, offset + ENTRY_HEADER + nameLength)),
  };
}
