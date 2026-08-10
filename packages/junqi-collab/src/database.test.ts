import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CollaborationDatabase } from "./database.js";
import { CollaborationError } from "./errors.js";
import { PERSISTENCE_LIMITS } from "./persistence-policy.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";
import type { OriginRef } from "./types.js";

const origin: OriginRef = {
  runtimeId: "runtime-1",
  agentId: "main",
  sessionKey: "agent:main:main",
  sessionId: "session-1",
  nativeMessageId: "message-1",
};

function assertSynchronousTransactionTypes(database: CollaborationDatabase): void {
  database.transaction(() => 1);
  database.readTransaction(() => "snapshot");

  // @ts-expect-error SQL transaction callbacks cannot cross an async boundary.
  database.transaction(async () => 1);
  // @ts-expect-error PromiseLike results are rejected, not only native Promise results.
  database.readTransaction((): PromiseLike<string> => Promise.resolve("snapshot"));
}
void assertSynchronousTransactionTypes;

test("database creates durable metadata and rejects a duplicate active origin", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    assert.match(database.instanceId, /^instance_/);
    assert.equal(database.integrityCheck(), "ok");
    database.createRun({ id: "run-1", origin, goal: "test", capabilitySnapshot: {} });
    assert.throws(
      () => database.createRun({ id: "run-2", origin, goal: "test", capabilitySnapshot: {} }),
      (error: unknown) => error instanceof CollaborationError && error.code === "ACTIVE_RUN_EXISTS",
    );
  } finally {
    database.close();
  }
});

