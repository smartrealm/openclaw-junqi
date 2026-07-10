import test from 'node:test';
import assert from 'node:assert/strict';
import { SingleFlight } from './SingleFlight';

test('BUG-02 concurrent callers share one task and one promise', async () => {
  const gate = new SingleFlight<number>();
  let executions = 0;
  let release!: (value: number) => void;
  const pending = new Promise<number>((resolve) => { release = resolve; });

  const first = gate.run(async () => {
    executions += 1;
    return pending;
  });
  const second = gate.run(async () => {
    executions += 1;
    return 99;
  });

  assert.strictEqual(second, first);
  assert.equal(executions, 0);
  await Promise.resolve();
  assert.equal(executions, 1);
  assert.equal(gate.running, true);

  release(42);
  assert.equal(await first, 42);
  await Promise.resolve();
  assert.equal(gate.running, false);
});

test('BUG-02 a settled task does not block the next restart', async () => {
  const gate = new SingleFlight<number>();
  let executions = 0;
  assert.equal(await gate.run(async () => ++executions), 1);
  assert.equal(await gate.run(async () => ++executions), 2);
});

test('BUG-02 a rejected task also releases the single-flight gate', async () => {
  const gate = new SingleFlight<number>();
  await assert.rejects(gate.run(async () => { throw new Error('restart failed'); }));
  assert.equal(gate.running, false);
  assert.equal(await gate.run(async () => 7), 7);
});
