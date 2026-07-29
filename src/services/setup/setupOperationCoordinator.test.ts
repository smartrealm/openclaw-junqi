import assert from "node:assert/strict";
import test from "node:test";
import { SetupOperationCoordinator } from "./setupOperationCoordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("confirmed cancellation waits for IPC acknowledgement and native transaction cleanup", async () => {
  const acknowledgement = deferred<{ accepted: boolean; queued: boolean }>();
  const nativeCall = deferred<void>();
  const cancellationIds: string[] = [];
  const coordinator = new SetupOperationCoordinator({
    scope: "test",
    cancelOperation: async (operationId) => {
      cancellationIds.push(operationId);
      return await acknowledgement.promise;
    },
  });
  const runId = coordinator.beginRun();
  coordinator.beginTransaction(runId);
  const operation = coordinator.runOperation(runId, "openclaw", async () => nativeCall.promise);

  let cancelled = false;
  const cancellation = coordinator.cancelActiveRun().then(() => { cancelled = true; });
  await Promise.resolve();
  assert.deepEqual(cancellationIds, ["test:1:openclaw"]);
  assert.equal(cancelled, false);

  acknowledgement.resolve({ accepted: true, queued: true });
  await Promise.resolve();
  assert.equal(cancelled, false);

  nativeCall.resolve();
  await operation;
  coordinator.finishTransaction(runId);
  await cancellation;
  assert.equal(cancelled, true);
});

test("failed cancellation retains the operation id for a retry", async () => {
  const nativeCall = deferred<void>();
  const cancellationIds: string[] = [];
  let attempt = 0;
  const coordinator = new SetupOperationCoordinator({
    scope: "retry",
    cancelOperation: async (operationId) => {
      cancellationIds.push(operationId);
      attempt += 1;
      if (attempt === 1) throw new Error("IPC unavailable");
      return { accepted: true, queued: true };
    },
  });
  const runId = coordinator.beginRun();
  coordinator.beginTransaction(runId);
  const operation = coordinator.runOperation(runId, "docker-image", async () => nativeCall.promise);

  await assert.rejects(coordinator.cancelActiveRun(), /IPC unavailable/);
  const retry = coordinator.cancelActiveRun();
  assert.deepEqual(cancellationIds, ["retry:1:docker-image", "retry:1:docker-image"]);

  nativeCall.resolve();
  await operation;
  coordinator.finishTransaction(runId);
  await retry;
});

test("best-effort invalidation fences the run and reports cancellation failure", async () => {
  const nativeCall = deferred<void>();
  const errors: unknown[] = [];
  const coordinator = new SetupOperationCoordinator({
    scope: "obsolete",
    cancelOperation: async () => { throw new Error("renderer is leaving"); },
    onBestEffortCancellationError: (error) => errors.push(error),
  });
  const runId = coordinator.beginRun();
  coordinator.beginTransaction(runId);
  const operation = coordinator.runOperation(runId, "node", async () => nativeCall.promise);

  const completion = coordinator.invalidateActiveRun();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(coordinator.isRunActive(runId), false);
  assert.equal(errors.length, 1);

  nativeCall.resolve();
  await operation;
  coordinator.finishTransaction(runId);
  await completion;
});

test("a new run receives a controlled busy result while the prior transaction stops", async () => {
  const nativeCall = deferred<void>();
  const coordinator = new SetupOperationCoordinator({
    scope: "admission",
    cancelOperation: async () => ({ accepted: true, queued: true }),
  });
  const firstRun = coordinator.beginRun();
  assert.equal(coordinator.beginTransaction(firstRun), true);
  const operation = coordinator.runOperation(firstRun, "node", async () => nativeCall.promise);

  const secondRun = coordinator.beginRun();
  assert.equal(coordinator.beginTransaction(secondRun), false);
  assert.equal(coordinator.isRunActive(firstRun), false);
  assert.equal(coordinator.isRunActive(secondRun), true);

  nativeCall.resolve();
  await operation;
  coordinator.finishTransaction(firstRun);
  assert.equal(coordinator.beginTransaction(secondRun), true);
  coordinator.finishTransaction(secondRun);
});
