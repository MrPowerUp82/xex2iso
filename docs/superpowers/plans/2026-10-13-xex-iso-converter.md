# Conversor XEX ⇄ ISO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um site estático para o GitHub Pages que converte pasta/`.xex` em ISO Xbox 360 (XISO) e extrai `default.xex` ou todos os arquivos de uma ISO, tudo no navegador.

**Architecture:** Módulos ES puros, sem build. O núcleo (`src/xdvdfs/`) é testável em Node: `format.js` (bytes), `layout.js` + `validate.js` + `writer.js` (gravador) e `reader.js` (leitor). A E/S do navegador (`src/io/`) e a interface (`src/ui/`) ficam por cima. Arquivos grandes passam por `Blob.slice()` e são gravados em fluxo, sem carregar na RAM.

**Tech Stack:** JavaScript (ES modules), HTML/CSS, `node:test` para testes (Node ≥ 20), sem dependências em tempo de execução.

**Spec:** `docs/superpowers/specs/2026-10-13-xex-iso-converter-design.md`

## Global Constraints

Valores copiados da spec. Valem para todas as tarefas.

- Setor = 2048 bytes. Inteiros little-endian. Descritor de volume no setor 32 (byte `0x10000`), com o magic `MICROSOFT*XBOX*MEDIA` em `0x000` e em `0x7EC`.
- Nome de entrada: Latin-1, no máximo 255 bytes. Arquivo: menos de 4 GiB (campo de tamanho `u32`).
- Sem dependências em tempo de execução, sem bundler, sem etapa de build. Caminhos de assets relativos (funciona em `usuario.github.io/repositorio/`).
- Nenhum dado do usuário sai da máquina: nenhuma requisição de rede com os arquivos.
- Interface em pt-BR, somente. Sem Web Worker. O site não remove nem recria assinaturas e não faz parse/patch de XEX.
- Publicação: GitHub Pages "Deploy from a branch" (`main`, pasta `/`).
- **Desvios deliberados da spec (seção 4):** o gravador é dividido em `layout.js` + `validate.js` + `writer.js`. `compareNames` mora em `format.js`. `showDirectoryPicker` não é usado como fonte de entrada, porque `<input webkitdirectory>` já cobre pasta em todos os navegadores. `showDirectoryPicker` continua sendo usado como destino da extração.
- Todo commit termina com o trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Constantes a confirmar contra ISOs ou fontes de referência (a spec manda não assumi-las): `PARTITION_OFFSET_CANDIDATES`; diretório vazio e arquivo vazio com setor 0 e tamanho 0; padding de entrada com `0xFF`; ordenação por `toUpperCase()`.

## Review Focus

Entradas e condições que a spec implica mas que nenhuma tarefa testaria por conta própria. Cada linha tem o teste na tarefa indicada.

1. **Imagem acima de 2 GiB e arquivo além de 4 GiB:** um leitor com `<<` de 32 bits leria o lugar errado em silêncio. O esperado é aritmética de ponto flutuante (`sector * 2048`). Teste na Tarefa 4 (blob esparso).
2. **ISO corrompida ou maliciosa** (ciclo na árvore, ponteiro além do fim, nome `..` ou com `/`): erro claro, sem loop infinito e sem escrever fora da pasta escolhida. Teste na Tarefa 4.
3. **Diretório com milhares de entradas:** nenhuma entrada cruza setor, e acima do limite do offset `u16` o gravador recusa em vez de gerar ISO corrompida. Testes na Tarefa 2.
4. **Nomes:** só diferem em maiúsculas/minúsculas (bloquear), acentuados em Latin-1 (aceitar), CJK (bloquear), e nomes parecidos com HTML (`<img onerror=…>.bin`) exibidos como texto, nunca como HTML. Testes na Tarefa 2 e verificação manual na Tarefa 8.
5. **Tamanhos de fronteira:** arquivo de 0 bytes, de 1 byte, de exatamente 2048 e de 2049 bytes. O esperado é alinhamento correto, sem setor sobrando e sem setor faltando. Teste na Tarefa 3.

---

## Estrutura de arquivos

```
package.json                  scripts: test
.gitignore
README.md
index.html
styles.css
src/xdvdfs/format.js          constantes, codificação/decodificação, compareNames
src/xdvdfs/layout.js          planDirectory, planImage (árvore binária + alocação de setores)
src/xdvdfs/validate.js        validateTree, collectWarnings, ValidationError
src/xdvdfs/writer.js          buildXiso(root) -> { parts, totalSize }
src/xdvdfs/reader.js          openIso, listEntries, readFile, findRootFile
src/io/sources.js             treeFromFileList, treeFromEntries, withDefaultXex
src/io/sinks.js               openFileSink, writeParts, writeFileIntoDirectory, createDirectory
src/ui/app.js                 abas, drag-and-drop, progresso, mensagens
scripts/serve.mjs             servidor estático local (porta 8080)
scripts/make-fixtures.mjs     gera ISOs de teste em fixtures/
.claude/launch.json           configuração do preview
tests/helpers.js
tests/format.test.js  layout.test.js  validate.test.js  writer.test.js
tests/reader.test.js  sources.test.js  sinks.test.js
```

Modelo de árvore usado por todos os módulos:

```js
// Diretório: { name: string, children: Node[] }   (o name da raiz é ignorado)
// Arquivo:   { name: string, blob: Blob }          (tamanho = blob.size)
```

---

### Task 1: Scaffold e `format.js`

**Files:**
- Create: `package.json`, `.gitignore`, `src/xdvdfs/format.js`, `tests/format.test.js`

**Interfaces:**
- Consumes: nada.
- Produces (de `format.js`):
  - Constantes: `SECTOR_SIZE`, `MAGIC`, `VOLUME_DESCRIPTOR_SECTOR`, `VOLUME_DESCRIPTOR_OFFSET`, `ATTR_DIRECTORY`, `ATTR_ARCHIVE`, `MAX_FILE_SIZE`, `MAX_NAME_BYTES`, `MAX_ENTRY_OFFSET_DWORDS`, `PARTITION_OFFSET_CANDIDATES`.
  - `latin1Bytes(text) -> Uint8Array | null`, `latin1String(bytes) -> string`, `compareNames(a, b) -> -1|0|1`.
  - `entrySize(nameLength) -> number`, `sectorToOffset(sector) -> number`, `dateToFiletime(date) -> bigint`.
  - `encodeVolumeDescriptor({rootSector, rootSize, filetime}) -> Uint8Array(2048)`.
  - `decodeVolumeDescriptor(bytes) -> {rootSector, rootSize, filetime} | null`.
  - `encodeEntry(bytes, offset, {left, right, sector, size, attributes, nameBytes})` (escreve no lugar).
  - `decodeEntry(bytes, offset) -> {left, right, sector, size, attributes, name} | null`.

- [ ] **Step 1: Verificar o ambiente e criar o repositório**

```bash
node --version
git init
```
Expected: `v20.x` ou superior. Se for menor que 18, pare e avise o usuário.

- [ ] **Step 2: Criar `package.json` e `.gitignore`**

`package.json`:
```json
{
  "name": "xex2iso",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "serve": "node scripts/serve.mjs"
  }
}
```

`.gitignore`:
```
node_modules/
fixtures/
```

- [ ] **Step 3: Escrever o teste que falha** — `tests/format.test.js`

