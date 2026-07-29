import assert from "node:assert/strict";
import test from "node:test";
import { runAfterSaveBarrier } from "./saveBeforeTransition";

test("save barrier commits a transition only after saving finishes", async () => {
  const order: string[] = [];
  await runAfterSaveBarrier(
    async () => { order.push("save"); },
    () => { order.push("transition"); },
  );
  assert.deepEqual(order, ["save", "transition"]);
});

test("save barrier preserves the current view when saving fails", async () => {
  let transitioned = false;
  await assert.rejects(
    runAfterSaveBarrier(
      async () => { throw new Error("disk conflict"); },
      () => { transitioned = true; },
    ),
    /disk conflict/,
  );
  assert.equal(transitioned, false);
});
