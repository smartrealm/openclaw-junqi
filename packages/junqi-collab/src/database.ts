import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { CollaborationError, assertCondition } from "./errors.js";
import {
  PERSISTENCE_LIMITS,
  assertBoundedJson,
  assertBoundedText,
  assertOriginBounded,
  assertPersistableText,
  boundedDiagnostic,
  sanitizeStoredJsonForOutput,
} from "./persistence-policy.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";
import type { CommandKind, CommandRecord, EventRecord, OriginRef, RunSummary, RunStatus } from "./types.js";
import { newId, nowMs, stableStringify } from "./util.js";

type SqlRow = Record<string, SQLOutputValue>;
type SynchronousResultConstraint<Result> = [Result] extends [never]
  ? unknown
  : [Extract<Result, PromiseLike<unknown>>] extends [never]
    ? unknown
    : never;

const SYNCHRONOUS_TRANSACTION_ERROR =
  "CollaborationDatabase transaction callbacks must be synchronous";

function rejectPromiseLikeTransactionResult(value: unknown): void {
  const promiseLike = (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && typeof (value as { then?: unknown }).then === "function";
  if (!promiseLike) return;

  // A JavaScript/any caller can bypass the compile-time contract. Observe a
  // possible rejection, then throw while the SQL transaction is still open so
  // the surrounding catch rolls it back instead of committing a partial unit.
  void Promise.resolve(value as PromiseLike<unknown>).catch(() => undefined);
  throw new TypeError(SYNCHRONOUS_TRANSACTION_ERROR);
}

export interface RunListCursor {
  createdAt: number;
  id: string;
  snapshotCreatedAt: number;
  snapshotId: string;
}

export interface RunListPage {
  runs: RunSummary[];
  nextCursor: RunListCursor | null;
}

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["COMPLETED", "CANCELLED", "FAILED"]);
const EMERGENCY_COMMAND_RECEIPT_SOURCES = new Set([
  "RUN:DISPATCH_STOPPED",
  "RUN:RUN_CANCEL_REQUESTED",
  "WORK_ITEM:WORK_ITEM_CANCEL_REQUESTED",
  "DELIVERY:DELIVERY_ABANDONED",
  "junqi.collab.run.delete",
  "junqi.collab.run.delete.retry",
]);

function parseJson<T>(value: SQLOutputValue | undefined, fallback: T): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : fallback;
}

function nullableString(value: SQLOutputValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: SQLOutputValue | undefined): number {
  return typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : 0;
}

function legacyAttemptExecutionRuntime(row: SqlRow): "native" | "acp" {
  if (typeof row.child_session_key === "string" && row.child_session_key.includes(":acp:")) {
    return "acp";
  }
  if (typeof row.capability_snapshot_json !== "string" || typeof row.worker_agent_id !== "string") {
    return "native";
  }
  try {
    const snapshot = JSON.parse(row.capability_snapshot_json) as {
      configuredFacts?: { agents?: Array<{ id?: unknown; runtimeType?: unknown }> };
    };
    const agent = snapshot.configuredFacts?.agents?.find(
      (candidate) => candidate.id === row.worker_agent_id,
    );
    return agent?.runtimeType === "acp" ? "acp" : "native";
  } catch {
    return "native";
  }
}

export class CollaborationDatabase {
  readonly db: DatabaseSync;
  readonly #instanceId: string;
  #transactionDepth = 0;
  #savepointSequence = 0;

