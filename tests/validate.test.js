import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTree, collectWarnings, ValidationError } from '../src/xdvdfs/validate.js';
import { file, dir, root } from './helpers.js';

test('árvore válida não tem erros', () => {
  assert.deepEqual(validateTree(root(file('default.xex', 'XEX2'), dir('Média', file('café.bin', 'x')))).errors, []);
});

test('raiz vazia é erro', () => {
  assert.equal(validateTree(root()).errors.length, 1);
});

test('nome fora de Latin-1 é erro e aponta o caminho', () => {
  const errors = validateTree(root(dir('d', file('日本.bin', 'x')))).errors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'd/日本.bin');
});

test('nome com mais de 255 bytes, vazio ou com barra é erro', () => {
  assert.equal(validateTree(root(file('a'.repeat(256), 'x'))).errors.length, 1);
  assert.equal(validateTree(root(file('a'.repeat(255), 'x'))).errors.length, 0);
  assert.equal(validateTree(root(file('', 'x'))).errors.length, 1);
  assert.equal(validateTree(root(file('a/b', 'x'))).errors.length, 1);
});

test('nomes que só diferem em maiúsculas/minúsculas no mesmo diretório são erro; em diretórios diferentes não', () => {
  assert.equal(validateTree(root(file('A.bin', 'x'), file('a.BIN', 'x'))).errors.length, 1);
  assert.equal(validateTree(root(dir('x', file('a.bin', 'x')), dir('y', file('A.bin', 'x')))).errors.length, 0);
});

test('arquivo com 4 GiB ou mais é erro; 4 GiB - 1 é aceito', () => {
  assert.equal(validateTree(root({ name: 'big.bin', blob: { size: 2 ** 32 } })).errors.length, 1);
  assert.equal(validateTree(root({ name: 'ok.bin', blob: { size: 2 ** 32 - 1 } })).errors.length, 0);
});

test('diretório grande demais para offsets u16 é erro', () => {
  const children = Array.from({ length: 20000 }, (_, i) => file(i.toString(36).padStart(3, '0'), ''));
  const errors = validateTree(root(...children)).errors;
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /entradas demais/);
});

test('ValidationError junta os problemas', () => {
  const err = new ValidationError([{ path: 'a', message: 'ruim' }]);
  assert.equal(err.problems.length, 1);
  assert.match(err.message, /a: ruim/);
});

test('collectWarnings: sem default.xex, com magic errado e válido', async () => {
  assert.equal((await collectWarnings(root(file('outro.bin', 'x')))).length, 1);
  assert.equal((await collectWarnings(root(file('default.xex', 'ABCDxxxx')))).length, 1);
  assert.equal((await collectWarnings(root(file('DEFAULT.XEX', 'XEX2xxxx')))).length, 0);
  assert.equal((await collectWarnings(root(file('default.xex', 'XEX1xxxx')))).length, 0);
});

test('ß.txt e SS.txt não são duplicados; A.txt e a.txt são', () => {
  assert.equal(validateTree(root(file('ß.txt', 'x'), file('SS.txt', 'x'))).errors.length, 0);
  assert.equal(validateTree(root(file('A.txt', 'x'), file('a.txt', 'x'))).errors.length, 1);
});
