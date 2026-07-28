import assert from "node:assert/strict";
import test from "node:test";
import { createCoalescedAsyncRunner } from "./coalescedAsyncRunner";

test("coalesced async runner folds concurrent signals into one follow-up run", async () => {
  const releases: Array<() => void> = [];
  let calls = 0;
  const runner = createCoalescedAsyncRunner(async () => {
    calls += 1;
    await new Promise<void>((resolve) => releases.push(resolve));
  });

  const first = runner.run();
  const second = runner.run();
  const third = runner.run();
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(calls, 1);
  assert.equal(runner.isRunning(), true);

  releases.shift()?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  releases.shift()?.();
  await first;
  assert.equal(runner.isRunning(), false);
});

test("coalesced async runner releases a failed task for a later retry", async () => {
  let calls = 0;
  const runner = createCoalescedAsyncRunner(async () => {
    calls += 1;
    if (calls === 1) throw new Error("failed");
  });

  await assert.rejects(runner.run(), /failed/);
  await assert.doesNotReject(runner.run());
  assert.equal(calls, 2);
});