```js
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
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `Cannot find module '../src/xdvdfs/format.js'`.

- [ ] **Step 5: Implementar** — `src/xdvdfs/format.js`

```js
export const SECTOR_SIZE = 2048;
export const MAGIC = 'MICROSOFT*XBOX*MEDIA';
export const VOLUME_DESCRIPTOR_SECTOR = 32;
export const VOLUME_DESCRIPTOR_OFFSET = VOLUME_DESCRIPTOR_SECTOR * SECTOR_SIZE;
export const ATTR_DIRECTORY = 0x10;
export const ATTR_ARCHIVE = 0x20;
export const MAX_FILE_SIZE = 0xffffffff;
export const MAX_NAME_BYTES = 255;
export const MAX_ENTRY_OFFSET_DWORDS = 0xffff;
// A CONFIRMAR contra ISOs/fontes de referência (ver spec, seção 3).
export const PARTITION_OFFSET_CANDIDATES = [0, 0x18300000, 0x0fd90000, 0x02080000, 0x89d80000];

const MAGIC_TAIL_OFFSET = 0x7ec;
const ENTRY_HEADER = 14;
const FILETIME_UNIX_EPOCH = 116444736000000000n;

export function latin1Bytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) return null;
    out[i] = code;
  }
  return out;
}

export function latin1String(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

export function compareNames(a, b) {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

export const entrySize = (nameLength) => (ENTRY_HEADER + nameLength + 3) & ~3;

// Multiplicação (não <<): imagens e posições passam de 2^32 bytes.
export const sectorToOffset = (sector) => sector * SECTOR_SIZE;

export const dateToFiletime = (date) => BigInt(date.getTime()) * 10000n + FILETIME_UNIX_EPOCH;

export function encodeVolumeDescriptor({ rootSector, rootSize, filetime }) {
  const bytes = new Uint8Array(SECTOR_SIZE);
  const view = new DataView(bytes.buffer);
  const magic = latin1Bytes(MAGIC);
  bytes.set(magic, 0);
  view.setUint32(0x14, rootSector, true);
  view.setUint32(0x18, rootSize, true);
  view.setBigUint64(0x1c, filetime, true);
  bytes.set(magic, MAGIC_TAIL_OFFSET);
  return bytes;
}

export function decodeVolumeDescriptor(bytes) {
  if (bytes.length < SECTOR_SIZE) return null;
  const magic = latin1Bytes(MAGIC);
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i] || bytes[MAGIC_TAIL_OFFSET + i] !== magic[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    rootSector: view.getUint32(0x14, true),
    rootSize: view.getUint32(0x18, true),
    filetime: view.getBigUint64(0x1c, true),
  };
}

export function encodeEntry(bytes, offset, { left, right, sector, size, attributes, nameBytes }) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(offset, left, true);
  view.setUint16(offset + 2, right, true);
  view.setUint32(offset + 4, sector, true);
  view.setUint32(offset + 8, size, true);
  bytes[offset + 12] = attributes;
  bytes[offset + 13] = nameBytes.length;
  bytes.set(nameBytes, offset + ENTRY_HEADER);
}

