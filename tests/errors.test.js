import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaleFileError, STALE_FILE_MESSAGE } from '../src/ui/errors.js';

test('reconhece o NotReadableError do navegador (arquivo mudou depois de selecionado)', () => {
  assert.equal(isStaleFileError(new DOMException('state had changed since it was read from disk', 'NotReadableError')), true);
  assert.equal(isStaleFileError({ name: 'NotReadableError' }), true);
});

test('não confunde outros erros com arquivo alterado', () => {
  assert.equal(isStaleFileError(new Error('disco cheio')), false);
  assert.equal(isStaleFileError(new DOMException('cancelado', 'AbortError')), false);
  assert.equal(isStaleFileError(null), false);
  assert.equal(isStaleFileError(undefined), false);
});

test('a mensagem explica a causa e o que fazer', () => {
  assert.match(STALE_FILE_MESSAGE, /mudou|alterad/i);
  assert.match(STALE_FILE_MESSAGE, /selecione/i);
  assert.match(STALE_FILE_MESSAGE, /OneDrive/);
});
