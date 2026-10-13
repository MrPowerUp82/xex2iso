import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskRunner } from '../src/ui/tasks.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('uma segunda tarefa enquanto a primeira roda é recusada e não executa', async () => {
  const runner = createTaskRunner();
  const gate = deferred();
  let secondRan = false;
  const first = runner.run(() => gate.promise);
  assert.equal(runner.busy, true);
  assert.equal(await runner.run(async () => { secondRan = true; }), false);
  assert.equal(secondRan, false);
  gate.resolve();
  assert.equal(await first, true);
  assert.equal(runner.busy, false);
  assert.equal(await runner.run(async () => {}), true, 'volta a aceitar tarefas depois de terminar');
});

test('cancel aborta o sinal da tarefa em andamento, e só ela', async () => {
  const runner = createTaskRunner();
  const gate = deferred();
  let signal;
  const running = runner.run((s) => { signal = s; return gate.promise; });
  runner.cancel();
  assert.equal(signal.aborted, true);
  gate.resolve();
  await running;
  runner.cancel(); // sem tarefa: não faz nada
  let next;
  await runner.run(async (s) => { next = s; });
  assert.equal(next.aborted, false);
});

test('erro da tarefa vai para onError e o runner é liberado', async () => {
  const events = [];
  const runner = createTaskRunner({
    onStart: () => events.push('start'),
    onFinish: () => events.push('finish'),
    onError: (e) => events.push(`erro:${e.message}`),
  });
  await runner.run(async () => { throw new Error('boom'); });
  assert.deepEqual(events, ['start', 'erro:boom', 'finish']);
  assert.equal(runner.busy, false);
});
