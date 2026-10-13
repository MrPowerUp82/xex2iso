import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXiso } from '../src/xdvdfs/writer.js';
import { ValidationError } from '../src/xdvdfs/validate.js';
import { decodeVolumeDescriptor, decodeEntry } from '../src/xdvdfs/format.js';
import { file, dir, root, pattern, toBytes } from './helpers.js';

const NOW = new Date(0);
const sector = (iso, n) => iso.subarray(n * 2048, (n + 1) * 2048);
const summary = (e) => ({ name: e.name, sector: e.sector, size: e.size, attributes: e.attributes, left: e.left, right: e.right });

test('ISO mínima com um default.xex', async () => {
  const content = pattern(3000, 7);
  const { parts, totalSize } = buildXiso(root(file('default.xex', content)), { now: NOW });
  const iso = await toBytes(parts);
  assert.equal(iso.length, totalSize);
  assert.equal(iso.length, 36 * 2048);
  assert.ok(iso.subarray(0, 0x10000).every((b) => b === 0));

  const vd = decodeVolumeDescriptor(sector(iso, 32));
  assert.deepEqual(vd, { rootSector: 33, rootSize: 2048, filetime: 116444736000000000n });

  const entry = decodeEntry(sector(iso, 33), 0);
  assert.deepEqual(summary(entry), { name: 'default.xex', sector: 34, size: 3000, attributes: 0x20, left: 0, right: 0 });
  assert.deepEqual(iso.subarray(34 * 2048, 34 * 2048 + 3000), content);
  assert.ok(iso.subarray(34 * 2048 + 3000, 36 * 2048).every((b) => b === 0), 'padding de dados em zero');
  assert.ok(sector(iso, 33).subarray(28).every((b) => b === 0xff), 'resto do setor do diretório em 0xFF');
});

test('tamanhos de fronteira: 0, 1, 2048 e 2049 bytes', async () => {
  const tree = root(file('a0', ''), file('b1', pattern(1)), file('c2048', pattern(2048)), file('d2049', pattern(2049)));
  const { parts, totalSize } = buildXiso(tree, { now: NOW });
  const iso = await toBytes(parts);
  // raiz(33) + b1(34) + c2048(35) + d2049(36,37) = 38 setores; a0 não consome setor
  assert.equal(totalSize, 38 * 2048);
  assert.equal(iso.length, totalSize);
});

test('arquivo vazio: setor 0 e tamanho 0; entrada de 2048 bytes sem padding', async () => {
  const { parts } = buildXiso(root(file('a.bin', pattern(2048)), file('z.bin', '')), { now: NOW });
  const iso = await toBytes(parts);
  assert.equal(iso.length, 35 * 2048);
  const rootEntry = decodeEntry(sector(iso, 33), 0); // n=2: a raiz da árvore é o 2º nome ordenado
  assert.deepEqual(summary(rootEntry), { name: 'z.bin', sector: 0, size: 0, attributes: 0x20, left: 5, right: 0 });
  const left = decodeEntry(sector(iso, 33), 20);
  assert.deepEqual(summary(left), { name: 'a.bin', sector: 34, size: 2048, attributes: 0x20, left: 0, right: 0 });
});

test('subdiretório: atributo de diretório, setor e tamanho do diretório', async () => {
  const { parts } = buildXiso(root(dir('media', file('a.bin', 'x')), dir('vazio')), { now: NOW });
  const iso = await toBytes(parts);
  const vd = decodeVolumeDescriptor(sector(iso, 32));
  const entries = [0, 20, 40].map((p) => decodeEntry(sector(iso, vd.rootSector), p)).filter(Boolean);
  const media = entries.find((e) => e.name === 'media');
  const vazio = entries.find((e) => e.name === 'vazio');
  assert.equal(media.attributes, 0x10);
  assert.equal(media.size, 2048);
  assert.equal(media.sector, 34);
  assert.equal(vazio.attributes, 0x10);
  assert.equal(vazio.size, 0);
  assert.equal(vazio.sector, 0);
});

test('mesma entrada, mesma saída (determinístico com `now` fixo)', async () => {
  const make = () => buildXiso(root(file('x.bin', pattern(5000)), dir('d', file('y', pattern(10)))), { now: NOW });
  assert.deepEqual(await toBytes(make().parts), await toBytes(make().parts));
});

test('árvore inválida lança ValidationError', () => {
  assert.throws(() => buildXiso(root()), ValidationError);
  assert.throws(() => buildXiso(root(file('日本', 'x'))), ValidationError);
});
