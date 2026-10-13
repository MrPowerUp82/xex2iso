import test from 'node:test';
import assert from 'node:assert/strict';
import { treeFromFileList, treeFromEntries, withDefaultXex } from '../src/io/sources.js';

const names = (node) => node.children.map((c) => c.name);

test('treeFromFileList: pasta escolhida vira a raiz (sem o nome da pasta)', () => {
  const f = (path) => ({ name: path.split('/').pop(), webkitRelativePath: path, size: 1 });
  const { root, label } = treeFromFileList([f('Halo3/default.xex'), f('Halo3/media/a.bin'), f('Halo3/media/b.bin')]);
  assert.equal(label, 'Halo3');
  assert.deepEqual(names(root).sort(), ['default.xex', 'media']);
  assert.equal(root.children.find((c) => c.name === 'media').children.length, 2);
});

test('treeFromFileList: arquivos soltos ficam na raiz e o rótulo é o nome sem extensão', () => {
  const { root, label } = treeFromFileList([{ name: 'game.xex', webkitRelativePath: '', size: 1 }]);
  assert.deepEqual(names(root), ['game.xex']);
  assert.equal(label, 'game');
  assert.equal(treeFromFileList([{ name: 'a.xex', webkitRelativePath: '' }, { name: 'b.xex', webkitRelativePath: '' }]).label, 'xbox360');
});

// FileSystemEntry falsos
const fileEntry = (name) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok({ name, size: 1 }) });
const dirEntry = (name, children, batchSize = 2) => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader() {
    let at = 0;
    return {
      readEntries(ok) {
        const batch = children.slice(at, at + batchSize);
        at += batchSize;
        ok(batch);
      },
    };
  },
});

test('treeFromEntries: uma pasta solta é promovida a raiz e lê todos os lotes de readEntries', async () => {
  const entry = dirEntry('Jogo', [fileEntry('default.xex'), fileEntry('b'), fileEntry('c'), dirEntry('sub', [fileEntry('d')])]);
  const { root, label } = await treeFromEntries([entry]);
  assert.equal(label, 'Jogo');
  assert.deepEqual(names(root), ['default.xex', 'b', 'c', 'sub']);
  assert.deepEqual(names(root.children[3]), ['d']);
});

test('treeFromEntries: um arquivo solto e vários itens', async () => {
  const single = await treeFromEntries([fileEntry('app.xex')]);
  assert.equal(single.label, 'app');
  assert.deepEqual(names(single.root), ['app.xex']);
  const many = await treeFromEntries([fileEntry('a.xex'), dirEntry('d', [])]);
  assert.equal(many.label, 'xbox360');
  assert.deepEqual(names(many.root), ['a.xex', 'd']);
});

test('withDefaultXex: renomeia só um .xex isolado', () => {
  const blob = { size: 1 };
  const one = { name: '', children: [{ name: 'Game.XEX', blob }] };
  const renamed = withDefaultXex(one);
  assert.notEqual(renamed, one);
  assert.deepEqual(names(renamed), ['default.xex']);
  assert.equal(one.children[0].name, 'Game.XEX', 'não muta a entrada');

  const already = { name: '', children: [{ name: 'DEFAULT.xex', blob }] };
  assert.equal(withDefaultXex(already), already);
  const two = { name: '', children: [{ name: 'a.xex', blob }, { name: 'b.xex', blob }] };
  assert.equal(withDefaultXex(two), two);
  const folder = { name: '', children: [{ name: 'x.xex', children: [] }] };
  assert.equal(withDefaultXex(folder), folder);
  const other = { name: '', children: [{ name: 'readme.txt', blob }] };
  assert.equal(withDefaultXex(other), other);
});
