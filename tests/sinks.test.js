import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_BYTES, CancelledError, supportsFilePicker, supportsDirectoryPicker,
  openFileSink, writeParts, createDirectory, writeFileIntoDirectory,
} from '../src/io/sinks.js';

function fakeWritable(record) {
  return {
    write: async (chunk) => { record.chunks.push(chunk); },
    close: async () => { record.closed = true; },
    abort: async () => { record.aborted = true; },
  };
}

function fakeDirectory() {
  const dirs = new Map();
  const files = new Map();
  return {
    dirs,
    files,
    async getDirectoryHandle(name) {
      if (!dirs.has(name)) dirs.set(name, fakeDirectory());
      return dirs.get(name);
    },
    async getFileHandle(name) {
      const record = { chunks: [], closed: false, aborted: false };
      files.set(name, record);
      return { createWritable: async () => fakeWritable(record) };
    },
  };
}

const sizeOf = (chunk) => chunk.byteLength ?? chunk.size;

test('detecção de suporte', () => {
  assert.equal(supportsFilePicker({}), false);
  assert.equal(supportsFilePicker({ showSaveFilePicker() {} }), true);
  assert.equal(supportsDirectoryPicker({}), false);
  assert.equal(supportsDirectoryPicker({ showDirectoryPicker() {} }), true);
});

test('writeParts: grava em blocos, reporta progresso e fecha', async () => {
  const record = { chunks: [], closed: false, aborted: false };
  const sink = fakeWritable(record);
  const progress = [];
  const total = CHUNK_BYTES * 2 + 5;
  await writeParts(sink, [new Uint8Array(10), new Blob([new Uint8Array(total)])], { onProgress: (n) => progress.push(n) });
  assert.equal(record.closed, true);
  assert.equal(record.chunks.reduce((sum, c) => sum + sizeOf(c), 0), total + 10);
  assert.equal(record.chunks.length, 1 + 3);
  assert.equal(progress.at(-1), total + 10);
});

test('writeParts: cancelamento aborta o sink e lança CancelledError', async () => {
  const record = { chunks: [], closed: false, aborted: false };
  const sink = fakeWritable(record);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(writeParts(sink, [new Uint8Array(10)], { signal: controller.signal }), CancelledError);
  assert.equal(record.aborted, true);
  assert.equal(record.closed, false);
});

test('writeParts: falha de escrita aborta o sink', async () => {
  const record = { chunks: [], closed: false, aborted: false };
  const sink = { ...fakeWritable(record), write: async () => { throw new Error('disco cheio'); } };
  await assert.rejects(writeParts(sink, [new Uint8Array(10)]), /disco cheio/);
  assert.equal(record.aborted, true);
});

test('openFileSink sem seletor de arquivo: acumula e entrega via download', async () => {
  const downloads = [];
  const sink = await openFileSink('jogo.iso', { g: {}, download: (blob, name) => downloads.push({ blob, name }) });
  await writeParts(sink, [new Uint8Array([1, 2, 3]), new Blob([new Uint8Array([4, 5])])]);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, 'jogo.iso');
  assert.deepEqual([...new Uint8Array(await downloads[0].blob.arrayBuffer())], [1, 2, 3, 4, 5]);
});

test('openFileSink com seletor de arquivo: grava no handle escolhido', async () => {
  const record = { chunks: [], closed: false, aborted: false };
  let asked;
  const g = {
    showSaveFilePicker: async (options) => {
      asked = options;
      return { createWritable: async () => fakeWritable(record) };
    },
  };
  const sink = await openFileSink('jogo.iso', { g });
  await writeParts(sink, [new Uint8Array([9])]);
  assert.equal(asked.suggestedName, 'jogo.iso');
  assert.equal(record.closed, true);
  assert.equal(record.chunks.length, 1);
});

test('createDirectory e writeFileIntoDirectory criam subpastas e gravam o conteúdo', async () => {
  const rootDir = fakeDirectory();
  await createDirectory(rootDir, 'Vazia');
  assert.ok(rootDir.dirs.has('Vazia'));

  const data = new Uint8Array(CHUNK_BYTES + 3).fill(7);
  const progress = [];
  await writeFileIntoDirectory(rootDir, 'media/deep/x.bin', new Blob([data]), { onProgress: (n) => progress.push(n) });
  const record = rootDir.dirs.get('media').dirs.get('deep').files.get('x.bin');
  assert.equal(record.closed, true);
  assert.equal(record.chunks.reduce((sum, c) => sum + sizeOf(c), 0), data.length);
  assert.equal(progress.at(-1), data.length);

  await writeFileIntoDirectory(rootDir, 'raiz.bin', new Blob([]));
  assert.equal(rootDir.files.get('raiz.bin').closed, true);
});
