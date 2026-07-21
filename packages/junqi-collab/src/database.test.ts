import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CollaborationDatabase } from "./database.js";
import { CollaborationError } from "./errors.js";
import { PERSISTENCE_LIMITS } from "./persistence-policy.js";
import { SCHEMA_VERSION } from "./schema.js";
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

test("schema v2 upgrades the active-run index to session identity", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-v2-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const original = new CollaborationDatabase(filePath);
  try {
    original.db.exec(`
      DROP INDEX collaboration_runs_active_origin;
      CREATE UNIQUE INDEX collaboration_runs_active_origin
      ON collaboration_runs(origin_runtime_id, origin_agent_id, origin_session_id, origin_native_message_id)
      WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED');
    `);
    original.setMetadata("schema_version", "2");
  } finally {
    original.close();
  }

  const migrated = new CollaborationDatabase(filePath);
  try {
    assert.equal(migrated.getMetadata("schema_version"), String(SCHEMA_VERSION));
    const columns = migrated.db
      .prepare("PRAGMA index_info('collaboration_runs_active_origin')")
      .all() as unknown as Array<{ name: string }>;
    assert.deepEqual(columns.map((column) => column.name), [
      "origin_runtime_id",
      "origin_agent_id",
      "origin_session_key",
      "origin_session_id",
    ]);
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v4 adds durable tombstone cleanup state without losing deletion evidence", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-v4-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const legacy = new CollaborationDatabase(filePath);
  try {
    legacy.db
      .prepare(
        `INSERT INTO tombstones(
          id, run_id, actor, content_digest, deleted_at,
          cleanup_status, cleanup_error, cleanup_updated_at
        ) VALUES ('tombstone-v4', 'deleted-run', 'operator', 'digest-v4', 123, 'COMPLETED', NULL, 123)`,
      )
      .run();
    legacy.db.exec(`
      ALTER TABLE tombstones DROP COLUMN cleanup_updated_at;
      ALTER TABLE tombstones DROP COLUMN cleanup_error;
      ALTER TABLE tombstones DROP COLUMN cleanup_status;
    `);
    legacy.setMetadata("schema_version", "4");
  } finally {
    legacy.close();
  }

  const migrated = new CollaborationDatabase(filePath);
  try {
    assert.equal(migrated.getMetadata("schema_version"), String(SCHEMA_VERSION));
    const row = migrated.db
      .prepare("SELECT * FROM tombstones WHERE run_id = 'deleted-run'")
      .get() as Record<string, unknown>;
    assert.equal(row.actor, "operator");
    assert.equal(row.content_digest, "digest-v4");
    assert.equal(row.cleanup_status, "COMPLETED");
    assert.equal(row.cleanup_error, null);
    assert.equal(row.cleanup_updated_at, 0);
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v5 backfills run-independent command receipts", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-v5-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const legacy = new CollaborationDatabase(filePath);
  try {
    legacy.createRun({ id: "receipt-run", origin, goal: "receipt migration", capabilitySnapshot: {} });
    legacy.insertCommand({
      id: "receipt-command",
      runId: "receipt-run",
      kind: "EXPORT",
      payloadHash: "receipt-payload-hash",
      payload: { noop: true },
      effectKey: "receipt-effect",
      response: { accepted: true, commandId: "receipt-command" },
    });
    legacy.db.prepare("DELETE FROM command_receipts").run();
    legacy.setMetadata("schema_version", "5");
  } finally {
    legacy.close();
  }

  const migrated = new CollaborationDatabase(filePath);
  try {
    assert.equal(migrated.getMetadata("schema_version"), String(SCHEMA_VERSION));
    assert.deepEqual(migrated.getCommandReceipt("receipt-command"), {
      source: "LEGACY_COMMAND",
      payloadHash: "receipt-payload-hash",
      response: { accepted: true, commandId: "receipt-command" },
    });
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v6 quarantines a reused cross-namespace command id without blocking startup", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-v6-conflict-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const legacy = new CollaborationDatabase(filePath);
  try {
    legacy.createRun({ id: "conflict-run", origin, goal: "receipt conflict", capabilitySnapshot: {} });
    legacy.insertCommand({
      id: "conflicting-command",
      runId: "conflict-run",
      kind: "EXPORT",
      payloadHash: "run-payload",
      payload: { noop: true },
      effectKey: "conflict-effect",
      response: { accepted: true },
    });
    const timestamp = Date.now();
    legacy.db
      .prepare(
        `INSERT INTO session_mutations(
          id, runtime_id, session_key, session_id, action, policy, status,
          lease_expires_at, result_json, created_at, updated_at
        ) VALUES ('conflict-mutation', 'runtime', 'session-key', 'session-id', 'delete',
          'PROCEED', 'COMPLETED', ?, '{}', ?, ?)`,
      )
      .run(timestamp, timestamp, timestamp);
    legacy.db
      .prepare(
        `INSERT INTO session_mutation_commands(
          command_id, mutation_id, operation, payload_hash, response_json, created_at, updated_at
        ) VALUES ('conflicting-command', 'conflict-mutation', 'COMPLETE', 'mutation-payload', '{}', ?, ?)`,
      )
      .run(timestamp, timestamp);
    legacy.db.prepare("DELETE FROM command_receipts").run();
    legacy.setMetadata("schema_version", "5");
  } finally {
    legacy.close();
  }

  const migrated = new CollaborationDatabase(filePath);
  try {
    assert.equal(migrated.getMetadata("schema_version"), String(SCHEMA_VERSION));
    assert.match(String(migrated.getCommandReceiptConflict("conflicting-command")), /legacy command id was reused/);
    assert.throws(
      () => migrated.reserveCommandReceipt({
        commandId: "conflicting-command",
        source: "junqi.collab.run.archive",
        runId: "conflict-run",
        payloadHash: "run-payload",
        response: { accepted: true },
      }),
      (error: unknown) => error instanceof CollaborationError && error.code === "IDEMPOTENCY_CONFLICT",
    );
    assert.doesNotThrow(() => migrated.reserveCommandReceipt({
      commandId: "unrelated-command",
      source: "junqi.collab.run.archive",
      runId: "conflict-run",
      payloadHash: "unrelated-payload",
      response: { accepted: true },
    }));
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v7 adds delayed outbox scheduling without losing existing commands", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-v7-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const legacy = new CollaborationDatabase(filePath);
  try {
    legacy.createRun({ id: "v7-run", origin, goal: "migrate outbox", capabilitySnapshot: {} });
    legacy.insertCommand({
      id: "v7-command",
      runId: "v7-run",
      kind: "EXPORT",
      payloadHash: "v7-payload",
      payload: { noop: true },
      effectKey: "v7-effect",
    });
    legacy.db.exec("DROP INDEX IF EXISTS commands_available; ALTER TABLE commands DROP COLUMN available_at;");
    legacy.setMetadata("schema_version", "6");
  } finally {
    legacy.close();
  }

  const migrated = new CollaborationDatabase(filePath);
  try {
    assert.equal(migrated.getMetadata("schema_version"), String(SCHEMA_VERSION));
    assert.equal(migrated.getCommand("v7-command").availableAt, 0);
    const index = migrated.db.prepare("PRAGMA index_info('commands_available')").all() as Array<{ name: string }>;
    assert.deepEqual(index.map((column) => column.name), [
      "status",
      "available_at",
      "lease_expires_at",
      "created_at",
    ]);
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v8 and v9 add failure accounting and effect intent without changing lease generations or scheduling indexes", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-v8-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const legacy = new CollaborationDatabase(filePath);
  try {
    legacy.createRun({ id: "v8-run", origin, goal: "migrate failure accounting", capabilitySnapshot: {} });
    legacy.insertCommand({
      id: "v8-command",
      runId: "v8-run",
      kind: "FLOW_SYNC",
      payloadHash: "v8-payload",
      payload: { terminal: "finished" },
      effectKey: "v8-effect",
    });
    legacy.db
      .prepare(
        `UPDATE commands SET status = 'FAILED', attempts = 4, available_at = 1234,
         last_error = 'legacy failure' WHERE id = 'v8-command'`,
      )
      .run();
    legacy.db.exec("ALTER TABLE commands DROP COLUMN failure_count;");
    legacy.db.exec("ALTER TABLE commands DROP COLUMN effect_started_at;");
    legacy.setMetadata("schema_version", "7");
  } finally {
    legacy.close();
  }

  const migrated = new CollaborationDatabase(filePath);
  try {
    assert.equal(migrated.getMetadata("schema_version"), String(SCHEMA_VERSION));
    const command = migrated.getCommand("v8-command");
    assert.equal(command.status, "FAILED");
    assert.equal(command.attempts, 4);
    assert.equal(command.failureCount, 0);
    assert.equal(command.effectStartedAt, null);
    assert.equal(command.availableAt, 1234);
    assert.deepEqual(command.payload, { terminal: "finished" });

    const failureColumn = (
      migrated.db.prepare("PRAGMA table_info('commands')").all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>
    ).find((column) => column.name === "failure_count");
    assert.deepEqual(failureColumn && {
      name: failureColumn.name,
      type: failureColumn.type,
      notnull: Number(failureColumn.notnull),
      defaultValue: failureColumn.dflt_value,
    }, {
      name: "failure_count",
      type: "INTEGER",
      notnull: 1,
      defaultValue: "0",
    });

    const effectIntentColumn = (
      migrated.db.prepare("PRAGMA table_info('commands')").all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>
    ).find((column) => column.name === "effect_started_at");
    assert.deepEqual(effectIntentColumn && {
      name: effectIntentColumn.name,
      type: effectIntentColumn.type,
      notnull: Number(effectIntentColumn.notnull),
      defaultValue: effectIntentColumn.dflt_value,
    }, {
      name: "effect_started_at",
      type: "INTEGER",
      notnull: 0,
      defaultValue: null,
    });

    const schedulingIndex = migrated.db
      .prepare("PRAGMA index_info('commands_available')")
      .all() as Array<{ name: string }>;
    assert.deepEqual(schedulingIndex.map((column) => column.name), [
      "status",
      "available_at",
      "lease_expires_at",
      "created_at",
    ]);
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v9 adds effect intent to an intermediate schema v8 database", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-v9-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const intermediate = new CollaborationDatabase(filePath);
  try {
    intermediate.createRun({ id: "v9-run", origin, goal: "migrate effect intent", capabilitySnapshot: {} });
    intermediate.insertCommand({
      id: "v9-command",
      runId: "v9-run",
      kind: "PROVISION",
      payloadHash: "v9-payload",
      payload: { provision: true },
      effectKey: "v9-effect",
    });
    intermediate.db.prepare("UPDATE commands SET failure_count = 2, attempts = 5 WHERE id = ?").run("v9-command");
    intermediate.db.exec("ALTER TABLE commands DROP COLUMN effect_started_at;");
    intermediate.setMetadata("schema_version", "8");
  } finally {
    intermediate.close();
  }

  const migrated = new CollaborationDatabase(filePath);
  try {
    assert.equal(migrated.getMetadata("schema_version"), String(SCHEMA_VERSION));
    const command = migrated.getCommand("v9-command");
    assert.equal(command.attempts, 5);
    assert.equal(command.failureCount, 2);
    assert.equal(command.effectStartedAt, null);
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v10 adds durable Flow abandonment evidence to existing tombstones", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-v10-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const intermediate = new CollaborationDatabase(filePath);
  try {
    intermediate.db.prepare(
      `INSERT INTO tombstones(
        id, run_id, actor, content_digest, deleted_at,
        cleanup_status, cleanup_error, cleanup_updated_at
      ) VALUES ('v10-tombstone', 'v10-run', 'operator', 'digest', 100, 'COMPLETED', NULL, 100)`,
    ).run();
    for (const column of [
      "flow_reconciliation_abandon_reason",
      "flow_reconciliation_abandoned_at",
      "flow_reconciliation_diagnostic",
      "openclaw_flow_revision",
      "openclaw_flow_id",
      "flow_reconciliation_command_id",
    ]) {
      intermediate.db.exec(`ALTER TABLE tombstones DROP COLUMN ${column};`);
    }
    intermediate.setMetadata("schema_version", "9");
  } finally {
    intermediate.close();
  }

  const migrated = new CollaborationDatabase(filePath);
  try {
    assert.equal(migrated.getMetadata("schema_version"), String(SCHEMA_VERSION));
    const row = migrated.db.prepare("SELECT * FROM tombstones WHERE id = ?").get("v10-tombstone") as Record<string, unknown>;
    assert.equal(row.run_id, "v10-run");
    assert.equal(row.flow_reconciliation_command_id, null);
    assert.equal(row.openclaw_flow_id, null);
    assert.equal(row.openclaw_flow_revision, null);
    assert.equal(row.flow_reconciliation_abandon_reason, null);
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v11 adds the authoritative deletion job reference to existing tombstones", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-v11-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const intermediate = new CollaborationDatabase(filePath);
  try {
    intermediate.db.exec("ALTER TABLE tombstones DROP COLUMN deletion_job_id;");
    intermediate.setMetadata("schema_version", "10");
  } finally {
    intermediate.close();
  }

  const migrated = new CollaborationDatabase(filePath);
  try {
    assert.equal(migrated.getMetadata("schema_version"), String(SCHEMA_VERSION));
    const columns = new Set(
      (migrated.db.prepare("PRAGMA table_info('tombstones')").all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
    assert.equal(columns.has("deletion_job_id"), true);
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v12 freezes legacy Attempt execution runtimes without guessing ACP", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-v12-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const intermediate = new CollaborationDatabase(filePath);
  try {
    intermediate.createRun({
      id: "v12-run",
      origin,
      goal: "backfill attempt runtimes",
      capabilitySnapshot: {
        configuredFacts: {
          agents: [
            { id: "worker-acp", runtimeType: "acp" },
            { id: "worker-native", runtimeType: "native" },
          ],
        },
      },
    });
    const insert = intermediate.db.prepare(`
      INSERT INTO attempts(
        id, run_id, kind, attempt_no, idempotency_key, worker_agent_id,
        execution_runtime, worker_owner_session_key, child_session_key,
        status, input_json, revision, created_at, updated_at
      ) VALUES (?, 'v12-run', 'WORKER', ?, ?, ?, 'native', ?, ?, 'CREATED', '{}', 1, 1, 1)
    `);
    insert.run("v12-acp-from-snapshot", 1, "v12-effect-1", "worker-acp", "agent:worker-acp:main", "agent:worker-acp:subagent:one");
    insert.run("v12-acp-from-key", 2, "v12-effect-2", "worker-native", "agent:worker-native:main", "agent:worker-native:acp:two");
    insert.run("v12-native", 3, "v12-effect-3", "worker-native", "agent:worker-native:main", "agent:worker-native:subagent:three");
    intermediate.db.exec("ALTER TABLE attempts DROP COLUMN execution_runtime;");
    intermediate.setMetadata("schema_version", "11");
  } finally {
    intermediate.close();
  }

  const migrated = new CollaborationDatabase(filePath);
  try {
    assert.equal(migrated.getMetadata("schema_version"), String(SCHEMA_VERSION));
    const rows = migrated.db
      .prepare("SELECT id, execution_runtime FROM attempts WHERE run_id = ? ORDER BY attempt_no")
      .all("v12-run") as Array<{ id: string; execution_runtime: string }>;
    assert.deepEqual(rows.map((row) => ({ ...row })), [
      { id: "v12-acp-from-snapshot", execution_runtime: "acp" },
      { id: "v12-acp-from-key", execution_runtime: "acp" },
      { id: "v12-native", execution_runtime: "native" },
    ]);
    assert.throws(
      () => migrated.db.prepare("UPDATE attempts SET execution_runtime = 'remote' WHERE id = ?").run("v12-native"),
      /CHECK constraint failed/,
    );
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("database rejects a schema newer than this plugin without rewriting its version", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-newer-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const database = new CollaborationDatabase(filePath);
  database.setMetadata("schema_version", String(SCHEMA_VERSION + 1));
  database.close();
  try {
    assert.throws(
      () => new CollaborationDatabase(filePath),
      new RegExp(`schema ${SCHEMA_VERSION + 1} is newer than supported ${SCHEMA_VERSION}`),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("schema v3 migration fails closed when legacy data has concurrent session runs", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-schema-conflict-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const legacy = new CollaborationDatabase(filePath);
  try {
    legacy.db.exec(`
      DROP INDEX collaboration_runs_active_origin;
      CREATE UNIQUE INDEX collaboration_runs_active_origin
      ON collaboration_runs(origin_runtime_id, origin_agent_id, origin_session_id, origin_native_message_id)
      WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED');
    `);
    legacy.setMetadata("schema_version", "2");
    legacy.createRun({ id: "run-1", origin, goal: "first", capabilitySnapshot: {} });
    legacy.createRun({
      id: "run-2",
      origin: { ...origin, nativeMessageId: "message-2" },
      goal: "second",
      capabilitySnapshot: {},
    });
  } finally {
    legacy.close();
  }

  try {
    assert.throws(
      () => new CollaborationDatabase(filePath),
      /schema 3 migration is blocked by 2 active runs in session session-1/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
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
