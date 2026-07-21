import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundLifecycleSupervisor,
  BackgroundTaskRegistry,
  LifecycleAbortedError,
  LifecycleClosedError,
  SingleFlight,
} from "./async-lifecycle.js";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("background registry drain waits for a task registered by an in-flight task", async () => {
  const failures: Array<{ label: string; error: unknown }> = [];
  const registry = new BackgroundTaskRegistry((label, error) => failures.push({ label, error }));
  const outerGate = deferred();
  const innerGate = deferred();
  let innerRegistered = false;
  let drainSettled = false;

  registry.track("outer", (async () => {
    await outerGate.promise;
    registry.track("inner", innerGate.promise);
    innerRegistered = true;
  })());

  const draining = registry.drain().then(() => {
    drainSettled = true;
  });
  outerGate.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(innerRegistered, true);
  assert.equal(drainSettled, false);
  assert.equal(registry.size, 1);

  innerGate.reject(new Error("inner failed"));
  await draining;

  assert.equal(registry.size, 0);
  assert.equal(drainSettled, true);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.label, "inner");
  assert.match(String(failures[0]?.error), /inner failed/);
});

test("single flight merges concurrent calls", async () => {
  const singleFlight = new SingleFlight();
  const gate = deferred();
  let calls = 0;
  let reentrant: Promise<void> | undefined;

  const first = singleFlight.run(async () => {
    calls += 1;
    reentrant = singleFlight.run(async () => {
      calls += 1;
    });
    await gate.promise;
  });
  const second = singleFlight.run(async () => {
    calls += 1;
  });

  assert.strictEqual(second, first);
  assert.strictEqual(reentrant, first);
  assert.equal(calls, 1);
  assert.equal(singleFlight.active, true);

  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(singleFlight.active, false);
  await singleFlight.drain();
});

test("single flight can run again after a rejected task", async () => {
  const singleFlight = new SingleFlight();
  let calls = 0;

  await assert.rejects(
    singleFlight.run(() => {
      calls += 1;
      throw new Error("first run failed");
    }),
    /first run failed/,
  );

  assert.equal(singleFlight.active, false);
  await singleFlight.run(async () => {
    calls += 1;
  });

  assert.equal(calls, 2);
  assert.equal(singleFlight.active, false);
});