test("database creates the current schema and reuses its stable instance identity", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-current-schema-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const created = new CollaborationDatabase(filePath);
  const instanceId = created.instanceId;
  try {
    assert.equal(created.getMetadata("schema_version"), String(SCHEMA_VERSION));
    assert.equal(Number(created.db.prepare("PRAGMA foreign_keys").get()?.foreign_keys), 1);
    const index = created.db
      .prepare("PRAGMA index_info('commands_available')")
      .all() as Array<{ name: string }>;
    assert.deepEqual(index.map((column) => column.name), [
      "status",
      "available_at",
      "lease_expires_at",
      "created_at",
    ]);
    const retiredTables = created.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('session_mutations', 'session_mutation_commands')",
      )
      .all();
    assert.deepEqual(retiredTables, []);
  } finally {
    created.close();
  }

  const reopened = new CollaborationDatabase(filePath);
  try {
    assert.equal(reopened.instanceId, instanceId);
    assert.equal(reopened.getMetadata("schema_version"), String(SCHEMA_VERSION));
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const unsupportedVersion of [SCHEMA_VERSION - 1, SCHEMA_VERSION + 1]) {
  test(`database rejects unsupported schema ${unsupportedVersion} without rewriting it`, () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-unsupported-schema-"));
    const filePath = path.join(directory, "collaboration.sqlite");
    const database = new CollaborationDatabase(filePath);
    database.setMetadata("schema_version", String(unsupportedVersion));
    database.close();

    assert.throws(
      () => new CollaborationDatabase(filePath),
      new RegExp(`schema ${unsupportedVersion} is unsupported; expected ${SCHEMA_VERSION}`),
    );

    const raw = new DatabaseSync(filePath);
    try {
      const row = raw.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get();
      assert.equal(row?.value, String(unsupportedVersion));
    } finally {
      raw.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("database rejects an existing store without collaboration metadata", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-missing-metadata-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const raw = new DatabaseSync(filePath);
  raw.exec("CREATE TABLE unrelated_data(id TEXT PRIMARY KEY)");
  raw.close();

  assert.throws(
    () => new CollaborationDatabase(filePath),
    /collaboration database metadata is missing/,
  );

  const inspected = new DatabaseSync(filePath);
  try {
    const row = inspected
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'unrelated_data'")
      .get();
    assert.equal(row?.name, "unrelated_data");
  } finally {
    inspected.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("database rejects current-version storage whose structure drifted", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-drift-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const database = new CollaborationDatabase(filePath);
  database.db.exec("DROP INDEX commands_available");
  database.close();

  assert.throws(
    () => new CollaborationDatabase(filePath),
    /collaboration database structure does not match the current schema/,
  );

  const inspected = new DatabaseSync(filePath);
  try {
    const row = inspected.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get();
    assert.equal(row?.value, String(SCHEMA_VERSION));
  } finally {
    inspected.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("database rejects current-version storage with an unexpected trigger", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-trigger-drift-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  try {
    const database = new CollaborationDatabase(filePath);
    database.db.exec(
      `CREATE TRIGGER unexpected_run_trigger
       AFTER INSERT ON collaboration_runs
       BEGIN
         UPDATE metadata SET updated_at = updated_at WHERE key = 'schema_version';
       END`,
    );
    database.close();

    assert.throws(
      () => new CollaborationDatabase(filePath),
      /collaboration database structure does not match the current schema/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("database rejects current-version storage whose table constraint drifted", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-constraint-drift-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  try {
    const raw = new DatabaseSync(filePath);
    const constraint = ",\n  CHECK(deletion_job_id IS NOT NULL OR actor = 'retention-policy')";
    const driftedSchema = SCHEMA_SQL.replace(constraint, "");
    assert.notEqual(driftedSchema, SCHEMA_SQL);
    raw.exec(driftedSchema);
    raw.prepare("INSERT INTO metadata(key, value, updated_at) VALUES ('schema_version', ?, 1)")
      .run(String(SCHEMA_VERSION));
    raw.prepare("INSERT INTO metadata(key, value, updated_at) VALUES ('collaboration_instance_id', 'instance_drift', 1)")
      .run();
    raw.close();

    assert.throws(
      () => new CollaborationDatabase(filePath),
      /collaboration database structure does not match the current schema/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed nested transaction rolls back to its savepoint while the outer transaction continues", () => {
  const database = new CollaborationDatabase(":memory:");
  const nestedFailure = new Error("nested write failed");
  try {
    database.transaction(() => {
      database.setMetadata("outer-before", "committed-before");

      assert.throws(
        () => database.transaction(() => {
          database.setMetadata("nested-only", "must-roll-back");
          throw nestedFailure;
        }),
        (error: unknown) => error === nestedFailure,
      );

      assert.equal(database.getMetadata("nested-only"), null);
      database.transaction(() => {
        database.setMetadata("nested-after-recovery", "committed-after");
      });
      database.setMetadata("outer-after", "committed-after");
    });

    assert.equal(database.getMetadata("outer-before"), "committed-before");
    assert.equal(database.getMetadata("nested-only"), null);
    assert.equal(database.getMetadata("nested-after-recovery"), "committed-after");
    assert.equal(database.getMetadata("outer-after"), "committed-after");
    assert.equal(database.integrityCheck(), "ok");
  } finally {
    database.close();
  }
});

test("transaction rejects a runtime PromiseLike bypass before commit and rolls back", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    assert.throws(
      () => Reflect.apply(database.transaction, database, [() => {
        database.setMetadata("async-transaction-write", "must-roll-back");
        return Promise.resolve("not-a-synchronous-result");
      }]),
      (error: unknown) => error instanceof TypeError
        && error.message === "CollaborationDatabase transaction callbacks must be synchronous",
    );

    assert.equal(database.getMetadata("async-transaction-write"), null);
    database.setMetadata("after-async-transaction-rejection", "connection-remains-usable");
    assert.equal(database.getMetadata("after-async-transaction-rejection"), "connection-remains-usable");
  } finally {
    database.close();
  }
});

test("read transaction rejects a runtime PromiseLike bypass before commit and rolls back", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    assert.throws(
      () => Reflect.apply(database.readTransaction, database, [() => {
        database.setMetadata("async-read-transaction-write", "must-roll-back");
        return Promise.resolve("not-a-synchronous-result");
      }]),
      (error: unknown) => error instanceof TypeError
        && error.message === "CollaborationDatabase transaction callbacks must be synchronous",
    );

    assert.equal(database.getMetadata("async-read-transaction-write"), null);
  } finally {
    database.close();
  }
});

test("nested transaction rejects a runtime PromiseLike bypass and rolls back only its savepoint", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    database.transaction(() => {
      database.setMetadata("outer-before-promise-like", "committed");
      assert.throws(
        () => Reflect.apply(database.transaction, database, [() => {
          database.setMetadata("nested-promise-like", "must-roll-back");
          return Promise.resolve("not-a-synchronous-result");
        }]),
        (error: unknown) => error instanceof TypeError
          && error.message === "CollaborationDatabase transaction callbacks must be synchronous",
      );
      assert.equal(database.getMetadata("nested-promise-like"), null);
      database.setMetadata("outer-after-promise-like", "committed");
    });

    assert.equal(database.getMetadata("outer-before-promise-like"), "committed");
    assert.equal(database.getMetadata("nested-promise-like"), null);
    assert.equal(database.getMetadata("outer-after-promise-like"), "committed");
  } finally {
    database.close();
  }
});

test("history run listing uses a stable created-at and id cursor across timestamp ties", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    for (const id of ["run-a", "run-b", "run-c"]) {
      database.createRun({
        id,
        origin: {
          ...origin,
          sessionKey: `agent:main:${id}`,
          sessionId: `session-${id}`,
          nativeMessageId: `message-${id}`,
        },
        goal: id,
        capabilitySnapshot: {},
      });
    }
    database.db.prepare("UPDATE collaboration_runs SET created_at = 1234, updated_at = 1234").run();

    const first = database.listRunsPage({ includeArchived: true, limit: 2 });
    assert.deepEqual(first.runs.map((run) => run.id), ["run-c", "run-b"]);
    assert.deepEqual(first.nextCursor, {
      createdAt: 1234,
      id: "run-b",
      snapshotCreatedAt: 1234,
      snapshotId: "run-c",
    });

    const second = database.listRunsPage({ includeArchived: true, limit: 2, cursor: first.nextCursor! });
    assert.deepEqual(second.runs.map((run) => run.id), ["run-a"]);
    assert.equal(second.nextCursor, null);
  } finally {
    database.close();
  }
});

test("history pagination does not skip or duplicate a run updated between pages", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    for (const id of ["run-a", "run-b", "run-c"]) {
      database.createRun({
        id,
        origin: {
          ...origin,
          sessionKey: `agent:main:${id}`,
          sessionId: `session-${id}`,
          nativeMessageId: `message-${id}`,
        },
        goal: id,
        capabilitySnapshot: {},
      });
    }
    database.db.prepare(
      `UPDATE collaboration_runs
       SET created_at = CASE id WHEN 'run-a' THEN 300 WHEN 'run-b' THEN 200 ELSE 100 END,
           updated_at = CASE id WHEN 'run-a' THEN 300 WHEN 'run-b' THEN 200 ELSE 100 END`,
    ).run();

    const first = database.listRunsPage({ includeArchived: true, limit: 1 });
    assert.deepEqual(first.runs.map((run) => run.id), ["run-a"]);

    database.db.prepare("UPDATE collaboration_runs SET updated_at = 400 WHERE id = 'run-c'").run();
    database.createRun({
      id: "run-new",
      origin: {
        ...origin,
        sessionKey: "agent:main:run-new",
        sessionId: "session-run-new",
        nativeMessageId: "message-run-new",
      },
      goal: "run-new",
      capabilitySnapshot: {},
    });
    database.db.prepare("UPDATE collaboration_runs SET created_at = 400, updated_at = 400 WHERE id = 'run-new'").run();

    const collected = [...first.runs];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = database.listRunsPage({ includeArchived: true, limit: 1, cursor });
      collected.push(...page.runs);
      cursor = page.nextCursor;
    }

    assert.deepEqual(collected.map((run) => run.id), ["run-a", "run-b", "run-c"]);
    assert.equal(new Set(collected.map((run) => run.id)).size, 3);
    assert.deepEqual(
      database.listRunsPage({ includeArchived: true, limit: 10 }).runs.map((run) => run.id),
      ["run-new", "run-a", "run-b", "run-c"],
    );
  } finally {
    database.close();
  }
});