  constructor(readonly filePath: string) {
    if (filePath !== ":memory:") {
      const directory = path.dirname(filePath);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      securePermissions(directory, 0o700);
    }
    this.db = new DatabaseSync(filePath);
    let instanceId: string;
    try {
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
      this.migrate();
      const persistedInstanceId = this.getMetadata("collaboration_instance_id");
      if (!persistedInstanceId) throw new Error("collaboration instance id is missing");
      instanceId = persistedInstanceId;
      this.secureDatabaseFiles();
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.#instanceId = instanceId;
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.transaction(() => {
      this.db.exec(SCHEMA_SQL);
      const current = this.getMetadata("schema_version");
      const currentVersion = current == null ? 0 : Number(current);
      if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
        throw new Error(`database schema version is invalid: ${current}`);
      }
      if (currentVersion > SCHEMA_VERSION) {
        throw new Error(`database schema ${current} is newer than supported ${SCHEMA_VERSION}`);
      }
      if (currentVersion > 0 && currentVersion < 3) {
        const conflict = this.db.prepare(`
          SELECT origin_runtime_id, origin_agent_id, origin_session_key, origin_session_id, COUNT(*) AS active_count
          FROM collaboration_runs
          WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED')
          GROUP BY origin_runtime_id, origin_agent_id, origin_session_key, origin_session_id
          HAVING COUNT(*) > 1
          LIMIT 1
        `).get() as SqlRow | undefined;
        if (conflict) {
          throw new Error(
            `database schema 3 migration is blocked by ${numberValue(conflict.active_count)} active runs in session ${String(conflict.origin_session_id)}`,
          );
        }
        this.db.exec(`
          DROP INDEX IF EXISTS collaboration_runs_active_origin;
          CREATE UNIQUE INDEX collaboration_runs_active_origin
          ON collaboration_runs(origin_runtime_id, origin_agent_id, origin_session_key, origin_session_id)
          WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED');
        `);
      }
      if (currentVersion < 5) {
        const tombstoneColumns = new Set(
          (this.db.prepare("PRAGMA table_info('tombstones')").all() as SqlRow[])
            .map((row) => String(row.name)),
        );
        if (!tombstoneColumns.has("cleanup_status")) {
          this.db.exec("ALTER TABLE tombstones ADD COLUMN cleanup_status TEXT NOT NULL DEFAULT 'COMPLETED'");
        }
        if (!tombstoneColumns.has("cleanup_error")) {
          this.db.exec("ALTER TABLE tombstones ADD COLUMN cleanup_error TEXT");
        }
        if (!tombstoneColumns.has("cleanup_updated_at")) {
          this.db.exec("ALTER TABLE tombstones ADD COLUMN cleanup_updated_at INTEGER NOT NULL DEFAULT 0");
        }
      }
      if (currentVersion < 6) {
        this.db.exec(`
          INSERT OR IGNORE INTO command_receipt_conflicts(command_id, diagnostic, created_at)
          SELECT sm.command_id, 'legacy command id was reused across session mutation and collaboration operations',
                 MIN(sm.created_at)
          FROM session_mutation_commands sm
          WHERE EXISTS (SELECT 1 FROM commands c WHERE c.id = sm.command_id)
             OR EXISTS (SELECT 1 FROM deletion_command_receipts d WHERE d.command_id = sm.command_id)
          GROUP BY sm.command_id;

          INSERT OR IGNORE INTO command_receipt_conflicts(command_id, diagnostic, created_at)
          SELECT d.command_id, 'legacy deletion command id has conflicting payload hashes', MIN(d.created_at)
          FROM deletion_command_receipts d
          JOIN commands c ON c.id = d.command_id
          WHERE d.payload_hash <> c.payload_hash
          GROUP BY d.command_id;

          INSERT OR IGNORE INTO command_receipts(
            command_id, source, run_id, payload_hash, response_json, created_at, updated_at
          )
          SELECT command_id, 'LEGACY_DELETE', run_id, payload_hash, response_json, created_at, updated_at
          FROM deletion_command_receipts;

          INSERT OR IGNORE INTO command_receipts(
            command_id, source, run_id, payload_hash, response_json, created_at, updated_at
          )
          SELECT id,
            CASE
              WHEN kind = 'PLAN' AND effect_key LIKE '%:plan:pending:%' THEN 'junqi.collab.plan.create'
              WHEN kind = 'PLAN' AND effect_key LIKE '%:plan:revision:%' THEN 'junqi.collab.plan.revise'
              WHEN kind = 'PROVISION' THEN 'junqi.collab.plan.approve'
              WHEN kind = 'EXPORT' AND json_extract(payload_json, '$.jobId') IS NOT NULL THEN 'junqi.collab.export.create'
              WHEN kind = 'EXPORT' AND json_extract(payload_json, '$.eventType') IS NOT NULL
                THEN 'RUN:' || json_extract(payload_json, '$.eventType')
              ELSE 'LEGACY_COMMAND'
            END,
            run_id, payload_hash, response_json, created_at, updated_at
          FROM commands
          WHERE response_json IS NOT NULL;

          INSERT OR IGNORE INTO command_receipts(
            command_id, source, run_id, payload_hash, response_json, created_at, updated_at
          )
          SELECT command_id, 'SESSION_MUTATION:' || operation, NULL, payload_hash, response_json, created_at, updated_at
          FROM session_mutation_commands;
        `);
      }
      if (currentVersion < 7) {
        const commandColumns = new Set(
          (this.db.prepare("PRAGMA table_info('commands')").all() as SqlRow[])
            .map((row) => String(row.name)),
        );
        if (!commandColumns.has("available_at")) {
          this.db.exec("ALTER TABLE commands ADD COLUMN available_at INTEGER NOT NULL DEFAULT 0");
        }
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS commands_available
          ON commands(status, available_at, lease_expires_at, created_at);
        `);
      }
      if (currentVersion < 8) {
        const commandColumns = new Set(
          (this.db.prepare("PRAGMA table_info('commands')").all() as SqlRow[])
            .map((row) => String(row.name)),
        );
        if (!commandColumns.has("failure_count")) {
          this.db.exec("ALTER TABLE commands ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0");
        }
      }
      if (currentVersion < 9) {
        const commandColumns = new Set(
          (this.db.prepare("PRAGMA table_info('commands')").all() as SqlRow[])
            .map((row) => String(row.name)),
        );
        if (!commandColumns.has("effect_started_at")) {
          this.db.exec("ALTER TABLE commands ADD COLUMN effect_started_at INTEGER");
        }
      }
      if (currentVersion < 10) {
        const tombstoneColumns = new Set(
          (this.db.prepare("PRAGMA table_info('tombstones')").all() as SqlRow[])
            .map((row) => String(row.name)),
        );
        const additions = [
          ["flow_reconciliation_command_id", "TEXT"],
          ["openclaw_flow_id", "TEXT"],
          ["openclaw_flow_revision", "INTEGER"],
          ["flow_reconciliation_diagnostic", "TEXT"],
          ["flow_reconciliation_abandoned_at", "INTEGER"],
          ["flow_reconciliation_abandon_reason", "TEXT"],
        ] as const;
        for (const [column, type] of additions) {
          if (!tombstoneColumns.has(column)) {
            this.db.exec(`ALTER TABLE tombstones ADD COLUMN ${column} ${type}`);
          }
        }
      }
      if (currentVersion < 11) {
        const tombstoneColumns = new Set(
          (this.db.prepare("PRAGMA table_info('tombstones')").all() as SqlRow[])
            .map((row) => String(row.name)),
        );
        if (!tombstoneColumns.has("deletion_job_id")) {
          this.db.exec("ALTER TABLE tombstones ADD COLUMN deletion_job_id TEXT");
        }
      }
      if (currentVersion < 12) {
        const attemptColumns = new Set(
          (this.db.prepare("PRAGMA table_info('attempts')").all() as SqlRow[])
            .map((row) => String(row.name)),
        );
        if (!attemptColumns.has("execution_runtime")) {
          this.db.exec(
            "ALTER TABLE attempts ADD COLUMN execution_runtime TEXT NOT NULL DEFAULT 'native' CHECK(execution_runtime IN ('native', 'acp'))",
          );
        }
        const legacyAttempts = this.db.prepare(`
          SELECT a.id, a.worker_agent_id, a.child_session_key, r.capability_snapshot_json
          FROM attempts a
          JOIN collaboration_runs r ON r.id = a.run_id
        `).all() as SqlRow[];
        const updateRuntime = this.db.prepare(
          "UPDATE attempts SET execution_runtime = ? WHERE id = ?",
        );
        for (const attempt of legacyAttempts) {
          updateRuntime.run(legacyAttemptExecutionRuntime(attempt), String(attempt.id));
        }
      }
      this.setMetadata("schema_version", String(SCHEMA_VERSION));
      if (!this.getMetadata("collaboration_instance_id")) {
        this.setMetadata("collaboration_instance_id", newId("instance"));
      }
      // Confirmation values are stale-state guards, not authentication
      // credentials. They are derived from the instance id, so no secret or
      // token needs to live in collaboration storage.
      this.db.prepare("DELETE FROM metadata WHERE key = 'confirmation_secret'").run();
    });
  }

  transaction<Result>(run: (() => Result) & SynchronousResultConstraint<Result>): Result {
    return this.runTransaction("IMMEDIATE", run);
  }

  readTransaction<Result>(run: (() => Result) & SynchronousResultConstraint<Result>): Result {
    return this.runTransaction("DEFERRED", run);
  }

  private runTransaction<Result>(
    mode: "IMMEDIATE" | "DEFERRED",
    run: () => Result,
  ): Result {
    if (this.#transactionDepth > 0) return this.runSavepoint(run);
    this.db.exec(`BEGIN ${mode}`);
    this.#transactionDepth = 1;
    try {
      const result = run();
      rejectPromiseLikeTransactionResult(result);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Preserve the original transaction or validation error.
      }
      throw error;
    } finally {
      this.#transactionDepth = 0;
    }
  }

  private runSavepoint<Result>(run: () => Result): Result {
    const savepoint = `junqi_nested_${++this.#savepointSequence}`;
    this.db.exec(`SAVEPOINT ${savepoint}`);
    this.#transactionDepth += 1;
    try {
      const result = run();
      rejectPromiseLikeTransactionResult(result);
      this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } catch {
        // Preserve the original nested transaction error.
      }
      throw error;
    } finally {
      this.#transactionDepth -= 1;
    }
  }

  integrityCheck(): string {
    const row = this.db.prepare("PRAGMA integrity_check").get() as SqlRow | undefined;
    const value = row ? Object.values(row)[0] : undefined;
    return typeof value === "string" ? value : "unknown";
  }

  checkpoint(): void {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.secureDatabaseFiles();
  }

  secureDatabaseFiles(): void {
    if (this.filePath === ":memory:") return;
    for (const candidate of [this.filePath, `${this.filePath}-wal`, `${this.filePath}-shm`]) {
      if (existsSync(candidate)) securePermissions(candidate, 0o600);
    }
  }

  getMetadata(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as SqlRow | undefined;
    return nullableString(row?.value);
  }

  setMetadata(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO metadata(key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, nowMs());
  }

  get instanceId(): string {
    return this.#instanceId;
  }

  createRun(params: {
    id: string;
    origin: OriginRef;
    goal: string;
    capabilitySnapshot: Record<string, unknown>;
    configHash?: string;
  }): RunSummary {
    assertOriginBounded(params.origin);
    assertPersistableText(params.goal, "goal", PERSISTENCE_LIMITS.goalBytes);
    assertBoundedJson(
      params.capabilitySnapshot,
      "capabilitySnapshot",
      PERSISTENCE_LIMITS.capabilitySnapshotBytes,
    );
    const now = nowMs();
    try {
      this.db
        .prepare(
          `INSERT INTO collaboration_runs(
            id, origin_runtime_id, origin_agent_id, origin_session_key, origin_session_id,
            origin_native_message_id, origin_client_message_id, origin_channel, origin_account_id,
            origin_target, origin_thread_id, goal, status, dispatch_state, archive_state,
            reconcile_state, revision, capability_snapshot_json, capability_config_hash,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNING', 'CLOSED', 'ACTIVE', 'IDLE', 1, ?, ?, ?, ?)`,
        )
        .run(
          params.id,
          params.origin.runtimeId,
          params.origin.agentId,
          params.origin.sessionKey,
          params.origin.sessionId,
          params.origin.nativeMessageId,
          params.origin.clientMessageId ?? null,
          params.origin.channel ?? null,
          params.origin.accountId ?? null,
          params.origin.target ?? null,
          params.origin.threadId != null ? String(params.origin.threadId) : null,
          params.goal,
          stableStringify(params.capabilitySnapshot),
          params.configHash ?? null,
          now,
          now,
        );
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed")) {
        const existing = this.findActiveRunByOrigin(params.origin);
        throw new CollaborationError("ACTIVE_RUN_EXISTS", "This session already has an active collaboration run", {
          runId: existing?.id,
        });
      }
      throw error;
    }
    this.appendEvent(params.id, "RUN_CREATED", "run", params.id, 1, { goal: params.goal });
    return this.getRunSummary(params.id);
  }

  findActiveRunByOrigin(origin: OriginRef): RunSummary | null {
    const row = this.db
      .prepare(
        `SELECT * FROM collaboration_runs
         WHERE origin_runtime_id = ? AND origin_agent_id = ? AND origin_session_id = ?
           AND origin_session_key = ?
           AND status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED')
         LIMIT 1`,
      )
      .get(origin.runtimeId, origin.agentId, origin.sessionId, origin.sessionKey) as SqlRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  getRunRow(runId: string): SqlRow {
    const row = this.db.prepare("SELECT * FROM collaboration_runs WHERE id = ?").get(runId) as SqlRow | undefined;
    if (!row) throw new CollaborationError("NOT_FOUND", `Collaboration run ${runId} was not found`);
    return row;
  }

  getRunSummary(runId: string): RunSummary {
    return this.mapRun(this.getRunRow(runId));
  }

  listRuns(params: {
    sessionKey?: string;
    sessionId?: string;
    includeArchived?: boolean;
    activeOnly?: boolean;
    limit?: number;
    cursor?: RunListCursor;
  } = {}): RunSummary[] {
    if (params.cursor) return this.listRunsPage(params).runs;

    const where: string[] = [];
    const values: Array<string | number> = [];
    if (params.sessionKey) {
      where.push("origin_session_key = ?");
      values.push(params.sessionKey);
    }
    if (params.sessionId) {
      where.push("origin_session_id = ?");
      values.push(params.sessionId);
    }
    if (!params.includeArchived) where.push("archive_state = 'ACTIVE'");
    if (params.activeOnly) where.push("status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED')");
    const limit = Math.min(500, Math.max(1, params.limit ?? 100));
    values.push(limit);
    const sql = `SELECT * FROM collaboration_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC, id DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...values) as SqlRow[]).map((row) => this.mapRun(row));
  }

  listRunsPage(params: {
    sessionKey?: string;
    sessionId?: string;
    includeArchived?: boolean;
    activeOnly?: boolean;
    limit?: number;
    cursor?: RunListCursor;
  } = {}): RunListPage {
    return this.readTransaction(() => {
      const baseWhere: string[] = [];
      const baseValues: Array<string | number> = [];
      if (params.sessionKey) {
        baseWhere.push("origin_session_key = ?");
        baseValues.push(params.sessionKey);
      }
      if (params.sessionId) {
        baseWhere.push("origin_session_id = ?");
        baseValues.push(params.sessionId);
      }
      if (!params.includeArchived) baseWhere.push("archive_state = 'ACTIVE'");
      if (params.activeOnly) baseWhere.push("status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED')");

      const snapshot = params.cursor ?? (() => {
        const boundarySql = `SELECT created_at, id FROM collaboration_runs
          ${baseWhere.length ? `WHERE ${baseWhere.join(" AND ")}` : ""}
          ORDER BY created_at DESC, id DESC LIMIT 1`;
        const boundary = this.db.prepare(boundarySql).get(...baseValues) as SqlRow | undefined;
        return boundary
          ? {
              createdAt: numberValue(boundary.created_at),
              id: String(boundary.id),
              snapshotCreatedAt: numberValue(boundary.created_at),
              snapshotId: String(boundary.id),
            }
          : null;
      })();
      if (!snapshot) return { runs: [], nextCursor: null };

      const where = [...baseWhere];
      const values = [...baseValues];
      where.push("(created_at < ? OR (created_at = ? AND id <= ?))");
      values.push(snapshot.snapshotCreatedAt, snapshot.snapshotCreatedAt, snapshot.snapshotId);
      if (params.cursor) {
        where.push("(created_at < ? OR (created_at = ? AND id < ?))");
        values.push(params.cursor.createdAt, params.cursor.createdAt, params.cursor.id);
      }
      const limit = Math.min(500, Math.max(1, params.limit ?? 100));
      values.push(limit + 1);
      const sql = `SELECT * FROM collaboration_runs WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC, id DESC LIMIT ?`;
      const rows = this.db.prepare(sql).all(...values) as SqlRow[];
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const runs = pageRows.map((row) => this.mapRun(row));
      const last = pageRows.at(-1);
      return {
        runs,
        nextCursor: hasMore && last
          ? {
              createdAt: numberValue(last.created_at),
              id: String(last.id),
              snapshotCreatedAt: snapshot.snapshotCreatedAt,
              snapshotId: snapshot.snapshotId,
            }
          : null,
      };
    });
  }

  listActiveRunsByIdPage(params: { afterId?: string; limit?: number } = {}): RunSummary[] {
    const where = ["status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED')"];
    const values: Array<string | number> = [];
    if (params.afterId) {
      where.push("id > ?");
      values.push(params.afterId);
    }
    const limit = Math.min(500, Math.max(1, params.limit ?? 500));
    values.push(limit);
    const rows = this.db
      .prepare(`SELECT * FROM collaboration_runs WHERE ${where.join(" AND ")} ORDER BY id ASC LIMIT ?`)
      .all(...values) as SqlRow[];
    return rows.map((row) => this.mapRun(row));
  }

  countActiveRuns(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM collaboration_runs WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'FAILED')")
      .get() as SqlRow;
    return numberValue(row.count);
  }

  *scanActiveRunsById(params: { batchSize?: number } = {}): Generator<RunSummary> {
    const batchSize = Math.min(500, Math.max(1, params.batchSize ?? 500));
    let afterId: string | undefined;
    while (true) {
      const page = this.listActiveRunsByIdPage({ ...(afterId ? { afterId } : {}), limit: batchSize });
      if (page.length === 0) return;
      for (const run of page) yield run;
      if (page.length < batchSize) return;
      afterId = page[page.length - 1]!.id;
    }
  }

  updateRun(
    runId: string,
    expectedRevision: number,
    patch: Partial<{
      status: RunStatus;
      resumeStatus: RunStatus | null;
      dispatchState: string;
      archiveState: string;
      reconcileState: string;
      completionOutcome: string | null;
      currentPlanRevisionId: string | null;
      openclawFlowId: string | null;
      openclawFlowRevision: number | null;
      cancelRequestedAt: number | null;
      failureCode: string | null;
      failureMessage: string | null;
      endedAt: number | null;
    }>,
  ): RunSummary {
    if (patch.openclawFlowId) {
      assertPersistableText(
        patch.openclawFlowId,
        "OpenClaw managed flow id",
        PERSISTENCE_LIMITS.externalReferenceBytes,
      );
    }
    if (patch.failureCode) assertBoundedText(patch.failureCode, "run failure code", 256);
    if (patch.failureMessage) patch.failureMessage = boundedDiagnostic(patch.failureMessage);
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    const mapping: Record<string, string> = {
      status: "status",
      resumeStatus: "resume_status",
      dispatchState: "dispatch_state",
      archiveState: "archive_state",
      reconcileState: "reconcile_state",
      completionOutcome: "completion_outcome",
      currentPlanRevisionId: "current_plan_revision_id",
      openclawFlowId: "openclaw_flow_id",
      openclawFlowRevision: "openclaw_flow_revision",
      cancelRequestedAt: "cancel_requested_at",
      failureCode: "failure_code",
      failureMessage: "failure_message",
      endedAt: "ended_at",
    };
    for (const [key, value] of Object.entries(patch)) {
      const column = mapping[key];
      if (!column || value === undefined) continue;
      fields.push(`${column} = ?`);
      values.push(value);
    }
    fields.push("revision = revision + 1", "updated_at = ?");
    values.push(nowMs(), runId, expectedRevision);
    const result = this.db
      .prepare(`UPDATE collaboration_runs SET ${fields.join(", ")} WHERE id = ? AND revision = ?`)
      .run(...values);
    if (Number(result.changes) !== 1) {
      const actual = this.getRunSummary(runId);
      throw new CollaborationError("REVISION_CONFLICT", "Run revision changed", {
        expectedRevision,
        actualRevision: actual.revision,
      });
    }
    return this.getRunSummary(runId);
  }

  appendEvent(
    runId: string,
    eventType: string,
    entityType: string | null,
    entityId: string | null,
    runRevision: number,
    payload: Record<string, unknown>,
  ): number {
    assertBoundedJson(payload, `event ${eventType} payload`, PERSISTENCE_LIMITS.eventPayloadBytes);
    const result = this.db
      .prepare(
        `INSERT INTO collaboration_events(
          run_id, event_type, entity_type, entity_id, run_revision, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(runId, eventType, entityType, entityId, runRevision, stableStringify(payload), nowMs());
    return Number(result.lastInsertRowid);
  }

  listEvents(runId: string, afterSequence = 0, limit = 200): EventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM collaboration_events WHERE run_id = ? AND sequence > ?
         ORDER BY sequence ASC LIMIT ?`,
      )
      .all(runId, afterSequence, Math.min(PERSISTENCE_LIMITS.eventsPerExport, Math.max(1, limit))) as SqlRow[];
    return rows.map((row) => ({
      sequence: numberValue(row.sequence),
      runId: String(row.run_id),
      eventType: String(row.event_type),
      ...(typeof row.entity_type === "string" ? { entityType: row.entity_type } : {}),
      ...(typeof row.entity_id === "string" ? { entityId: row.entity_id } : {}),
      runRevision: numberValue(row.run_revision),
      payload: sanitizeStoredJsonForOutput(
        parseJson(row.payload_json, {}),
        "event payload",
        PERSISTENCE_LIMITS.eventPayloadBytes,
      ) as Record<string, unknown>,
      createdAt: numberValue(row.created_at),
    }));
  }

  getLastSequence(runId?: string): number {
    const row = (runId
      ? this.db.prepare("SELECT MAX(sequence) AS value FROM collaboration_events WHERE run_id = ?").get(runId)
      : this.db.prepare("SELECT MAX(sequence) AS value FROM collaboration_events").get()) as SqlRow | undefined;
    return numberValue(row?.value);
  }

  insertCommand(params: {
    id: string;
    runId: string;
    kind: CommandKind;
    entityId?: string;
    payloadHash: string;
    payload: Record<string, unknown>;
    effectKey: string;
    response?: Record<string, unknown>;
    receiptSource?: string;
  }): CommandRecord {
    const existing = this.db.prepare("SELECT * FROM commands WHERE id = ?").get(params.id) as SqlRow | undefined;
    if (existing) {
      if (existing.payload_hash !== params.payloadHash) {
        throw new CollaborationError("IDEMPOTENCY_CONFLICT", "commandId was already used with another payload");
      }
      return this.mapCommand(existing);
    }
    assertBoundedJson(params.payload, "command payload", PERSISTENCE_LIMITS.commandPayloadBytes);
    if (params.response) {
      assertBoundedJson(params.response, "command response", PERSISTENCE_LIMITS.commandResponseBytes);
    }
    const now = nowMs();
    if (params.receiptSource) {
      this.reserveCommandReceipt({
        commandId: params.id,
        source: params.receiptSource,
        runId: params.runId,
        payloadHash: params.payloadHash,
        response: params.response ?? null,
      });
    }
    this.db
      .prepare(
        `INSERT INTO commands(
          id, run_id, kind, entity_id, payload_hash, payload_json, effect_key,
          status, attempts, failure_count, available_at, response_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 0, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.runId,
        params.kind,
        params.entityId ?? null,
        params.payloadHash,
        stableStringify(params.payload),
        params.effectKey,
        now,
        params.response ? stableStringify(params.response) : null,
        now,
        now,
      );
    return this.getCommand(params.id);
  }

  getCommand(id: string): CommandRecord {
    const row = this.db.prepare("SELECT * FROM commands WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) throw new CollaborationError("NOT_FOUND", `Command ${id} was not found`);
    return this.mapCommand(row);
  }

  getCommandResponse(id: string): Record<string, unknown> | null {
    const row = this.db.prepare("SELECT response_json FROM commands WHERE id = ?").get(id) as SqlRow | undefined;
    return row ? parseJson(row.response_json, null) : null;
  }

  setCommandResponse(id: string, response: Record<string, unknown>): void {
    assertBoundedJson(response, "command response", PERSISTENCE_LIMITS.commandResponseBytes);
    const command = this.db.prepare("SELECT run_id, payload_hash FROM commands WHERE id = ?").get(id) as SqlRow | undefined;
    if (!command) throw new CollaborationError("NOT_FOUND", `Command ${id} was not found`);
    const receipt = this.getCommandReceipt(id);
    if (receipt) {
      this.reserveCommandReceipt({
        commandId: id,
        source: receipt.source,
        runId: String(command.run_id),
        payloadHash: String(command.payload_hash),
        response,
      });
    }
    this.db.prepare("UPDATE commands SET response_json = ?, updated_at = ? WHERE id = ?").run(stableStringify(response), nowMs(), id);
  }

  claimCommands(owner: string, limit: number, leaseMs: number): CommandRecord[] {
    return this.transaction(() => {
      const now = nowMs();
      this.db
        .prepare(
          `UPDATE commands SET status = 'PENDING', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE status = 'LEASED' AND lease_expires_at < ?`,
        )
        .run(now, now);
      const rows = this.db
        .prepare(
          `SELECT * FROM commands WHERE status = 'PENDING' AND available_at <= ?
           ORDER BY available_at ASC, created_at ASC LIMIT ?`,
        )
        .all(now, Math.max(1, limit)) as SqlRow[];
      const claimed: CommandRecord[] = [];
      for (const row of rows) {
        const result = this.db
          .prepare(
            `UPDATE commands SET status = 'LEASED', attempts = attempts + 1,
             lease_owner = ?, lease_expires_at = ?, updated_at = ?
             WHERE id = ? AND status = 'PENDING'`,
          )
          .run(owner, now + leaseMs, now, String(row.id));
        if (Number(result.changes) === 1) claimed.push(this.getCommand(String(row.id)));
      }
      return claimed;
    });
  }

  releaseCommandLeases(owner: string): number {
    const changed = this.db
      .prepare(
        `UPDATE commands SET status = 'PENDING', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE status = 'LEASED' AND lease_owner = ?`,
      )
      .run(nowMs(), owner);
    return Number(changed.changes);
  }

  renewClaimedCommandLease(
    command: Pick<CommandRecord, "id" | "attempts" | "leaseOwner">,
    leaseMs: number,
    referenceTime = nowMs(),
  ): boolean {
    if (
      !command.leaseOwner
      || !Number.isSafeInteger(leaseMs)
      || leaseMs <= 0
      || !Number.isSafeInteger(referenceTime)
      || referenceTime < 0
    ) {
      return false;
    }
    const leaseExpiresAt = referenceTime + leaseMs;
    if (!Number.isSafeInteger(leaseExpiresAt)) return false;
    const changed = this.db
      .prepare(
        `UPDATE commands SET lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND status = 'LEASED' AND lease_owner = ? AND attempts = ?`,
      )
      .run(
        leaseExpiresAt,
        referenceTime,
        command.id,
        command.leaseOwner,
        command.attempts,
      );
    return Number(changed.changes) === 1;
  }

  markClaimedCommandEffectStarted(
    command: Pick<CommandRecord, "id" | "attempts" | "leaseOwner">,
    referenceTime = nowMs(),
  ): boolean {
    if (
      !command.leaseOwner
      || !Number.isSafeInteger(referenceTime)
      || referenceTime < 0
    ) {
      return false;
    }
    const changed = this.db
      .prepare(
        `UPDATE commands SET effect_started_at = COALESCE(effect_started_at, ?), updated_at = ?
         WHERE id = ? AND status = 'LEASED' AND lease_owner = ? AND attempts = ?`,
      )
      .run(referenceTime, referenceTime, command.id, command.leaseOwner, command.attempts);
    return Number(changed.changes) === 1;
  }

  settleOrphanedCommandUnknown(
    command: Pick<CommandRecord, "id" | "status" | "attempts" | "leaseOwner" | "leaseExpiresAt">,
    error: string,
    referenceTime = nowMs(),
  ): boolean {
    if (!Number.isSafeInteger(referenceTime) || referenceTime < 0) return false;
    const diagnostic = boundedDiagnostic(error);
    if (command.status === "LEASED") {
      if (
        !command.leaseOwner
        || command.leaseExpiresAt == null
        || command.leaseExpiresAt >= referenceTime
      ) {
        return false;
      }
      const changed = this.db
        .prepare(
          `UPDATE commands SET status = 'UNKNOWN', last_error = ?, lease_owner = NULL,
           lease_expires_at = NULL, updated_at = ?
           WHERE id = ? AND status = 'LEASED' AND attempts = ?
             AND lease_owner = ? AND lease_expires_at = ? AND lease_expires_at < ?`,
        )
        .run(
          diagnostic,
          referenceTime,
          command.id,
          command.attempts,
          command.leaseOwner,
          command.leaseExpiresAt,
          referenceTime,
        );
      return Number(changed.changes) === 1;
    }
    if (!["PENDING", "FAILED", "UNKNOWN"].includes(command.status)) return false;
    const changed = this.db
      .prepare(
        `UPDATE commands SET status = 'UNKNOWN', last_error = ?, lease_owner = NULL,
         lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND status = ? AND attempts = ?
           AND lease_owner IS NULL AND lease_expires_at IS NULL`,
      )
      .run(diagnostic, referenceTime, command.id, command.status, command.attempts);
    return Number(changed.changes) === 1;
  }

  settleUnleasedCommand(
    id: string,
    expectedStatus: Exclude<CommandRecord["status"], "LEASED">,
    status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CANCELLED",
    params: { response?: Record<string, unknown>; error?: string } = {},
  ): boolean {
    if (params.response) assertBoundedJson(params.response, "command response", PERSISTENCE_LIMITS.commandResponseBytes);
    const diagnostic = params.error == null ? null : boundedDiagnostic(params.error);
    const changed = this.db
      .prepare(
        `UPDATE commands SET status = ?, response_json = COALESCE(?, response_json), last_error = ?,
         lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND status = ? AND lease_owner IS NULL AND lease_expires_at IS NULL`,
      )
      .run(
        status,
        params.response ? stableStringify(params.response) : null,
        diagnostic,
        nowMs(),
        id,
        expectedStatus,
      );
    if (Number(changed.changes) !== 1) return false;
    if (params.response) {
      const command = this.db.prepare("SELECT run_id, payload_hash FROM commands WHERE id = ?").get(id) as SqlRow;
      const receipt = this.getCommandReceipt(id);
      if (receipt) {
        this.reserveCommandReceipt({
          commandId: id,
          source: receipt.source,
          runId: String(command.run_id),
          payloadHash: String(command.payload_hash),
          response: params.response,
        });
      }
    }
    return true;
  }

  settleUnleasedCommandSnapshot(
    command: Pick<CommandRecord, "id" | "status" | "attempts" | "leaseOwner" | "leaseExpiresAt">,
    status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CANCELLED",
    params: { error?: string } = {},
  ): boolean {
    if (command.status === "LEASED" || command.leaseOwner != null || command.leaseExpiresAt != null) return false;
    const diagnostic = params.error == null ? null : boundedDiagnostic(params.error);
    const changed = this.db
      .prepare(
        `UPDATE commands SET status = ?, last_error = ?, lease_owner = NULL,
         lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND status = ? AND attempts = ?
           AND lease_owner IS NULL AND lease_expires_at IS NULL`,
      )
      .run(status, diagnostic, nowMs(), command.id, command.status, command.attempts);
    return Number(changed.changes) === 1;
  }

  settleClaimedCommand(
    command: Pick<CommandRecord, "id" | "attempts" | "leaseOwner">,
    status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CANCELLED",
    params: { error?: string } = {},
  ): boolean {
    if (!command.leaseOwner) return false;
    const diagnostic = params.error == null ? null : boundedDiagnostic(params.error);
    const changed = this.db
      .prepare(
        `UPDATE commands SET status = ?, last_error = ?,
         failure_count = failure_count + ?, lease_owner = NULL,
         lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'LEASED' AND lease_owner = ? AND attempts = ?`,
      )
      .run(
        status,
        diagnostic,
        status === "FAILED" ? 1 : 0,
        nowMs(),
        command.id,
        command.leaseOwner,
        command.attempts,
      );
    return Number(changed.changes) === 1;
  }

  deferClaimedCommand(
    command: Pick<CommandRecord, "id" | "attempts" | "leaseOwner">,
    delayMs: number,
    reason: string,
  ): boolean {
    return this.scheduleClaimedCommand(command, delayMs, reason, 0);
  }

  rescheduleClaimedCommand(
    command: Pick<CommandRecord, "id" | "attempts" | "leaseOwner">,
    delayMs: number,
    error: string,
  ): boolean {
    return this.scheduleClaimedCommand(command, delayMs, error, 1);
  }

  reopenFailedCommand(
    id: string,
    kind: CommandKind,
    referenceTime = nowMs(),
  ): boolean {
    if (!Number.isSafeInteger(referenceTime) || referenceTime < 0) return false;
    const changed = this.db
      .prepare(
        `UPDATE commands SET status = 'PENDING', failure_count = 0, available_at = ?,
         lease_owner = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = ?
         WHERE id = ? AND status = 'FAILED' AND kind = ?
           AND lease_owner IS NULL AND lease_expires_at IS NULL`,
      )
      .run(referenceTime, referenceTime, id, kind);
    return Number(changed.changes) === 1;
  }

  private scheduleClaimedCommand(
    command: Pick<CommandRecord, "id" | "attempts" | "leaseOwner">,
    delayMs: number,
    diagnostic: string,
    failureIncrement: 0 | 1,
  ): boolean {
    if (!command.leaseOwner || !Number.isSafeInteger(delayMs) || delayMs < 0) return false;
    const timestamp = nowMs();
    const availableAt = timestamp + delayMs;
    if (!Number.isSafeInteger(availableAt)) return false;
    const changed = this.db
      .prepare(
        `UPDATE commands SET status = 'PENDING', available_at = ?, last_error = ?,
         failure_count = failure_count + ?,
         lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'LEASED' AND lease_owner = ? AND attempts = ?`,
      )
      .run(
        availableAt,
        boundedDiagnostic(diagnostic),
        failureIncrement,
        timestamp,
        command.id,
        command.leaseOwner,
        command.attempts,
      );
    return Number(changed.changes) === 1;
  }

  getCommandReceipt(id: string): {
    source: string;
    payloadHash: string;
    response: Record<string, unknown> | null;
  } | null {
    const row = this.db
      .prepare("SELECT source, payload_hash, response_json FROM command_receipts WHERE command_id = ?")
      .get(id) as SqlRow | undefined;
    return row
      ? {
        source: String(row.source),
        payloadHash: String(row.payload_hash),
        response: parseJson(row.response_json, null),
      }
      : null;
  }

  reserveCommandReceipt(params: {
    commandId: string;
    source: string;
    runId: string | null;
    payloadHash: string;
    response: Record<string, unknown> | null;
  }): void {
    assertBoundedText(params.source, "command receipt source", 256);
    if (params.response) {
      assertBoundedJson(params.response, "command receipt response", PERSISTENCE_LIMITS.commandResponseBytes);
    }
    const existing = this.db
      .prepare("SELECT source, payload_hash, response_json FROM command_receipts WHERE command_id = ?")
      .get(params.commandId) as SqlRow | undefined;
    const responseJson = params.response ? stableStringify(params.response) : null;
    const conflict = this.db
      .prepare("SELECT diagnostic FROM command_receipt_conflicts WHERE command_id = ?")
      .get(params.commandId) as SqlRow | undefined;
    if (conflict) {
      throw new CollaborationError("IDEMPOTENCY_CONFLICT", "commandId is quarantined after a legacy namespace collision", {
        diagnostic: boundedDiagnostic(conflict.diagnostic),
      });
    }
    if (existing) {
      if (existing.source !== params.source) {
        throw new CollaborationError("IDEMPOTENCY_CONFLICT", "commandId was already used by another collaboration operation");
      }
      if (existing.payload_hash !== params.payloadHash) {
        throw new CollaborationError("IDEMPOTENCY_CONFLICT", "commandId was already used with another payload");
      }
      if (responseJson && existing.response_json !== responseJson) {
        this.db
          .prepare("UPDATE command_receipts SET response_json = ?, updated_at = ? WHERE command_id = ?")
          .run(responseJson, nowMs(), params.commandId);
      }
      return;
    }
    const countRow = (params.runId == null
      ? this.db.prepare("SELECT COUNT(*) AS value FROM command_receipts WHERE run_id IS NULL").get()
      : this.db.prepare("SELECT COUNT(*) AS value FROM command_receipts WHERE run_id = ?").get(params.runId)) as SqlRow;
    const emergency = params.runId != null && EMERGENCY_COMMAND_RECEIPT_SOURCES.has(params.source);
    const limit = params.runId == null
      ? PERSISTENCE_LIMITS.unscopedCommandReceipts
      : PERSISTENCE_LIMITS.commandReceiptsPerRun
        + (emergency ? PERSISTENCE_LIMITS.emergencyCommandReceiptsPerRun : 0);
    assertCondition(
      numberValue(countRow.value) < limit,
      "CAPACITY_EXCEEDED",
      `command receipt capacity of ${limit} has been reached`,
      {
        runId: params.runId,
        limit,
        emergency,
        ...(params.runId == null
          ? {}
          : {
            normalLimit: PERSISTENCE_LIMITS.commandReceiptsPerRun,
            emergencyReserve: PERSISTENCE_LIMITS.emergencyCommandReceiptsPerRun,
          }),
      },
    );
    const timestamp = nowMs();
    this.db
      .prepare(
        `INSERT INTO command_receipts(
          command_id, source, run_id, payload_hash, response_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.commandId,
        params.source,
        params.runId,
        params.payloadHash,
        responseJson,
        timestamp,
        timestamp,
      );
  }

  getCommandReceiptConflict(id: string): string | null {
    const row = this.db
      .prepare("SELECT diagnostic FROM command_receipt_conflicts WHERE command_id = ?")
      .get(id) as SqlRow | undefined;
    return typeof row?.diagnostic === "string" ? boundedDiagnostic(row.diagnostic) : null;
  }

  cancelPendingCommands(runId: string, kind?: CommandKind): number {
    const sql = `UPDATE commands SET status = 'CANCELLED', updated_at = ?
      WHERE run_id = ? AND status = 'PENDING'${kind ? " AND kind = ?" : ""}`;
    const values = kind ? [nowMs(), runId, kind] : [nowMs(), runId];
    return Number(this.db.prepare(sql).run(...values).changes);
  }

  private mapRun(row: SqlRow): RunSummary {
    const origin = assertOriginBounded({
      runtimeId: String(row.origin_runtime_id),
      agentId: String(row.origin_agent_id),
      sessionKey: String(row.origin_session_key),
      sessionId: String(row.origin_session_id),
      nativeMessageId: String(row.origin_native_message_id),
      ...(typeof row.origin_client_message_id === "string" ? { clientMessageId: row.origin_client_message_id } : {}),
      ...(typeof row.origin_channel === "string" ? { channel: row.origin_channel } : {}),
      ...(typeof row.origin_account_id === "string" ? { accountId: row.origin_account_id } : {}),
      ...(typeof row.origin_target === "string" ? { target: row.origin_target } : {}),
      ...(typeof row.origin_thread_id === "string" ? { threadId: row.origin_thread_id } : {}),
    });
    const status = String(row.status) as RunStatus;
    const goal = assertPersistableText(String(row.goal), "goal", PERSISTENCE_LIMITS.goalBytes);
    return {
      id: String(row.id),
      status,
      dispatchState: String(row.dispatch_state) as RunSummary["dispatchState"],
      archiveState: String(row.archive_state) as RunSummary["archiveState"],
      reconcileState: String(row.reconcile_state) as RunSummary["reconcileState"],
      completionOutcome: nullableString(row.completion_outcome) as RunSummary["completionOutcome"],
      revision: numberValue(row.revision),
      goal,
      origin,
      currentPlanRevisionId: nullableString(row.current_plan_revision_id),
      cancelRequestedAt: row.cancel_requested_at == null ? null : numberValue(row.cancel_requested_at),
      allowedActions: allowedActionsForRun(
        status,
        String(row.dispatch_state),
        String(row.archive_state),
        TERMINAL_RUN_STATUSES.has(status),
      ),
      createdAt: numberValue(row.created_at),
      updatedAt: numberValue(row.updated_at),
    };
  }

  private mapCommand(row: SqlRow): CommandRecord {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      kind: String(row.kind) as CommandKind,
      entityId: nullableString(row.entity_id),
      payload: parseJson(row.payload_json, {}),
      effectKey: String(row.effect_key),
      status: String(row.status) as CommandRecord["status"],
      attempts: numberValue(row.attempts),
      failureCount: numberValue(row.failure_count),
      effectStartedAt: row.effect_started_at == null ? null : numberValue(row.effect_started_at),
      availableAt: numberValue(row.available_at),
      leaseOwner: nullableString(row.lease_owner),
      leaseExpiresAt: row.lease_expires_at == null ? null : numberValue(row.lease_expires_at),
    };
  }
}

function securePermissions(target: string, mode: number): void {
  try {
    chmodSync(target, mode);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

function allowedActionsForRun(status: RunStatus, dispatchState: string, archiveState: string, terminal: boolean): string[] {
  if (terminal) return ["EXPORT", "CLONE", archiveState === "ARCHIVED" ? "UNARCHIVE" : "ARCHIVE", "DELETE"];
  switch (status) {
    case "AWAITING_APPROVAL":
      return ["PLAN_REVISE", "PLAN_APPROVE", "CANCEL"];
    case "RUNNING":
      return dispatchState === "OPEN"
        ? ["DISPATCH_STOP", "WORK_ITEM_INPUT_APPEND", "WORK_ITEM_CANCEL", "CANCEL"]
        : ["DISPATCH_RESUME", "WORK_ITEM_INPUT_APPEND", "WORK_ITEM_CANCEL", "CANCEL"];
    case "AWAITING_INTERVENTION":
      return [
        "PLAN_REVISE",
        "WORK_ITEM_INPUT_APPEND",
        "WORK_ITEM_CANCEL",
        "WORK_ITEM_RETRY",
        "WORK_ITEM_REASSIGN",
        "PARTIAL",
        "CANCEL",
      ];
    case "DELIVERY_PENDING":
      return ["RECONCILE", "DELIVERY_RETRY", "DELIVERY_RETARGET", "EXPORT", "DELIVERY_ABANDON"];
    case "CANCELLING":
      return ["RECONCILE"];
    default:
      return ["CANCEL"];
  }
}