export function decodeEntry(bytes, offset) {
  if (offset + ENTRY_HEADER > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(offset, true) === 0xffffffff) return null;
  const nameLength = bytes[offset + 13];
  if (offset + ENTRY_HEADER + nameLength > bytes.length) return null;
  return {
    left: view.getUint16(offset, true),
    right: view.getUint16(offset + 2, true),
    sector: view.getUint32(offset + 4, true),
    size: view.getUint32(offset + 8, true),
    attributes: bytes[offset + 12],
    name: latin1String(bytes.subarray(offset + ENTRY_HEADER, offset + ENTRY_HEADER + nameLength)),
  };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test`
Expected: PASS, 9 testes.

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore src/xdvdfs/format.js tests/format.test.js
git commit -m "feat: estrutura do projeto e primitivas do formato XDVDFS" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Layout e validação

**Files:**
- Create: `tests/helpers.js`, `src/xdvdfs/layout.js`, `src/xdvdfs/validate.js`, `tests/layout.test.js`, `tests/validate.test.js`

**Interfaces:**
- Consumes: de `format.js`: `SECTOR_SIZE`, `VOLUME_DESCRIPTOR_SECTOR`, `MAX_FILE_SIZE`, `MAX_NAME_BYTES`, `MAX_ENTRY_OFFSET_DWORDS`, `entrySize`, `latin1Bytes`, `compareNames`.
- Produces:
  - `layout.js`: `isDirectory(node) -> boolean`; `planDirectory(children) -> { sorted: Node[], order: Slot[], size: number }` onde `Slot = { node, nameBytes, left: Slot|null, right: Slot|null, pos: number }` e `order[0]` é a raiz da árvore, com `pos` 0; `planImage(root) -> { dirs: DirRec[], files: FileRec[], info: Map<Node, DirRec|FileRec>, totalSectors: number }` com `DirRec = { node, plan, sector }` e `FileRec = { node, sector }`. `dirs[0]` é a raiz, no setor 33.
  - `validate.js`: `class ValidationError extends Error { problems: {path, message}[] }`; `validateTree(root) -> { errors: {path, message}[] }`; `collectWarnings(root) -> Promise<string[]>`.
  - `tests/helpers.js`: `pattern(length, seed)`, `file(name, content)`, `dir(name, ...children)`, `root(...children)`, `toBytes(parts)`, `flatten(tree)`, `sparseBlob(size, regions)`.

- [ ] **Step 1: Criar os helpers de teste** — `tests/helpers.js`

```js
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
```

- [ ] **Step 2: Escrever os testes de layout que falham** — `tests/layout.test.js`

```js
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/layout.test.js`
Expected: FAIL com `Cannot find module '../src/xdvdfs/layout.js'`.

- [ ] **Step 4: Implementar** — `src/xdvdfs/layout.js`

```js
import { SECTOR_SIZE, VOLUME_DESCRIPTOR_SECTOR, compareNames, entrySize, latin1Bytes } from './format.js';

export const isDirectory = (node) => Array.isArray(node.children);

// Constrói a árvore binária balanceada de um diretório e posiciona as entradas.
// A ordem de `order` é pré-ordem, então order[0] (a raiz da árvore) fica em pos 0.
export function planDirectory(children) {
  const sorted = [...children].sort((a, b) => compareNames(a.name, b.name));
  const order = [];
  const build = (lo, hi) => {
    if (lo >= hi) return null;
    const mid = (lo + hi) >> 1;
    const slot = { node: sorted[mid], nameBytes: latin1Bytes(sorted[mid].name), left: null, right: null, pos: 0 };
    order.push(slot);
    slot.left = build(lo, mid);
    slot.right = build(mid + 1, hi);
    return slot;
  };
  build(0, sorted.length);

  let pos = 0;
  for (const slot of order) {
    const size = entrySize(slot.nameBytes.length);
    if ((pos % SECTOR_SIZE) + size > SECTOR_SIZE) pos = Math.ceil(pos / SECTOR_SIZE) * SECTOR_SIZE;
    slot.pos = pos;
    pos += size;
  }
  return { sorted, order, size: Math.ceil(pos / SECTOR_SIZE) * SECTOR_SIZE };
}

// Aloca setores: descritor no 32, depois todos os diretórios, depois os dados dos arquivos.
export function planImage(root) {
  const dirs = [];
  const files = [];
  const info = new Map();

  const walk = (dir) => {
    const plan = planDirectory(dir.children);
    const record = { node: dir, plan, sector: 0 };
    dirs.push(record);
    info.set(dir, record);
    for (const node of plan.sorted) {
      if (isDirectory(node)) {
        walk(node);
      } else {
        const fileRecord = { node, sector: 0 };
        files.push(fileRecord);
        info.set(node, fileRecord);
      }
    }
  };
  walk(root);

  let next = VOLUME_DESCRIPTOR_SECTOR + 1;
  for (const record of dirs) {
    if (record.plan.size === 0) continue;
    record.sector = next;
    next += record.plan.size / SECTOR_SIZE;
  }
  for (const record of files) {
    const size = record.node.blob.size;
    if (size === 0) continue;
    record.sector = next;
    next += Math.ceil(size / SECTOR_SIZE);
  }
  return { dirs, files, info, totalSectors: next };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/layout.test.js`
Expected: PASS, 4 testes.

- [ ] **Step 6: Escrever os testes de validação que falham** — `tests/validate.test.js`

```js
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
```
- [ ] **Step 7: Rodar e ver falhar**

Run: `node --test tests/validate.test.js`
Expected: FAIL com `Cannot find module '../src/xdvdfs/validate.js'`.

- [ ] **Step 8: Implementar** — `src/xdvdfs/validate.js`

```js
import { MAX_ENTRY_OFFSET_DWORDS, MAX_FILE_SIZE, MAX_NAME_BYTES, latin1Bytes } from './format.js';
import { isDirectory, planDirectory } from './layout.js';

export class ValidationError extends Error {
  constructor(problems) {
    super(problems.map((p) => `${p.path}: ${p.message}`).join('\n'));
    this.name = 'ValidationError';
    this.problems = problems;
  }
}

export function validateTree(root) {
  const errors = [];
  if (!isDirectory(root) || root.children.length === 0) {
    errors.push({ path: '/', message: 'Nenhum arquivo para converter.' });
    return { errors };
  }

  const walk = (dir, prefix) => {
    const seen = new Map();
    let namesOk = true;
    for (const node of dir.children) {
      const path = prefix + node.name;
      const bytes = latin1Bytes(node.name);
      if (node.name.length === 0 || /[\\/]/.test(node.name)) {
        errors.push({ path, message: 'Nome inválido (vazio ou com barra).' });
        namesOk = false;
      } else if (!bytes) {
        errors.push({ path, message: 'Nome com caracteres fora de Latin-1, que a ISO não suporta.' });
        namesOk = false;
      } else if (bytes.length > MAX_NAME_BYTES) {
        errors.push({ path, message: `Nome com mais de ${MAX_NAME_BYTES} bytes.` });
        namesOk = false;
      }
      const key = node.name.toUpperCase();
      if (seen.has(key)) {
        errors.push({ path, message: `Nome duplicado, sem diferenciar maiúsculas/minúsculas ("${seen.get(key)}").` });
        namesOk = false;
      } else {
        seen.set(key, node.name);
      }
      if (isDirectory(node)) walk(node, path + '/');
      else if (node.blob.size > MAX_FILE_SIZE) {
        errors.push({ path, message: 'Arquivo com 4 GiB ou mais não cabe no formato XISO.' });
      }
    }
    if (namesOk) {
      const { order } = planDirectory(dir.children);
      if (order.some((slot) => slot.pos / 4 > MAX_ENTRY_OFFSET_DWORDS)) {
        errors.push({ path: prefix || '/', message: 'Pasta com entradas demais para caber no formato XISO.' });
      }
    }
  };
  walk(root, '');
  return { errors };
}

export async function collectWarnings(root) {
  const warnings = [];
  const xex = root.children.find((n) => !isDirectory(n) && n.name.toUpperCase() === 'DEFAULT.XEX');
  if (!xex) {
    warnings.push('Não há default.xex na raiz: a ISO será criada, mas não vai iniciar em um console.');
    return warnings;
  }
  const head = new TextDecoder('latin1').decode(await xex.blob.slice(0, 4).arrayBuffer());
  if (head !== 'XEX2' && head !== 'XEX1') {
    warnings.push('O default.xex não começa com XEX2/XEX1; pode não ser um XEX válido.');
  }
  return warnings;
}
```

- [ ] **Step 9: Rodar tudo e ver passar**

Run: `npm test`
Expected: PASS (format, layout, validate).

- [ ] **Step 10: Commit**

```bash
git add tests/helpers.js tests/layout.test.js tests/validate.test.js src/xdvdfs/layout.js src/xdvdfs/validate.js
git commit -m "feat: layout da XISO e validação da árvore de entrada" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Gravador (`writer.js`)

**Files:**
- Create: `src/xdvdfs/writer.js`, `tests/writer.test.js`

**Interfaces:**
- Consumes: `planImage`, `isDirectory` (layout); `validateTree`, `ValidationError` (validate); `encodeVolumeDescriptor`, `encodeEntry`, `dateToFiletime`, `SECTOR_SIZE`, `ATTR_DIRECTORY`, `ATTR_ARCHIVE` (format); `toBytes`, `file`, `dir`, `root`, `pattern` (helpers).
- Produces: `buildXiso(root, { now?: Date }) -> { parts: (Uint8Array|Blob)[], totalSize: number }`. Lança `ValidationError` se a árvore for inválida. `new Blob(parts).size === totalSize`.

- [ ] **Step 1: Escrever o teste que falha** — `tests/writer.test.js`

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/writer.test.js`
Expected: FAIL com `Cannot find module '../src/xdvdfs/writer.js'`.

- [ ] **Step 3: Implementar** — `src/xdvdfs/writer.js`

```js
import {
  ATTR_ARCHIVE, ATTR_DIRECTORY, SECTOR_SIZE, VOLUME_DESCRIPTOR_SECTOR,
  dateToFiletime, encodeEntry, encodeVolumeDescriptor,
} from './format.js';
import { isDirectory, planImage } from './layout.js';
import { ValidationError, validateTree } from './validate.js';

const BEFORE_DESCRIPTOR = new Uint8Array(VOLUME_DESCRIPTOR_SECTOR * SECTOR_SIZE);

function serializeDirectory(record, info) {
  const bytes = new Uint8Array(record.plan.size).fill(0xff);
  for (const slot of record.plan.order) {
    const child = info.get(slot.node);
    const directory = isDirectory(slot.node);
    encodeEntry(bytes, slot.pos, {
      left: slot.left ? slot.left.pos / 4 : 0,
      right: slot.right ? slot.right.pos / 4 : 0,
      sector: child.sector,
      size: directory ? child.plan.size : slot.node.blob.size,
      attributes: directory ? ATTR_DIRECTORY : ATTR_ARCHIVE,
      nameBytes: slot.nameBytes,
    });
  }
  return bytes;
}

// Devolve as partes da imagem na ordem: zeros até o setor 32, descritor, diretórios, dados dos arquivos.
export function buildXiso(root, { now = new Date() } = {}) {
  const { errors } = validateTree(root);
  if (errors.length > 0) throw new ValidationError(errors);

  const image = planImage(root);
  const rootRecord = image.dirs[0];
  const parts = [
    BEFORE_DESCRIPTOR,
    encodeVolumeDescriptor({
      rootSector: rootRecord.sector,
      rootSize: rootRecord.plan.size,
      filetime: dateToFiletime(now),
    }),
  ];
  for (const record of image.dirs) {
    if (record.plan.size > 0) parts.push(serializeDirectory(record, image.info));
  }
  for (const record of image.files) {
    const size = record.node.blob.size;
    if (size === 0) continue;
    parts.push(record.node.blob);
    const padding = (SECTOR_SIZE - (size % SECTOR_SIZE)) % SECTOR_SIZE;
    if (padding > 0) parts.push(new Uint8Array(padding));
  }
  return { parts, totalSize: image.totalSectors * SECTOR_SIZE };
}
```

- [ ] **Step 4: Rodar tudo e ver passar**

Run: `npm test`
Expected: PASS. Se o teste "subdiretório" falhar por posições de entrada diferentes de 0/20/40, imprima `entrySize` de cada nome e ajuste as posições do teste. Não mude a implementação por causa disso.

- [ ] **Step 5: Commit**

```bash
git add src/xdvdfs/writer.js tests/writer.test.js
git commit -m "feat: gravador de XISO (buildXiso)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Leitor (`reader.js`)

**Files:**
- Create: `src/xdvdfs/reader.js`, `tests/reader.test.js`

**Interfaces:**
- Consumes: de `format.js`: `ATTR_DIRECTORY`, `PARTITION_OFFSET_CANDIDATES`, `SECTOR_SIZE`, `VOLUME_DESCRIPTOR_OFFSET`, `compareNames`, `decodeEntry`, `decodeVolumeDescriptor`, `sectorToOffset`. O leitor só usa `blob.size` e `blob.slice(a, b).arrayBuffer()`, então aceita `Blob`, `File` e os blobs esparsos dos testes.
- Produces:
  - `class NotXisoError`, `class CorruptIsoError` (ambos `extends Error`, com `name` definido).
  - `openIso(blob) -> Promise<Iso>`, com `Iso = { blob, partitionOffset, rootSector, rootSize, filetime }`.
  - `listEntries(iso, { maxEntries? }) -> Promise<Entry[]>`, com `Entry = { path, name, isDirectory, size, sector }`. Uma pasta aparece antes do seu conteúdo.
  - `readFile(iso, entry) -> Blob` (slice, sem cópia).
  - `findRootFile(entries, name) -> Entry | null` (raiz, sem diferenciar maiúsculas de minúsculas).

- [ ] **Step 1: Escrever o teste que falha** — `tests/reader.test.js`

```js
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

test('ida e volta: diretório com 300 arquivos (várias setores de diretório)', async () => {
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/reader.test.js`
Expected: FAIL com `Cannot find module '../src/xdvdfs/reader.js'`.

- [ ] **Step 3: Implementar** — `src/xdvdfs/reader.js`

```js
import {
  ATTR_DIRECTORY, PARTITION_OFFSET_CANDIDATES, SECTOR_SIZE, VOLUME_DESCRIPTOR_OFFSET,
  compareNames, decodeEntry, decodeVolumeDescriptor, sectorToOffset,
} from './format.js';

const MAX_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 64;

export class NotXisoError extends Error {
  constructor(message = 'Este arquivo não é uma ISO Xbox válida.') {
    super(message);
    this.name = 'NotXisoError';
  }
}

export class CorruptIsoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CorruptIsoError';
  }
}

async function readBytes(blob, start, length) {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

export async function openIso(blob) {
  for (const partitionOffset of PARTITION_OFFSET_CANDIDATES) {
    const at = partitionOffset + VOLUME_DESCRIPTOR_OFFSET;
    if (at + SECTOR_SIZE > blob.size) continue;
    const descriptor = decodeVolumeDescriptor(await readBytes(blob, at, SECTOR_SIZE));
    if (descriptor) return { blob, partitionOffset, ...descriptor };
  }
  throw new NotXisoError();
}

function assertInside(iso, sector, size, what) {
  const end = iso.partitionOffset + sectorToOffset(sector) + size;
  if (end > iso.blob.size) throw new CorruptIsoError(`${what} aponta para além do fim da imagem.`);
}

function assertSafeName(name) {
  if (name === '' || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new CorruptIsoError(`Nome de entrada inválido na imagem: ${JSON.stringify(name)}.`);
  }
}

async function readDirectory(iso, sector, size, counter) {
  if (size > MAX_DIRECTORY_BYTES) throw new CorruptIsoError('Diretório grande demais.');
  assertInside(iso, sector, size, 'Diretório');
  const data = await readBytes(iso.blob, iso.partitionOffset + sectorToOffset(sector), size);
  const visited = new Set();
  const pending = [0];
  const entries = [];
  while (pending.length > 0) {
    const offset = pending.pop();
    if (visited.has(offset)) throw new CorruptIsoError('Árvore de diretório com ciclo.');
    visited.add(offset);
    if (++counter.seen > counter.max) throw new CorruptIsoError('Imagem com entradas demais.');
    const entry = decodeEntry(data, offset);
    if (!entry) throw new CorruptIsoError('Entrada de diretório inválida.');
    entries.push(entry);
    if (entry.left) pending.push(entry.left * 4);
    if (entry.right) pending.push(entry.right * 4);
  }
  return entries.sort((a, b) => compareNames(a.name, b.name));
}

export async function listEntries(iso, { maxEntries = 1_000_000 } = {}) {
  const counter = { seen: 0, max: maxEntries };
  const result = [];

  const walk = async (sector, size, prefix, depth) => {
    if (depth > MAX_DEPTH) throw new CorruptIsoError('Pastas aninhadas demais.');
    if (size === 0) return;
    for (const raw of await readDirectory(iso, sector, size, counter)) {
      assertSafeName(raw.name);
      const path = prefix + raw.name;
      if ((raw.attributes & ATTR_DIRECTORY) !== 0) {
        result.push({ path, name: raw.name, isDirectory: true, size: 0, sector: raw.sector });
        await walk(raw.sector, raw.size, path + '/', depth + 1);
      } else {
        if (raw.size > 0) assertInside(iso, raw.sector, raw.size, `O arquivo ${path}`);
        result.push({ path, name: raw.name, isDirectory: false, size: raw.size, sector: raw.sector });
      }
    }
  };
  await walk(iso.rootSector, iso.rootSize, '', 0);
  return result;
}

export function readFile(iso, entry) {
  const start = iso.partitionOffset + sectorToOffset(entry.sector);
  return iso.blob.slice(start, start + entry.size);
}

export function findRootFile(entries, name) {
  const wanted = name.toUpperCase();
  return entries.find((e) => !e.isDirectory && e.path.toUpperCase() === wanted) ?? null;
}
```

- [ ] **Step 4: Rodar tudo e ver passar**

Run: `npm test`
Expected: PASS. Se "arquivo vazio" na ida e volta falhar, confira `readFile` com `sector: 0` e `size: 0` (deve devolver um blob vazio).

- [ ] **Step 5: Commit**

```bash
git add src/xdvdfs/reader.js tests/reader.test.js
git commit -m "feat: leitor de XISO com detecção de offset de partição e proteção contra ISO corrompida" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fontes de entrada (`sources.js`)

**Files:**
- Create: `src/io/sources.js`, `tests/sources.test.js`

**Interfaces:**
- Consumes: nada de outros módulos.
- Produces:
  - `treeFromFileList(files) -> { root, label }`: `files` é uma lista de objetos com `name`, `webkitRelativePath` e comportamento de `Blob`. A primeira parte de `webkitRelativePath` (a pasta escolhida) é removida.
  - `treeFromEntries(entries) -> Promise<{ root, label }>`: `entries` são `FileSystemEntry` (de `webkitGetAsEntry()`). Uma única pasta solta tem o conteúdo promovido a raiz.
  - `withDefaultXex(root) -> root`: se a raiz tem exatamente um arquivo `.xex` que não se chama `default.xex`, devolve uma nova raiz com ele renomeado. Caso contrário, devolve a mesma raiz.
  - `label`: nome sugerido para a ISO, sem extensão (`xbox360` quando não há nome óbvio).

- [ ] **Step 1: Escrever o teste que falha** — `tests/sources.test.js`

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/sources.test.js`
Expected: FAIL com `Cannot find module '../src/io/sources.js'`.

- [ ] **Step 3: Implementar** — `src/io/sources.js`

```js
const DEFAULT_LABEL = 'xbox360';

const stripExtension = (name) => name.replace(/\.[^.]*$/, '') || name;

function ensureDirectory(parent, name) {
  let found = parent.children.find((c) => c.children && c.name === name);
  if (!found) {
    found = { name, children: [] };
    parent.children.push(found);
  }
  return found;
}

// Resultado de <input webkitdirectory> ou <input multiple>.
export function treeFromFileList(files) {
  const root = { name: '', children: [] };
  let label = files.length === 1 ? stripExtension(files[0].name) : DEFAULT_LABEL;
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean);
    if (file.webkitRelativePath) {
      label = parts[0];
      parts.shift(); // o nome da pasta escolhida não entra na ISO
    }
    const name = parts.pop();
    let parent = root;
    for (const part of parts) parent = ensureDirectory(parent, part);
    parent.children.push({ name, blob: file });
  }
  return { root, label };
}

async function nodeFromEntry(entry) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return { name: entry.name, blob: file };
  }
  const reader = entry.createReader();
  const children = [];
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    for (const child of batch) children.push(await nodeFromEntry(child));
  }
  return { name: entry.name, children };
}

// `entries` vêm de dataTransfer.items[i].webkitGetAsEntry(), coletados de forma síncrona no evento drop.
export async function treeFromEntries(entries) {
  const top = [];
  for (const entry of entries) top.push(await nodeFromEntry(entry));
  if (top.length === 1 && top[0].children) {
    return { root: { name: '', children: top[0].children }, label: top[0].name };
  }
  return {
    root: { name: '', children: top },
    label: top.length === 1 ? stripExtension(top[0].name) : DEFAULT_LABEL,
  };
}

export function withDefaultXex(root) {
  if (root.children.length !== 1) return root;
  const [only] = root.children;
  if (only.children || !/\.xex$/i.test(only.name) || only.name.toUpperCase() === 'DEFAULT.XEX') return root;
  return { name: '', children: [{ ...only, name: 'default.xex' }] };
}
```

- [ ] **Step 4: Rodar tudo e ver passar**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/io/sources.js tests/sources.test.js
git commit -m "feat: fontes de entrada (lista de arquivos, FileSystemEntry) e renomeio para default.xex" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Destinos de saída (`sinks.js`)

**Files:**
- Create: `src/io/sinks.js`, `tests/sinks.test.js`

**Interfaces:**
- Consumes: nada de outros módulos.
- Produces:
  - `class CancelledError`; constante `CHUNK_BYTES` (8 MiB).
  - `supportsFilePicker(g?)`, `supportsDirectoryPicker(g?)`: `g` é o objeto global (padrão `globalThis`).
  - `downloadBlob(blob, name)`: DOM, sem teste automatizado.
  - `openFileSink(suggestedName, { g?, download? }) -> Promise<Sink>`, com `Sink = { write(chunk), close(), abort() }`. Deve ser chamado direto no handler do clique (o seletor de arquivo exige gesto do usuário).
  - `writeParts(sink, parts, { onProgress?(doneBytes), signal? }) -> Promise<void>`: grava `Uint8Array`/`Blob` em blocos de `CHUNK_BYTES`, fecha o sink no fim e o aborta se houver erro ou cancelamento (lança `CancelledError`).
  - `createDirectory(rootHandle, path) -> Promise<DirectoryHandle>`.
  - `writeFileIntoDirectory(rootHandle, path, blob, { onProgress?, signal? }) -> Promise<void>`.

- [ ] **Step 1: Escrever o teste que falha** — `tests/sinks.test.js`

```js
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
  const sink = { write: (c) => fakeWritable(record).write(c), close: () => fakeWritable(record).close(), abort: () => fakeWritable(record).abort() };
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/sinks.test.js`
Expected: FAIL com `Cannot find module '../src/io/sinks.js'`.

- [ ] **Step 3: Implementar** — `src/io/sinks.js`

```js
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
```

- [ ] **Step 4: Rodar tudo e ver passar**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/io/sinks.js tests/sinks.test.js
git commit -m "feat: destinos de saída com gravação em blocos, cancelamento e fallback por download" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Interface (HTML, CSS, `app.js`) e scripts de apoio

**Files:**
- Create: `index.html`, `styles.css`, `src/ui/app.js`, `scripts/serve.mjs`, `scripts/make-fixtures.mjs`, `.claude/launch.json`

**Interfaces:**
- Consumes: tudo das tarefas 1–6: `buildXiso`, `validateTree`, `collectWarnings`, `ValidationError`, `openIso`, `listEntries`, `readFile`, `findRootFile`, `NotXisoError`, `CorruptIsoError`, `treeFromFileList`, `treeFromEntries`, `withDefaultXex`, `openFileSink`, `writeParts`, `writeFileIntoDirectory`, `createDirectory`, `supportsFilePicker`, `supportsDirectoryPicker`, `CancelledError`.
- Produces: o site funcional. Parâmetro de URL `?fallback` força o caminho sem gravação direta (usado em testes e útil para quem quer um download comum).

A interface não tem teste automatizado, porque depende do DOM. A verificação é manual, na Tarefa 8. Regra firme: **nomes de arquivo vindos de ISO ou de pasta só entram no DOM com `textContent`, nunca com `innerHTML`**.

- [ ] **Step 1: Criar `index.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>XEX ⇄ ISO</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <header>
      <h1>XEX ⇄ ISO</h1>
      <p>Crie uma ISO de Xbox 360 a partir de uma pasta de jogo ou de um <code>.xex</code>, ou extraia os arquivos de uma ISO. Tudo roda no seu navegador: nenhum arquivo é enviado para a internet.</p>
    </header>

    <p id="browser-notice" class="message warn" hidden></p>

    <div class="tabs" role="tablist">
      <button id="tab-create" role="tab" aria-controls="panel-create" aria-selected="true">Criar ISO</button>
      <button id="tab-extract" role="tab" aria-controls="panel-extract" aria-selected="false">Extrair ISO</button>
    </div>

    <section id="panel-create" role="tabpanel" aria-labelledby="tab-create">
      <div id="drop-create" class="drop">
        <p>Arraste aqui uma <strong>pasta</strong> de jogo ou um arquivo <code>.xex</code></p>
        <div class="actions">
          <label class="button">Escolher pasta<input id="pick-folder" type="file" webkitdirectory hidden></label>
          <label class="button">Escolher arquivos<input id="pick-files" type="file" multiple hidden></label>
        </div>
      </div>
      <div id="create-summary" hidden>
        <p id="create-info"></p>
        <label id="rename-row" hidden><input id="rename-default" type="checkbox" checked> Renomear para <code>default.xex</code></label>
        <button id="convert" class="primary" type="button">Criar ISO</button>
      </div>
    </section>

    <section id="panel-extract" role="tabpanel" aria-labelledby="tab-extract" hidden>
      <div id="drop-extract" class="drop">
        <p>Arraste aqui uma <strong>ISO</strong> do Xbox 360</p>
        <div class="actions">
          <label class="button">Escolher ISO<input id="pick-iso" type="file" accept=".iso" hidden></label>
        </div>
      </div>
      <div id="extract-summary" hidden>
        <p id="extract-info"></p>
        <div class="actions">
          <button id="extract-xex" type="button">Extrair default.xex</button>
          <button id="extract-all" type="button">Extrair tudo…</button>
        </div>
        <table>
          <thead><tr><th>Caminho</th><th class="num">Tamanho</th><th></th></tr></thead>
          <tbody id="file-rows"></tbody>
        </table>
      </div>
    </section>

    <div id="progress-box" hidden>
      <progress id="progress" max="1" value="0"></progress>
      <span id="progress-label"></span>
      <button id="cancel" type="button">Cancelar</button>
    </div>

    <div id="messages" aria-live="polite"></div>

    <footer>
      <p>Use apenas arquivos seus. A ISO gerada só roda em console desbloqueado ou em emulador; este site não remove nem recria assinaturas.</p>
    </footer>
  </main>
  <script type="module" src="src/ui/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Criar `styles.css`**

```css
:root {
  --bg: #f6f7f9; --fg: #1b1f24; --muted: #5b6573; --card: #ffffff; --line: #d4d9e0;
  --accent: #107c10; --accent-fg: #ffffff; --warn: #8a5a00; --warn-bg: #fff4d6;
  --error: #a4262c; --error-bg: #fde7e9; --ok: #0b6a0b; --ok-bg: #e3f4e3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171c; --fg: #e8ebef; --muted: #9aa5b4; --card: #1e232b; --line: #343b46;
    --accent: #2ea043; --accent-fg: #ffffff; --warn: #f2c15b; --warn-bg: #3a2f12;
    --error: #ff9aa2; --error-bg: #3d1a1d; --ok: #7ee787; --ok-bg: #14301a;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
h1 { margin: 0 0 .25rem; }
header p, footer p { color: var(--muted); }
code { background: var(--card); border: 1px solid var(--line); border-radius: 4px; padding: 0 .3em; }
.tabs { display: flex; gap: .5rem; margin: 1.5rem 0 1rem; border-bottom: 1px solid var(--line); }
.tabs button { background: none; border: 0; border-bottom: 3px solid transparent; padding: .6rem 1rem; color: var(--muted); font: inherit; cursor: pointer; }
.tabs button[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); }
.drop { border: 2px dashed var(--line); border-radius: 10px; background: var(--card); padding: 2rem 1rem; text-align: center; }
.drop.over { border-color: var(--accent); }
.actions { display: flex; gap: .5rem; justify-content: center; flex-wrap: wrap; margin: .5rem 0; }
button, .button { font: inherit; padding: .5rem 1rem; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--fg); cursor: pointer; }
button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, .button:focus-within, .tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#create-summary, #extract-summary { margin-top: 1rem; }
table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid var(--line); word-break: break-all; }
th.num, td.num { text-align: right; white-space: nowrap; }
#progress-box { display: flex; align-items: center; gap: .75rem; margin-top: 1rem; }
#progress { flex: 1; }
.message { border-radius: 6px; padding: .5rem .75rem; margin: .5rem 0; }
.message.warn { background: var(--warn-bg); color: var(--warn); }
.message.error { background: var(--error-bg); color: var(--error); }
.message.ok { background: var(--ok-bg); color: var(--ok); }
.message.info { background: var(--card); border: 1px solid var(--line); }
[hidden] { display: none !important; }
```

- [ ] **Step 3: Criar `src/ui/app.js`**

```js
import { buildXiso } from '../xdvdfs/writer.js';
import { ValidationError, validateTree, collectWarnings } from '../xdvdfs/validate.js';
import { openIso, listEntries, readFile, findRootFile, NotXisoError, CorruptIsoError } from '../xdvdfs/reader.js';
import { treeFromFileList, treeFromEntries, withDefaultXex } from '../io/sources.js';
import {
  openFileSink, writeParts, writeFileIntoDirectory, createDirectory,
  supportsFilePicker, supportsDirectoryPicker, CancelledError,
} from '../io/sinks.js';

