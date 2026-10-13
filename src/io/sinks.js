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
  prefersBytes: true, // lê a origem em blocos para a memória: permite repetir leituras e separar erros de leitura/escrita
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Lê um bloco da origem para a memória, repetindo leituras que falham de forma transitória
// (arquivo momentaneamente travado por antivírus/indexador).
async function readChunk(part, at, end, { retries, retryDelayMs }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return new Uint8Array(await part.slice(at, end).arrayBuffer());
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(retryDelayMs);
    }
  }
}

// Em caso de erro, anota em qual etapa falhou ('read' origem, 'write' destino, 'close' finalização),
// qual parte (o Blob de origem) e em que posição, para a interface apontar o culpado.
export async function writeParts(sink, parts, { onProgress = () => {}, signal, retries = 3, retryDelayMs = 250 } = {}) {
  let done = 0;
  let current = null;
  let offset = 0;
  let stage = 'write';
  try {
    for (const part of parts) {
      current = part;
      const isBytes = part instanceof Uint8Array;
      const size = isBytes ? part.byteLength : part.size;
      for (let at = 0; at < size; at += CHUNK_BYTES) {
        if (signal?.aborted) throw new CancelledError();
        offset = at;
        const end = Math.min(at + CHUNK_BYTES, size);
        let chunk;
        if (isBytes) {
          chunk = part.subarray(at, end);
        } else if (sink.prefersBytes) {
          stage = 'read';
          chunk = await readChunk(part, at, end, { retries, retryDelayMs });
        } else {
          chunk = part.slice(at, end); // sem gravação direta: mantém o Blob apoiado no arquivo, sem copiar
        }
        stage = 'write';
        await sink.write(chunk);
        done += end - at;
        onProgress(done);
      }
    }
    if (signal?.aborted) throw new CancelledError();
    stage = 'close';
    await sink.close();
  } catch (error) {
    if (error && typeof error === 'object') {
      error.failedStage = stage;
      error.failedPart = stage === 'close' ? null : current;
      error.failedOffset = offset;
    }
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
