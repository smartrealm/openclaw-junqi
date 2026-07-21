import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CollaborationDatabase } from "./database.js";
import { CollaborationError } from "./errors.js";
import { RunDeletionRepository } from "./run-deletion-repository.js";

function createTerminalRun(database: CollaborationDatabase, runId: string): void {
  database.createRun({
    id: runId,
    origin: {
      runtimeId: "runtime-delete-repository",
      agentId: "main",
      sessionKey: `agent:main:${runId}`,
      sessionId: `session-${runId}`,
      nativeMessageId: `message-${runId}`,
    },
    goal: "Exercise the deletion repository snapshot",
    capabilitySnapshot: {},
  });
  database.db
    .prepare(
      `UPDATE collaboration_runs
       SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ?,
           openclaw_flow_id = 'flow-delete-repository', openclaw_flow_revision = 9
       WHERE id = ?`,
    )
    .run(Date.now(), runId);
}

test("deletion repository classifies zero, one, and multiple failed Flow commands", () => {
  const database = new CollaborationDatabase(":memory:");
  const repository = new RunDeletionRepository(database);
  const runId = "delete-repository-cardinality";
  try {
    createTerminalRun(database, runId);
    assert.deepEqual(repository.readSnapshot(runId).failedFlowReconciliations, []);

    database.insertCommand({
      id: "failed-provision",
      runId,
      kind: "PROVISION",
      payloadHash: "failed-provision-payload",
      payload: {},
      effectKey: "failed-provision-effect",
    });
    database.settleUnleasedCommand("failed-provision", "PENDING", "FAILED", {
      error: "Provision result is ambiguous",
    });
    assert.deepEqual(repository.readSnapshot(runId).failedFlowReconciliations, [{
      commandId: "failed-provision",
      commandStatus: "FAILED",
      flowId: "flow-delete-repository",
      flowRevision: 9,
      diagnostic: "Provision result is ambiguous",
    }]);

    database.insertCommand({
      id: "failed-flow-sync",
      runId,
      kind: "FLOW_SYNC",
      payloadHash: "failed-flow-sync-payload",
      payload: {},
      effectKey: "failed-flow-sync-effect",
    });
    database.settleUnleasedCommand("failed-flow-sync", "PENDING", "FAILED", {
      error: "Terminal Flow state is ambiguous",
    });
    const ambiguous = repository.readSnapshot(runId).failedFlowReconciliations;
    assert.equal(ambiguous.length, 2);
    assert.deepEqual(ambiguous.map((entry) => entry.commandId), ["failed-flow-sync", "failed-provision"]);
  } finally {
    database.close();
  }
});

test("deletion repository excludes only the active DELETE command from competing work", () => {
  const database = new CollaborationDatabase(":memory:");
  const repository = new RunDeletionRepository(database);
  const runId = "delete-repository-active-command";
  try {
    createTerminalRun(database, runId);
    database.insertCommand({
      id: "current-delete",
      runId,
      kind: "DELETE",
      payloadHash: "current-delete-payload",
      payload: {},
      effectKey: "current-delete-effect",
    });
    assert.equal(repository.readSnapshot(runId).hasOtherActiveOrUncertainCommand, true);
    assert.equal(repository.readSnapshot(runId, "current-delete").hasOtherActiveOrUncertainCommand, false);

    database.insertCommand({
      id: "active-export",
      runId,
      kind: "EXPORT",
      payloadHash: "active-export-payload",
      payload: {},
      effectKey: "active-export-effect",
    });
    assert.equal(repository.readSnapshot(runId, "active-export").hasOtherActiveOrUncertainCommand, true);
    database.settleUnleasedCommand("active-export", "PENDING", "CANCELLED");

    database.insertCommand({
      id: "other-delete",
      runId,
      kind: "DELETE",
      payloadHash: "other-delete-payload",
      payload: {},
      effectKey: "other-delete-effect",
    });
    assert.equal(repository.readSnapshot(runId, "current-delete").hasOtherActiveOrUncertainCommand, true);
  } finally {
    database.close();
  }
});

