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
  children: [file('default.xex', xex()), file('<img src=x onerror=alert(1)>.bin', 'x'), file('&amp;<b>bold.txt', 'y')],
});
await writeFile('fixtures/not-an-iso.iso', Buffer.from(bytes(200000)));
console.log('fixtures/not-an-iso.iso');
