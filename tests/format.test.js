import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTOR_SIZE, MAGIC, latin1Bytes, latin1String, compareNames, entrySize, sectorToOffset,
  dateToFiletime, encodeVolumeDescriptor, decodeVolumeDescriptor, encodeEntry, decodeEntry,
} from '../src/xdvdfs/format.js';

test('descritor de volume: tamanho, magic nas duas posições e ida e volta', () => {
  const bytes = encodeVolumeDescriptor({ rootSector: 33, rootSize: 4096, filetime: 123n });
  assert.equal(bytes.length, SECTOR_SIZE);
  assert.equal(latin1String(bytes.subarray(0, 20)), MAGIC);
  assert.equal(latin1String(bytes.subarray(0x7ec, 0x7ec + 20)), MAGIC);
  assert.deepEqual(decodeVolumeDescriptor(bytes), { rootSector: 33, rootSize: 4096, filetime: 123n });
});

test('descritor de volume: magic ausente em qualquer ponta devolve null', () => {
  const ok = encodeVolumeDescriptor({ rootSector: 33, rootSize: 2048, filetime: 0n });
  const noHead = ok.slice(); noHead[0] = 0;
  const noTail = ok.slice(); noTail[0x7ec] = 0;
  assert.equal(decodeVolumeDescriptor(noHead), null);
  assert.equal(decodeVolumeDescriptor(noTail), null);
  assert.equal(decodeVolumeDescriptor(new Uint8Array(100)), null);
});

test('entrySize alinha a 4 bytes', () => {
  assert.equal(entrySize(1), 16);
  assert.equal(entrySize(2), 16);
  assert.equal(entrySize(3), 20);
  assert.equal(entrySize(11), 28);
});

test('entrada de diretório: ida e volta', () => {
  const buf = new Uint8Array(64).fill(0xff);
  encodeEntry(buf, 8, { left: 5, right: 9, sector: 1234, size: 99999, attributes: 0x20, nameBytes: latin1Bytes('default.xex') });
  assert.deepEqual(decodeEntry(buf, 8), { left: 5, right: 9, sector: 1234, size: 99999, attributes: 0x20, name: 'default.xex' });
});

test('decodeEntry devolve null para padding 0xFF e para entrada truncada', () => {
  assert.equal(decodeEntry(new Uint8Array(32).fill(0xff), 0), null);
  const buf = new Uint8Array(20);
  buf[13] = 200; // nome de 200 bytes não cabe
  assert.equal(decodeEntry(buf, 0), null);
  assert.equal(decodeEntry(new Uint8Array(10), 0), null);
});

test('latin1Bytes aceita acentos e rejeita fora de Latin-1', () => {
  assert.deepEqual([...latin1Bytes('é')], [0xe9]);
  assert.equal(latin1Bytes('日本'), null);
});

test('compareNames ignora maiúsculas/minúsculas', () => {
  assert.equal(compareNames('abc', 'ABC'), 0);
  assert.ok(compareNames('a', 'B') < 0);
  assert.ok(compareNames('B', 'a') > 0);
});

test('sectorToOffset usa aritmética que passa de 2^32', () => {
  assert.equal(sectorToOffset(0x300000), 6442450944);
});

test('dateToFiletime: época Unix', () => {
  assert.equal(dateToFiletime(new Date(0)), 116444736000000000n);
});
