import test from 'node:test';
import assert from 'node:assert/strict';
import { openIso, listEntries, readFile, findRootFile, NotXisoError, CorruptIsoError } from '../src/xdvdfs/reader.js';
import { buildXiso } from '../src/xdvdfs/writer.js';
import { encodeEntry, encodeVolumeDescriptor, latin1Bytes } from '../src/xdvdfs/format.js';
import { file, dir, root, pattern, flatten, toBytes, sparseBlob } from './helpers.js';

const isoOf = (tree) => new Blob(buildXiso(tree, { now: new Date(0) }).parts);

async function assertRoundTrip(tree) {
  const iso = await openIso(isoOf(tree));
  const entries = await listEntries(iso);
  const expected = await flatten(tree);
  assert.deepEqual(entries.map((e) => e.path).sort(), [...expected.keys()].sort());
  for (const entry of entries) {
    const want = expected.get(entry.path);
    if (entry.isDirectory) {
      assert.equal(want, null);
      continue;
    }
    assert.equal(entry.size, want.length);
    assert.deepEqual(new Uint8Array(await readFile(iso, entry).arrayBuffer()), want);
  }
}

test('ida e volta: árvore com subpastas, arquivo vazio, pasta vazia e tamanhos de fronteira', async () => {
  await assertRoundTrip(root(
    file('default.xex', pattern(5000, 1)),
    dir('Media', file('Intro.bmv', pattern(2048, 2)), file('empty.bin', ''), dir('Deep', file('x.dat', pattern(1, 3)))),
    dir('Vazia'),
    file('Café.txt', pattern(2049, 4)),
  ));
});

test('ida e volta: diretório com 300 arquivos (vários setores de diretório)', async () => {
  const files = Array.from({ length: 300 }, (_, i) => file(`file-${String(i).padStart(4, '0')}.bin`, pattern((i % 5) + 1, i)));
  await assertRoundTrip(root(...files));
});

test('findRootFile acha default.xex sem diferenciar caixa e ignora subpastas', async () => {
  const iso = await openIso(isoOf(root(file('DEFAULT.XEX', 'XEX2'), dir('d', file('default.xex', 'x')))));
  const entries = await listEntries(iso);
  assert.equal(findRootFile(entries, 'default.xex').path, 'DEFAULT.XEX');
  assert.equal(findRootFile(entries.filter((e) => e.path !== 'DEFAULT.XEX'), 'default.xex'), null);
});

test('ISO com offset de partição acima de 2 GiB (0x89D80000)', async () => {
  const embedded = await toBytes(buildXiso(root(file('default.xex', 'XEX2....')), { now: new Date(0) }).parts);
  const at = 0x89d80000;
  const blob = sparseBlob(at + embedded.length, [{ at, bytes: embedded }]);
  const iso = await openIso(blob);
  assert.equal(iso.partitionOffset, at);
  const entries = await listEntries(iso);
  assert.deepEqual(entries.map((e) => e.path), ['default.xex']);
  assert.equal(new TextDecoder().decode(await readFile(iso, entries[0]).arrayBuffer()), 'XEX2....');
});

// --- imagens cruas para casos de corrupção ---
function dirWith(...entries) {
  const bytes = new Uint8Array(2048).fill(0xff);
  for (const e of entries) {
    encodeEntry(bytes, e.pos, { left: 0, right: 0, sector: 34, size: 0, attributes: 0x20, ...e, nameBytes: latin1Bytes(e.name) });
  }
  return bytes;
}
function rawIso(dirBytes, { extraRegions = [], size } = {}) {
  const vd = encodeVolumeDescriptor({ rootSector: 33, rootSize: dirBytes.length, filetime: 0n });
  const regions = [{ at: 0x10000, bytes: vd }, { at: 33 * 2048, bytes: dirBytes }, ...extraRegions];
  return sparseBlob(size ?? 33 * 2048 + dirBytes.length, regions);
}

test('arquivo além de 4 GiB é lido com a aritmética correta', async () => {
  const far = 0x300000; // byte 6442450944
  const blob = rawIso(dirWith({ pos: 0, name: 'big.bin', sector: far, size: 4 }), {
    extraRegions: [{ at: far * 2048, bytes: Uint8Array.of(65, 66, 67, 68) }],
    size: far * 2048 + 4,
  });
  const iso = await openIso(blob);
  const [entry] = await listEntries(iso);
  assert.equal(new TextDecoder().decode(await readFile(iso, entry).arrayBuffer()), 'ABCD');
});

test('não é uma ISO Xbox: blob aleatório e blob menor que o descritor', async () => {
  await assert.rejects(openIso(new Blob([new Uint8Array(100)])), NotXisoError);
  await assert.rejects(openIso(new Blob([new Uint8Array(0x10000 + 4096)])), NotXisoError);
});

test('ciclo na árvore de diretório é CorruptIsoError (sem loop infinito)', async () => {
  const dirBytes = dirWith({ pos: 0, name: 'a', right: 4 }, { pos: 16, name: 'b', right: 4 });
  const iso = await openIso(rawIso(dirBytes));
  await assert.rejects(listEntries(iso), CorruptIsoError);
});

test('arquivo que aponta além do fim da imagem é CorruptIsoError', async () => {
  const iso = await openIso(rawIso(dirWith({ pos: 0, name: 'x.bin', sector: 1000, size: 10 })));
  await assert.rejects(listEntries(iso), CorruptIsoError);
});

test('nomes perigosos (.., com barra) são CorruptIsoError', async () => {
  for (const name of ['..', '.', 'a/b', 'a\\b']) {
    const iso = await openIso(rawIso(dirWith({ pos: 0, name })));
    await assert.rejects(listEntries(iso), CorruptIsoError, `nome ${name}`);
  }
});

test('limite de entradas protege contra imagens absurdas', async () => {
  const iso = await openIso(isoOf(root(file('a', 'x'), file('b', 'x'), file('c', 'x'))));
  await assert.rejects(listEntries(iso, { maxEntries: 2 }), CorruptIsoError);
});