test("active-run uniqueness is scoped to the native session, not the origin message", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    database.createRun({ id: "run-1", origin, goal: "first", capabilitySnapshot: {} });
    const nextMessage = {
      ...origin,
      nativeMessageId: "message-2",
      clientMessageId: "client-message-2",
    };
    assert.throws(
      () => database.createRun({ id: "run-2", origin: nextMessage, goal: "second", capabilitySnapshot: {} }),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "ACTIVE_RUN_EXISTS"
        && error.details?.runId === "run-1",
    );
  } finally {
    database.close();
  }
});

test("expired command leases are reclaimed without duplicating effect keys", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    database.createRun({ id: "run-1", origin, goal: "test", capabilitySnapshot: {} });
    database.insertCommand({
      id: "command-1",
      runId: "run-1",
      kind: "PLAN",
      payloadHash: "hash-1",
      payload: { attemptId: "attempt-1" },
      effectKey: "effect-1",
    });
    const first = database.claimCommands("worker-a", 1, -1);
    assert.equal(first.length, 1);
    const second = database.claimCommands("worker-b", 1, 30_000);
    assert.equal(second.length, 1);
    assert.equal(second[0]?.id, "command-1");
    assert.equal(second[0]?.attempts, 2);
    assert.equal(database.renewClaimedCommandLease(first[0]!, 30_000), false);
    assert.equal(
      database.settleOrphanedCommandUnknown(first[0]!, "stale orphan observer", Date.now()),
      false,
    );
    assert.equal(database.renewClaimedCommandLease(second[0]!, 30_000), true);
    assert.equal(database.settleClaimedCommand(first[0]!, "FAILED", { error: "late worker" }), false);
    assert.equal(database.getCommand("command-1").status, "LEASED");
    assert.equal(database.getCommand("command-1").leaseOwner, "worker-b");
    assert.equal(database.getCommand("command-1").failureCount, 0);
    assert.equal(database.settleClaimedCommand(second[0]!, "SUCCEEDED"), true);
    assert.equal(database.getCommand("command-1").failureCount, 0);
  } finally {
    database.close();
  }
});

