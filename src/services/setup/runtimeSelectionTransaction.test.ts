import assert from "node:assert/strict";
import test from "node:test";
import {
  executeRuntimeSelectionTransaction,
  type RuntimeSelectionTransactionPorts,
} from "./runtimeSelectionTransaction";

function ports(overrides: Partial<RuntimeSelectionTransactionPorts> = {}) {
  const calls: string[] = [];
  const value: RuntimeSelectionTransactionPorts = {
    isActive: () => true,
    rollbackPendingLocations: async () => { calls.push("rollback-locations"); return false; },
    stageMode: async (mode) => { calls.push(`stage:${mode}`); },
    prepare: async (mode) => { calls.push(`prepare:${mode}`); },
    setup: async (mode) => { calls.push(`setup:${mode}`); return true; },
    commit: async (mode) => { calls.push(`commit:${mode}`); },
    rollbackMode: async (mode) => { calls.push(`rollback-mode:${mode}`); },
    restoreGateway: async (mode) => { calls.push(`restore:${mode}`); },
    ...overrides,
  };
  return { calls, value };
}

test("runtime selection has one successful commit boundary", async () => {
  const fixture = ports();
  const outcome = await executeRuntimeSelectionTransaction("docker", "native", fixture.value);
  assert.deepEqual(outcome, { status: "committed" });
  assert.deepEqual(fixture.calls, [
    "rollback-locations", "stage:docker", "prepare:docker", "setup:docker", "commit:docker",
  ]);
});

test("a prepare failure after staging is compensated", async () => {
  const fixture = ports({ prepare: async () => { fixture.calls.push("prepare:docker"); throw new Error("probe failed"); } });
  const outcome = await executeRuntimeSelectionTransaction("docker", "native", fixture.value);
  assert.equal(outcome.status, "rolled-back");
  assert.deepEqual(fixture.calls, [
    "rollback-locations", "stage:docker", "prepare:docker", "rollback-locations", "rollback-mode:docker", "restore:native",
  ]);
});

test("a commit failure restores mode and previous Gateway", async () => {
  const fixture = ports({ commit: async () => { fixture.calls.push("commit:docker"); throw new Error("commit failed"); } });
  const outcome = await executeRuntimeSelectionTransaction("docker", "native", fixture.value);
  assert.equal(outcome.status, "rolled-back");
  assert.deepEqual(fixture.calls.slice(-3), ["rollback-locations", "rollback-mode:docker", "restore:native"]);
});

test("durable location recovery owns mode recovery and avoids a second rollback", async () => {
  const fixture = ports({
    setup: async () => false,
    rollbackPendingLocations: async () => {
      fixture.calls.push("rollback-locations");
      return true;
    },
  });
  const outcome = await executeRuntimeSelectionTransaction("native", "docker", fixture.value);
  assert.equal(outcome.status, "rolled-back");
  assert.doesNotMatch(fixture.calls.join(" "), /rollback-mode|restore:docker/);
});

test("location rollback failure still attempts mode rollback and previous Gateway restore", async () => {
  const fixture = ports({
    setup: async () => false,
    rollbackPendingLocations: async () => {
      fixture.calls.push("rollback-locations");
      throw new Error("location rollback failed");
    },
  });

  const outcome = await executeRuntimeSelectionTransaction("native", "docker", fixture.value);

  assert.equal(outcome.status, "rolled-back");
  assert.deepEqual(fixture.calls.slice(-3), [
    "rollback-locations",
    "rollback-mode:native",
    "restore:docker",
  ]);
  if (outcome.status === "rolled-back") {
    assert.equal(outcome.compensationErrors?.length, 1);
  }
});

test("mode rollback failure fails closed instead of starting the wrong previous Gateway", async () => {
  const fixture = ports({
    setup: async () => false,
    rollbackMode: async () => {
      fixture.calls.push("rollback-mode:docker");
      throw new Error("mode rollback failed");
    },
  });

  const outcome = await executeRuntimeSelectionTransaction("docker", "native", fixture.value);

  assert.equal(outcome.status, "rolled-back");
  assert.doesNotMatch(fixture.calls.join(" "), /restore:native/);
  if (outcome.status === "rolled-back") {
    assert.equal(outcome.restoredPreviousGateway, false);
    assert.equal(outcome.compensationErrors?.length, 1);
  }
});

test("pre-stage Docker location recovery does not suppress failed-switch compensation", async () => {
  let rollbackCount = 0;
  const fixture = ports({
    setup: async () => {
      fixture.calls.push("setup:docker");
      return false;
    },
    rollbackPendingLocations: async () => {
      fixture.calls.push("rollback-locations");
      rollbackCount += 1;
      return rollbackCount === 1;
    },
  });

  const outcome = await executeRuntimeSelectionTransaction("docker", "native", fixture.value);

  assert.equal(outcome.status, "rolled-back");
  assert.deepEqual(fixture.calls, [
    "rollback-locations",
    "stage:docker",
    "prepare:docker",
    "setup:docker",
    "rollback-locations",
    "rollback-mode:docker",
    "restore:native",
  ]);
});
