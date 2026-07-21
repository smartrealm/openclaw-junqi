import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CollaborationDatabase as ProductionCollaborationDatabase } from "./database.js";
import { commandPayloadForHash } from "./domain.js";
import { CollaborationError } from "./errors.js";
import { CollaborationService } from "./service.js";
import type { CapabilityAgent, OriginRef, RuntimeAdapter } from "./types.js";
import { sha256 } from "./util.js";

class SessionMutationRuntime implements RuntimeAdapter {
  readonly runtimeVersion = "2026.7.1";
  readonly agents: CapabilityAgent[] = [
    { id: "coordinator", runtimeType: "native", allowed: true, coordinator: true },
    { id: "worker", runtimeType: "native", allowed: true, coordinator: false },
  ];
  dispatches = 0;
  flowControllerId: string | null = null;
  flowState: Record<string, unknown> | null = null;
  flowRevision = 0;
  flowStatus: "running" | "succeeded" | "failed" | "cancelled" = "running";

  async readOrigin() {
    return { found: true, role: "user", text: "origin" };
  }

  listConfiguredAgents() {
    return this.agents;
  }

  createManagedFlow(params: { controllerId: string; state: Record<string, unknown> }) {
    this.flowControllerId = params.controllerId;
    this.flowState = params.state;
    this.flowRevision = 1;
    this.flowStatus = "running";
    return {
      flowId: "flow-session-mutation",
      revision: this.flowRevision,
      status: this.flowStatus,
      controllerId: this.flowControllerId,
      state: this.flowState,
      cancelRequestedAt: null,
    };
  }

  findManagedFlowByController(params: { controllerId: string }) {
    if (this.flowRevision === 0 || this.flowControllerId !== params.controllerId) {
      return { kind: "ABSENT" as const };
    }
    return {
      kind: "FOUND" as const,
      flow: {
        flowId: "flow-session-mutation",
        revision: this.flowRevision,
        status: this.flowStatus,
        controllerId: this.flowControllerId,
        state: this.flowState,
        cancelRequestedAt: null,
      },
    };
  }

  async updateManagedFlow(params: {
    expectedRevision: number;
    state: Record<string, unknown>;
    terminal?: "finished" | "failed" | "cancelled";
  }) {
    if (params.expectedRevision !== this.flowRevision) return null;
    this.flowRevision += 1;
    this.flowState = params.state;
    this.flowStatus = params.terminal === "finished"
      ? "succeeded"
      : params.terminal === "failed"
        ? "failed"
        : params.terminal === "cancelled"
          ? "cancelled"
          : "running";
    return { revision: this.flowRevision };
  }

  getManagedFlow() {
    if (this.flowRevision === 0) return null;
    return {
      flowId: "flow-session-mutation",
      revision: this.flowRevision,
      status: this.flowStatus,
      controllerId: this.flowControllerId,
      state: this.flowState,
      cancelRequestedAt: null,
    };
  }

  async runAgent() {
    this.dispatches += 1;
    return { runId: `native-run-${this.dispatches}`, taskId: `task-${this.dispatches}` };
  }

  async findAgentTask() {
    return { kind: "ABSENT" as const };
  }

  async waitForRun() {
    return { status: "timeout" as const };
  }

  async getSessionMessages() {
    return [];
  }

  async cancelRun() {
    return { found: true, cancelled: true };
  }

  async appendTranscript() {
    return { ok: true as const, messageId: "message-1" };
  }

  emitChanged() {}
}

let currentTestCollaborationInstanceId = "";

class CollaborationDatabase extends ProductionCollaborationDatabase {
  constructor(filePath: string) {
    super(filePath);
    currentTestCollaborationInstanceId = this.instanceId;
  }
}

function writeParams<T extends Record<string, unknown>>(
  params: T,
): T & { expectedCollaborationInstanceId: string; payloadHash: string } {
  const withHash = {
    expectedCollaborationInstanceId: currentTestCollaborationInstanceId,
    ...params,
    runtimeId: currentTestCollaborationInstanceId,
    payloadHash: "",
  };
  return { ...withHash, payloadHash: sha256(commandPayloadForHash(withHash)) };
}

