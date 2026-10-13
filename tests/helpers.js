export const pattern = (length, seed = 0) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff);

export function file(name, content = '') {
  const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { name, blob: new Blob([data]) };
}

export const dir = (name, ...children) => ({ name, children });
export const root = (...children) => ({ name: '', children });

export async function toBytes(parts) {
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

// Map caminho -> bytes (arquivo) ou null (diretório)
export async function flatten(tree, prefix = '') {
  const out = new Map();
  for (const node of tree.children) {
    const path = prefix + node.name;
    if (node.children) {
      out.set(path, null);
      for (const [p, b] of await flatten(node, path + '/')) out.set(p, b);
    } else {
      out.set(path, new Uint8Array(await node.blob.arrayBuffer()));
    }
  }
  return out;
}

// Imitação de Blob enorme: só materializa as regiões informadas, o resto é zero.
export function sparseBlob(size, regions) {
  return {
    size,
    slice(start, end) {
      const stop = Math.min(end, size);
      const out = new Uint8Array(Math.max(0, stop - start));
      for (const { at, bytes } of regions) {
        const from = Math.max(at, start);
        const to = Math.min(at + bytes.length, stop);
        if (from < to) out.set(bytes.subarray(from - at, to - at), from - start);
      }
      return { size: out.length, arrayBuffer: async () => out.buffer };
    },
  };
}
