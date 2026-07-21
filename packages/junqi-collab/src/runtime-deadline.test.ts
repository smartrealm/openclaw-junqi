import assert from "node:assert/strict";
import test from "node:test";
import { LifecycleAbortedError } from "./async-lifecycle.js";
import { CollaborationError } from "./errors.js";
import {
  DEFAULT_RUNTIME_DEADLINE_POLICY,
  FixedRuntimeDeadlinePolicy,
  withRuntimeDeadline,
} from "./runtime-deadline.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function withReferencedEventLoop<T>(operation: () => Promise<T>): Promise<T> {
  const handle = setInterval(() => undefined, 1_000);
  try {
    return await operation();
  } finally {
    clearInterval(handle);
  }
}

test("runtime deadline policy is immutable, complete, and supports validated test overrides", () => {
  assert.equal(DEFAULT_RUNTIME_DEADLINE_POLICY.deadlineMs("runAgent"), 20_000);
  assert.equal(DEFAULT_RUNTIME_DEADLINE_POLICY.deadlineMs("waitForRun"), 35_000);

  const policy = new FixedRuntimeDeadlinePolicy({
    ...DEFAULT_RUNTIME_DEADLINE_POLICY.values,
    runAgent: 7,
  });
  assert.equal(policy.deadlineMs("runAgent"), 7);
  assert.throws(
    () => new FixedRuntimeDeadlinePolicy({
      ...DEFAULT_RUNTIME_DEADLINE_POLICY.values,
      runAgent: 0,
    }),
    /runAgent.*positive/i,
  );
});

test("runtime deadline rejects a hung operation with structured bounded context", async () => {
  const operation = deferred<string>();
  const signal = new AbortController().signal;

  await withReferencedEventLoop(() => assert.rejects(
    withRuntimeDeadline(() => operation.promise, {
      label: "dispatch planner attempt-1",
      timeoutMs: 10,
      signal,
    }),
    (error: unknown) => error instanceof CollaborationError
      && error.code === "RUNTIME_TIMEOUT"
      && error.details?.label === "dispatch planner attempt-1"
      && error.details?.timeoutMs === 10,
  ));

  operation.resolve("late result");
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("runtime deadline absorbs a late rejection after timeout", async () => {
  const operation = deferred<void>();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    await withReferencedEventLoop(() => assert.rejects(
      withRuntimeDeadline(() => operation.promise, {
        label: "append delivery delivery-1",
        timeoutMs: 10,
        signal: new AbortController().signal,
      }),
      (error: unknown) => error instanceof CollaborationError && error.code === "RUNTIME_TIMEOUT",
    ));
    operation.reject(new Error("late runtime rejection"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("runtime deadline clears its timer when the operation settles", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const cleared: unknown[] = [];
  const fakeHandle = { unref() {} };
  globalThis.setTimeout = (() => fakeHandle) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle: unknown) => {
    cleared.push(handle);
  }) as typeof clearTimeout;
  try {
    assert.equal(
      await withRuntimeDeadline(() => Promise.resolve("ok"), {
        label: "read origin",
        timeoutMs: 100,
        signal: new AbortController().signal,
      }),
      "ok",
    );
    assert.deepEqual(cleared, [fakeHandle]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("lifecycle abort wins before the deadline and prevents a not-yet-started operation", async () => {
  const controller = new AbortController();
  const operation = deferred<void>();
  const pending = withRuntimeDeadline(() => operation.promise, {
    label: "runtime call during shutdown",
    timeoutMs: 60_000,
    signal: controller.signal,
  });
  controller.abort(new LifecycleAbortedError("service is stopping"));
  await assert.rejects(pending, LifecycleAbortedError);

  const alreadyStopped = new AbortController();
  alreadyStopped.abort(new LifecycleAbortedError("service already stopped"));
  let calls = 0;
  await assert.rejects(
    withRuntimeDeadline(() => {
      calls += 1;
      return Promise.resolve();
    }, {
      label: "must not start",
      timeoutMs: 60_000,
      signal: alreadyStopped.signal,
    }),
    LifecycleAbortedError,
  );
  assert.equal(calls, 0);

  operation.reject(new Error("late rejection after abort"));
  await new Promise<void>((resolve) => setImmediate(resolve));
});
