import { MAX_ENTRY_OFFSET_DWORDS, MAX_FILE_SIZE, MAX_NAME_BYTES, latin1Bytes, nameKey } from './format.js';
import { isDirectory, planDirectory } from './layout.js';

export class ValidationError extends Error {
  constructor(problems) {
    super(problems.map((p) => `${p.path}: ${p.message}`).join('\n'));
    this.name = 'ValidationError';
    this.problems = problems;
  }
}

export function validateTree(root) {
  const errors = [];
  if (!isDirectory(root) || root.children.length === 0) {
    errors.push({ path: '/', message: 'Nenhum arquivo para converter.' });
    return { errors };
  }

  const walk = (dir, prefix) => {
    const seen = new Map();
    let namesOk = true;
    for (const node of dir.children) {
      const path = prefix + node.name;
      const bytes = latin1Bytes(node.name);
      if (node.name.length === 0 || /[\\/]/.test(node.name)) {
        errors.push({ path, message: 'Nome inválido (vazio ou com barra).' });
        namesOk = false;
      } else if (!bytes) {
        errors.push({ path, message: 'Nome com caracteres fora de Latin-1, que a ISO não suporta.' });
        namesOk = false;
      } else if (bytes.length > MAX_NAME_BYTES) {
        errors.push({ path, message: `Nome com mais de ${MAX_NAME_BYTES} bytes.` });
        namesOk = false;
      }
      const key = nameKey(node.name);
      if (seen.has(key)) {
        errors.push({ path, message: `Nome duplicado, sem diferenciar maiúsculas/minúsculas ("${seen.get(key)}").` });
        namesOk = false;
      } else {
        seen.set(key, node.name);
      }
      if (isDirectory(node)) walk(node, path + '/');
      else if (node.blob.size > MAX_FILE_SIZE) {
        errors.push({ path, message: 'Arquivo com 4 GiB ou mais não cabe no formato XISO.' });
      }
    }
    if (namesOk) {
      const { order } = planDirectory(dir.children);
      if (order.some((slot) => slot.pos / 4 > MAX_ENTRY_OFFSET_DWORDS)) {
        errors.push({ path: prefix || '/', message: 'Pasta com entradas demais para caber no formato XISO.' });
      }
    }
  };
  walk(root, '');
  return { errors };
}

export async function collectWarnings(root) {
  const warnings = [];
  const xex = root.children.find((n) => !isDirectory(n) && n.name.toUpperCase() === 'DEFAULT.XEX');
  if (!xex) {
    warnings.push('Não há default.xex na raiz: a ISO será criada, mas não vai iniciar em um console.');
    return warnings;
  }
  const head = new TextDecoder('latin1').decode(await xex.blob.slice(0, 4).arrayBuffer());
  if (head !== 'XEX2' && head !== 'XEX1') {
    warnings.push('O default.xex não começa com XEX2/XEX1; pode não ser um XEX válido.');
  }
  return warnings;
}