test("command deferrals preserve failure budget while lease generations remain monotonic", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    database.createRun({ id: "defer-run", origin, goal: "defer", capabilitySnapshot: {} });
    const inserted = database.insertCommand({
      id: "defer-command",
      runId: "defer-run",
      kind: "PROVISION",
      payloadHash: "defer-payload",
      payload: { waitingForCapacity: true },
      effectKey: "defer-effect",
    });
    assert.equal(inserted.attempts, 0);
    assert.equal(inserted.failureCount, 0);

    const [first] = database.claimCommands("worker-a", 1, 30_000);
    assert.ok(first);
    assert.equal(first.attempts, 1);
    assert.equal(first.failureCount, 0);
    assert.equal(
      database.deferClaimedCommand(first, Number.MAX_SAFE_INTEGER, "invalid deferral"),
      false,
    );
    assert.equal(database.getCommand(first.id).status, "LEASED");
    assert.equal(database.deferClaimedCommand(first, 0, "capacity unavailable"), true);
    assert.equal(database.getCommand(first.id).failureCount, 0);

    const [second] = database.claimCommands("worker-a", 1, 30_000);
    assert.ok(second);
    assert.equal(second.attempts, 2);
    assert.equal(second.failureCount, 0);
    assert.equal(database.deferClaimedCommand(first, 0, "stale deferral"), false);
    assert.equal(database.rescheduleClaimedCommand(first, 0, "stale failure"), false);
    assert.equal(database.getCommand(second.id).leaseOwner, "worker-a");
    assert.equal(database.getCommand(second.id).failureCount, 0);

    assert.equal(database.deferClaimedCommand(second, 0, "still unavailable"), true);
    const [third] = database.claimCommands("worker-c", 1, 30_000);
    assert.ok(third);
    assert.equal(third.attempts, 3);
    assert.equal(third.failureCount, 0);
  } finally {
    database.close();
  }
});