const $ = (id) => document.getElementById(id);
// ?fallback força o caminho sem gravação direta (download comum).
const g = new URLSearchParams(location.search).has('fallback') ? {} : globalThis;

// ---------- utilidades de interface ----------
function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

// Cada grupo: { kind: 'error'|'warn'|'ok'|'info', lines: string[] }. Sempre textContent.
function showMessages(...groups) {
  const box = $('messages');
  box.replaceChildren();
  for (const { kind, lines } of groups) {
    for (const line of lines) {
      const p = document.createElement('p');
      p.className = `message ${kind}`;
      p.textContent = line;
      box.append(p);
    }
  }
}

function setProgress(done, total) {
  $('progress').max = Math.max(total, 1);
  $('progress').value = done;
  $('progress-label').textContent = `${formatBytes(done)} / ${formatBytes(total)}`;
}

let currentTask = null;

async function runTask(job) {
  const controller = new AbortController();
  currentTask = controller;
  $('progress-box').hidden = false;
  setProgress(0, 1);
  try {
    await job(controller.signal, setProgress);
  } catch (error) {
    reportError(error);
  } finally {
    currentTask = null;
    $('progress-box').hidden = true;
  }
}

function reportError(error) {
  if (error?.name === 'AbortError' || error instanceof CancelledError) {
    showMessages({ kind: 'info', lines: ['Operação cancelada.'] });
  } else if (error instanceof ValidationError) {
    showMessages({ kind: 'error', lines: error.problems.map((p) => `${p.path}: ${p.message}`) });
  } else if (error instanceof NotXisoError || error instanceof CorruptIsoError) {
    showMessages({ kind: 'error', lines: [error.message] });
  } else {
    console.error(error);
    showMessages({ kind: 'error', lines: [`Erro inesperado: ${error?.message ?? error}`] });
  }
}

