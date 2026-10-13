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