test("external effect intent is durable, idempotent, and fenced by the exact command lease", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    database.createRun({ id: "effect-run", origin, goal: "effect intent", capabilitySnapshot: {} });
    database.insertCommand({
      id: "effect-command",
      runId: "effect-run",
      kind: "PROVISION",
      payloadHash: "effect-payload",
      payload: { flow: true },
      effectKey: "effect-key",
    });
    const [first] = database.claimCommands("worker-a", 1, 30_000);
    assert.ok(first);
    assert.equal(first.effectStartedAt, null);
    assert.equal(database.markClaimedCommandEffectStarted(first, -1), false);
    assert.equal(database.markClaimedCommandEffectStarted({ ...first, leaseOwner: "worker-b" }, 1_000), false);
    assert.equal(database.markClaimedCommandEffectStarted(first, 1_000), true);
    assert.equal(database.getCommand(first.id).effectStartedAt, 1_000);
    assert.equal(database.markClaimedCommandEffectStarted(first, 2_000), true);
    assert.equal(database.getCommand(first.id).effectStartedAt, 1_000);

    assert.equal(database.deferClaimedCommand(first, 0, "retry after fence"), true);
    const [second] = database.claimCommands("worker-b", 1, 30_000);
    assert.ok(second);
    assert.equal(second.effectStartedAt, 1_000);
    assert.equal(database.markClaimedCommandEffectStarted(first, 3_000), false);
    assert.equal(database.markClaimedCommandEffectStarted(second, 3_000), true);
    assert.equal(database.getCommand(second.id).effectStartedAt, 1_000);
  } finally {
    database.close();
  }
});

test("outbox retry scheduling is lease-fenced and unavailable before its due time", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    database.createRun({ id: "retry-run", origin, goal: "retry", capabilitySnapshot: {} });
    database.insertCommand({
      id: "retry-command",
      runId: "retry-run",
      kind: "FLOW_SYNC",
      payloadHash: "retry-payload",
      payload: { terminal: "finished" },
      effectKey: "retry-effect",
    });
    const [claimed] = database.claimCommands("worker-old", 1, 30_000);
    assert.ok(claimed);
    assert.equal(database.rescheduleClaimedCommand(claimed, 60_000, "transient failure"), true);
    assert.equal(database.getCommand(claimed.id).failureCount, 1);
    assert.deepEqual(database.claimCommands("worker-new", 1, 30_000), []);
    assert.equal(database.rescheduleClaimedCommand(claimed, 0, "stale owner"), false);
    assert.equal(database.getCommand(claimed.id).failureCount, 1);

    database.db.prepare("UPDATE commands SET available_at = 0 WHERE id = ?").run(claimed.id);
    const [reclaimed] = database.claimCommands("worker-new", 1, 30_000);
    assert.equal(reclaimed?.id, claimed.id);
    assert.equal(reclaimed?.attempts, 2);
    assert.equal(reclaimed?.failureCount, 1);
    assert.equal(database.rescheduleClaimedCommand(claimed, 0, "superseded lease"), false);
    assert.equal(database.settleClaimedCommand(claimed, "FAILED", { error: "superseded lease" }), false);
    assert.equal(database.getCommand(claimed.id).failureCount, 1);

    assert.ok(reclaimed);
    assert.equal(database.settleClaimedCommand(reclaimed, "FAILED", { error: "terminal failure" }), true);
    assert.equal(database.getCommand(reclaimed.id).failureCount, 2);
    assert.equal(database.settleClaimedCommand(reclaimed, "FAILED", { error: "duplicate settlement" }), false);
    assert.equal(database.getCommand(reclaimed.id).failureCount, 2);
  } finally {
    database.close();
  }
});

