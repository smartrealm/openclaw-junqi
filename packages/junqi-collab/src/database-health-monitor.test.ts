import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseHealthMonitor } from "./database-health-monitor.js";

test("database health monitor caches explicit immutable observations", () => {
  let checks = 0;
  let now = 100;
  const monitor = new DatabaseHealthMonitor(
    {
      integrityCheck() {
        checks += 1;
        return checks === 1 ? "ok" : "corrupt";
      },
    },
    () => now,
  );

  assert.deepEqual(monitor.snapshot(), { databaseIntegrity: "unknown", checkedAt: null });
  assert.equal(checks, 0);

  const first = monitor.refresh();
  assert.deepEqual(first, { databaseIntegrity: "ok", checkedAt: 100 });
  assert.equal(Object.isFrozen(first), true);
  assert.equal(monitor.snapshot(), first);
  assert.equal(checks, 1);

  now = 200;
  const second = monitor.refresh();
  assert.deepEqual(second, { databaseIntegrity: "corrupt", checkedAt: 200 });
  assert.equal(monitor.snapshot(), second);
  assert.equal(checks, 2);
});

test("database health monitor fails closed when a refresh throws", () => {
  let shouldThrow = false;
  let now = 10;
  const monitor = new DatabaseHealthMonitor(
    {
      integrityCheck() {
        if (shouldThrow) throw new Error("probe failed");
        return "ok";
      },
    },
    () => now,
  );

  monitor.refresh();
  shouldThrow = true;
  now = 20;
  assert.throws(() => monitor.refresh(), /probe failed/);
  assert.deepEqual(monitor.snapshot(), { databaseIntegrity: "unknown", checkedAt: 20 });
});
