import assert from "node:assert/strict";
import test from "node:test";
import { MaintenanceLeaseSpecification } from "./maintenance-lease-specification.js";
import { stableStringify } from "./util.js";

const specification = new MaintenanceLeaseSpecification();

test("maintenance lease specification upgrades legacy active state and requires an explicit expiry transition", () => {
  const raw = stableStringify({
    id: "maintenance-legacy",
    reason: "database migration",
    owner: "desktop",
    enteredAt: 100,
    expiresAt: 200,
  });

  const active = specification.inspect(raw, 199);
  assert.equal(active.kind, "VALID");
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.recoveryRequired, false);
  assert.equal(active.kind === "VALID" && active.lease.version, 1);

  const due = specification.inspect(raw, 200);
  assert.equal(due.kind, "VALID");
  assert.equal(due.status, "EXPIRED");
  assert.equal(due.recoveryRequired, true);
  assert.equal(due.kind === "VALID" && due.transitionRequired, true);

  assert.equal(due.kind, "VALID");
  if (due.kind !== "VALID") return;
  const expired = specification.expire(due.lease, 225);
  const persisted = specification.inspect(specification.serialize(expired), 1_000);
  assert.equal(persisted.kind, "VALID");
  assert.equal(persisted.status, "EXPIRED");
  assert.equal(persisted.kind === "VALID" && persisted.transitionRequired, false);
  assert.equal(persisted.kind === "VALID" && persisted.lease.expiredAt, 225);
});

test("maintenance lease specification fails closed with bounded diagnostics for corrupt state", () => {
  for (const raw of [
    "{not-json",
    stableStringify({
      version: 1,
      status: "ACTIVE",
      id: "maintenance-corrupt",
      reason: "migration",
      owner: "desktop",
      enteredAt: 200,
      expiresAt: 100,
    }),
    stableStringify({
      version: 2,
      status: "ACTIVE",
      id: "maintenance-future",
      reason: "migration",
      owner: "desktop",
      enteredAt: 100,
      expiresAt: 200,
    }),
  ]) {
    const inspection = specification.inspect(raw, 300);
    assert.equal(inspection.kind, "MALFORMED");
    assert.equal(inspection.gateActive, true);
    assert.equal(inspection.recoveryRequired, true);
    assert.equal(inspection.status, "MALFORMED");
    assert.equal(inspection.lease, null);
    assert.ok(inspection.kind === "MALFORMED" && Buffer.byteLength(inspection.diagnostic, "utf8") <= 4_096);
    assert.ok(inspection.kind === "MALFORMED" && /^[a-f0-9]{64}$/.test(inspection.rawDigest));
  }
});