$('cancel').addEventListener('click', () => currentTask?.abort());

// ---------- abas ----------
function selectTab(name) {
  for (const id of ['create', 'extract']) {
    const selected = id === name;
    $(`tab-${id}`).setAttribute('aria-selected', String(selected));
    $(`panel-${id}`).hidden = !selected;
  }
  showMessages();
}
$('tab-create').addEventListener('click', () => selectTab('create'));
$('tab-extract').addEventListener('click', () => selectTab('extract'));

// ---------- aviso de navegador ----------
if (!supportsFilePicker(g)) {
  $('browser-notice').hidden = false;
  $('browser-notice').textContent =
    'Este navegador não grava direto no disco. A conversão funciona, mas imagens muito grandes dependem do download do navegador. Para jogos completos, prefira Chrome ou Edge.';
}
if (!supportsDirectoryPicker(g)) $('extract-all').hidden = true;

// ---------- arrastar e soltar ----------
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

function wireDrop(zone, onDrop) {
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('over');
    // Os FileSystemEntry só valem de forma síncrona dentro do evento: colete antes de qualquer await.
    const entries = [...event.dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
    const files = [...event.dataTransfer.files];
    onDrop(entries, files);
  });
}

// ---------- criar ISO ----------
let created = null; // { root, label }

const summarize = (root) => {
  let files = 0;
  let bytes = 0;
  (function walk(dir) {
    for (const node of dir.children) {
      if (node.children) walk(node);
      else { files++; bytes += node.blob.size; }
    }
  })(root);
  return { files, bytes };
};

