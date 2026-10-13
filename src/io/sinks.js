export const CHUNK_BYTES = 8 * 1024 * 1024;

export class CancelledError extends Error {
  constructor() {
    super('Operação cancelada.');
    this.name = 'CancelledError';
  }
}

export const supportsFilePicker = (g = globalThis) => typeof g.showSaveFilePicker === 'function';
export const supportsDirectoryPicker = (g = globalThis) => typeof g.showDirectoryPicker === 'function';

const writableSink = (writable) => ({
  write: (chunk) => writable.write(chunk),
  close: () => writable.close(),
  abort: () => writable.abort(),
});

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Chame direto do handler do clique: showSaveFilePicker exige gesto do usuário.
export async function openFileSink(suggestedName, { g = globalThis, download = downloadBlob } = {}) {
  if (supportsFilePicker(g)) {
    const options = { suggestedName };
    if (suggestedName.toLowerCase().endsWith('.iso')) {
      options.types = [{ description: 'Imagem ISO', accept: { 'application/octet-stream': ['.iso'] } }];
    }
    const handle = await g.showSaveFilePicker(options);
    return writableSink(await handle.createWritable());
  }
  // Sem gravação direta: os blobs ficam apoiados nos arquivos originais, sem copiar para a RAM.
  let chunks = [];
  return {
    write: async (chunk) => { chunks.push(chunk); },
    close: async () => {
      download(new Blob(chunks), suggestedName);
      chunks = [];
    },
    abort: async () => { chunks = []; },
  };
}

export async function writeParts(sink, parts, { onProgress = () => {}, signal } = {}) {
  let done = 0;
  try {
    for (const part of parts) {
      const isBytes = part instanceof Uint8Array;
      const size = isBytes ? part.byteLength : part.size;
      for (let at = 0; at < size; at += CHUNK_BYTES) {
        if (signal?.aborted) throw new CancelledError();
        const end = Math.min(at + CHUNK_BYTES, size);
        await sink.write(isBytes ? part.subarray(at, end) : part.slice(at, end));
        done += end - at;
        onProgress(done);
      }
    }
    if (signal?.aborted) throw new CancelledError();
    await sink.close();
  } catch (error) {
    await Promise.resolve(sink.abort()).catch(() => {});
    throw error;
  }
}

export async function createDirectory(rootHandle, path) {
  let handle = rootHandle;
  for (const part of path.split('/')) handle = await handle.getDirectoryHandle(part, { create: true });
  return handle;
}

export async function writeFileIntoDirectory(rootHandle, path, blob, options = {}) {
  const parts = path.split('/');
  const name = parts.pop();
  const parent = parts.length > 0 ? await createDirectory(rootHandle, parts.join('/')) : rootHandle;
  const handle = await parent.getFileHandle(name, { create: true });
  await writeParts(writableSink(await handle.createWritable()), [blob], options);
}
