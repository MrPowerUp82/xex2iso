import test from 'node:test';
import assert from 'node:assert/strict';
import { planDirectory, planImage } from '../src/xdvdfs/layout.js';
import { entrySize } from '../src/xdvdfs/format.js';
import { file, dir, root } from './helpers.js';

test('planDirectory: raiz da árvore em pos 0 e percurso em ordem é a ordenação sem diferenciar caixa', () => {
  const plan = planDirectory(['zeta', 'Alpha', 'beta', 'Gamma', 'delta'].map((n) => file(n, 'x')));
  const expected = ['Alpha', 'beta', 'delta', 'Gamma', 'zeta'];
  assert.equal(plan.order[0].pos, 0);
  assert.deepEqual(plan.sorted.map((n) => n.name), expected);
  const visited = [];
  (function inorder(slot) {
    if (!slot) return;
    inorder(slot.left);
    visited.push(slot.node.name);
    inorder(slot.right);
  })(plan.order[0]);
  assert.deepEqual(visited, expected);
});

test('planDirectory: 300 entradas — nenhuma cruza setor, alinhadas a 4, árvore balanceada', () => {
  const children = Array.from({ length: 300 }, (_, i) => file(`file-${String(i).padStart(4, '0')}.bin`, 'x'));
  const plan = planDirectory(children);
  assert.equal(plan.order.length, 300);
  assert.equal(plan.size % 2048, 0);
  assert.ok(plan.size > 2048);
  for (const slot of plan.order) {
    assert.ok((slot.pos % 2048) + entrySize(slot.nameBytes.length) <= 2048, `entrada cruza setor em ${slot.pos}`);
    assert.equal(slot.pos % 4, 0);
  }
  const depth = (slot) => (slot ? 1 + Math.max(depth(slot.left), depth(slot.right)) : 0);
  assert.ok(depth(plan.order[0]) <= 9);
});

test('planDirectory: diretório vazio tem tamanho 0', () => {
  const plan = planDirectory([]);
  assert.equal(plan.size, 0);
  assert.deepEqual(plan.order, []);
});

test('planImage: descritor no 32, diretórios, depois arquivos; vazios ficam no setor 0', () => {
  const tree = root(file('default.xex', 'x'.repeat(3000)), dir('media', file('a.bin', 'y')), dir('empty'));
  const [xex, media, empty] = [tree.children[0], tree.children[1], tree.children[2]];
  const image = planImage(tree);
  assert.equal(image.dirs[0].node, tree);
  assert.equal(image.dirs[0].sector, 33);
  assert.equal(image.info.get(empty).sector, 0);
  assert.equal(image.info.get(media).sector, 34);
  assert.equal(image.info.get(xex).sector, 35); // 3000 bytes = 2 setores
  assert.equal(image.info.get(media.children[0]).sector, 37);
  assert.equal(image.totalSectors, 38);
});