const effectiveRoot = () => (created && $('rename-default').checked ? withDefaultXex(created.root) : created?.root);

async function refreshCreate() {
  if (!created) return;
  const root = effectiveRoot();
  const { errors } = validateTree(root);
  const warnings = errors.length > 0 ? [] : await collectWarnings(root);
  const { files, bytes } = summarize(root);
  $('create-summary').hidden = false;
  $('create-info').textContent = `${created.label}: ${files} arquivo(s), ${formatBytes(bytes)}.`;
  $('rename-row').hidden = withDefaultXex(created.root) === created.root;
  $('convert').disabled = errors.length > 0;
  showMessages(
    { kind: 'error', lines: errors.map((e) => `${e.path}: ${e.message}`) },
    { kind: 'warn', lines: warnings },
  );
}

async function setCreateSource(source) {
  created = source;
  $('rename-default').checked = true;
  await refreshCreate();
}

wireDrop($('drop-create'), async (entries, files) => {
  try {
    await setCreateSource(entries.length > 0 ? await treeFromEntries(entries) : treeFromFileList(files));
  } catch (error) {
    reportError(error);
  }
});
$('pick-folder').addEventListener('change', (event) => setCreateSource(treeFromFileList([...event.target.files])));
$('pick-files').addEventListener('change', (event) => setCreateSource(treeFromFileList([...event.target.files])));
$('rename-default').addEventListener('change', refreshCreate);

$('convert').addEventListener('click', () => runTask(async (signal, onProgress) => {
  const root = effectiveRoot();
  const { errors } = validateTree(root);
  if (errors.length > 0) throw new ValidationError(errors);
  // O seletor de arquivo precisa ser aberto antes de qualquer espera longa (gesto do usuário).
  const sink = await openFileSink(`${created.label}.iso`, { g });
  const { parts, totalSize } = buildXiso(root);
  await writeParts(sink, parts, { signal, onProgress: (done) => onProgress(done, totalSize) });
  showMessages({ kind: 'ok', lines: [`ISO criada (${formatBytes(totalSize)}).`] });
}));