async function waitUntil(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for collaboration state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function origin(sessionId = "session-mutation-1", nativeMessageId = "native-mutation-1"): OriginRef {
  return {
    runtimeId: currentTestCollaborationInstanceId,
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId,
    nativeMessageId,
  };
}

function createHarness() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-session-mutation-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new SessionMutationRuntime();
  const service = new CollaborationService(
    database,
    runtime,
    {
      coordinatorAgentId: "coordinator",
      allowedAgentIds: ["coordinator", "worker"],
      maxConcurrency: 2,
      maxWorkItems: 10,
      attemptTimeoutMs: 60_000,
      retentionDays: 365,
    },
    directory,
    { info() {}, warn() {}, error() {} },
  );
  return {
    database,
    runtime,
    service,
    close() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function assertErrorCode(code: CollaborationError["code"]) {
  return (error: unknown): boolean => error instanceof CollaborationError && error.code === code;
}

function createActiveRun(database: CollaborationDatabase, ref = origin()): string {
  const runId = `run-${ref.sessionId}`;
  database.createRun({
    id: runId,
    origin: ref,
    goal: "Active collaboration",
    capabilitySnapshot: {},
  });
  return runId;
}

function insertQueuedWorker(database: CollaborationDatabase, runId: string): void {
  const timestamp = Date.now();
  database.db
    .prepare(
      `INSERT INTO plan_revisions(id, run_id, revision_no, plan_json, digest, created_at)
       VALUES ('plan-fence', ?, 1, '{}', 'digest', ?)`,
    )
    .run(runId, timestamp);
  database.db
    .prepare(
      `INSERT INTO work_items(
        id, run_id, plan_revision_id, logical_id, title, input_scope_json, dependencies_json,
        required_capabilities_json, candidate_agent_ids_json, acceptance_criteria_json,
        risk_level, side_effect_class, assigned_agent_id, status, revision, created_at, updated_at
      ) VALUES (
        'work-fence', ?, 'plan-fence', 'work', 'Work', '[]', '[]', '[]', '["worker"]', '[]',
        'LOW', 'READ_ONLY', 'worker', 'DISPATCHING', 1, ?, ?
      )`,
    )
    .run(runId, timestamp, timestamp);
  database.db
    .prepare(
      `INSERT INTO attempts(
        id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
        worker_owner_session_key, child_session_key, status, input_json, revision, created_at, updated_at
      ) VALUES (
        'attempt-fence', ?, 'work-fence', 'WORKER', 1, 'effect-fence', 'worker',
        'agent:worker:main', 'agent:worker:subagent:fence', 'CREATED', '{}', 1, ?, ?
      )`,
    )
    .run(runId, timestamp, timestamp);
  database.insertCommand({
    id: "dispatch-fence",
    runId,
    kind: "DISPATCH",
    entityId: "attempt-fence",
    payloadHash: sha256({ attemptId: "attempt-fence" }),
    payload: { attemptId: "attempt-fence" },
    effectKey: "effect-fence",
  });
  database.db
    .prepare(
      `UPDATE collaboration_runs SET status = 'RUNNING', dispatch_state = 'OPEN',
       current_plan_revision_id = 'plan-fence' WHERE id = ?`,
    )
    .run(runId);
}

test("session mutation prepare is durable, replayable, and blocks plan creation", async () => {
  const harness = createHarness();
  try {
    const prepareParams = writeParams({
      commandId: "mutation-prepare-idempotent",
      runtimeId: origin().runtimeId,
      sessionKey: origin().sessionKey,
      sessionId: origin().sessionId,
      action: "reset",
      policy: "PROCEED",
    });
    const prepared = harness.service.prepareSessionMutation(prepareParams);
    const replayed = harness.service.prepareSessionMutation(prepareParams);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.mutationId, prepared.mutationId);
    assert.throws(
      () => harness.service.prepareSessionMutation(writeParams({ ...prepareParams, action: "delete" })),
      assertErrorCode("IDEMPOTENCY_CONFLICT"),
    );

    await assert.rejects(
      harness.service.createPlan(writeParams({
        commandId: "plan-blocked-by-mutation",
        origin: origin(),
        goal: "Must not start",
      })),
      assertErrorCode("SESSION_MUTATION_ACTIVE"),
    );

    const otherSession = await harness.service.createPlan(writeParams({
      commandId: "plan-other-session",
      origin: origin("session-mutation-2", "native-mutation-2"),
      goal: "May start",
    }));
    assert.equal(otherSession.accepted, true);
  } finally {
    harness.close();
  }
});

test("delete stop-and-retarget fence suspends queued workers and rejects dispatch resume", () => {
  const harness = createHarness();
  try {
    const runId = createActiveRun(harness.database);
    insertQueuedWorker(harness.database, runId);
    assert.throws(
      () => harness.service.prepareSessionMutation(writeParams({
        commandId: "mutation-invalid-reset-stop",
        runtimeId: origin().runtimeId,
        sessionKey: origin().sessionKey,
        sessionId: origin().sessionId,
        action: "reset",
        policy: "STOP_AND_RETARGET_LATER",
      })),
      assertErrorCode("INVALID_REQUEST"),
    );

    const prepared = harness.service.prepareSessionMutation(writeParams({
      commandId: "mutation-delete-stop",
      runtimeId: origin().runtimeId,
      sessionKey: origin().sessionKey,
      sessionId: origin().sessionId,
      action: "delete",
      policy: "STOP_AND_RETARGET_LATER",
    }));
    assert.equal(prepared.coreRpcAllowed, true);
    const run = harness.database.getRunSummary(runId);
    assert.equal(run.status, "AWAITING_INTERVENTION");
    assert.equal(run.dispatchState, "STOPPED");
    assert.equal(harness.database.getCommand("dispatch-fence").status, "CANCELLED");
    const attempt = harness.database.db.prepare("SELECT status FROM attempts WHERE id = 'attempt-fence'").get() as { status: string };
    const work = harness.database.db.prepare("SELECT status FROM work_items WHERE id = 'work-fence'").get() as { status: string };
    assert.equal(attempt.status, "CANCELLED");
    assert.equal(work.status, "READY");
    assert.equal(harness.runtime.dispatches, 0);

    assert.throws(
      () => harness.service.resumeDispatch(writeParams({
        commandId: "resume-blocked-by-mutation",
        runId,
        expectedRunRevision: run.revision,
      })),
      assertErrorCode("SESSION_MUTATION_ACTIVE"),
    );

    harness.database.db
      .prepare("UPDATE collaboration_runs SET status = 'RUNNING', dispatch_state = 'OPEN' WHERE id = ?")
      .run(runId);
    (harness.service as unknown as { scheduleReadyWork(runId: string): void }).scheduleReadyWork(runId);
    const workerAttempts = harness.database.db
      .prepare("SELECT COUNT(*) AS count FROM attempts WHERE run_id = ? AND kind = 'WORKER'")
      .get(runId) as { count: number };
    assert.equal(Number(workerAttempts.count), 1);
  } finally {
    harness.close();
  }
});

test("dispatch stop cancels only the queued attempt and resume creates one fresh Worker dispatch", async () => {
  const harness = createHarness();
  let started = false;
  try {
    const runId = createActiveRun(harness.database);
    const capabilitySnapshot = (harness.service as unknown as {
      buildCapabilitySnapshot(input: Record<string, unknown>): Record<string, unknown>;
    }).buildCapabilitySnapshot({});
    harness.database.db
      .prepare("UPDATE collaboration_runs SET capability_config_hash = ? WHERE id = ?")
      .run(String(capabilitySnapshot.configHash), runId);
    insertQueuedWorker(harness.database, runId);

    const running = harness.database.getRunSummary(runId);
    harness.service.stopDispatch(writeParams({
      commandId: "queued-worker-stop",
      runId,
      expectedRunRevision: running.revision,
    }));

    const stopped = harness.database.getRunSummary(runId);
    const cancelledAttempt = harness.database.db
      .prepare("SELECT status FROM attempts WHERE id = 'attempt-fence'")
      .get() as { status: string };
    const readyWork = harness.database.db
      .prepare("SELECT status FROM work_items WHERE id = 'work-fence'")
      .get() as { status: string };
    assert.equal(stopped.status, "AWAITING_INTERVENTION");
    assert.equal(stopped.dispatchState, "STOPPED");
    assert.equal(harness.database.getCommand("dispatch-fence").status, "CANCELLED");
    assert.equal(cancelledAttempt.status, "CANCELLED");
    assert.equal(readyWork.status, "READY");
    assert.equal(harness.runtime.dispatches, 0);

    harness.service.resumeDispatch(writeParams({
      commandId: "queued-worker-resume",
      runId,
      expectedRunRevision: stopped.revision,
    }));
    const attemptsBeforeDrain = harness.database.db
      .prepare(
        `SELECT attempt_no, status FROM attempts
         WHERE work_item_id = 'work-fence' ORDER BY attempt_no`,
      )
      .all() as Array<{ attempt_no: number; status: string }>;
    assert.deepEqual(attemptsBeforeDrain.map((attempt) => ({ ...attempt })), [
      { attempt_no: 1, status: "CANCELLED" },
      { attempt_no: 2, status: "CREATED" },
    ]);

    harness.service.start();
    started = true;
    await waitUntil(() => harness.runtime.dispatches === 1);
    await waitUntil(() => {
      const attempt = harness.database.db
        .prepare("SELECT openclaw_run_id FROM attempts WHERE work_item_id = 'work-fence' AND attempt_no = 2")
        .get() as { openclaw_run_id: string | null } | undefined;
      return attempt?.openclaw_run_id === "native-run-1";
    });
    assert.equal(harness.runtime.dispatches, 1);
    assert.equal(
      Number(harness.database.db
        .prepare("SELECT COUNT(*) AS count FROM attempts WHERE work_item_id = 'work-fence'")
        .get()?.count),
      2,
    );
  } finally {
    if (started) await harness.service.stop();
    harness.close();
  }
});

test("session mutation turns a potentially-started queued dispatch UNKNOWN and never redispatches it", async () => {
  const harness = createHarness();
  try {
    const runId = createActiveRun(harness.database);
    insertQueuedWorker(harness.database, runId);
    harness.database.db
      .prepare("UPDATE attempts SET status = 'DISPATCHING' WHERE id = 'attempt-fence'")
      .run();
    harness.runtime.dispatches = 1;

    harness.service.prepareSessionMutation(writeParams({
      commandId: "mutation-dispatching-stop",
      runtimeId: origin().runtimeId,
      sessionKey: origin().sessionKey,
      sessionId: origin().sessionId,
      action: "delete",
      policy: "STOP_AND_RETARGET_LATER",
    }));

    const run = harness.database.getRunSummary(runId);
    const attempt = harness.database.db
      .prepare("SELECT status FROM attempts WHERE id = 'attempt-fence'")
      .get() as { status: string };
    assert.equal(run.status, "AWAITING_INTERVENTION");
    assert.equal(run.dispatchState, "STOPPED");
    assert.equal(run.reconcileState, "ATTENTION_REQUIRED");
    assert.equal(harness.database.getCommand("dispatch-fence").status, "UNKNOWN");
    assert.equal(attempt.status, "UNKNOWN");
    assert.equal(
      Number(harness.database.db
        .prepare("SELECT COUNT(*) AS count FROM interventions WHERE run_id = ? AND entity_id = 'attempt-fence' AND resolved_at IS NULL")
        .get(runId)?.count),
      1,
    );

    assert.throws(
      () => harness.service.resumeDispatch(writeParams({
        commandId: "mutation-dispatching-resume",
        runId,
        expectedRunRevision: run.revision,
      })),
      assertErrorCode("SESSION_MUTATION_ACTIVE"),
    );
    await (harness.service as unknown as { drainCommands(): Promise<void> }).drainCommands();
    assert.equal(harness.runtime.dispatches, 1);
    assert.equal(
      Number(harness.database.db
        .prepare("SELECT COUNT(*) AS count FROM attempts WHERE work_item_id = 'work-fence'")
        .get()?.count),
      1,
    );
  } finally {
    harness.close();
  }
});

test("cancel-and-wait prepares before cancellation and permits core only after runs settle", () => {
  const harness = createHarness();
  try {
    const runId = createActiveRun(harness.database);
    const prepared = harness.service.prepareSessionMutation(writeParams({
      commandId: "mutation-cancel-prepare",
      runtimeId: origin().runtimeId,
      sessionKey: origin().sessionKey,
      sessionId: origin().sessionId,
      action: "reset",
      policy: "CANCEL_AND_WAIT",
    }));
    assert.equal(prepared.coreRpcAllowed, false);
    assert.equal((prepared.activeRuns as unknown[]).length, 1);

    const fencedRun = harness.database.getRunSummary(runId);
    harness.service.cancelRun(writeParams({
      commandId: "mutation-cancel-run",
      runId,
      expectedRunRevision: fencedRun.revision,
    }));
    assert.equal(harness.database.getRunSummary(runId).status, "CANCELLED");
    const settledImpact = harness.service.sessionMutationImpact({
      runtimeId: origin().runtimeId,
      sessionKey: origin().sessionKey,
      sessionId: origin().sessionId,
      action: "reset",
    });
    assert.equal((settledImpact.activeRuns as unknown[]).length, 0);
    assert.equal(settledImpact.coreRpcAllowed, true);

    const completeParams = writeParams({
      commandId: "mutation-cancel-complete",
      mutationId: prepared.mutationId,
      success: true,
    });
    const completed = harness.service.completeSessionMutation(completeParams);
    const replayed = harness.service.completeSessionMutation(completeParams);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(replayed.replayed, true);
    assert.throws(
      () => harness.service.completeSessionMutation(writeParams({ ...completeParams, success: false })),
      assertErrorCode("IDEMPOTENCY_CONFLICT"),
    );
  } finally {
    harness.close();
  }
});

test("expired mutation remains fenced until explicit recovery completion", async () => {
  const harness = createHarness();
  try {
    const prepared = harness.service.prepareSessionMutation(writeParams({
      commandId: "mutation-expiry-prepare",
      runtimeId: origin().runtimeId,
      sessionKey: origin().sessionKey,
      sessionId: origin().sessionId,
      action: "delete",
      policy: "PROCEED",
    }));
    harness.database.db
      .prepare("UPDATE session_mutations SET lease_expires_at = ? WHERE id = ?")
      .run(Date.now() - 1, prepared.mutationId);

    const impact = harness.service.sessionMutationImpact({
      runtimeId: origin().runtimeId,
      sessionKey: origin().sessionKey,
      sessionId: origin().sessionId,
      action: "delete",
    });
    assert.equal(impact.recoveryRequired, true);
    assert.equal((impact.activeMutation as { status: string }).status, "EXPIRED");
    const expired = harness.database.db
      .prepare("SELECT status, result_json FROM session_mutations WHERE id = ?")
      .get(prepared.mutationId) as { status: string; result_json: string };
    assert.equal(expired.status, "EXPIRED");
    assert.equal((JSON.parse(expired.result_json) as { reason: string }).reason, "LEASE_EXPIRED");

    await assert.rejects(
      harness.service.createPlan(writeParams({
        commandId: "plan-blocked-by-expired-mutation",
        origin: origin(),
        goal: "Still fenced",
      })),
      (error: unknown) => {
        assert.ok(error instanceof CollaborationError);
        assert.equal(error.code, "SESSION_MUTATION_ACTIVE");
        assert.equal(error.details?.recoveryRequired, true);
        return true;
      },
    );

    const recovered = harness.service.completeSessionMutation(writeParams({
      commandId: "mutation-expiry-recover",
      mutationId: prepared.mutationId,
      success: false,
      error: "Desktop restarted before the core RPC result was known",
    }));
    assert.equal(recovered.status, "FAILED");
    assert.equal(recovered.recoveredFromExpiry, true);
    const result = harness.database.db
      .prepare("SELECT result_json FROM session_mutations WHERE id = ?")
      .get(prepared.mutationId) as { result_json: string };
    const audit = JSON.parse(result.result_json) as Record<string, unknown>;
    assert.equal(audit.reason, "LEASE_EXPIRED");
    assert.equal((audit.coreRpc as { success: boolean }).success, false);

    const created = await harness.service.createPlan(writeParams({
      commandId: "plan-after-mutation-recovery",
      origin: origin(),
      goal: "Fence was explicitly released",
    }));
    assert.equal(created.accepted, true);
  } finally {
    harness.close();
  }
});

test("expired fence keeps affected runs in attention through reconciliation", async () => {
  const harness = createHarness();
  try {
    const runId = createActiveRun(harness.database);
    const prepared = harness.service.prepareSessionMutation(writeParams({
      commandId: "mutation-active-expiry-prepare",
      runtimeId: origin().runtimeId,
      sessionKey: origin().sessionKey,
      sessionId: origin().sessionId,
      action: "reset",
      policy: "CANCEL_AND_WAIT",
    }));
    harness.database.db
      .prepare("UPDATE session_mutations SET lease_expires_at = ? WHERE id = ?")
      .run(Date.now() - 1, prepared.mutationId);

    harness.service.sessionMutationImpact({
      runtimeId: origin().runtimeId,
      sessionKey: origin().sessionKey,
      sessionId: origin().sessionId,
      action: "reset",
    });
    assert.equal(harness.database.getRunSummary(runId).reconcileState, "ATTENTION_REQUIRED");
    const intervention = harness.database.db
      .prepare(
        `SELECT code FROM interventions
         WHERE run_id = ? AND entity_id = ? AND resolved_at IS NULL`,
      )
      .get(runId, prepared.mutationId) as { code: string };
    assert.equal(intervention.code, "SESSION_MUTATION_EXPIRED");

    await (harness.service as unknown as { reconcileActiveRuns(): Promise<void> }).reconcileActiveRuns();
    assert.equal(harness.database.getRunSummary(runId).reconcileState, "ATTENTION_REQUIRED");

    harness.service.completeSessionMutation(writeParams({
      commandId: "mutation-active-expiry-recover",
      mutationId: prepared.mutationId,
      success: false,
      error: "Core RPC was not executed",
    }));
    const resolved = harness.database.db
      .prepare("SELECT resolved_at FROM interventions WHERE run_id = ? AND entity_id = ?")
      .get(runId, prepared.mutationId) as { resolved_at: number | null };
    assert.ok(resolved.resolved_at);
  } finally {
    harness.close();
  }
});