test("manual command recovery resets only failure budget and preserves fencing and effect intent", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    database.createRun({ id: "reopen-run", origin, goal: "reopen", capabilitySnapshot: {} });
    database.insertCommand({
      id: "reopen-command",
      runId: "reopen-run",
      kind: "PROVISION",
      payloadHash: "reopen-payload",
      payload: { provision: true },
      effectKey: "reopen-effect",
    });
    const [claimed] = database.claimCommands("worker-a", 1, 30_000);
    assert.ok(claimed);
    assert.equal(database.markClaimedCommandEffectStarted(claimed, 100), true);
    assert.equal(database.settleClaimedCommand(claimed, "FAILED", { error: "terminal failure" }), true);
    const failed = database.getCommand(claimed.id);
    assert.equal(failed.attempts, 1);
    assert.equal(failed.failureCount, 1);
    assert.equal(failed.effectStartedAt, 100);

    assert.equal(database.reopenFailedCommand(claimed.id, "FLOW_SYNC", 200), false);
    assert.equal(database.reopenFailedCommand(claimed.id, "PROVISION", -1), false);
    assert.equal(database.reopenFailedCommand(claimed.id, "PROVISION", 200), true);
    const reopened = database.getCommand(claimed.id);
    assert.equal(reopened.status, "PENDING");
    assert.equal(reopened.attempts, 1);
    assert.equal(reopened.failureCount, 0);
    assert.equal(reopened.effectStartedAt, 100);
    assert.equal(reopened.availableAt, 200);
  } finally {
    database.close();
  }
});

test("external command receipts reserve bounded capacity for terminal recovery commands", () => {
  const database = new CollaborationDatabase(":memory:");
  try {
    database.db.exec(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < ${PERSISTENCE_LIMITS.commandReceiptsPerRun}
      )
      INSERT INTO command_receipts(
        command_id, source, run_id, payload_hash, response_json, created_at, updated_at
      )
      SELECT 'capacity-' || value, 'RUN:RUN_ARCHIVED', 'capacity-run',
             'hash-' || value, '{}', 1, 1
      FROM sequence;
    `);
    assert.throws(
      () => database.reserveCommandReceipt({
        commandId: "capacity-overflow",
        source: "RUN:RUN_ARCHIVED",
        runId: "capacity-run",
        payloadHash: "overflow-hash",
        response: { accepted: true },
      }),
      (error: unknown) => error instanceof CollaborationError && error.code === "CAPACITY_EXCEEDED",
    );
    assert.doesNotThrow(() => database.reserveCommandReceipt({
      commandId: "capacity-emergency-cancel",
      source: "RUN:RUN_CANCEL_REQUESTED",
      runId: "capacity-run",
      payloadHash: "emergency-hash",
      response: { accepted: true },
    }));
    database.db.exec(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 2
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < ${PERSISTENCE_LIMITS.emergencyCommandReceiptsPerRun}
      )
      INSERT INTO command_receipts(
        command_id, source, run_id, payload_hash, response_json, created_at, updated_at
      )
      SELECT 'capacity-emergency-' || value, 'junqi.collab.run.delete', 'capacity-run',
             'emergency-hash-' || value, '{}', 1, 1
      FROM sequence;
    `);
    assert.throws(
      () => database.reserveCommandReceipt({
        commandId: "capacity-emergency-overflow",
        source: "junqi.collab.run.delete.retry",
        runId: "capacity-run",
        payloadHash: "emergency-overflow-hash",
        response: { accepted: true },
      }),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "CAPACITY_EXCEEDED"
        && error.details?.emergency === true
        && error.details?.limit === PERSISTENCE_LIMITS.commandReceiptsPerRun
          + PERSISTENCE_LIMITS.emergencyCommandReceiptsPerRun,
    );
  } finally {
    database.close();
  }
});

test("file-backed collaboration state is private on Unix", { skip: process.platform === "win32" }, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-db-"));
  const filePath = path.join(directory, "state", "collaboration.sqlite");
  const database = new CollaborationDatabase(filePath);
  try {
    assert.equal(statSync(path.dirname(filePath)).mode & 0o777, 0o700);
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