// ---------- extrair ISO ----------
let opened = null; // { iso, entries }

async function setIsoSource(file) {
  try {
    const iso = await openIso(file);
    const entries = await listEntries(iso);
    opened = { iso, entries };
    renderEntries();
    showMessages();
  } catch (error) {
    opened = null;
    $('extract-summary').hidden = true;
    reportError(error);
  }
}

function saveEntry(entry) {
  return runTask(async (signal, onProgress) => {
    const sink = await openFileSink(entry.name, { g });
    await writeParts(sink, [readFile(opened.iso, entry)], { signal, onProgress: (done) => onProgress(done, entry.size) });
    showMessages({ kind: 'ok', lines: [`${entry.name} salvo.`] });
  });
}

function renderEntries() {
  const { entries } = opened;
  const files = entries.filter((e) => !e.isDirectory);
  const total = files.reduce((sum, e) => sum + e.size, 0);
  $('extract-summary').hidden = false;
  $('extract-info').textContent = `${files.length} arquivo(s), ${formatBytes(total)}.`;
  $('extract-xex').disabled = !findRootFile(entries, 'default.xex');

  const rows = $('file-rows');
  rows.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement('tr');
    const path = document.createElement('td');
    path.textContent = entry.isDirectory ? `${entry.path}/` : entry.path;
    const size = document.createElement('td');
    size.className = 'num';
    size.textContent = entry.isDirectory ? '' : formatBytes(entry.size);
    const action = document.createElement('td');
    if (!entry.isDirectory) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Baixar';
      button.addEventListener('click', () => saveEntry(entry));
      action.append(button);
    }
    row.append(path, size, action);
    rows.append(row);
  }
}

wireDrop($('drop-extract'), (_entries, files) => { if (files[0]) setIsoSource(files[0]); });
$('pick-iso').addEventListener('change', (event) => { if (event.target.files[0]) setIsoSource(event.target.files[0]); });

$('extract-xex').addEventListener('click', () => {
  const entry = findRootFile(opened.entries, 'default.xex');
  if (entry) saveEntry(entry);
});

$('extract-all').addEventListener('click', () => runTask(async (signal, onProgress) => {
  const target = await g.showDirectoryPicker({ mode: 'readwrite' });
  const files = opened.entries.filter((e) => !e.isDirectory);
  const total = files.reduce((sum, e) => sum + e.size, 0);
  for (const entry of opened.entries.filter((e) => e.isDirectory)) await createDirectory(target, entry.path);
  let base = 0;
  for (const entry of files) {
    await writeFileIntoDirectory(target, entry.path, readFile(opened.iso, entry), {
      signal,
      onProgress: (done) => onProgress(base + done, total),
    });
    base += entry.size;
  }
  showMessages({ kind: 'ok', lines: [`${files.length} arquivo(s) extraído(s).`] });
}));
```

- [ ] **Step 4: Criar `scripts/serve.mjs`**

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname));
    if (path.endsWith('/') || path.endsWith('\\')) path += 'index.html';
    const file = join(root, path);
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(8080, '127.0.0.1', () => console.log('http://127.0.0.1:8080'));
```

- [ ] **Step 5: Criar `.claude/launch.json`**

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "xex2iso",
      "runtimeExecutable": "node",
      "runtimeArgs": ["scripts/serve.mjs"],
      "port": 8080
    }
  ]
}
```

- [ ] **Step 6: Criar `scripts/make-fixtures.mjs`**

```js
import { mkdir, writeFile } from 'node:fs/promises';
import { buildXiso } from '../src/xdvdfs/writer.js';

const bytes = (length, seed = 0) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff);
const file = (name, content) => ({ name, blob: new Blob([content]) });
const dir = (name, ...children) => ({ name, children });
const xex = () => new Uint8Array([0x58, 0x45, 0x58, 0x32, ...bytes(4092, 9)]); // "XEX2" + dados

async function save(name, tree) {
  const { parts } = buildXiso(tree);
  await writeFile(`fixtures/${name}`, Buffer.from(await new Blob(parts).arrayBuffer()));
  console.log(`fixtures/${name}`);
}

await mkdir('fixtures', { recursive: true });
await save('sample.iso', {
  name: '',
  children: [file('default.xex', xex()), dir('media', file('intro.bin', bytes(300000, 1)), dir('deep', file('x.dat', bytes(5, 2)))), dir('vazia'), file('Café.txt', 'olá')],
});
await save('xex-only.iso', { name: '', children: [file('default.xex', xex())] });
await save('no-xex.iso', { name: '', children: [file('readme.txt', 'sem default.xex')] });
await save('hostile-names.iso', {
  name: '',
  children: [file('default.xex', xex()), file('<img src=x onerror=alert(1)>.bin', 'x'), file('&amp;<b>bold</b>.txt', 'y')],
});
await writeFile('fixtures/not-an-iso.iso', Buffer.from(bytes(200000)));
console.log('fixtures/not-an-iso.iso');
```

- [ ] **Step 7: Verificar que o app carrega e os testes seguem verdes**

Run: `npm test && node scripts/make-fixtures.mjs`
Expected: testes passam; cinco arquivos listados em `fixtures/`.

- [ ] **Step 8: Commit**

```bash
git add index.html styles.css src/ui/app.js scripts .claude/launch.json
git commit -m "feat: interface do site, servidor local e fixtures de teste manual" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verificação no navegador, README e publicação

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: o site completo (Tarefa 7) e `fixtures/` (gerado por `node scripts/make-fixtures.mjs`).
- Produces: README e a lista de verificações que comprovam os critérios de sucesso da spec.

- [ ] **Step 1: Subir o servidor e abrir a página**

Use `preview_start` com o nome `xex2iso` (de `.claude/launch.json`). Navegue para `http://127.0.0.1:8080/`.
Expected: a página abre com as abas "Criar ISO" e "Extrair ISO", sem erros no console (`read_console_messages` com `onlyErrors`).

- [ ] **Step 2: Extrair, via `?fallback`, em `http://127.0.0.1:8080/?fallback`**

Use `javascript_tool` para injetar uma ISO no input e conferir a interface. Os arquivos de `fixtures/` ficam no disco local, então primeiro sirva-os: copie `fixtures/` para dentro de uma pasta servida (por exemplo, `cp -r fixtures dist-test` e remova depois) ou gere bytes direto no navegador com os módulos:

```js
const { buildXiso } = await import('/src/xdvdfs/writer.js');
const mk = (n, c) => ({ name: n, blob: new Blob([c]) });
const tree = { name: '', children: [mk('default.xex', 'XEX2....'), { name: 'media', children: [mk('a.bin', 'abc')] }, mk('<img src=x onerror=alert(1)>.bin', 'x')] };
const iso = new File(new Blob(buildXiso(tree).parts).slice(), 'teste.iso');
const input = document.getElementById('pick-iso');
const dt = new DataTransfer(); dt.items.add(iso); input.files = dt.files;
document.getElementById('tab-extract').click();
input.dispatchEvent(new Event('change'));
```
Expected: a tabela lista `default.xex`, `media/`, `media/a.bin` e o arquivo com nome de HTML **como texto** (nenhum `alert` dispara; confira com `find`/`read_page` que não existe elemento `<img>` na tabela). O botão "Extrair default.xex" está habilitado. Em `?fallback`, "Extrair tudo…" fica oculto.

- [ ] **Step 3: Baixar um arquivo no caminho de fallback**

No mesmo estado, capture o download sem diálogo:

