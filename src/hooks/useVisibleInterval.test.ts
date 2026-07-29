import assert from "node:assert/strict";
import test from "node:test";
import { installVisibleInterval } from "./useVisibleInterval";

class FakeVisibilitySource {
  visibilityState = "visible";
  private listeners = new Set<() => void>();

  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  setVisibility(state: "visible" | "hidden"): void {
    this.visibilityState = state;
    for (const listener of this.listeners) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

test("visible interval pauses while hidden and refreshes immediately on resume", () => {
  const source = new FakeVisibilitySource();
  const callbacks = new Map<number, () => void>();
  const cleared: number[] = [];
  let nextHandle = 0;
  let runs = 0;

  const dispose = installVisibleInterval({
    run: () => { runs += 1; },
    intervalMs: 3000,
    visibilitySource: source,
    setIntervalFn: (callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: (handle) => {
      const numericHandle = handle as unknown as number;
      cleared.push(numericHandle);
      callbacks.delete(numericHandle);
    },
  });

  assert.equal(runs, 1);
  callbacks.get(0)?.();
  assert.equal(runs, 2);

  source.setVisibility("hidden");
  assert.deepEqual(cleared, [0]);
  source.setVisibility("visible");
  assert.equal(runs, 3);
  assert.equal(callbacks.has(1), true);

  dispose();
  assert.deepEqual(cleared, [0, 1]);
  assert.equal(source.listenerCount(), 0);
});
