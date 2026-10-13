import {
  ATTR_ARCHIVE, ATTR_DIRECTORY, SECTOR_SIZE, VOLUME_DESCRIPTOR_SECTOR,
  dateToFiletime, encodeEntry, encodeVolumeDescriptor,
} from './format.js';
import { isDirectory, planImage } from './layout.js';
import { ValidationError, validateTree } from './validate.js';

const BEFORE_DESCRIPTOR = new Uint8Array(VOLUME_DESCRIPTOR_SECTOR * SECTOR_SIZE);

function serializeDirectory(record, info) {
  const bytes = new Uint8Array(record.plan.size).fill(0xff);
  for (const slot of record.plan.order) {
    const child = info.get(slot.node);
    const directory = isDirectory(slot.node);
    encodeEntry(bytes, slot.pos, {
      left: slot.left ? slot.left.pos / 4 : 0,
      right: slot.right ? slot.right.pos / 4 : 0,
      sector: child.sector,
      size: directory ? child.plan.size : slot.node.blob.size,
      attributes: directory ? ATTR_DIRECTORY : ATTR_ARCHIVE,
      nameBytes: slot.nameBytes,
    });
  }
  return bytes;
}

// Devolve as partes da imagem na ordem: zeros até o setor 32, descritor, diretórios, dados dos arquivos.
export function buildXiso(root, { now = new Date() } = {}) {
  const { errors } = validateTree(root);
  if (errors.length > 0) throw new ValidationError(errors);

  const image = planImage(root);
  const rootRecord = image.dirs[0];
  const parts = [
    BEFORE_DESCRIPTOR,
    encodeVolumeDescriptor({
      rootSector: rootRecord.sector,
      rootSize: rootRecord.plan.size,
      filetime: dateToFiletime(now),
    }),
  ];
  for (const record of image.dirs) {
    if (record.plan.size > 0) parts.push(serializeDirectory(record, image.info));
  }
  for (const record of image.files) {
    const size = record.node.blob.size;
    if (size === 0) continue;
    parts.push(record.node.blob);
    const padding = (SECTOR_SIZE - (size % SECTOR_SIZE)) % SECTOR_SIZE;
    if (padding > 0) parts.push(new Uint8Array(padding));
  }
  return { parts, totalSize: image.totalSectors * SECTOR_SIZE };
}