```js
let captured;
HTMLAnchorElement.prototype.click = function () { captured = { href: this.href, name: this.download }; };
document.getElementById('extract-xex').click();
await new Promise((r) => setTimeout(r, 500));
const text = await (await fetch(captured.href)).text();
({ name: captured.name, text });
```
Expected: `{ name: 'default.xex', text: 'XEX2....' }`.

- [ ] **Step 4: Criar ISO a partir de arquivos soltos, pelo navegador**

Na aba "Criar ISO", injete um `.xex` solto:

```js
const input = document.getElementById('pick-files');
const dt = new DataTransfer();
dt.items.add(new File(['XEX2....'], 'Game.xex'));
input.files = dt.files;
input.dispatchEvent(new Event('change'));
await new Promise((r) => setTimeout(r, 300));
let captured;
HTMLAnchorElement.prototype.click = function () { captured = { href: this.href, name: this.download }; };
document.getElementById('convert').click();
await new Promise((r) => setTimeout(r, 800));
const buf = new Uint8Array(await (await fetch(captured.href)).arrayBuffer());
const { openIso, listEntries } = await import('/src/xdvdfs/reader.js');
const entries = await listEntries(await openIso(new Blob([buf])));
({ name: captured.name, size: buf.length, entries: entries.map((e) => e.path) });
```
Expected: o checkbox "Renomear para default.xex" aparece marcado. O resultado é `{ name: 'Game.iso', size: 73728, entries: ['default.xex'] }` (36 setores).

- [ ] **Step 5: Mensagens de erro e aviso**

- Injete um arquivo qualquer (`not-an-iso.iso`, ou `new File([new Uint8Array(200000)], 'x.iso')`) na aba "Extrair ISO". Expected: mensagem "Este arquivo não é uma ISO Xbox válida." e a tabela some.
- Injete em "Criar ISO" apenas `new File(['x'], 'readme.txt')`. Expected: aviso "Não há default.xex na raiz…" e o botão Criar ISO continua habilitado.
- Injete `new File(['x'], '日本.bin')`. Expected: erro de nome fora de Latin-1 e o botão Criar ISO desabilitado.

- [ ] **Step 6: Layout em celular**

Use `resize_window` com `preset: "mobile"`, recarregue e tire um screenshot. Expected: sem rolagem horizontal, botões legíveis. Depois, `resize_window` com `preset: "desktop"` para restaurar.

- [ ] **Step 7: Teste no Chrome/Edge com seletores reais (manual do usuário)**

Peça ao usuário para abrir `http://127.0.0.1:8080/` no Chrome/Edge e conferir com os arquivos de `fixtures/` (e, se tiver, uma pasta de jogo real): criar ISO de pasta, criar ISO de `.xex`, extrair `default.xex`, extrair tudo para uma pasta, cancelar no meio. As janelas nativas de salvar/escolher pasta não podem ser automatizadas. Registre o resultado e qualquer divergência.

Para validar o formato contra uma referência independente, se o usuário tiver o `extract-xiso`:
```bash
extract-xiso -l fixtures/sample.iso
```
Expected: lista `default.xex`, `media/...`, `Café.txt`. Se divergir, corrija em `format.js`/`writer.js` e atualize os testes. Registre no README qualquer ponto ainda não verificado (diretório vazio, arquivo vazio, offsets de partição).

- [ ] **Step 8: Escrever o `README.md`**

```markdown
# XEX ⇄ ISO

Site estático (GitHub Pages) que cria ISOs de Xbox 360 (formato XISO/XDVDFS) a partir de uma pasta de jogo ou de um `.xex`, e extrai `default.xex` ou todos os arquivos de uma ISO. Tudo roda no navegador; nenhum arquivo é enviado.

## Uso
- **Criar ISO:** arraste uma pasta de jogo ou um `.xex` (ou use os botões). Para um `.xex` solto, a ISO conterá só ele, renomeado para `default.xex` (opcional). Serve para homebrew.
- **Extrair ISO:** arraste uma ISO (XISO pura ou de disco completo). Extraia só o `default.xex`, tudo (Chrome/Edge) ou arquivo por arquivo.

## Navegadores
Chrome/Edge gravam direto no disco (jogos de vários GB). Firefox/Safari funcionam via download comum, com mais limites para arquivos muito grandes.

## Limites
- Arquivos de 4 GiB ou mais não cabem no formato XISO.
- Nomes: Latin-1, até 255 bytes. Sem nomes iguais que só diferem em maiúsculas/minúsculas.
- Não remove nem recria assinaturas, não gera a partição de vídeo de discos XGD e não converte para GOD/STFS.
- A ISO gerada só roda em console desbloqueado ou em emulador.

## Desenvolvimento
```bash
npm test            # testes (Node >= 20)
npm run serve       # http://127.0.0.1:8080
node scripts/make-fixtures.mjs   # ISOs de teste em fixtures/
```
`?fallback` na URL força o caminho de download comum.

## Publicar no GitHub Pages
Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`.
```

- [ ] **Step 9: Commit**

```bash
git add README.md
git commit -m "docs: README com uso, limites e publicação" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Publicação (só com autorização do usuário)**

Criar o repositório remoto e dar `push` publica o código, e criar o repositório também é uma ação externa. **Pergunte ao usuário** o nome do repositório e se ele deve ser público. Com a autorização, rode:
```bash
gh repo create <nome> --public --source . --push
```
Depois ative o Pages (Settings → Pages → `main` / root) e abra a URL publicada para repetir os Steps 2–4 contra o site real.

---

## Self-Review

**Cobertura da spec:**
- Seção 1 (objetivo e critérios): critérios 1–2 pelas Tarefas 3–4 (testes) e 8 (manual). Critério 3 pelas Tarefas 4 e 6. Critério 4 pelas restrições globais e pela ausência de `fetch` com dados do usuário. Critério 5 pelas Tarefas 7–8.
- Seção 3 (formato): `format.js` (Tarefa 1) e testes de layout/writer/reader (Tarefas 2–4). Offsets de partição na Tarefa 4, com confirmação listada nas restrições globais e no Step 7 da Tarefa 8.
- Seção 4: 4.1 Tarefa 1. 4.2 Tarefa 4. 4.3 Tarefas 2–3. 4.4 Tarefas 5–6. 4.5 Tarefa 7. Desvios listados nas restrições globais.
- Seção 6 (validações): nomes, tamanho, duplicados e limite de offset na Tarefa 2. Avisos de `default.xex` e do magic na Tarefa 2. Erros de leitura e cancelamento nas Tarefas 4 e 6. A "entrada que não cabe em um setor" é inalcançável (nome ≤ 255 bytes → entrada ≤ 272 bytes), e o limite de offset `u16` toma o seu lugar.
- Seção 7 (testes): ida e volta, invariantes, offset de partição, erros, referência externa (opcional, Tarefa 8) e interface manual (Tarefa 8).
- Seção 8 (publicação): Tarefa 8, Steps 8 e 10.

**Varredura de placeholders:** nenhum "TBD/TODO"; todos os passos de código trazem o código.

**Consistência de tipos:** `buildXiso → { parts, totalSize }`; `planDirectory → { sorted, order, size }` com `Slot = { node, nameBytes, left, right, pos }`; `planImage → { dirs, files, info, totalSectors }`; `openIso → { blob, partitionOffset, rootSector, rootSize, filetime }`; `Entry = { path, name, isDirectory, size, sector }`; fontes devolvem `{ root, label }`; `writeParts(sink, parts, { onProgress(done), signal })`. O `app.js` usa exatamente esses nomes.

**Review Focus:** os cinco itens têm teste nas tarefas indicadas (1: Tarefa 4; 2: Tarefa 4; 3: Tarefa 2; 4: Tarefas 2 e 8; 5: Tarefa 3).