test("lifecycle supervisor observes task failures before callers await them", async () => {
  const failures: Array<{ label: string; error: unknown }> = [];
  const supervisor = new BackgroundLifecycleSupervisor((label, error) => failures.push({ label, error }));

  const failed = supervisor.run("failing-task", async () => {
    throw new Error("task failed");
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.label, "failing-task");
  assert.match(String(failures[0]?.error), /task failed/);
  await assert.rejects(failed, /task failed/);
  assert.equal(await supervisor.run("next-task", async () => 42), 42);
  await supervisor.close();
});

test("lifecycle supervisor coalesces keyed work and permits a later flight", async () => {
  const supervisor = new BackgroundLifecycleSupervisor();
  const gate = deferred();
  let calls = 0;

  const first = supervisor.runOnce("reconcile:run-1", "reconcile run", async () => {
    calls += 1;
    await gate.promise;
    return "first";
  });
  const second = supervisor.runOnce("reconcile:run-1", "reconcile run", async () => {
    calls += 1;
    return "second";
  });

  assert.strictEqual(second, first);
  assert.equal(calls, 1);
  gate.resolve();
  assert.equal(await first, "first");
  assert.equal(
    await supervisor.runOnce("reconcile:run-1", "reconcile run", async () => {
      calls += 1;
      return "next";
    }),
    "next",
  );
  assert.equal(calls, 2);
  await supervisor.close();
});

test("lifecycle supervisor owns and unreferences interval and deferred timers", async () => {
  interface FakeTimer {
    id: number;
    callback: () => void;
    unrefCalls: number;
    cleared: boolean;
    unref(): void;
  }

  const originalSetInterval = globalThis.setInterval;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearInterval = globalThis.clearInterval;
  const originalClearTimeout = globalThis.clearTimeout;
  const fakeTimers: FakeTimer[] = [];
  let nextTimerId = 1;
  const createTimer = (callback: (...args: unknown[]) => void): FakeTimer => {
    const timer: FakeTimer = {
      id: nextTimerId++,
      callback: () => callback(),
      unrefCalls: 0,
      cleared: false,
      unref() {
        this.unrefCalls += 1;
      },
    };
    fakeTimers.push(timer);
    return timer;
  };

  globalThis.setInterval = ((callback: (...args: unknown[]) => void) => createTimer(callback)) as typeof setInterval;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => createTimer(callback)) as typeof setTimeout;
  globalThis.clearInterval = ((timer: FakeTimer) => {
    timer.cleared = true;
  }) as unknown as typeof clearInterval;
  globalThis.clearTimeout = ((timer: FakeTimer) => {
    timer.cleared = true;
  }) as unknown as typeof clearTimeout;

  try {
    const supervisor = new BackgroundLifecycleSupervisor();
    const intervalGate = deferred();
    let intervalCalls = 0;
    let deferredCalls = 0;
    const cancelInterval = supervisor.every(
      "reconcile",
      "periodic reconcile",
      1_000,
      async () => {
        intervalCalls += 1;
        await intervalGate.promise;
      },
      { immediate: true },
    );
    supervisor.defer("startup", "startup recovery", 10, async () => {
      deferredCalls += 1;
    });

    assert.equal(supervisor.scheduledTimerCount, 2);
    assert.deepEqual(fakeTimers.map((timer) => timer.unrefCalls), [1, 1]);
    assert.equal(intervalCalls, 1);

    fakeTimers[0]!.callback();
    assert.equal(intervalCalls, 1);
    intervalGate.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    fakeTimers[0]!.callback();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(intervalCalls, 2);

    fakeTimers[1]!.callback();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(deferredCalls, 1);
    assert.equal(supervisor.scheduledTimerCount, 1);

    cancelInterval();
    assert.equal(fakeTimers[0]!.cleared, true);
    assert.equal(supervisor.scheduledTimerCount, 0);
    await supervisor.close();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearInterval = originalClearInterval;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("lifecycle close aborts raced work, clears timers, drains, and is idempotent", async () => {
  const failures: Array<{ label: string; error: unknown }> = [];
  const supervisor = new BackgroundLifecycleSupervisor((label, error) => failures.push({ label, error }));
  const underlying = deferred();
  supervisor.every("idle", "idle timer", 60_000, async () => undefined);
  const task = supervisor.run("runtime-call", async () => supervisor.race(underlying.promise));

  const firstClose = supervisor.close();
  const secondClose = supervisor.close();
  assert.strictEqual(secondClose, firstClose);
  assert.equal(supervisor.state, "closing");
  assert.equal(supervisor.signal.aborted, true);
  assert.equal(supervisor.scheduledTimerCount, 0);

  await assert.rejects(task, LifecycleAbortedError);
  await firstClose;
  assert.equal(supervisor.state, "closed");
  assert.equal(supervisor.activeTaskCount, 0);
  assert.deepEqual(failures, []);

  underlying.reject(new Error("late runtime rejection"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(
    supervisor.run("too-late", async () => undefined),
    LifecycleClosedError,
  );
  await assert.rejects(supervisor.race(Promise.resolve()), LifecycleClosedError);
  assert.throws(
    () => supervisor.defer("too-late", "too late", 0, async () => undefined),
    LifecycleClosedError,
  );
});

test("lifecycle sleep is unreferenced and abortable", async () => {
  const supervisor = new BackgroundLifecycleSupervisor();
  const sleeping = supervisor.sleep(60_000);
  const closing = supervisor.close();
  await assert.rejects(sleeping, LifecycleAbortedError);
  await closing;
});