test("deletion repository projects independent persisted eligibility facts", () => {
  const database = new CollaborationDatabase(":memory:");
  const repository = new RunDeletionRepository(database);
  const timestamp = Date.now();
  try {
    for (const runId of ["facts-attempt", "facts-export", "facts-deletion-job"]) {
      createTerminalRun(database, runId);
    }
    database.db
      .prepare(
        `INSERT INTO attempts(
          id, run_id, work_item_id, kind, attempt_no, idempotency_key,
          worker_agent_id, worker_owner_session_key, child_session_key,
          status, input_json, revision, created_at, updated_at
        ) VALUES (
          'facts-active-attempt', 'facts-attempt', NULL, 'PLANNER', 1, 'facts-attempt-key',
          'coordinator', 'agent:coordinator:main', 'agent:coordinator:facts-attempt',
          'UNKNOWN', '{}', 1, ?, ?
        )`,
      )
      .run(timestamp, timestamp);
    database.db
      .prepare(
        `INSERT INTO export_jobs(id, run_id, status, format, created_at, updated_at)
         VALUES ('facts-pending-export', 'facts-export', 'PENDING', 'json', ?, ?)`,
      )
      .run(timestamp, timestamp);
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(
          id, run_id, status, confirmation_digest, last_error, created_at, updated_at
        ) VALUES (
          'facts-failed-deletion', 'facts-deletion-job', 'FAILED', 'facts-digest', 'cleanup failed', ?, ?
        )`,
      )
      .run(timestamp, timestamp);

    const attempt = repository.readSnapshot("facts-attempt");
    assert.equal(attempt.hasActiveAttempt, true);
    assert.equal(attempt.hasPendingExport, false);
    assert.equal(attempt.hasIncompleteDeletionJob, false);

    const exportJob = repository.readSnapshot("facts-export");
    assert.equal(exportJob.hasActiveAttempt, false);
    assert.equal(exportJob.hasPendingExport, true);
    assert.equal(exportJob.hasIncompleteDeletionJob, false);

    const deletionJob = repository.readSnapshot("facts-deletion-job");
    assert.equal(deletionJob.hasActiveAttempt, false);
    assert.equal(deletionJob.hasPendingExport, false);
    assert.equal(deletionJob.hasIncompleteDeletionJob, true);
  } finally {
    database.close();
  }
});

test("deletion repository projects only an open residual-risk intervention as a blocker", () => {
  const database = new CollaborationDatabase(":memory:");
  const repository = new RunDeletionRepository(database);
  const runId = "facts-residual-risk";
  const timestamp = Date.now();
  try {
    createTerminalRun(database, runId);
    database.db
      .prepare(
        `INSERT INTO interventions(
          id, run_id, code, entity_type, entity_id, required_action,
          diagnostics_json, resume_status, created_at
        ) VALUES (
          'residual-risk-open', ?, 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK',
          'attempt', 'attempt-1', 'Inspect Task', '{}', 'CANCELLING', ?
        )`,
      )
      .run(runId, timestamp);
    assert.equal(repository.readSnapshot(runId).hasOpenResidualExecutionRisk, true);

    database.db
      .prepare(
        `UPDATE interventions SET resolved_at = ?, resolved_by = 'test', resolution_json = '{}'
         WHERE id = 'residual-risk-open'`,
      )
      .run(timestamp + 1);
    assert.equal(repository.readSnapshot(runId).hasOpenResidualExecutionRisk, false);
  } finally {
    database.close();
  }
});

test("retention candidates use a strict cutoff and stable ended-at/id cursor", () => {
  const database = new CollaborationDatabase(":memory:");
  const repository = new RunDeletionRepository(database);
  try {
    for (const runId of ["candidate-a", "candidate-b", "candidate-cutoff"]) {
      createTerminalRun(database, runId);
    }
    database.db
      .prepare("UPDATE collaboration_runs SET ended_at = 99, reconcile_state = 'ATTENTION_REQUIRED' WHERE id IN ('candidate-a', 'candidate-b')")
      .run();
    database.db.prepare("UPDATE collaboration_runs SET ended_at = 100 WHERE id = 'candidate-cutoff'").run();
    database.insertCommand({
      id: "candidate-b-flow",
      runId: "candidate-b",
      kind: "FLOW_SYNC",
      payloadHash: "candidate-b-flow-payload",
      payload: {},
      effectKey: "candidate-b-flow-effect",
    });
    database.settleUnleasedCommand("candidate-b-flow", "PENDING", "FAILED", {
      error: "This policy blocker must not disappear from the broad candidate scan",
    });

    const first = repository.listRetentionCandidates({
      cutoff: 100,
      cursorEndedAt: -1,
      cursorRunId: "",
      limit: 1,
    });
    assert.deepEqual(first, [{ runId: "candidate-a", endedAt: 99 }]);
    const second = repository.listRetentionCandidates({
      cutoff: 100,
      cursorEndedAt: first[0]!.endedAt,
      cursorRunId: first[0]!.runId,
      limit: 1,
    });
    assert.deepEqual(second, [{ runId: "candidate-b", endedAt: 99 }]);
    assert.deepEqual(repository.listRetentionCandidates({
      cutoff: 100,
      cursorEndedAt: second[0]!.endedAt,
      cursorRunId: second[0]!.runId,
      limit: 10,
    }), []);
  } finally {
    database.close();
  }
});

test("deletion query indexes are installed for existing schema 10 databases", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-deletion-index-test-"));
  const filePath = path.join(directory, "collaboration.sqlite");
  const initial = new CollaborationDatabase(filePath);
  try {
    initial.db.exec(`
      DROP INDEX collaboration_runs_retention;
      DROP INDEX attempts_run_active;
      DROP INDEX commands_run_active;
      DROP INDEX commands_run_failed_flow;
      DROP INDEX export_jobs_run_status;
      DROP INDEX deletion_jobs_run_status;
    `);
    initial.setMetadata("schema_version", "10");
    assert.equal(initial.getMetadata("schema_version"), "10");
  } finally {
    initial.close();
  }

  const reopened = new CollaborationDatabase(filePath);
  try {
    const names = new Set((reopened.db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name IN (
           'collaboration_runs_retention', 'attempts_run_active', 'commands_run_active',
           'commands_run_failed_flow', 'export_jobs_run_status', 'deletion_jobs_run_status'
         )`,
      )
      .all() as Array<{ name: string }>).map((row) => row.name));
    assert.deepEqual(names, new Set([
      "collaboration_runs_retention",
      "attempts_run_active",
      "commands_run_active",
      "commands_run_failed_flow",
      "export_jobs_run_status",
      "deletion_jobs_run_status",
    ]));

    const plan = (reopened.db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT r.id, r.ended_at
         FROM collaboration_runs r INDEXED BY collaboration_runs_retention
         WHERE r.status IN ('COMPLETED', 'CANCELLED', 'FAILED')
           AND r.ended_at IS NOT NULL AND r.ended_at < ?
           AND (r.ended_at > ? OR (r.ended_at = ? AND r.id > ?))
         ORDER BY r.ended_at ASC, r.id ASC
         LIMIT ?`,
      )
      .all(100, -1, -1, "", 500) as Array<{ detail: string }>).map((row) => row.detail).join("\n");
    assert.match(plan, /collaboration_runs_retention/);
    assert.doesNotMatch(plan, /TEMP B-TREE/);
  } finally {
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deletion repository fails closed on malformed persisted policy facts", () => {
  const database = new CollaborationDatabase(":memory:");
  const repository = new RunDeletionRepository(database);
  const runId = "delete-repository-malformed";
  try {
    createTerminalRun(database, runId);
    database.insertCommand({
      id: "delete-repository-malformed-flow",
      runId,
      kind: "FLOW_SYNC",
      payloadHash: "delete-repository-malformed-flow-payload",
      payload: {},
      effectKey: "delete-repository-malformed-flow-effect",
    });
    database.settleUnleasedCommand("delete-repository-malformed-flow", "PENDING", "FAILED", {
      error: "Flow state is ambiguous",
    });

    database.db.prepare("UPDATE collaboration_runs SET openclaw_flow_revision = 'corrupt' WHERE id = ?").run(runId);
    assert.throws(
      () => repository.readSnapshot(runId),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "INVALID_RESPONSE"
        && error.details?.field === "collaboration_runs.openclaw_flow_revision",
    );

    database.db
      .prepare("UPDATE collaboration_runs SET openclaw_flow_revision = 9, status = 'CORRUPT' WHERE id = ?")
      .run(runId);
    assert.throws(
      () => repository.readSnapshot(runId),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "INVALID_RESPONSE"
        && error.details?.field === "collaboration_runs.status",
    );

    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', ended_at = -2 WHERE id = ?")
      .run(runId);
    assert.throws(
      () => repository.readSnapshot(runId),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "INVALID_RESPONSE"
        && error.details?.field === "collaboration_runs.ended_at",
    );
  } finally {
    database.close();
  }
});
