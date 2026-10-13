const DEFAULT_LABEL = 'xbox360';

const stripExtension = (name) => name.replace(/\.[^.]*$/, '') || name;

function ensureDirectory(parent, name) {
  let found = parent.children.find((c) => c.children && c.name === name);
  if (!found) {
    found = { name, children: [] };
    parent.children.push(found);
  }
  return found;
}

// Resultado de <input webkitdirectory> ou <input multiple>.
export function treeFromFileList(files) {
  const root = { name: '', children: [] };
  let label = files.length === 1 ? stripExtension(files[0].name) : DEFAULT_LABEL;
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean);
    if (file.webkitRelativePath) {
      label = parts[0];
      parts.shift(); // o nome da pasta escolhida não entra na ISO
    }
    const name = parts.pop();
    let parent = root;
    for (const part of parts) parent = ensureDirectory(parent, part);
    parent.children.push({ name, blob: file });
  }
  return { root, label };
}

async function nodeFromEntry(entry) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return { name: entry.name, blob: file };
  }
  const reader = entry.createReader();
  const children = [];
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    for (const child of batch) children.push(await nodeFromEntry(child));
  }
  return { name: entry.name, children };
}

// `entries` vêm de dataTransfer.items[i].webkitGetAsEntry(), coletados de forma síncrona no evento drop.
export async function treeFromEntries(entries) {
  const top = [];
  for (const entry of entries) top.push(await nodeFromEntry(entry));
  if (top.length === 1 && top[0].children) {
    return { root: { name: '', children: top[0].children }, label: top[0].name };
  }
  return {
    root: { name: '', children: top },
    label: top.length === 1 ? stripExtension(top[0].name) : DEFAULT_LABEL,
  };
}

export function withDefaultXex(root) {
  if (root.children.length !== 1) return root;
  const [only] = root.children;
  if (only.children || !/\.xex$/i.test(only.name) || only.name.toUpperCase() === 'DEFAULT.XEX') return root;
  return { name: '', children: [{ ...only, name: 'default.xex' }] };
}
