import { SECTOR_SIZE, VOLUME_DESCRIPTOR_SECTOR, compareNames, entrySize, latin1Bytes } from './format.js';

export const isDirectory = (node) => Array.isArray(node.children);

// Constrói a árvore binária balanceada de um diretório e posiciona as entradas.
// A ordem de `order` é pré-ordem, então order[0] (a raiz da árvore) fica em pos 0.
export function planDirectory(children) {
  const sorted = [...children].sort((a, b) => compareNames(a.name, b.name));
  const order = [];
  const build = (lo, hi) => {
    if (lo >= hi) return null;
    const mid = (lo + hi) >> 1;
    const slot = { node: sorted[mid], nameBytes: latin1Bytes(sorted[mid].name), left: null, right: null, pos: 0 };
    order.push(slot);
    slot.left = build(lo, mid);
    slot.right = build(mid + 1, hi);
    return slot;
  };
  build(0, sorted.length);

  let pos = 0;
  for (const slot of order) {
    const size = entrySize(slot.nameBytes.length);
    if ((pos % SECTOR_SIZE) + size > SECTOR_SIZE) pos = Math.ceil(pos / SECTOR_SIZE) * SECTOR_SIZE;
    slot.pos = pos;
    pos += size;
  }
  return { sorted, order, size: Math.ceil(pos / SECTOR_SIZE) * SECTOR_SIZE };
}

// Aloca setores: descritor no 32, depois todos os diretórios, depois os dados dos arquivos.
export function planImage(root) {
  const dirs = [];
  const files = [];
  const info = new Map();

  const walk = (dir) => {
    const plan = planDirectory(dir.children);
    const record = { node: dir, plan, sector: 0 };
    dirs.push(record);
    info.set(dir, record);
    for (const node of plan.sorted) {
      if (isDirectory(node)) {
        walk(node);
      } else {
        const fileRecord = { node, sector: 0 };
        files.push(fileRecord);
        info.set(node, fileRecord);
      }
    }
  };
  walk(root);

  let next = VOLUME_DESCRIPTOR_SECTOR + 1;
  for (const record of dirs) {
    if (record.plan.size === 0) continue;
    record.sector = next;
    next += record.plan.size / SECTOR_SIZE;
  }
  for (const record of files) {
    const size = record.node.blob.size;
    if (size === 0) continue;
    record.sector = next;
    next += Math.ceil(size / SECTOR_SIZE);
  }
  return { dirs, files, info, totalSectors: next };
}
