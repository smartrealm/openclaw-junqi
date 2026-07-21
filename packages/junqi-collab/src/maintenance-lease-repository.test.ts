import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationDatabase } from "./database.js";
import { MaintenanceLeaseRepository } from "./maintenance-lease-repository.js";
import { MaintenanceLeaseSpecification } from "./maintenance-lease-specification.js";

test("maintenance lease repository persists one expiry transition and releases only an exact lease", () => {
  const database = new CollaborationDatabase(":memory:");
  let clock = 100;
  const specification = new MaintenanceLeaseSpecification();
  const repository = new MaintenanceLeaseRepository(database, specification, () => clock);
  try {
    const lease = specification.createActive({
      id: "maintenance-repository",
      reason: "database migration",
      owner: "desktop",
      enteredAt: 100,
      expiresAt: 200,
    });
    assert.equal(repository.create(lease), true);
    assert.equal(repository.create(lease), false);

    let transitions = 0;
    assert.equal(repository.recoverExpired(199, () => { transitions += 1; }).status, "ACTIVE");
    const expired = repository.recoverExpired(200, () => { transitions += 1; });
    assert.equal(expired.status, "EXPIRED");
    assert.equal(transitions, 1);
    assert.equal(repository.recoverExpired(300, () => { transitions += 1; }).status, "EXPIRED");
    assert.equal(transitions, 1);

    clock = 300;
    const mismatch = repository.releaseExact("maintenance-other", "desktop");
    assert.equal(mismatch.kind, "MISMATCH");
    assert.equal(repository.inspect().gateActive, true);
    const ownerMismatch = repository.releaseExact(lease.id, "other-desktop");
    assert.equal(ownerMismatch.kind, "MISMATCH");
    assert.equal(repository.inspect().gateActive, true);
    const released = repository.releaseExact(lease.id, "desktop");
    assert.equal(released.kind, "RELEASED");
    assert.equal(released.kind === "RELEASED" && released.lease.status, "EXPIRED");
    assert.equal(repository.inspect().status, "INACTIVE");
  } finally {
    database.close();
  }
});

test("maintenance lease repository never releases malformed persisted state", () => {
  const database = new CollaborationDatabase(":memory:");
  const repository = new MaintenanceLeaseRepository(database);
  try {
    database.setMetadata("maintenance_lease", "{broken");
    assert.equal(repository.inspect(1_000).status, "MALFORMED");
    assert.equal(repository.releaseExact("untrusted", "untrusted-owner", 1_000).kind, "MALFORMED");
    assert.equal(database.getMetadata("maintenance_lease"), "{broken");
  } finally {
    database.close();
  }
});
