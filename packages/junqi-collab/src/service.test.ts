import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentDispatchNotStartedError } from "./agent-dispatcher.js";
import { CollaborationDatabase as ProductionCollaborationDatabase } from "./database.js";
import { commandPayloadForHash } from "./domain.js";
import { CollaborationError } from "./errors.js";
import { PERSISTENCE_LIMITS } from "./persistence-policy.js";
import {
  DEFAULT_RUNTIME_DEADLINE_POLICY,
  FixedRuntimeDeadlinePolicy,
  type RuntimeDeadlinePolicy,
  type RuntimeDeadlineValues,
} from "./runtime-deadline.js";
import { CollaborationService } from "./service.js";
import type { AgentTaskStatus, CapabilityAgent, CommandRecord, OriginRef, RuntimeAdapter } from "./types.js";
import { sha256 } from "./util.js";

const plan = {
  goal: "Assess a launch proposal",
  workItems: [
    {
      id: "research",
      title: "Research the proposal",
      inputScope: ["origin message"],
      dependencies: [],
      requiredCapabilities: ["analysis"],
      candidateAgentIds: ["worker"],
      acceptanceCriteria: ["Evidence is explicit"],
      riskLevel: "LOW",
      sideEffectClass: "READ_ONLY",
    },
    {
      id: "review",
      title: "Review the research",
      inputScope: ["research evidence"],
      dependencies: ["research"],
      requiredCapabilities: ["review"],
      candidateAgentIds: ["worker"],
      acceptanceCriteria: ["Risks are classified"],
      riskLevel: "LOW",
      sideEffectClass: "READ_ONLY",
    },
  ],
  synthesis: {
    requiredEvidence: ["research", "review"],
    finalAnswerContract: "Return a concise recommendation",
  },
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForSignal<T>(promise: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for test signal")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

class FakeRuntime implements RuntimeAdapter {
  readonly runtimeVersion = "2026.7.1";
  readonly agents: CapabilityAgent[] = [
    { id: "coordinator", name: "Coordinator", runtimeType: "native", allowed: true, coordinator: true },
    { id: "worker", name: "Worker", runtimeType: "native", allowed: true, coordinator: false },
  ];
  readonly responses = new Map<string, string>();
  readonly runs: Array<{
    runId: string;
    childSessionKey: string;
    idempotencyKey: string;
    status: AgentTaskStatus;
    terminalOutcome?: "succeeded" | "blocked";
    terminalSummary?: string;
  }> = [];
  readonly processRunIdempotency = new Map<string, string>();
  readonly dispatchedMessages: string[] = [];
  readonly transcript: Array<{ text: string; idempotencyKey: string }> = [];
  runAgentCalls = 0;
  runAgentFailuresAfterStart = 0;
  flowCreateCalls = 0;
  flowCreates = 0;
  flowControllerId: string | null = null;
  readonly flowControllerCalls: string[] = [];
  flowCreateHook?: () => void;
  flowRevision = 0;
  flowStatus: "running" | "succeeded" | "failed" | "cancelled" = "running";
  flowState: Record<string, unknown> = {};
  flowCancelRequestedAt: number | null = null;
  flowUpdateCalls = 0;
  flowUpdateFailuresAfterWrite = 0;
  flowUpdateBarrier?: () => Promise<void>;
  changedEvents = 0;
  transcriptFailuresRemaining = 0;
  transcriptFailuresAfterWrite = 0;
  readonly transcriptReplayResults: Array<{ code?: string; reason: string }> = [];
  waitMode: "ok" | "timeout" = "ok";
  waitForRunCalls = 0;
  waitOkCompletesTask = true;
  cancelMode: "confirmed" | "unconfirmed" | "throw" = "confirmed";
  readonly cancelledRunIds: string[] = [];
  readOriginBarrier?: () => Promise<void>;
  runAgentReturnBarrier?: () => Promise<void>;
  waitForRunHook: (() => Promise<{ status: "ok" | "error" | "timeout"; error?: string }>) | undefined;
  messagesBarrier?: () => Promise<void>;
  cancelBarrier?: () => Promise<void>;
  appendBarrier?: () => Promise<void>;
  plannerText: string | null = null;
  synthesisText = "Recommendation: proceed with the launch after the documented risks are addressed.";

  async readOrigin(_origin: OriginRef) {
    await this.readOriginBarrier?.();
    return { found: true, role: "user", text: "Please assess this launch proposal" };
  }

  listConfiguredAgents(): CapabilityAgent[] {
    return this.agents;
  }

  createManagedFlow(params: { controllerId: string; state: Record<string, unknown> }) {
    this.flowCreateCalls += 1;
    this.flowControllerCalls.push(params.controllerId);
    if (this.flowRevision > 0 && this.flowControllerId === params.controllerId) {
      return {
        flowId: "flow-1",
        revision: this.flowRevision,
        status: this.flowStatus,
        controllerId: this.flowControllerId,
        state: this.flowState,
        cancelRequestedAt: this.flowCancelRequestedAt,
      };
    }
    this.flowCreates += 1;
    this.flowControllerId = params.controllerId;
    this.flowRevision = 1;
    this.flowStatus = "running";
    this.flowState = params.state;
    this.flowCancelRequestedAt = null;
    this.flowCreateHook?.();
    return {
      flowId: "flow-1",
      revision: 1,
      status: this.flowStatus,
      controllerId: this.flowControllerId,
      state: this.flowState,
      cancelRequestedAt: this.flowCancelRequestedAt,
    };
  }

  findManagedFlowByController(params: { controllerId: string }) {
    if (this.flowRevision === 0 || this.flowControllerId !== params.controllerId) {
      return { kind: "ABSENT" as const };
    }
    return {
      kind: "FOUND" as const,
      flow: {
        flowId: "flow-1",
        revision: this.flowRevision,
        status: this.flowStatus,
        controllerId: this.flowControllerId,
        state: this.flowState,
        cancelRequestedAt: this.flowCancelRequestedAt,
      },
    };
  }

  async updateManagedFlow(params: {
    expectedRevision: number;
    state: Record<string, unknown>;
    terminal?: "finished" | "failed" | "cancelled";
  }) {
    this.flowUpdateCalls += 1;
    await this.flowUpdateBarrier?.();
    if (params.expectedRevision !== this.flowRevision) return null;
    this.flowRevision += 1;
    if (params.terminal !== "cancelled") this.flowState = params.state;
    this.flowStatus = params.terminal === "finished"
      ? "succeeded"
      : params.terminal === "failed"
        ? "failed"
        : params.terminal === "cancelled"
          ? "cancelled"
          : "running";
    if (this.flowUpdateFailuresAfterWrite > 0) {
      this.flowUpdateFailuresAfterWrite -= 1;
      throw new Error("managed flow acknowledgement lost after durable update");
    }
    return { revision: this.flowRevision };
  }

  getManagedFlow() {
    if (this.flowRevision === 0) return null;
    return {
      flowId: "flow-1",
      revision: this.flowRevision,
      status: this.flowStatus,
      controllerId: this.flowControllerId,
      state: this.flowState,
      cancelRequestedAt: this.flowCancelRequestedAt,
    };
  }

  async runAgent(params: { ownerAgentId: string; childSessionKey: string; message: string; idempotencyKey: string }) {
    this.runAgentCalls += 1;
    const existingRunId = this.processRunIdempotency.get(params.idempotencyKey);
    const existing = existingRunId ? this.runs.find((run) => run.runId === existingRunId) : undefined;
    if (existing) return { runId: existing.runId, taskId: `task-${existing.runId}` };
    const runId = `openclaw-${this.runs.length + 1}`;
    this.dispatchedMessages.push(params.message);
    const response = params.message.includes("You are the planner")
      ? (this.plannerText ?? JSON.stringify(plan))
      : params.message.includes("You are a worker")
        ? JSON.stringify({
            summary: "Verified",
            outcome: "SUCCEEDED",
            evidence: [
              {
                type: "analysis",
                title: "Verified result",
                reference: `${params.ownerAgentId}:${runId}`,
                verification: "Acceptance criteria checked",
              },
            ],
            createdArtifacts: [],
            handoffNotes: [],
          })
        : this.synthesisText;
    this.runs.push({
      runId,
      childSessionKey: params.childSessionKey,
      idempotencyKey: params.idempotencyKey,
      status: "running",
    });
    this.processRunIdempotency.set(params.idempotencyKey, runId);
    this.responses.set(params.childSessionKey, response);
    await this.runAgentReturnBarrier?.();
    if (this.runAgentFailuresAfterStart > 0) {
      this.runAgentFailuresAfterStart -= 1;
      throw new Error("runAgent acknowledgement lost after remote start");
    }
    return { runId, taskId: `task-${runId}` };
  }

  async findAgentTask(params: {
    ownerSessionKey: string;
    childSessionKey: string;
    expectedTaskId?: string;
    expectedRunId?: string;
  }) {
    const matches = this.runs.filter((run) => (
      run.childSessionKey === params.childSessionKey
      && (!params.expectedTaskId || `task-${run.runId}` === params.expectedTaskId)
      && (!params.expectedRunId || run.runId === params.expectedRunId)
    ));
    if (matches.length === 0) return { kind: "ABSENT" as const };
    if (matches.length !== 1) {
      return {
        kind: "AMBIGUOUS" as const,
        matchCount: matches.length,
        reason: "Multiple fake Tasks use the same child session key",
      };
    }
    const run = matches[0]!;
    return {
      kind: "FOUND" as const,
      taskId: `task-${run.runId}`,
      runId: run.runId,
      status: run.status,
      ...(run.terminalOutcome ? { terminalOutcome: run.terminalOutcome } : {}),
      ...(run.terminalSummary ? { terminalSummary: run.terminalSummary } : {}),
    };
  }

  async waitForRun(runId: string) {
    this.waitForRunCalls += 1;
    let result: { status: "ok" | "error" | "timeout"; error?: string };
    if (this.waitForRunHook) {
      result = await this.waitForRunHook();
    } else if (this.waitMode === "timeout") {
      await new Promise((resolve) => setTimeout(resolve, 5));
      result = { status: "timeout" };
    } else {
      result = { status: "ok" };
    }
    if (result.status === "ok" && this.waitOkCompletesTask) {
      const run = this.runs.find((candidate) => candidate.runId === runId);
      if (run?.status === "running" || run?.status === "queued") run.status = "succeeded";
    }
    return result;
  }

  async getSessionMessages(sessionKey: string) {
    await this.messagesBarrier?.();
    return [{ role: "assistant", content: this.responses.get(sessionKey) ?? "" }];
  }

  async cancelRun(params: { runId: string }) {
    this.cancelledRunIds.push(params.runId);
    await this.cancelBarrier?.();
    if (this.cancelMode === "throw") throw new Error("cancel transport unavailable");
    if (this.cancelMode === "unconfirmed") {
      return { found: true, cancelled: false, reason: "runtime could not confirm cancellation" };
    }
    const run = this.runs.find((candidate) => candidate.runId === params.runId);
    if (run) run.status = "cancelled";
    return { found: true, cancelled: true };
  }

  async appendTranscript(params: { text: string; idempotencyKey: string }) {
    await this.appendBarrier?.();
    if (this.transcriptFailuresRemaining > 0) {
      this.transcriptFailuresRemaining -= 1;
      throw new Error("transcript acknowledgement lost");
    }
    const existingIndex = this.transcript.findIndex((entry) => entry.idempotencyKey === params.idempotencyKey);
    if (existingIndex >= 0) {
      const replayFailure = this.transcriptReplayResults.shift();
      if (replayFailure) return { ok: false as const, ...replayFailure };
      return { ok: true as const, messageId: `message-${existingIndex + 1}` };
    }
    this.transcript.push(params);
    if (this.transcriptFailuresAfterWrite > 0) {
      this.transcriptFailuresAfterWrite -= 1;
      throw new Error("transcript acknowledgement lost after durable append");
    }
    return { ok: true as const, messageId: `message-${this.transcript.length}` };
  }

  emitChanged() {
    this.changedEvents += 1;
  }
}

let currentTestCollaborationInstanceId = "";

class CollaborationDatabase extends ProductionCollaborationDatabase {
  constructor(filePath: string) {
    super(filePath);
    currentTestCollaborationInstanceId = this.instanceId;
  }
}

function restartFakeRuntime(source: FakeRuntime): FakeRuntime {
  const restarted = new FakeRuntime();
  restarted.runs.push(...source.runs.map((run) => ({ ...run })));
  for (const [sessionKey, response] of source.responses) restarted.responses.set(sessionKey, response);
  restarted.transcript.push(...source.transcript.map((entry) => ({ ...entry })));
  restarted.flowCreateCalls = source.flowCreateCalls;
  restarted.flowCreates = source.flowCreates;
  restarted.flowControllerId = source.flowControllerId;
  restarted.flowControllerCalls.push(...source.flowControllerCalls);
  restarted.flowRevision = source.flowRevision;
  restarted.flowStatus = source.flowStatus;
  restarted.flowState = structuredClone(source.flowState);
  restarted.flowCancelRequestedAt = source.flowCancelRequestedAt;
  return restarted;
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
  if (withHash.maintenanceLeaseId !== undefined && withHash.owner === undefined) {
    withHash.owner = "test";
  }
  return { ...withHash, payloadHash: sha256(commandPayloadForHash(withHash)) };
}

function expireActiveMaintenanceLease(database: CollaborationDatabase): string {
  const stored = JSON.parse(database.getMetadata("maintenance_lease")!) as Record<string, unknown>;
  const { expiredAt: _expiredAt, ...active } = stored;
  database.setMetadata("maintenance_lease", JSON.stringify({
    ...active,
    version: 1,
    status: "ACTIVE",
    enteredAt: 0,
    expiresAt: 1,
  }));
  return String(stored.id);
}

async function waitUntil(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for collaboration state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function startRunningCollaboration(
  service: CollaborationService,
  database: CollaborationDatabase,
  runtime: FakeRuntime,
  origin: OriginRef,
  commandPrefix: string,
): Promise<string> {
  const created = await service.createPlan(
    writeParams({ commandId: `${commandPrefix}-create`, origin, goal: "Assess a launch proposal" }),
  );
  const runId = String(created.runId);
  await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
  const planned = database.getRunSummary(runId);
  runtime.waitMode = "timeout";
  service.approvePlan(writeParams({
    commandId: `${commandPrefix}-approve`,
    runId,
    planRevisionId: planned.currentPlanRevisionId,
    expectedRunRevision: planned.revision,
    assignments: { research: "worker", review: "worker" },
  }));
  await waitUntil(() => {
    const snapshot = service.getRun({ runId });
    return (snapshot.attempts as Array<{ kind: string; status: string }>).some(
      (attempt) => attempt.kind === "WORKER" && attempt.status === "RUNNING",
    );
  });
  return runId;
}

async function startRunningCollaborationWithBlockedWorker(
  service: CollaborationService,
  database: CollaborationDatabase,
  runtime: FakeRuntime,
  origin: OriginRef,
  commandPrefix: string,
  workerWait: Promise<{ status: "ok" | "error" | "timeout" }>,
): Promise<string> {
  const created = await service.createPlan(
    writeParams({ commandId: `${commandPrefix}-create`, origin, goal: "Assess a launch proposal" }),
  );
  const runId = String(created.runId);
  await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
  const planned = database.getRunSummary(runId);
  runtime.waitForRunHook = () => workerWait;
  service.approvePlan(writeParams({
    commandId: `${commandPrefix}-approve`,
    runId,
    planRevisionId: planned.currentPlanRevisionId,
    expectedRunRevision: planned.revision,
    assignments: { research: "worker", review: "worker" },
  }));
  await waitUntil(() => {
    const snapshot = service.getRun({ runId });
    return (snapshot.attempts as Array<{ kind: string; status: string }>).some(
      (attempt) => attempt.kind === "WORKER" && attempt.status === "RUNNING",
    );
  });
  return runId;
}

async function startCollaborationUntilDelivery(
  service: CollaborationService,
  database: CollaborationDatabase,
  origin: OriginRef,
  commandPrefix: string,
  expectedDeliveryStatus: string,
  timeoutMs = 5_000,
): Promise<{ runId: string; deliveryId: string }> {
  const created = await service.createPlan(
    writeParams({ commandId: `${commandPrefix}-create`, origin, goal: "Assess a launch proposal" }),
  );
  const runId = String(created.runId);
  await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL", timeoutMs);
  const planned = database.getRunSummary(runId);
  service.approvePlan(writeParams({
    commandId: `${commandPrefix}-approve`,
    runId,
    planRevisionId: planned.currentPlanRevisionId,
    expectedRunRevision: planned.revision,
    assignments: { research: "worker", review: "worker" },
  }));
  await waitUntil(() => {
    const delivery = database.db
      .prepare("SELECT status FROM deliveries WHERE run_id = ? ORDER BY target_revision DESC LIMIT 1")
      .get(runId) as { status?: string } | undefined;
    return delivery?.status === expectedDeliveryStatus;
  }, timeoutMs);
  const delivery = database.db
    .prepare("SELECT id FROM deliveries WHERE run_id = ? ORDER BY target_revision DESC LIMIT 1")
    .get(runId) as { id: string };
  return { runId, deliveryId: delivery.id };
}

function createTestService(
  database: CollaborationDatabase,
  runtime: FakeRuntime,
  directory: string,
  logger = { info() {}, warn() {}, error() {} },
  runtimeDeadlinePolicy: RuntimeDeadlinePolicy = DEFAULT_RUNTIME_DEADLINE_POLICY,
): CollaborationService {
  return new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  }, directory, logger, undefined, runtimeDeadlinePolicy);
}

function testRuntimeDeadlinePolicy(
  overrides: Partial<RuntimeDeadlineValues>,
): RuntimeDeadlinePolicy {
  return new FixedRuntimeDeadlinePolicy({
    ...DEFAULT_RUNTIME_DEADLINE_POLICY.values,
    ...overrides,
  });
}

test("a definite Gateway dispatch refusal fails the Attempt without creating UNKNOWN execution risk", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-dispatch-rejected-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.agents[0]!.runtimeType = "acp";
  runtime.runAgent = async (_params: Parameters<RuntimeAdapter["runAgent"]>[0]) => {
    runtime.runAgentCalls += 1;
    throw new AgentDispatchNotStartedError("ACP is disabled by Gateway policy", {
      runtime: "acp",
      rejected: true,
    });
  };
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "dispatch-rejected-create",
      origin: {
        runtimeId: "runtime-dispatch-rejected",
        agentId: "main",
        sessionKey: "agent:main:dispatch-rejected",
        sessionId: "session-dispatch-rejected",
        nativeMessageId: "message-dispatch-rejected",
      },
      goal: "Exercise a rejected ACP dispatch",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_INTERVENTION");

    const run = database.getRunSummary(runId);
    const attempt = database.db
      .prepare("SELECT status, execution_runtime, openclaw_run_id FROM attempts WHERE run_id = ?")
      .get(runId) as { status: string; execution_runtime: string; openclaw_run_id: string | null };
    const command = database.db
      .prepare("SELECT status FROM commands WHERE run_id = ? AND kind = 'PLAN'")
      .get(runId) as { status: string };
    const intervention = database.db
      .prepare("SELECT code FROM interventions WHERE run_id = ? AND resolved_at IS NULL")
      .get(runId) as { code: string };
    assert.equal(run.dispatchState, "STOPPED");
    assert.equal(run.reconcileState, "ATTENTION_REQUIRED");
    assert.equal(attempt.status, "FAILED");
    assert.equal(attempt.execution_runtime, "acp");
    assert.equal(attempt.openclaw_run_id, null);
    assert.equal(command.status, "FAILED");
    assert.equal(intervention.code, "AGENT_DISPATCH_REJECTED");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM attempts WHERE run_id = ? AND status = 'UNKNOWN'").get(runId)?.value),
      0,
    );
    assert.equal(runtime.runAgentCalls, 1);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a definite Gateway refusal closes a concurrent cancellation without residual execution risk", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-dispatch-rejected-cancel-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const dispatchStarted = deferred<void>();
  const releaseDispatch = deferred<void>();
  runtime.agents[0]!.runtimeType = "acp";
  runtime.runAgent = async (_params: Parameters<RuntimeAdapter["runAgent"]>[0]) => {
    runtime.runAgentCalls += 1;
    dispatchStarted.resolve();
    await releaseDispatch.promise;
    throw new AgentDispatchNotStartedError("ACP is disabled by Gateway policy", {
      runtime: "acp",
      rejected: true,
    });
  };
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "dispatch-rejected-cancel-create",
      origin: {
        runtimeId: "runtime-dispatch-rejected-cancel",
        agentId: "main",
        sessionKey: "agent:main:dispatch-rejected-cancel",
        sessionId: "session-dispatch-rejected-cancel",
        nativeMessageId: "message-dispatch-rejected-cancel",
      },
      goal: "Cancel while ACP policy is rejecting dispatch",
    }));
    const runId = String(created.runId);
    await waitForSignal(dispatchStarted.promise);
    const dispatching = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "dispatch-rejected-cancel-run",
      runId,
      expectedRunRevision: dispatching.revision,
    }));
    assert.equal(database.getRunSummary(runId).status, "CANCELLING");
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE run_id = ?").get(runId) as { status: string }).status,
      "DISPATCHING",
    );

    releaseDispatch.resolve();
    await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");
    const attempt = database.db
      .prepare("SELECT status, openclaw_run_id FROM attempts WHERE run_id = ?")
      .get(runId) as { status: string; openclaw_run_id: string | null };
    assert.equal(attempt.status, "CANCELLED");
    assert.equal(attempt.openclaw_run_id, null);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM interventions WHERE run_id = ? AND resolved_at IS NULL").get(runId)?.value),
      0,
    );
    assert.equal(database.getRunSummary(runId).reconcileState, "IDLE");
  } finally {
    releaseDispatch.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function preparePendingProvision(
  database: CollaborationDatabase,
  runtime: FakeRuntime,
  directory: string,
  origin: OriginRef,
  commandPrefix: string,
): Promise<{ runId: string; provisionCommandId: string; controlService: CollaborationService }> {
  const controlService = createTestService(database, runtime, directory);
  controlService.start();
  const created = await controlService.createPlan(writeParams({
    commandId: `${commandPrefix}-create`,
    origin,
    goal: "Assess a launch proposal",
  }));
  const runId = String(created.runId);
  await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
  await controlService.stop();

  const planned = database.getRunSummary(runId);
  const provisionCommandId = `${commandPrefix}-approve`;
  controlService.approvePlan(writeParams({
    commandId: provisionCommandId,
    runId,
    planRevisionId: planned.currentPlanRevisionId,
    expectedRunRevision: planned.revision,
    assignments: { research: "worker", review: "worker" },
  }));
  assert.equal(database.getRunSummary(runId).status, "PROVISIONING");
  assert.equal(database.getCommand(provisionCommandId).status, "PENDING");
  return { runId, provisionCommandId, controlService };
}

test("global run history returns a bounded opaque cursor and rejects malformed or mismatched cursors", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-run-list-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  try {
    for (const id of ["history-a", "history-b", "history-c"]) {
      database.createRun({
        id,
        origin: {
          runtimeId: "runtime-history",
          agentId: "main",
          sessionKey: `agent:main:${id}`,
          sessionId: `session-${id}`,
          nativeMessageId: `message-${id}`,
        },
        goal: id,
        capabilitySnapshot: {},
      });
    }
    database.db.prepare("UPDATE collaboration_runs SET created_at = 777, updated_at = 777").run();

    const first = service.listRuns({ includeArchived: true, limit: 2 }) as {
      runs: Array<{ id: string }>;
      nextCursor: string | null;
    };
    assert.deepEqual(first.runs.map((run) => run.id), ["history-c", "history-b"]);
    assert.equal(typeof first.nextCursor, "string");
    assert.ok(Buffer.byteLength(first.nextCursor!, "utf8") <= 512);

    database.db.prepare("UPDATE collaboration_runs SET updated_at = 999 WHERE id = 'history-a'").run();

    const second = service.listRuns({ includeArchived: true, limit: 2, cursor: first.nextCursor }) as {
      runs: Array<{ id: string }>;
      nextCursor: string | null;
    };
    assert.deepEqual(second.runs.map((run) => run.id), ["history-a"]);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.runs, ...second.runs].map((run) => run.id)).size, 3);

    const outsideSnapshot = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8")) as {
      createdAt: number;
      snapshotCreatedAt: number;
    };
    outsideSnapshot.createdAt = outsideSnapshot.snapshotCreatedAt + 1;
    const outsideSnapshotCursor = Buffer.from(JSON.stringify(outsideSnapshot), "utf8").toString("base64url");
    assert.throws(
      () => service.listRuns({ includeArchived: true, limit: 2, cursor: outsideSnapshotCursor }),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "INVALID_REQUEST"
        && /snapshot boundary/.test(error.message),
    );

    assert.throws(
      () => service.listRuns({ includeArchived: true, limit: 2, cursor: "not+a-valid-cursor" }),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
    );
    assert.throws(
      () => service.listRuns({ includeArchived: false, limit: 2, cursor: first.nextCursor }),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "INVALID_REQUEST"
        && /filters/.test(error.message),
    );
    assert.throws(
      () => service.listRuns({ includeArchived: true, limit: 501 }),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("event pages validate integer bounds and expose an advancing hasMore cursor", () => {
  const database = new CollaborationDatabase(":memory:");
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-event-page-test-"));
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  const runId = "event-page-run";
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-event-page",
        agentId: "main",
        sessionKey: "agent:main:event-page",
        sessionId: "session-event-page",
        nativeMessageId: "message-event-page",
      },
      goal: "event page contract",
      capabilitySnapshot: {},
    });
    for (let index = 0; index < 3; index += 1) {
      database.appendEvent(runId, `TEST_${index}`, null, null, 1, { index });
    }
    const first = service.listEvents({ runId, afterSequence: 0, limit: 2 }) as {
      events: Array<{ sequence: number }>;
      nextSequence: number;
      hasMore: boolean;
    };
    assert.deepEqual(first.events.map((event) => event.sequence), [1, 2]);
    assert.equal(first.nextSequence, 2);
    assert.equal(first.hasMore, true);
    const second = service.listEvents({ runId, afterSequence: first.nextSequence, limit: 2 }) as {
      events: Array<{ sequence: number }>;
      nextSequence: number;
      hasMore: boolean;
    };
    assert.deepEqual(second.events.map((event) => event.sequence), [3, 4]);
    assert.equal(second.nextSequence, 4);
    assert.equal(second.hasMore, false);

    for (const invalidLimit of [0, -1, 1.5, Number.NaN, PERSISTENCE_LIMITS.eventsPerPage + 1]) {
      assert.throws(
        () => service.listEvents({ runId, afterSequence: 0, limit: invalidLimit }),
        (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
      );
    }
    for (const invalidCursor of [-1, 1.5, Number.NaN]) {
      assert.throws(
        () => service.listEvents({ runId, afterSequence: invalidCursor, limit: 2 }),
        (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
      );
    }
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("capabilities fail closed when the configured coordinator is not effectively allowed", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-capabilities-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.agents[0] = { ...runtime.agents[0]!, allowed: false };
  const service = new CollaborationService(
    database,
    runtime,
    {
      coordinatorAgentId: "coordinator",
      allowedAgentIds: ["worker"],
      maxConcurrency: 2,
      maxWorkItems: 10,
      attemptTimeoutMs: 60_000,
      retentionDays: 365,
    },
    directory,
    { info() {}, warn() {}, error() {} },
  );
  try {
    service.start();
    const capabilityDocument = service.capabilities() as {
      configured: boolean;
      coordinatorAgentId: string | null;
      allowedAgentIds: string[];
      repairs: string[];
      featureEvidence: {
        kind: string;
        behaviorVerified: boolean;
        requiredBehaviorGate: string;
        structuralChecks: { databaseIntegrity: string; configured: boolean };
      };
    };
    assert.equal(capabilityDocument.configured, false);
    assert.equal(capabilityDocument.coordinatorAgentId, "coordinator");
    assert.deepEqual(capabilityDocument.allowedAgentIds, ["worker"]);
    assert.ok(capabilityDocument.repairs.some((repair) => /Include the coordinator/.test(repair)));
    assert.equal(capabilityDocument.featureEvidence.kind, "DECLARED_PLUGIN_CONTRACT");
    assert.equal(capabilityDocument.featureEvidence.behaviorVerified, false);
    assert.equal(capabilityDocument.featureEvidence.requiredBehaviorGate, "ISOLATED_REAL_GATEWAY");
    assert.equal(capabilityDocument.featureEvidence.structuralChecks.databaseIntegrity, "ok");
    assert.equal(capabilityDocument.featureEvidence.structuralChecks.configured, false);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("capabilities reuse startup database health and maintenance refreshes it explicitly", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-health-cache-test-"));
  const database = new CollaborationDatabase(":memory:");
  const integrityCheck = database.integrityCheck.bind(database);
  let integrityChecks = 0;
  database.integrityCheck = () => {
    integrityChecks += 1;
    return integrityCheck();
  };
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  try {
    assert.equal(service.capabilities().databaseIntegrity, "unknown");
    assert.equal(integrityChecks, 0);

    service.start();
    assert.equal(integrityChecks, 1);
    assert.equal(service.capabilities().databaseIntegrity, "ok");
    assert.equal(service.capabilities().databaseIntegrity, "ok");
    assert.equal(integrityChecks, 1);

    const entered = service.enterMaintenance(writeParams({
      commandId: "health-cache-maintenance-enter",
      reason: "verify database health cache refresh",
      owner: "test",
    }));
    assert.equal(entered.databaseIntegrity, "ok");
    assert.equal(integrityChecks, 2);
    assert.equal(service.capabilities().databaseIntegrity, "ok");
    assert.equal(integrityChecks, 2);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed maintenance health refresh invalidates cached startup health before mutation", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-health-failure-test-"));
  const database = new CollaborationDatabase(":memory:");
  const integrityCheck = database.integrityCheck.bind(database);
  let failRefresh = false;
  database.integrityCheck = () => {
    if (failRefresh) throw new Error("integrity probe unavailable");
    return integrityCheck();
  };
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  try {
    service.start();
    assert.equal(service.capabilities().databaseIntegrity, "ok");

    failRefresh = true;
    assert.throws(
      () => service.enterMaintenance(writeParams({
        commandId: "health-failure-maintenance-enter",
        reason: "verify failed health refresh fencing",
        owner: "test",
      })),
      /integrity probe unavailable/,
    );
    assert.equal(service.capabilities().databaseIntegrity, "unknown");
    assert.equal(service.maintenanceStatus().active, false);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("command receipts bind idempotency to the exact collaboration operation", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-operation-receipt-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  const runId = "operation-receipt-run";
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-operation-receipt",
        agentId: "main",
        sessionKey: "agent:main:operation-receipt",
        sessionId: "session-operation-receipt",
        nativeMessageId: "message-operation-receipt",
      },
      goal: "Keep archive and unarchive idempotency distinct",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(Date.now(), runId);
    const shared = writeParams({
      commandId: "shared-archive-command",
      runId,
      expectedRunRevision: database.getRunSummary(runId).revision,
    });
    service.archiveRun(shared, true);
    assert.equal(database.getRunSummary(runId).archiveState, "ARCHIVED");
    assert.throws(
      () => service.archiveRun(shared, false),
      (error: unknown) => error instanceof CollaborationError && error.code === "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(database.getRunSummary(runId).archiveState, "ARCHIVED");

    const unarchive = writeParams({
      commandId: "distinct-unarchive-command",
      runId,
      expectedRunRevision: database.getRunSummary(runId).revision,
    });
    service.archiveRun(unarchive, false);
    assert.equal(database.getRunSummary(runId).archiveState, "ACTIVE");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("maintenance commands are replayable and persist only bounded active-run references", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-maintenance-receipt-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  try {
    database.createRun({
      id: "maintenance-visible-run",
      origin: {
        runtimeId: "runtime-maintenance",
        agentId: "main",
        sessionKey: "agent:main:maintenance",
        sessionId: "session-maintenance",
        nativeMessageId: "message-maintenance",
      },
      goal: "PRIVATE_GOAL_NOT_IN_MAINTENANCE_RECEIPT",
      capabilitySnapshot: {},
    });
    const enterParams = writeParams({
      commandId: "maintenance-enter-command",
      reason: "storage-migration",
      owner: "desktop-operation",
    });
    const entered = service.enterMaintenance(enterParams);
    const replayedEnter = service.enterMaintenance(enterParams);
    assert.equal(replayedEnter.replayed, true);
    assert.equal(replayedEnter.maintenanceLeaseId, entered.maintenanceLeaseId);
    const persistedLease = service.maintenanceStatus().lease as Record<string, unknown>;
    assert.equal(
      Number(persistedLease.expiresAt) - Number(persistedLease.enteredAt),
      45 * 60_000,
    );
    assert.doesNotMatch(JSON.stringify(entered), /PRIVATE_GOAL/);
    await assert.rejects(
      () => service.createPlan(writeParams({
        commandId: "maintenance-blocked-plan",
        origin: {
          runtimeId: "runtime-maintenance",
          agentId: "main",
          sessionKey: "agent:main:maintenance-new",
          sessionId: "session-maintenance-new",
          nativeMessageId: "message-maintenance-new",
        },
        goal: "Do not start during maintenance",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "MAINTENANCE_ACTIVE",
    );
    const exitParams = writeParams({
      commandId: "maintenance-exit-command",
      maintenanceLeaseId: entered.maintenanceLeaseId,
      owner: "desktop-operation",
      healthVerified: true,
    });
    assert.throws(
      () => service.exitMaintenance(writeParams({
        commandId: "maintenance-foreign-owner-exit-command",
        maintenanceLeaseId: entered.maintenanceLeaseId,
        owner: "other-desktop",
        healthVerified: true,
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "REVISION_CONFLICT",
    );
    assert.equal(service.maintenanceStatus().active, true);
    assert.equal(service.exitMaintenance(exitParams).active, false);
    assert.equal(service.exitMaintenance(exitParams).replayed, true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an expired maintenance lease recovers once after restart and requires an exact explicit release", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-maintenance-expiry-restart-"));
  const databasePath = path.join(directory, "collaboration.sqlite");
  let database: CollaborationDatabase | null = new CollaborationDatabase(databasePath);
  let restartedDatabase: CollaborationDatabase | null = null;
  let restartedService: CollaborationService | null = null;
  try {
    const service = createTestService(database, new FakeRuntime(), directory);
    const runId = "maintenance-expiry-run";
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-maintenance-expiry",
        agentId: "main",
        sessionKey: "agent:main:maintenance-expiry",
        sessionId: "session-maintenance-expiry",
        nativeMessageId: "message-maintenance-expiry",
      },
      goal: "Remain stopped after an expired maintenance lease",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'RUNNING', dispatch_state = 'OPEN' WHERE id = ?")
      .run(runId);
    const entered = service.enterMaintenance(writeParams({
      commandId: "maintenance-expiry-enter",
      reason: "restart recovery test",
      owner: "test",
    }));
    const leaseId = String(entered.maintenanceLeaseId);
    const stored = JSON.parse(database.getMetadata("maintenance_lease")!) as Record<string, unknown>;
    database.setMetadata("maintenance_lease", JSON.stringify({
      ...stored,
      version: 1,
      status: "ACTIVE",
      enteredAt: 0,
      expiresAt: 1,
    }));
    database.close();
    database = null;

    restartedDatabase = new CollaborationDatabase(databasePath);
    restartedService = createTestService(restartedDatabase, new FakeRuntime(), directory);
    restartedService.start();

    const firstStatus = restartedService.maintenanceStatus();
    const secondStatus = restartedService.maintenanceStatus();
    const capabilityStatus = restartedService.capabilities().maintenance as Record<string, unknown>;
    for (const status of [firstStatus, secondStatus, capabilityStatus]) {
      assert.equal(status.active, true);
      assert.equal(status.gateActive, true);
      assert.equal(status.status, "EXPIRED");
      assert.equal(status.recoveryRequired, true);
      assert.equal((status.lease as Record<string, unknown>).id, leaseId);
      assert.equal((status.lease as Record<string, unknown>).status, "EXPIRED");
    }

    const eventCount = restartedDatabase.db
      .prepare(
        "SELECT COUNT(*) AS count FROM collaboration_events WHERE run_id = ? AND event_type = 'MAINTENANCE_LEASE_EXPIRED'",
      )
      .get(runId) as { count: number };
    const interventionCount = restartedDatabase.db
      .prepare(
        `SELECT COUNT(*) AS count FROM interventions
         WHERE run_id = ? AND code = 'MAINTENANCE_LEASE_EXPIRED' AND entity_id = ? AND resolved_at IS NULL`,
      )
      .get(runId, leaseId) as { count: number };
    assert.equal(Number(eventCount.count), 1);
    assert.equal(Number(interventionCount.count), 1);
    assert.equal(restartedDatabase.getRunSummary(runId).reconcileState, "ATTENTION_REQUIRED");

    await assert.rejects(
      () => restartedService!.createPlan(writeParams({
        commandId: "maintenance-expiry-blocked-plan",
        origin: {
          runtimeId: "runtime-maintenance-expiry",
          agentId: "main",
          sessionKey: "agent:main:maintenance-expiry-blocked",
          sessionId: "session-maintenance-expiry-blocked",
          nativeMessageId: "message-maintenance-expiry-blocked",
        },
        goal: "Must remain blocked after expiry",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "MAINTENANCE_ACTIVE",
    );
    assert.throws(
      () => restartedService!.exitMaintenance(writeParams({
        commandId: "maintenance-expiry-wrong-exit",
        maintenanceLeaseId: "maintenance-wrong",
        healthVerified: true,
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "REVISION_CONFLICT",
    );

    const released = restartedService.exitMaintenance(writeParams({
      commandId: "maintenance-expiry-exact-exit",
      maintenanceLeaseId: leaseId,
      healthVerified: true,
    }));
    assert.equal(released.active, false);
    assert.equal(released.gateActive, false);
    assert.equal(released.status, "INACTIVE");
    const runAfterExit = restartedDatabase.getRunSummary(runId);
    assert.equal(runAfterExit.status, "AWAITING_INTERVENTION");
    assert.equal(runAfterExit.dispatchState, "STOPPED");
    assert.equal(runAfterExit.reconcileState, "ATTENTION_REQUIRED");
    assert.equal(
      Number((restartedDatabase.db
        .prepare(
          `SELECT COUNT(*) AS count FROM interventions
           WHERE run_id = ? AND code = 'MAINTENANCE_LEASE_EXPIRED' AND resolved_at IS NULL`,
        )
        .get(runId) as { count: number }).count),
      1,
    );
  } finally {
    await restartedService?.stop();
    restartedDatabase?.close();
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a terminal Planner result settles locally after maintenance expiry without clearing the recovery fence", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-maintenance-planner-settlement-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.waitMode = "timeout";
  const service = createTestService(database, runtime, directory);
  try {
    service.start();
    const created = await service.createPlan(writeParams({
      commandId: "maintenance-planner-create",
      origin: {
        runtimeId: "runtime-maintenance-planner",
        agentId: "main",
        sessionKey: "agent:main:maintenance-planner",
        sessionId: "session-maintenance-planner",
        nativeMessageId: "message-maintenance-planner",
      },
      goal: "Settle a planner result across maintenance expiry",
    }));
    const runId = String(created.runId);
    await waitUntil(() => Boolean(database.db
      .prepare("SELECT 1 FROM attempts WHERE run_id = ? AND kind = 'PLANNER' AND status = 'RUNNING'")
      .get(runId)));

    service.enterMaintenance(writeParams({
      commandId: "maintenance-planner-enter",
      reason: "planner settlement fence",
      owner: "test",
    }));
    const leaseId = expireActiveMaintenanceLease(database);
    const maintenance = service.maintenanceStatus();
    assert.equal(maintenance.status, "EXPIRED");
    assert.equal(database.getRunSummary(runId).status, "AWAITING_INTERVENTION");
    assert.equal(database.getRunRow(runId).resume_status, "PLANNING");

    const plannerAttempt = database.db
      .prepare("SELECT openclaw_run_id FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(runId) as { openclaw_run_id: string };
    runtime.runs.find((run) => run.runId === plannerAttempt.openclaw_run_id)!.status = "succeeded";
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");

    const settledAttempt = database.db
      .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(runId) as { status: string };
    assert.equal(settledAttempt.status, "SUCCEEDED");
    assert.ok(database.getRunSummary(runId).currentPlanRevisionId);
    assert.equal(database.getRunSummary(runId).reconcileState, "ATTENTION_REQUIRED");
    assert.equal(database.getRunRow(runId).resume_status, null);
    assert.equal(service.maintenanceStatus().gateActive, true);
    assert.equal(Number((database.db
      .prepare(
        `SELECT COUNT(*) AS count FROM interventions
         WHERE run_id = ? AND code = 'MAINTENANCE_LEASE_EXPIRED' AND entity_id = ? AND resolved_at IS NULL`,
      )
      .get(runId, leaseId) as { count: number }).count), 1);
    assert.equal(Number((database.db
      .prepare(
        "SELECT COUNT(*) AS count FROM collaboration_events WHERE run_id = ? AND event_type = 'SUSPENDED_ATTEMPT_RESULT_ACCEPTED'",
      )
      .get(runId) as { count: number }).count), 1);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a suspended Planner result is rejected when its durable resume phase belongs to another attempt kind", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-maintenance-planner-mismatch-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.waitMode = "timeout";
  const service = createTestService(database, runtime, directory);
  try {
    service.start();
    const created = await service.createPlan(writeParams({
      commandId: "maintenance-planner-mismatch-create",
      origin: {
        runtimeId: "runtime-maintenance-planner-mismatch",
        agentId: "main",
        sessionKey: "agent:main:maintenance-planner-mismatch",
        sessionId: "session-maintenance-planner-mismatch",
        nativeMessageId: "message-maintenance-planner-mismatch",
      },
      goal: "Reject a mismatched suspended planner result",
    }));
    const runId = String(created.runId);
    await waitUntil(() => Boolean(database.db
      .prepare("SELECT 1 FROM attempts WHERE run_id = ? AND kind = 'PLANNER' AND status = 'RUNNING'")
      .get(runId)));

    service.enterMaintenance(writeParams({
      commandId: "maintenance-planner-mismatch-enter",
      reason: "planner mismatch fence",
      owner: "test",
    }));
    expireActiveMaintenanceLease(database);
    service.maintenanceStatus();
    database.db
      .prepare("UPDATE collaboration_runs SET resume_status = 'SYNTHESIZING' WHERE id = ?")
      .run(runId);

    const plannerAttempt = database.db
      .prepare("SELECT openclaw_run_id FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(runId) as { openclaw_run_id: string };
    let terminalTranscriptRead = false;
    runtime.messagesBarrier = async () => {
      terminalTranscriptRead = true;
    };
    runtime.runs.find((run) => run.runId === plannerAttempt.openclaw_run_id)!.status = "succeeded";
    await waitUntil(() => terminalTranscriptRead);

    assert.equal(database.getRunSummary(runId).status, "AWAITING_INTERVENTION");
    assert.equal(database.getRunSummary(runId).currentPlanRevisionId, null);
    assert.equal((database.db
      .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(runId) as { status: string }).status, "RUNNING");
    assert.equal(Number((database.db
      .prepare(
        "SELECT COUNT(*) AS count FROM collaboration_events WHERE run_id = ? AND event_type = 'SUSPENDED_ATTEMPT_RESULT_ACCEPTED'",
      )
      .get(runId) as { count: number }).count), 0);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a Worker result during maintenance remains resumable and does not strand dependent dispatch", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-maintenance-worker-settlement-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  const origin: OriginRef = {
    runtimeId: "runtime-maintenance-worker",
    agentId: "main",
    sessionKey: "agent:main:maintenance-worker",
    sessionId: "session-maintenance-worker",
    nativeMessageId: "message-maintenance-worker",
  };
  service.start();
  try {
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      origin,
      "maintenance-worker",
    );
    const researchAttempt = database.db
      .prepare(
        `SELECT a.openclaw_run_id FROM attempts a
         JOIN work_items w ON w.id = a.work_item_id
         WHERE a.run_id = ? AND w.logical_id = 'research' ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(runId) as { openclaw_run_id: string };
    assert.ok(researchAttempt.openclaw_run_id);

    service.enterMaintenance(writeParams({
      commandId: "maintenance-worker-enter",
      reason: "worker settlement fence",
      owner: "test",
    }));
    const leaseId = expireActiveMaintenanceLease(database);
    service.maintenanceStatus();
    assert.equal(database.getRunSummary(runId).status, "AWAITING_INTERVENTION");
    assert.equal(database.getRunRow(runId).resume_status, "RUNNING");

    runtime.runs.find((run) => run.runId === researchAttempt.openclaw_run_id)!.status = "succeeded";
    await waitUntil(() => (
      (database.db
        .prepare(
          `SELECT a.status FROM attempts a JOIN work_items w ON w.id = a.work_item_id
           WHERE a.run_id = ? AND w.logical_id = 'research' ORDER BY a.created_at DESC LIMIT 1`,
        )
        .get(runId) as { status: string }).status === "SUCCEEDED"
    ));
    const suspended = database.getRunSummary(runId);
    assert.equal(suspended.status, "AWAITING_INTERVENTION");
    assert.equal(suspended.dispatchState, "STOPPED");

    const released = service.exitMaintenance(writeParams({
      commandId: "maintenance-worker-exit",
      maintenanceLeaseId: leaseId,
      healthVerified: true,
    }));
    assert.equal(released.active, false);
    const resumable = database.getRunSummary(runId);
    service.resumeDispatch(writeParams({
      commandId: "maintenance-worker-resume",
      runId,
      expectedRunRevision: resumable.revision,
    }));
    await waitUntil(() => {
      const attempt = database.db
        .prepare(
          `SELECT a.status FROM attempts a JOIN work_items w ON w.id = a.work_item_id
           WHERE a.run_id = ? AND w.logical_id = 'review' ORDER BY a.created_at DESC LIMIT 1`,
        )
        .get(runId) as { status: string } | undefined;
      return attempt?.status === "RUNNING";
    });
    assert.equal(database.getRunSummary(runId).dispatchState, "OPEN");
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a Worker result after an explicit dispatch stop remains suspended until dispatch is resumed", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-stopped-worker-settlement-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  const origin: OriginRef = {
    runtimeId: "runtime-stopped-worker",
    agentId: "main",
    sessionKey: "agent:main:stopped-worker",
    sessionId: "session-stopped-worker",
    nativeMessageId: "message-stopped-worker",
  };
  service.start();
  try {
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      origin,
      "stopped-worker",
    );
    const researchAttempt = database.db
      .prepare(
        `SELECT a.openclaw_run_id FROM attempts a
         JOIN work_items w ON w.id = a.work_item_id
         WHERE a.run_id = ? AND w.logical_id = 'research' ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(runId) as { openclaw_run_id: string };

    const running = database.getRunSummary(runId);
    service.stopDispatch(writeParams({
      commandId: "stopped-worker-stop",
      runId,
      expectedRunRevision: running.revision,
    }));
    runtime.runs.find((run) => run.runId === researchAttempt.openclaw_run_id)!.status = "succeeded";
    await waitUntil(() => Boolean(database.db
      .prepare(
        `SELECT 1 FROM attempts a JOIN work_items w ON w.id = a.work_item_id
         WHERE a.run_id = ? AND w.logical_id = 'research' AND a.status = 'SUCCEEDED'`,
      )
      .get(runId)));

    const suspended = database.getRunSummary(runId);
    assert.equal(suspended.status, "AWAITING_INTERVENTION");
    assert.equal(suspended.dispatchState, "STOPPED");
    assert.equal(database.getRunRow(runId).resume_status, "RUNNING");
    assert.equal(Number((database.db
      .prepare(
        `SELECT COUNT(*) AS count FROM interventions
         WHERE run_id = ? AND code = 'DISPATCH_STOPPED' AND resolved_at IS NULL`,
      )
      .get(runId) as { count: number }).count), 1);
    assert.ok(
      ((service.getRun({ runId }).run as { allowedActions: string[] }).allowedActions)
        .includes("DISPATCH_RESUME"),
    );
    assert.equal(Number((database.db
      .prepare(
        `SELECT COUNT(*) AS count FROM attempts a JOIN work_items w ON w.id = a.work_item_id
         WHERE a.run_id = ? AND w.logical_id = 'review'`,
      )
      .get(runId) as { count: number }).count), 0);

    service.resumeDispatch(writeParams({
      commandId: "stopped-worker-resume",
      runId,
      expectedRunRevision: suspended.revision,
    }));
    await waitUntil(() => Boolean(database.db
      .prepare(
        `SELECT 1 FROM attempts a JOIN work_items w ON w.id = a.work_item_id
         WHERE a.run_id = ? AND w.logical_id = 'review' AND a.status = 'RUNNING'`,
      )
      .get(runId)));
    const resumed = database.getRunSummary(runId);
    assert.equal(resumed.status, "RUNNING");
    assert.equal(resumed.dispatchState, "OPEN");
    assert.equal(database.getRunRow(runId).resume_status, null);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed export sidecar cannot mutate a maintenance-deferred delivery or duplicate its effect", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-maintenance-synthesis-settlement-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  let service: CollaborationService | null = createTestService(database, runtime, directory);
  try {
    service.start();
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      {
        runtimeId: "runtime-maintenance-synthesis",
        agentId: "main",
        sessionKey: "agent:main:maintenance-synthesis",
        sessionId: "session-maintenance-synthesis",
        nativeMessageId: "message-maintenance-synthesis",
      },
      "maintenance-synthesis",
    );

    const synthesisDeadline = Date.now() + 5_000;
    while (!database.db
      .prepare("SELECT 1 FROM attempts WHERE run_id = ? AND kind = 'SYNTHESIZER' AND status = 'RUNNING'")
      .get(runId)) {
      const workers = database.db
        .prepare("SELECT openclaw_run_id FROM attempts WHERE run_id = ? AND kind = 'WORKER' AND status = 'RUNNING'")
        .all(runId) as Array<{ openclaw_run_id: string }>;
      for (const worker of workers) {
        runtime.runs.find((run) => run.runId === worker.openclaw_run_id)!.status = "succeeded";
      }
      if (Date.now() >= synthesisDeadline) throw new Error("Timed out waiting for Synthesizer attempt");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    service.enterMaintenance(writeParams({
      commandId: "maintenance-synthesis-enter",
      reason: "synthesis delivery fence",
      owner: "test",
    }));
    const leaseId = expireActiveMaintenanceLease(database);
    service.maintenanceStatus();
    assert.equal(database.getRunSummary(runId).status, "AWAITING_INTERVENTION");
    assert.equal(database.getRunRow(runId).resume_status, "SYNTHESIZING");

    const synthesizerAttempt = database.db
      .prepare("SELECT openclaw_run_id FROM attempts WHERE run_id = ? AND kind = 'SYNTHESIZER'")
      .get(runId) as { openclaw_run_id: string };
    runtime.runs.find((run) => run.runId === synthesizerAttempt.openclaw_run_id)!.status = "succeeded";
    await waitUntil(() => database.getRunSummary(runId).status === "DELIVERY_PENDING");

    const deliveryCommandBeforeRestart = database.db
      .prepare("SELECT id, effect_key FROM commands WHERE run_id = ? AND kind = 'DELIVER'")
      .get(runId) as { id: string; effect_key: string };
    await service.stop();
    service = createTestService(database, runtime, directory);
    service.start();
    await waitUntil(() => Number((database.db
      .prepare("SELECT attempts FROM commands WHERE id = ?")
      .get(deliveryCommandBeforeRestart.id) as { attempts: number }).attempts) > 0);

    const deliveryCommand = database.db
      .prepare("SELECT status, attempts, failure_count, effect_key, last_error FROM commands WHERE id = ?")
      .get(deliveryCommandBeforeRestart.id) as {
        status: string;
        attempts: number;
        failure_count: number;
        effect_key: string;
        last_error: string;
      };
    assert.equal(deliveryCommand.status, "PENDING");
    assert.ok(Number(deliveryCommand.attempts) >= 1);
    assert.equal(Number(deliveryCommand.failure_count), 0);
    assert.equal(deliveryCommand.effect_key, deliveryCommandBeforeRestart.effect_key);
    assert.match(deliveryCommand.last_error, /Maintenance deferred transcript delivery/);
    assert.equal(runtime.transcript.length, 0);
    assert.equal(Number((database.db
      .prepare("SELECT COUNT(*) AS count FROM delivery_attempts WHERE delivery_id IN (SELECT id FROM deliveries WHERE run_id = ?)")
      .get(runId) as { count: number }).count), 0);
    assert.equal((database.db
      .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'SYNTHESIZER'")
      .get(runId) as { status: string }).status, "SUCCEEDED");
    assert.equal(Number((database.db
      .prepare("SELECT COUNT(*) AS count FROM final_artifacts WHERE run_id = ?")
      .get(runId) as { count: number }).count), 1);
    assert.equal(database.getRunSummary(runId).reconcileState, "ATTENTION_REQUIRED");
    assert.equal(service.maintenanceStatus().gateActive, true);
    assert.equal(Number((database.db
      .prepare(
        `SELECT COUNT(*) AS count FROM interventions
         WHERE run_id = ? AND code = 'MAINTENANCE_LEASE_EXPIRED' AND entity_id = ? AND resolved_at IS NULL`,
      )
      .get(runId, leaseId) as { count: number }).count), 1);

    database.db
      .prepare(
        `WITH digits(d) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
         sequence(n) AS (
           SELECT a.d + 10*b.d + 100*c.d + 1000*d.d
           FROM digits a CROSS JOIN digits b CROSS JOIN digits c CROSS JOIN digits d
         )
         INSERT INTO collaboration_events(
           run_id, event_type, entity_type, entity_id, run_revision, payload_json, created_at
         )
         SELECT ?, 'EXPORT_ISOLATION_TEST', 'run', ?, ?, '{}', ?
         FROM sequence WHERE n < ?`,
      )
      .run(
        runId,
        runId,
        database.getRunSummary(runId).revision,
        Date.now(),
        PERSISTENCE_LIMITS.eventsPerExport,
      );
    const beforeExport = database.getRunSummary(runId);
    const exportCommandId = "maintenance-synthesis-export-overflow";
    const exportResponse = service.createExport(writeParams({
      commandId: exportCommandId,
      runId,
      expectedRunRevision: beforeExport.revision,
      format: "json",
    }));
    const exportJobId = String(exportResponse.exportJobId);
    await waitUntil(() => service!.exportGet({ jobId: exportJobId }).status === "FAILED");

    const failedExport = service.exportGet({ jobId: exportJobId });
    assert.match(String(failedExport.last_error), /event timeline exceeds.*export limit/);
    assert.equal(database.getCommand(exportCommandId).status, "FAILED");
    assert.equal(database.getRunSummary(runId).status, "DELIVERY_PENDING");
    assert.equal(Number((database.db
      .prepare(
        `SELECT COUNT(*) AS count FROM collaboration_events
         WHERE run_id = ? AND event_type = 'COMMAND_FAILED' AND entity_id = ?`,
      )
      .get(runId, exportCommandId) as { count: number }).count), 0);
    assert.equal(runtime.transcript.length, 0);

    const exited = service.exitMaintenance(writeParams({
      commandId: "maintenance-synthesis-exit",
      maintenanceLeaseId: leaseId,
      healthVerified: true,
    }));
    assert.equal(exited.gateActive, false);
    database.db
      .prepare("UPDATE commands SET available_at = ? WHERE id = ? AND status = 'PENDING'")
      .run(Date.now(), deliveryCommandBeforeRestart.id);
    await (service as unknown as { drainCommands(): Promise<void> }).drainCommands();
    await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");

    const completedDeliveryCommand = database.getCommand(deliveryCommandBeforeRestart.id);
    assert.equal(completedDeliveryCommand.status, "SUCCEEDED");
    assert.equal(completedDeliveryCommand.effectKey, deliveryCommandBeforeRestart.effect_key);
    assert.equal(Number((database.db
      .prepare("SELECT COUNT(*) AS count FROM delivery_attempts WHERE delivery_id IN (SELECT id FROM deliveries WHERE run_id = ?)")
      .get(runId) as { count: number }).count), 1);
    assert.equal(runtime.transcript.length, 1);
  } finally {
    await service?.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("malformed maintenance state fails closed without crashing status, capabilities, enter, or exit", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-maintenance-malformed-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  const malformed = "{not-valid-json";
  try {
    database.setMetadata("maintenance_lease", malformed);
    const status = service.maintenanceStatus();
    assert.equal(status.active, true);
    assert.equal(status.gateActive, true);
    assert.equal(status.status, "MALFORMED");
    assert.equal(status.recoveryRequired, true);
    assert.equal(status.lease, null);
    assert.ok(Buffer.byteLength(String(status.diagnostic), "utf8") <= PERSISTENCE_LIMITS.diagnosticBytes);
    assert.match(String(status.rawDigest), /^[a-f0-9]{64}$/);

    const capabilityStatus = service.capabilities().maintenance as Record<string, unknown>;
    assert.equal(capabilityStatus.status, "MALFORMED");
    assert.equal(capabilityStatus.gateActive, true);
    assert.equal(capabilityStatus.activeRunCount, 0);
    assert.throws(
      () => service.enterMaintenance(writeParams({
        commandId: "maintenance-malformed-enter",
        reason: "must not overwrite malformed state",
        owner: "test",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "MAINTENANCE_ACTIVE",
    );
    assert.throws(
      () => service.exitMaintenance(writeParams({
        commandId: "maintenance-malformed-exit",
        maintenanceLeaseId: "unverifiable",
        healthVerified: true,
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "MAINTENANCE_ACTIVE",
    );
    assert.equal(database.getMetadata("maintenance_lease"), malformed);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("capabilities expose expired maintenance recovery even when there are no active Runs", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-maintenance-expired-empty-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  try {
    database.setMetadata("maintenance_lease", JSON.stringify({
      version: 1,
      id: "maintenance-expired-empty",
      reason: "gateway restart",
      owner: "test",
      enteredAt: 0,
      expiresAt: 1,
      status: "ACTIVE",
    }));
    const maintenance = service.capabilities().maintenance as Record<string, unknown>;
    assert.equal(maintenance.active, true);
    assert.equal(maintenance.gateActive, true);
    assert.equal(maintenance.status, "EXPIRED");
    assert.equal(maintenance.recoveryRequired, true);
    assert.equal(maintenance.activeRunCount, 0);
    assert.deepEqual(maintenance.activeRuns, []);
    assert.equal(
      (JSON.parse(database.getMetadata("maintenance_lease")!) as Record<string, unknown>).status,
      "EXPIRED",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("repeated maintenance deferrals preserve the PROVISION failure budget before a real retry succeeds", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-provision-maintenance-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  let processor: CollaborationService | null = null;
  try {
    const { runId, provisionCommandId, controlService } = await preparePendingProvision(
      database,
      runtime,
      directory,
      {
        runtimeId: "runtime-provision-maintenance",
        agentId: "main",
        sessionKey: "agent:main:provision-maintenance",
        sessionId: "session-provision-maintenance",
        nativeMessageId: "message-provision-maintenance",
      },
      "provision-maintenance",
    );
    runtime.waitMode = "timeout";
    const entered = controlService.enterMaintenance(writeParams({
      commandId: "provision-maintenance-enter",
      reason: "hold provisioning before the external Flow effect",
      owner: "test",
    }));

    processor = createTestService(database, runtime, directory);
    processor.start();
    for (let expectedAttempts = 1; expectedAttempts <= 4; expectedAttempts += 1) {
      if (expectedAttempts > 1) {
        database.db.prepare("UPDATE commands SET available_at = 0 WHERE id = ?").run(provisionCommandId);
        await (processor as unknown as { drainCommands(): Promise<void> }).drainCommands();
      }
      await waitUntil(() => {
        const command = database.getCommand(provisionCommandId);
        return command.status === "PENDING" && command.attempts >= expectedAttempts;
      });
      assert.equal(database.getCommand(provisionCommandId).failureCount, 0);
    }
    const deferredAttempts = database.getCommand(provisionCommandId).attempts;
    assert.ok(deferredAttempts >= 4);
    assert.ok(
      (processor as unknown as { scheduledCommandDrainAt: number | null }).scheduledCommandDrainAt! > Date.now(),
    );
    assert.equal(runtime.flowCreateCalls, 0);
    assert.equal(database.getRunRow(runId).openclaw_flow_id, null);

    let rejectFirstCreate = true;
    runtime.flowCreateHook = () => {
      if (!rejectFirstCreate) return;
      rejectFirstCreate = false;
      throw new Error("managed Flow acknowledgement was lost after creation");
    };
    database.db.prepare("UPDATE commands SET available_at = 0 WHERE id = ?").run(provisionCommandId);
    processor.exitMaintenance(writeParams({
      commandId: "provision-maintenance-exit",
      maintenanceLeaseId: entered.maintenanceLeaseId,
      healthVerified: true,
    }));
    await waitUntil(() => {
      const command = database.getCommand(provisionCommandId);
      return command.status === "PENDING" && command.failureCount === 1;
    });
    assert.equal(runtime.flowCreates, 1);

    database.db.prepare("UPDATE commands SET available_at = 0 WHERE id = ?").run(provisionCommandId);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await (processor as unknown as { drainCommands(): Promise<void> }).drainCommands();
    await waitUntil(() => database.getCommand(provisionCommandId).status === "SUCCEEDED");

    const command = database.getCommand(provisionCommandId);
    assert.equal(command.attempts, deferredAttempts + 2);
    assert.equal(command.failureCount, 1);
    assert.equal(runtime.flowCreateCalls, 1);
    assert.equal(runtime.flowCreates, 1);
    assert.ok(command.effectStartedAt != null);
    assert.equal(database.getRunRow(runId).openclaw_flow_id, "flow-1");
    assert.equal(database.getRunSummary(runId).status, "RUNNING");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'PROVISION'").get(runId)?.value),
      1,
    );
  } finally {
    if (processor) await processor.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("repeated maintenance deferrals never turn a pre-dispatch Planner failure into UNKNOWN", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-planner-maintenance-failure-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const controlService = createTestService(database, runtime, directory);
  let processor: CollaborationService | null = null;
  try {
    (controlService as unknown as { drainCommands(): Promise<void> }).drainCommands = async () => {};
    const commandId = "planner-maintenance-failure-create";
    const created = await controlService.createPlan(writeParams({
      commandId,
      origin: {
        runtimeId: "runtime-planner-maintenance-failure",
        agentId: "main",
        sessionKey: "agent:main:planner-maintenance-failure",
        sessionId: "session-planner-maintenance-failure",
        nativeMessageId: "message-planner-maintenance-failure",
      },
      goal: "Fail deterministically before the Planner effect starts",
    }));
    const runId = String(created.runId);
    const entered = controlService.enterMaintenance(writeParams({
      commandId: "planner-maintenance-failure-enter",
      reason: "hold the planner before dispatch",
      owner: "test",
    }));

    processor = createTestService(database, runtime, directory);
    processor.start();
    for (let expectedAttempts = 1; expectedAttempts <= 4; expectedAttempts += 1) {
      if (expectedAttempts > 1) {
        database.db.prepare("UPDATE commands SET available_at = 0 WHERE id = ?").run(commandId);
        await (processor as unknown as { drainCommands(): Promise<void> }).drainCommands();
      }
      await waitUntil(() => {
        const command = database.getCommand(commandId);
        return command.status === "PENDING" && command.attempts >= expectedAttempts;
      });
    }
    assert.ok(database.getCommand(commandId).attempts >= 4);
    assert.equal(database.getCommand(commandId).effectStartedAt, null);

    runtime.readOrigin = async () => {
      throw new Error("planner origin read failed before dispatch");
    };
    database.db.prepare("UPDATE commands SET available_at = 0 WHERE id = ?").run(commandId);
    processor.exitMaintenance(writeParams({
      commandId: "planner-maintenance-failure-exit",
      maintenanceLeaseId: entered.maintenanceLeaseId,
      healthVerified: true,
    }));

    await waitUntil(() => database.getCommand(commandId).status === "FAILED");
    const attempt = database.db
      .prepare("SELECT status, openclaw_run_id FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(runId) as { status: string; openclaw_run_id: string | null };
    assert.equal(runtime.runAgentCalls, 0);
    assert.equal(database.getCommand(commandId).status, "FAILED");
    assert.equal(database.getCommand(commandId).effectStartedAt, null);
    assert.equal(attempt.status, "FAILED");
    assert.equal(attempt.openclaw_run_id, null);
  } finally {
    if (processor) await processor.stop();
    await controlService.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a closing Run never creates a Flow after repeated infrastructure deferrals", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-provision-terminal-observe-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  let processor: CollaborationService | null = null;
  try {
    const { runId, provisionCommandId, controlService } = await preparePendingProvision(
      database,
      runtime,
      directory,
      {
        runtimeId: "runtime-provision-terminal",
        agentId: "main",
        sessionKey: "agent:main:provision-terminal",
        sessionId: "session-provision-terminal",
        nativeMessageId: "message-provision-terminal",
      },
      "provision-terminal",
    );
    const entered = controlService.enterMaintenance(writeParams({
      commandId: "provision-terminal-maintenance-enter",
      reason: "cancel before any external Flow effect",
      owner: "test",
    }));
    processor = createTestService(database, runtime, directory);
    processor.start();

    for (let expectedAttempts = 1; expectedAttempts <= 3; expectedAttempts += 1) {
      if (expectedAttempts > 1) {
        database.db.prepare("UPDATE commands SET available_at = 0 WHERE id = ?").run(provisionCommandId);
        await (processor as unknown as { drainCommands(): Promise<void> }).drainCommands();
      }
      await waitUntil(() => {
        const command = database.getCommand(provisionCommandId);
        return command.status === "PENDING" && command.attempts >= expectedAttempts;
      });
    }
    assert.equal(database.getCommand(provisionCommandId).effectStartedAt, null);
    assert.equal(runtime.flowCreateCalls, 0);

    const beforeCancel = database.getRunSummary(runId);
    controlService.cancelRun(writeParams({
      commandId: "provision-terminal-cancel",
      runId,
      expectedRunRevision: beforeCancel.revision,
    }));
    database.db.prepare("UPDATE commands SET available_at = 0 WHERE id = ?").run(provisionCommandId);
    await (processor as unknown as { drainCommands(): Promise<void> }).drainCommands();
    await waitUntil(() => database.getCommand(provisionCommandId).status === "CANCELLED");

    const settled = database.getCommand(provisionCommandId);
    assert.equal(settled.failureCount, 0);
    assert.equal(settled.effectStartedAt, null);
    assert.equal(database.getRunSummary(runId).status, "CANCELLED");
    assert.equal(database.getRunRow(runId).openclaw_flow_id, null);
    assert.equal(runtime.flowCreateCalls, 0);
    assert.equal(runtime.flowCreates, 0);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'").get(runId)?.value),
      0,
    );

    controlService.exitMaintenance(writeParams({
      commandId: "provision-terminal-maintenance-exit",
      maintenanceLeaseId: entered.maintenanceLeaseId,
      healthVerified: true,
    }));
  } finally {
    if (processor) await processor.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("terminal PROVISION observes an already-cancelled Flow without creating or failing recovery", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-provision-terminal-flow-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  try {
    const { runId, provisionCommandId, controlService } = await preparePendingProvision(
      database,
      runtime,
      directory,
      {
        runtimeId: "runtime-terminal-flow",
        agentId: "main",
        sessionKey: "agent:main:terminal-flow",
        sessionId: "session-terminal-flow",
        nativeMessageId: "message-terminal-flow",
      },
      "terminal-flow",
    );
    const provision = database.getCommand(provisionCommandId);
    const domainRevision = Number(provision.payload.flowDomainRevision);
    runtime.flowControllerId = `junqi-collab/${runId}`;
    runtime.flowRevision = 2;
    runtime.flowStatus = "cancelled";
    runtime.flowState = { runId, domainRevision };

    const beforeCancel = database.getRunSummary(runId);
    controlService.cancelRun(writeParams({
      commandId: "terminal-flow-cancel",
      runId,
      expectedRunRevision: beforeCancel.revision,
    }));
    const provisionLease = database.claimCommands("terminal-flow-worker", 16, 60_000)
      .find((command) => command.id === provisionCommandId);
    assert.ok(provisionLease);
    await (service as unknown as { executeCommand(command: typeof provisionLease): Promise<void> })
      .executeCommand(provisionLease);

    assert.equal(database.getCommand(provisionCommandId).status, "SUCCEEDED");
    assert.equal(database.getRunSummary(runId).status, "CANCELLED");
    assert.equal(database.getRunRow(runId).openclaw_flow_id, "flow-1");
    assert.equal(runtime.flowCreateCalls, 0);
    const flowSync = database.claimCommands("terminal-flow-sync-worker", 16, 60_000)
      .find((command) => command.kind === "FLOW_SYNC");
    assert.ok(flowSync);
    await (service as unknown as { executeCommand(command: typeof flowSync): Promise<void> })
      .executeCommand(flowSync);
    assert.equal(database.getCommand(flowSync.id).status, "SUCCEEDED");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("terminal PROVISION records a conflicting Flow and exposes reconciliation", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-provision-terminal-conflict-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  try {
    const { runId, provisionCommandId, controlService } = await preparePendingProvision(
      database,
      runtime,
      directory,
      {
        runtimeId: "runtime-terminal-conflict",
        agentId: "main",
        sessionKey: "agent:main:terminal-conflict",
        sessionId: "session-terminal-conflict",
        nativeMessageId: "message-terminal-conflict",
      },
      "terminal-conflict",
    );
    const provision = database.getCommand(provisionCommandId);
    const domainRevision = Number(provision.payload.flowDomainRevision);
    runtime.flowControllerId = `junqi-collab/${runId}`;
    runtime.flowRevision = 4;
    runtime.flowStatus = "succeeded";
    runtime.flowState = { runId, domainRevision: domainRevision + 1, status: "COMPLETED" };
    const beforeCancel = database.getRunSummary(runId);
    controlService.cancelRun(writeParams({
      commandId: "terminal-conflict-cancel",
      runId,
      expectedRunRevision: beforeCancel.revision,
    }));
    const lease = database.claimCommands("terminal-conflict-worker", 16, 60_000)
      .find((command) => command.id === provisionCommandId);
    assert.ok(lease);
    await (service as unknown as { executeCommand(command: typeof lease): Promise<void> }).executeCommand(lease);

    assert.equal(database.getCommand(provisionCommandId).status, "FAILED");
    assert.equal(database.getRunRow(runId).openclaw_flow_id, "flow-1");
    assert.equal(database.getRunRow(runId).openclaw_flow_revision, 4);
    assert.equal(database.getRunSummary(runId).reconcileState, "ATTENTION_REQUIRED");
    const snapshot = service.getRun({ runId });
    assert.ok(((snapshot.run as Record<string, unknown>).allowedActions as string[]).includes("RECONCILE"));
    assert.ok((snapshot.interventions as Array<Record<string, unknown>>)
      .some((intervention) => intervention.code === "FLOW_RECOVERY_CONFLICT"));

    const terminal = database.getRunSummary(runId);
    service.reconcileRun(writeParams({
      commandId: "terminal-conflict-reconcile",
      runId,
      expectedRunRevision: terminal.revision,
    }));
    const reopened = database.getCommand(provisionCommandId);
    assert.equal(reopened.status, "PENDING");
    assert.equal(reopened.failureCount, 0);
    assert.equal(reopened.attempts, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a session mutation fence defers PROVISION and the same command resumes when the mutation aborts", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-provision-session-fence-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  let processor: CollaborationService | null = null;
  try {
    const provisionOrigin: OriginRef = {
      runtimeId: "runtime-provision-session",
      agentId: "main",
      sessionKey: "agent:main:provision-session",
      sessionId: "session-provision-session",
      nativeMessageId: "message-provision-session",
    };
    const { runId, provisionCommandId, controlService } = await preparePendingProvision(
      database,
      runtime,
      directory,
      provisionOrigin,
      "provision-session",
    );
    runtime.waitMode = "timeout";
    const prepared = controlService.prepareSessionMutation(writeParams({
      commandId: "provision-session-prepare",
      runtimeId: provisionOrigin.runtimeId,
      sessionKey: provisionOrigin.sessionKey,
      sessionId: provisionOrigin.sessionId,
      action: "reset",
      policy: "CANCEL_AND_WAIT",
    }));
    assert.equal(prepared.coreRpcAllowed, false);

    processor = createTestService(database, runtime, directory);
    processor.start();
    await waitUntil(() => {
      const command = database.getCommand(provisionCommandId);
      return command.status === "PENDING" && command.attempts >= 1;
    });
    const deferredAttempts = database.getCommand(provisionCommandId).attempts;
    assert.equal(database.getCommand(provisionCommandId).failureCount, 0);
    assert.equal(runtime.flowCreateCalls, 0);
    assert.equal(database.getRunRow(runId).openclaw_flow_id, null);

    database.db.prepare("UPDATE commands SET available_at = 0 WHERE id = ?").run(provisionCommandId);
    const completed = processor.completeSessionMutation(writeParams({
      commandId: "provision-session-abort",
      mutationId: prepared.mutationId,
      success: false,
      error: "session mutation was aborted before the core RPC",
    }));
    assert.equal(completed.status, "FAILED");
    await waitUntil(() => database.getCommand(provisionCommandId).status === "SUCCEEDED");

    const command = database.getCommand(provisionCommandId);
    assert.ok(command.attempts > deferredAttempts);
    assert.equal(command.failureCount, 0);
    assert.equal(runtime.flowCreateCalls, 1);
    assert.equal(runtime.flowCreates, 1);
    assert.equal(database.getRunRow(runId).openclaw_flow_id, "flow-1");
    assert.equal(database.getRunSummary(runId).status, "RUNNING");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'PROVISION'").get(runId)?.value),
      1,
    );
  } finally {
    if (processor) await processor.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a stale PROVISION owner cannot commit and the replacement reuses the controller-bound Flow", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-provision-lease-loss-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  let processor: CollaborationService | null = null;
  let replacement: ReturnType<CollaborationDatabase["getCommand"]> | undefined;
  const staleRetry = deferred<boolean>();
  const originalReschedule = database.rescheduleClaimedCommand.bind(database);
  try {
    const { runId, provisionCommandId } = await preparePendingProvision(
      database,
      runtime,
      directory,
      {
        runtimeId: "runtime-provision-lease-loss",
        agentId: "main",
        sessionKey: "agent:main:provision-lease-loss",
        sessionId: "session-provision-lease-loss",
        nativeMessageId: "message-provision-lease-loss",
      },
      "provision-lease-loss",
    );
    runtime.waitMode = "timeout";
    database.rescheduleClaimedCommand = ((
      ...args: Parameters<CollaborationDatabase["rescheduleClaimedCommand"]>
    ) => {
      const rescheduled = originalReschedule(...args);
      const candidate = args[0];
      if (candidate.id === provisionCommandId && candidate.attempts === 1) staleRetry.resolve(rescheduled);
      return rescheduled;
    }) as CollaborationDatabase["rescheduleClaimedCommand"];
    runtime.flowCreateHook = () => {
      database.db
        .prepare("UPDATE commands SET lease_expires_at = ? WHERE id = ?")
        .run(Date.now() - 1, provisionCommandId);
      replacement = database.claimCommands("replacement-provision-worker", 16, 60_000)
        .find((command) => command.id === provisionCommandId);
      assert.ok(replacement);
    };

    processor = createTestService(database, runtime, directory);
    processor.start();
    assert.equal(await waitForSignal(staleRetry.promise), false);

    const staleResult = database.getCommand(provisionCommandId);
    assert.ok(replacement);
    assert.equal(staleResult.status, "LEASED");
    assert.equal(staleResult.leaseOwner, "replacement-provision-worker");
    assert.equal(database.getRunSummary(runId).status, "PROVISIONING");
    assert.equal(database.getRunRow(runId).openclaw_flow_id, null);
    assert.equal(runtime.flowCreateCalls, 1);
    assert.equal(runtime.flowCreates, 1);

    await (processor as unknown as {
      executeCommand(command: NonNullable<typeof replacement>): Promise<void>;
    }).executeCommand(replacement);

    assert.equal(database.getCommand(provisionCommandId).status, "SUCCEEDED");
    assert.equal(database.getRunSummary(runId).status, "RUNNING");
    assert.equal(database.getRunRow(runId).openclaw_flow_id, "flow-1");
    assert.equal(runtime.flowCreateCalls, 1);
    assert.equal(runtime.flowCreates, 1);
    assert.deepEqual(runtime.flowControllerCalls, [`junqi-collab/${runId}`]);
  } finally {
    database.rescheduleClaimedCommand = originalReschedule;
    if (processor) await processor.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("maintenance and reconciliation scan every active run beyond the 500-row page boundary", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-active-scan-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  try {
    database.transaction(() => {
      for (let index = 0; index < 501; index += 1) {
        const suffix = String(index).padStart(4, "0");
        database.createRun({
          id: `scan-run-${suffix}`,
          origin: {
            runtimeId: "runtime-active-scan",
            agentId: "main",
            sessionKey: `agent:main:scan-${suffix}`,
            sessionId: `session-scan-${suffix}`,
            nativeMessageId: `message-scan-${suffix}`,
          },
          goal: `scan ${suffix}`,
          capabilitySnapshot: {},
        });
      }
      database.db.prepare("UPDATE collaboration_runs SET dispatch_state = 'OPEN'").run();
    });

    const entered = service.enterMaintenance(writeParams({
      commandId: "maintenance-enter-501-command",
      reason: "verify-complete-active-scan",
      owner: "test",
    }));
    assert.equal(entered.activeRunCount, 501);
    assert.equal(entered.activeRunsTruncated, true);
    assert.equal((entered.activeRuns as unknown[]).length, 100);

    const open = database.db
      .prepare("SELECT COUNT(*) AS count FROM collaboration_runs WHERE dispatch_state = 'OPEN'")
      .get() as { count: number };
    const gateEvents = database.db
      .prepare("SELECT COUNT(*) AS count FROM collaboration_events WHERE event_type = 'MAINTENANCE_GATE_CLOSED'")
      .get() as { count: number };
    assert.equal(Number(open.count), 0);
    assert.equal(Number(gateEvents.count), 501);

    const reconciled: string[] = [];
    const scanCompleted = deferred<void>();
    const testService = service as unknown as {
      reconcileOneRun(runId: string): Promise<void>;
    };
    testService.reconcileOneRun = async (runId) => {
      reconciled.push(runId);
      if (reconciled.length === 501) scanCompleted.resolve();
    };
    service.start();
    await waitForSignal(scanCompleted.promise);
    await service.stop();
    assert.equal(reconciled.length, 501);
    assert.equal(new Set(reconciled).size, 501);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retention removes only expired terminal runs without unresolved work", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-retention-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = new CollaborationService(
    database,
    runtime,
    {
      coordinatorAgentId: "coordinator",
      allowedAgentIds: ["coordinator", "worker"],
      maxConcurrency: 2,
      maxWorkItems: 10,
      attemptTimeoutMs: 60_000,
      retentionDays: 7,
    },
    directory,
    { info() {}, warn() {}, error() {} },
  );
  const referenceTime = Date.UTC(2026, 6, 16, 0, 0, 0);
  const day = 24 * 60 * 60_000;
  const createRun = (suffix: string, status: "PLANNING" | "COMPLETED", endedAt: number | null): string => {
    const id = `retention-${suffix}`;
    database.createRun({
      id,
      origin: {
        runtimeId: "runtime-retention",
        agentId: "main",
        sessionKey: `agent:main:${suffix}`,
        sessionId: `session-${suffix}`,
        nativeMessageId: `message-${suffix}`,
      },
      goal: `Retention test ${suffix}`,
      capabilitySnapshot: {},
    });
    if (status === "COMPLETED") {
      database.db
        .prepare(
          "UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(endedAt, endedAt, id);
    }
    return id;
  };

  try {
    const expired = createRun("expired", "COMPLETED", referenceTime - 8 * day);
    const recent = createRun("recent", "COMPLETED", referenceTime - 6 * day);
    const active = createRun("active", "PLANNING", null);
    const pendingExport = createRun("pending-export", "COMPLETED", referenceTime - 8 * day);
    const uncertainCommand = createRun("uncertain-command", "COMPLETED", referenceTime - 8 * day);
    const failedDeletion = createRun("failed-deletion", "COMPLETED", referenceTime - 8 * day);
    const failedFlowMirror = createRun("failed-flow-mirror", "COMPLETED", referenceTime - 8 * day);
    const tombstoneConflict = createRun("tombstone-conflict", "COMPLETED", referenceTime - 8 * day);
    const unsafeArtifact = createRun("unsafe-artifact", "COMPLETED", referenceTime - 9 * day);

    const artifactPath = path.join(directory, "exports", "retention-export.json");
    writeFileSync(artifactPath, "retention export", { encoding: "utf8", mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO export_jobs(id, run_id, status, format, artifact_path, digest, created_at, updated_at)
         VALUES ('retention-export', ?, 'COMPLETED', 'json', ?, 'digest', ?, ?)`,
      )
      .run(expired, artifactPath, referenceTime - 8 * day, referenceTime - 8 * day);
    const expectedRetentionDigest = String(service.deletePreview({ runId: expired }).digest);
    const stagedDirectory = path.join(directory, "exports", ".delete-staging", expired);
    const stagedArtifactPath = path.join(stagedDirectory, path.basename(artifactPath));
    mkdirSync(stagedDirectory, { recursive: true });
    renameSync(artifactPath, stagedArtifactPath);

    const orphanStagingDirectory = path.join(directory, "exports", ".delete-staging", "retention-orphan");
    mkdirSync(orphanStagingDirectory, { recursive: true });
    writeFileSync(path.join(orphanStagingDirectory, "orphan.json"), "orphan", "utf8");

    const conflictArtifactPath = path.join(directory, "exports", "retention-conflict.json");
    writeFileSync(conflictArtifactPath, "conflict export", { encoding: "utf8", mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO export_jobs(id, run_id, status, format, artifact_path, digest, created_at, updated_at)
         VALUES ('retention-conflict-export', ?, 'COMPLETED', 'json', ?, 'digest', ?, ?)`,
      )
      .run(tombstoneConflict, conflictArtifactPath, referenceTime - 8 * day, referenceTime - 8 * day);
    database.db
      .prepare("INSERT INTO tombstones(id, run_id, actor, content_digest, deleted_at) VALUES ('stale-tombstone', ?, 'test', 'stale', ?)")
      .run(tombstoneConflict, referenceTime - 10 * day);

    const unsafeArtifactPath = path.join(directory, "outside-managed-exports.json");
    writeFileSync(unsafeArtifactPath, "unsafe export", { encoding: "utf8", mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO export_jobs(id, run_id, status, format, artifact_path, digest, created_at, updated_at)
         VALUES ('unsafe-retention-export', ?, 'COMPLETED', 'json', ?, 'digest', ?, ?)`,
      )
      .run(unsafeArtifact, unsafeArtifactPath, referenceTime - 9 * day, referenceTime - 9 * day);
    database.db
      .prepare(
        `INSERT INTO export_jobs(id, run_id, status, format, created_at, updated_at)
         VALUES ('pending-export-job', ?, 'PENDING', 'json', ?, ?)`,
      )
      .run(pendingExport, referenceTime - 8 * day, referenceTime - 8 * day);
    database.insertCommand({
      id: "uncertain-retention-command",
      runId: uncertainCommand,
      kind: "DELIVER",
      payloadHash: "uncertain-payload",
      payload: { deliveryId: "uncertain-delivery" },
      effectKey: "retention:uncertain-delivery",
    });
    database.settleUnleasedCommand(
      "uncertain-retention-command",
      "PENDING",
      "UNKNOWN",
      { error: "delivery state unknown" },
    );
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(id, run_id, status, confirmation_digest, last_error, created_at, updated_at)
         VALUES ('failed-deletion-job', ?, 'FAILED', 'digest', 'permission denied', ?, ?)`,
      )
      .run(failedDeletion, referenceTime - 8 * day, referenceTime - 8 * day);
    database.insertCommand({
      id: "failed-flow-mirror-command",
      runId: failedFlowMirror,
      kind: "FLOW_SYNC",
      payloadHash: "failed-flow-mirror-payload",
      payload: { terminal: "finished", flowId: "flow-retained" },
      effectKey: "retention:failed-flow-mirror",
    });
    database.settleUnleasedCommand(
      "failed-flow-mirror-command",
      "PENDING",
      "FAILED",
      { error: "terminal Flow mirror could not be confirmed" },
    );
    database.db
      .prepare("UPDATE collaboration_runs SET reconcile_state = 'ATTENTION_REQUIRED' WHERE id = ?")
      .run(failedFlowMirror);

    assert.equal(service.runRetentionSweep(referenceTime), 1);
    assert.equal(existsSync(artifactPath), false);
    assert.equal(existsSync(stagedArtifactPath), false);
    assert.equal(existsSync(orphanStagingDirectory), false);
    assert.equal(existsSync(unsafeArtifactPath), true);
    assert.equal(existsSync(conflictArtifactPath), true);
    assert.throws(
      () => database.getRunSummary(expired),
      (error: unknown) => error instanceof CollaborationError && error.code === "NOT_FOUND",
    );
    for (const retained of [
      recent,
      active,
      pendingExport,
      uncertainCommand,
      failedDeletion,
      failedFlowMirror,
      tombstoneConflict,
      unsafeArtifact,
    ]) {
      assert.equal(database.getRunSummary(retained).id, retained);
    }
    const tombstone = database.db
      .prepare("SELECT actor, content_digest FROM tombstones WHERE run_id = ?")
      .get(expired) as { actor?: string; content_digest?: string } | undefined;
    assert.equal(tombstone?.actor, "retention-policy");
    assert.equal(tombstone?.content_digest, expectedRetentionDigest);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM tombstones WHERE run_id = ?").get(failedFlowMirror)?.value),
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retention continues an unfinished cursor instead of restarting after 24 hours", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-retention-cursor-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
    {
      coordinatorAgentId: "coordinator",
      allowedAgentIds: ["coordinator", "worker"],
      maxConcurrency: 2,
      maxWorkItems: 10,
      attemptTimeoutMs: 60_000,
      retentionDays: 7,
    },
    directory,
    { info() {}, warn() {}, error() {} },
  );
  const referenceTime = Date.UTC(2026, 6, 16, 0, 0, 0);
  const endedAt = referenceTime - 8 * 24 * 60 * 60_000;
  const eligibleRunId = "retention-cursor-0501";
  try {
    database.transaction(() => {
      for (let index = 0; index < 502; index += 1) {
        const suffix = String(index).padStart(4, "0");
        database.createRun({
          id: `retention-cursor-${suffix}`,
          origin: {
            runtimeId: "runtime-retention-cursor",
            agentId: "main",
            sessionKey: `agent:main:retention-cursor-${suffix}`,
            sessionId: `session-retention-cursor-${suffix}`,
            nativeMessageId: `message-retention-cursor-${suffix}`,
          },
          goal: `Retention cursor ${suffix}`,
          capabilitySnapshot: {},
        });
      }
      database.db
        .prepare(
          `UPDATE collaboration_runs
           SET status = 'COMPLETED', dispatch_state = 'CLOSED', reconcile_state = 'ATTENTION_REQUIRED',
               ended_at = ?, updated_at = ?`,
        )
        .run(endedAt, endedAt);
      database.db.prepare("UPDATE collaboration_runs SET reconcile_state = 'IDLE' WHERE id = ?").run(eligibleRunId);
    });
    database.setMetadata("retention_cursor", JSON.stringify({
      endedAt,
      runId: "retention-cursor-0500",
      cycleStartedAt: referenceTime - 24 * 60 * 60_000,
    }));

    assert.equal(service.runRetentionSweep(referenceTime), 1);
    assert.throws(
      () => database.getRunSummary(eligibleRunId),
      (error: unknown) => error instanceof CollaborationError && error.code === "NOT_FOUND",
    );
    assert.equal(database.getRunSummary("retention-cursor-0000").reconcileState, "ATTENTION_REQUIRED");
    assert.equal(database.getMetadata("retention_cursor"), "");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retention expires operational receipts but keeps the minimal deletion tombstone", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-receipt-retention-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
    {
      coordinatorAgentId: "coordinator",
      allowedAgentIds: ["coordinator", "worker"],
      maxConcurrency: 2,
      maxWorkItems: 10,
      attemptTimeoutMs: 60_000,
      retentionDays: 7,
    },
    directory,
    { info() {}, warn() {}, error() {} },
  );
  const referenceTime = Date.UTC(2026, 6, 16, 0, 0, 0);
  const expiredAt = referenceTime - 8 * 24 * 60 * 60_000;
  try {
    database.db
      .prepare(
        `INSERT INTO tombstones(
          id, run_id, actor, content_digest, deleted_at,
          cleanup_status, cleanup_error, cleanup_updated_at
        ) VALUES ('receipt-tombstone', 'deleted-receipt-run', 'operator', 'digest', ?, 'COMPLETED', NULL, ?)`,
      )
      .run(expiredAt, expiredAt);
    database.reserveCommandReceipt({
      commandId: "old-run-command",
      source: "RUN:RUN_ARCHIVED",
      runId: "deleted-receipt-run",
      payloadHash: "run-hash",
      response: { accepted: true },
    });
    database.reserveCommandReceipt({
      commandId: "old-maintenance-command",
      source: "junqi.collab.maintenance.enter",
      runId: null,
      payloadHash: "maintenance-hash",
      response: { accepted: true },
    });
    database.db.prepare("UPDATE command_receipts SET created_at = ?, updated_at = ?").run(expiredAt, expiredAt);
    database.db
      .prepare(
        `INSERT INTO deletion_command_receipts(
          command_id, run_id, deletion_job_id, payload_hash, response_json, created_at, updated_at
        ) VALUES ('old-delete-command', 'deleted-receipt-run', 'old-delete-job', 'delete-hash', '{}', ?, ?)`,
      )
      .run(expiredAt, expiredAt);
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(
          id, run_id, status, confirmation_digest, created_at, updated_at
        ) VALUES ('old-delete-job', 'deleted-receipt-run', 'COMPLETED', 'digest', ?, ?)`,
      )
      .run(expiredAt, expiredAt);

    service.runRetentionSweep(referenceTime);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM command_receipts").get()?.value), 0);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM deletion_command_receipts").get()?.value), 0);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM deletion_jobs").get()?.value), 0);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM tombstones").get()?.value), 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deletion digest streams timelines that fail the bounded user-facing export", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-digest-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
    {
      coordinatorAgentId: "coordinator",
      allowedAgentIds: ["coordinator", "worker"],
      maxConcurrency: 2,
      maxWorkItems: 10,
      attemptTimeoutMs: 60_000,
      retentionDays: 7,
    },
    directory,
    { info() {}, warn() {}, error() {} },
  );
  const runId = "delete-digest-large-timeline";
  service.start();
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-digest",
        agentId: "main",
        sessionKey: "agent:main:delete-digest",
        sessionId: "session-delete-digest",
        nativeMessageId: "message-delete-digest",
      },
      goal: "Delete a run with a long event timeline",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(Date.now(), runId);
    database.db
      .prepare(
        `WITH digits(d) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
         sequence(n) AS (
           SELECT a.d + 10*b.d + 100*c.d + 1000*d.d
           FROM digits a CROSS JOIN digits b CROSS JOIN digits c CROSS JOIN digits d
         )
         INSERT INTO collaboration_events(
           run_id, event_type, entity_type, entity_id, run_revision, payload_json, created_at
         )
         SELECT ?, 'DIGEST_TEST', 'run', ?, 1, '{}', ?
         FROM sequence WHERE n < ?`,
      )
      .run(runId, runId, Date.now(), PERSISTENCE_LIMITS.eventsPerExport);

    const eventCount = Number(
      database.db.prepare("SELECT COUNT(*) AS value FROM collaboration_events WHERE run_id = ?").get(runId)?.value,
    );
    assert.ok(eventCount > PERSISTENCE_LIMITS.eventsPerExport);
    assert.match(String(service.deletePreview({ runId }).digest), /^[a-f0-9]{64}$/);
    const exportResponse = service.createExport(writeParams({
      commandId: "large-timeline-export",
      runId,
      expectedRunRevision: database.getRunSummary(runId).revision,
      format: "json",
    }));
    const exportJobId = String(exportResponse.exportJobId);
    await waitUntil(() => service.exportGet({ jobId: exportJobId }).status === "FAILED");
    const failedJob = service.exportGet({ jobId: exportJobId });
    assert.match(String(failedJob.last_error), /event timeline exceeds.*export limit/);
    assert.equal(
      readdirSync(path.join(directory, "exports")).some((name) => name.includes(exportJobId)),
      false,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("explicit Flow reconciliation abandonment is preview-bound and preserved in the deletion tombstone", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-flow-abandonment-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  const runId = "delete-flow-abandonment-run";
  const flowCommandId = "delete-flow-abandonment-sync";
  const initialDiagnostic = "Managed Flow terminal state could not be confirmed";
  const currentDiagnostic = "Managed Flow terminal state remains ambiguous after operator review";
  const abandonmentReason = "The external Flow was inspected separately and this local audit record must be removed.";
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-flow-abandonment",
        agentId: "main",
        sessionKey: "agent:main:delete-flow-abandonment",
        sessionId: "session-delete-flow-abandonment",
        nativeMessageId: "message-delete-flow-abandonment",
      },
      goal: "Delete only after explicitly abandoning failed Flow reconciliation",
      capabilitySnapshot: {},
    });
    database.db
      .prepare(
        `UPDATE collaboration_runs
         SET status = 'COMPLETED', dispatch_state = 'CLOSED', reconcile_state = 'ATTENTION_REQUIRED',
             openclaw_flow_id = 'flow-delete-abandonment', openclaw_flow_revision = 17,
             ended_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), Date.now(), runId);
    database.insertCommand({
      id: flowCommandId,
      runId,
      kind: "FLOW_SYNC",
      payloadHash: "delete-flow-abandonment-payload",
      payload: { flowId: "flow-delete-abandonment", terminal: "finished" },
      effectKey: "delete-flow-abandonment-effect",
    });
    database.settleUnleasedCommand(flowCommandId, "PENDING", "FAILED", { error: initialDiagnostic });

    const stalePreview = service.deletePreview({ runId });
    assert.deepEqual(stalePreview.flowReconciliationBlocker, {
      commandId: flowCommandId,
      commandStatus: "FAILED",
      flowId: "flow-delete-abandonment",
      flowRevision: 17,
      diagnostic: initialDiagnostic,
    });
    database.db.prepare("UPDATE commands SET last_error = ?, updated_at = ? WHERE id = ?")
      .run(currentDiagnostic, Date.now(), flowCommandId);
    assert.throws(
      () => service.deleteRun(writeParams({
        commandId: "delete-flow-abandonment-stale",
        runId,
        expectedRunRevision: stalePreview.runRevision,
        expiresAt: stalePreview.expiresAt,
        confirmationToken: stalePreview.confirmationToken,
        abandonFlowReconciliation: true,
        abandonmentReason,
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "REVISION_CONFLICT",
    );

    const preview = service.deletePreview({ runId });
    assert.deepEqual(preview.flowReconciliationBlocker, {
      commandId: flowCommandId,
      commandStatus: "FAILED",
      flowId: "flow-delete-abandonment",
      flowRevision: 17,
      diagnostic: currentDiagnostic,
    });
    assert.throws(
      () => service.deleteRun(writeParams({
        commandId: "delete-flow-abandonment-unconfirmed",
        runId,
        expectedRunRevision: preview.runRevision,
        expiresAt: preview.expiresAt,
        confirmationToken: preview.confirmationToken,
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "FLOW_RECONCILIATION_REQUIRED",
    );

    const accepted = service.deleteRun(writeParams({
      commandId: "delete-flow-abandonment-confirmed",
      runId,
      expectedRunRevision: preview.runRevision,
      expiresAt: preview.expiresAt,
      confirmationToken: preview.confirmationToken,
      abandonFlowReconciliation: true,
      abandonmentReason,
    }));
    const jobId = String(accepted.deletionJobId);
    service.start();
    await waitUntil(() => service.deleteJobGet({ jobId }).status === "COMPLETED");

    assert.throws(
      () => database.getRunSummary(runId),
      (error: unknown) => error instanceof CollaborationError && error.code === "NOT_FOUND",
    );
    const tombstone = (service.listTombstones({ limit: 10 }).tombstones as Array<Record<string, unknown>>)
      .find((entry) => entry.runId === runId);
    assert.ok(tombstone);
    assert.equal(tombstone.flowReconciliationCommandId, flowCommandId);
    assert.equal(tombstone.openclawFlowId, "flow-delete-abandonment");
    assert.equal(tombstone.openclawFlowRevision, 17);
    assert.equal(tombstone.flowReconciliationDiagnostic, currentDiagnostic);
    assert.equal(tombstone.flowReconciliationAbandonReason, abandonmentReason);
    assert.equal(typeof tombstone.flowReconciliationAbandonedAt, "number");
    assert.equal(Number(tombstone.flowReconciliationAbandonedAt), Number(tombstone.deletedAt));
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delete rejects fabricated Flow abandonment when no server blocker exists", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-fabricated-abandonment-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  const runId = "delete-fabricated-abandonment-run";
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-fabricated-abandonment",
        agentId: "main",
        sessionKey: "agent:main:delete-fabricated-abandonment",
        sessionId: "session-delete-fabricated-abandonment",
        nativeMessageId: "message-delete-fabricated-abandonment",
      },
      goal: "Reject fabricated Flow abandonment evidence",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(Date.now(), runId);
    const preview = service.deletePreview({ runId });
    assert.equal(preview.flowReconciliationBlocker, undefined);

    assert.throws(
      () => service.deleteRun(writeParams({
        commandId: "delete-fabricated-abandonment-delete",
        runId,
        expectedRunRevision: preview.runRevision,
        expiresAt: preview.expiresAt,
        confirmationToken: preview.confirmationToken,
        abandonFlowReconciliation: true,
        abandonmentReason: "There is no authoritative blocker for this request.",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
    );
    assert.equal(database.getRunSummary(runId).id, runId);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM deletion_jobs WHERE run_id = ?").get(runId)?.value), 0);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'DELETE'").get(runId)?.value),
      0,
    );
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM tombstones WHERE run_id = ?").get(runId)?.value), 0);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a second failed Flow command cannot be covered by an earlier single-blocker deletion preview", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-flow-ambiguity-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  const runId = "delete-flow-ambiguity-run";
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-flow-ambiguity",
        agentId: "main",
        sessionKey: "agent:main:delete-flow-ambiguity",
        sessionId: "session-delete-flow-ambiguity",
        nativeMessageId: "message-delete-flow-ambiguity",
      },
      goal: "Reject deletion when Flow abandonment evidence becomes ambiguous",
      capabilitySnapshot: {},
    });
    database.db
      .prepare(
        `UPDATE collaboration_runs
         SET status = 'COMPLETED', dispatch_state = 'CLOSED', reconcile_state = 'ATTENTION_REQUIRED',
             openclaw_flow_id = 'flow-delete-ambiguity', openclaw_flow_revision = 21,
             ended_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), Date.now(), runId);
    database.insertCommand({
      id: "delete-flow-ambiguity-sync",
      runId,
      kind: "FLOW_SYNC",
      payloadHash: "delete-flow-ambiguity-sync-payload",
      payload: { flowId: "flow-delete-ambiguity", terminal: "finished" },
      effectKey: "delete-flow-ambiguity-sync-effect",
    });
    database.settleUnleasedCommand("delete-flow-ambiguity-sync", "PENDING", "FAILED", {
      error: "Terminal Flow state could not be confirmed",
    });

    const preview = service.deletePreview({ runId });
    assert.equal(
      (preview.flowReconciliationBlocker as Record<string, unknown>).commandId,
      "delete-flow-ambiguity-sync",
    );

    // Command rows are deliberately outside the confirmation content digest.
    // The authoritative policy must therefore re-read their cardinality.
    database.insertCommand({
      id: "delete-flow-ambiguity-provision",
      runId,
      kind: "PROVISION",
      payloadHash: "delete-flow-ambiguity-provision-payload",
      payload: {},
      effectKey: "delete-flow-ambiguity-provision-effect",
    });
    database.settleUnleasedCommand("delete-flow-ambiguity-provision", "PENDING", "FAILED", {
      error: "Provision outcome also requires reconciliation",
    });

    assert.throws(
      () => service.deleteRun(writeParams({
        commandId: "delete-flow-ambiguity-delete",
        runId,
        expectedRunRevision: preview.runRevision,
        expiresAt: preview.expiresAt,
        confirmationToken: preview.confirmationToken,
        abandonFlowReconciliation: true,
        abandonmentReason: "Only the Flow sync command was reviewed.",
      })),
      (error: unknown) => {
        assert.ok(error instanceof CollaborationError);
        assert.equal(error.code, "FLOW_RECONCILIATION_REQUIRED");
        assert.deepEqual(error.details, {
          reason: "AMBIGUOUS_FLOW_RECONCILIATION",
          blockerCountLowerBound: 2,
          blockerWitnessCommandIds: ["delete-flow-ambiguity-sync", "delete-flow-ambiguity-provision"],
        });
        return true;
      },
    );
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM collaboration_runs WHERE id = ?").get(runId)?.value), 1);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM deletion_jobs WHERE run_id = ?").get(runId)?.value), 0);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM tombstones WHERE run_id = ?").get(runId)?.value), 0);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'DELETE'").get(runId)?.value),
      0,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DELETE execution rechecks Flow blocker cardinality after command acceptance", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-execution-flow-race-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  const runId = "delete-execution-flow-race-run";
  const deleteCommandId = "delete-execution-flow-race-delete";
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-execution-flow-race",
        agentId: "main",
        sessionKey: "agent:main:delete-execution-flow-race",
        sessionId: "session-delete-execution-flow-race",
        nativeMessageId: "message-delete-execution-flow-race",
      },
      goal: "Recheck Flow evidence inside the authoritative deletion transaction",
      capabilitySnapshot: {},
    });
    database.db
      .prepare(
        `UPDATE collaboration_runs
         SET status = 'COMPLETED', dispatch_state = 'CLOSED', reconcile_state = 'ATTENTION_REQUIRED',
             openclaw_flow_id = 'flow-delete-execution-race', openclaw_flow_revision = 34,
             ended_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), Date.now(), runId);
    database.insertCommand({
      id: "delete-execution-flow-race-sync",
      runId,
      kind: "FLOW_SYNC",
      payloadHash: "delete-execution-flow-race-sync-payload",
      payload: {},
      effectKey: "delete-execution-flow-race-sync-effect",
    });
    database.settleUnleasedCommand("delete-execution-flow-race-sync", "PENDING", "FAILED", {
      error: "Terminal Flow state could not be confirmed",
    });

    const preview = service.deletePreview({ runId });
    const accepted = service.deleteRun(writeParams({
      commandId: deleteCommandId,
      runId,
      expectedRunRevision: preview.runRevision,
      expiresAt: preview.expiresAt,
      confirmationToken: preview.confirmationToken,
      abandonFlowReconciliation: true,
      abandonmentReason: "The single Flow sync blocker was reviewed before deletion was queued.",
    }));
    const jobId = String(accepted.deletionJobId);
    assert.equal(service.deleteJobGet({ jobId }).status, "PENDING");
    assert.equal(database.getCommand(deleteCommandId).status, "PENDING");

    database.insertCommand({
      id: "delete-execution-flow-race-provision",
      runId,
      kind: "PROVISION",
      payloadHash: "delete-execution-flow-race-provision-payload",
      payload: {},
      effectKey: "delete-execution-flow-race-provision-effect",
    });
    database.settleUnleasedCommand("delete-execution-flow-race-provision", "PENDING", "FAILED", {
      error: "Provision outcome became ambiguous after DELETE acceptance",
    });

    service.start();
    await waitUntil(() => service.deleteJobGet({ jobId }).status === "FAILED");
    assert.equal(database.getCommand(deleteCommandId).status, "FAILED");
    assert.match(String(service.deleteJobGet({ jobId }).last_error), /Multiple failed Managed Flow reconciliations/);
    assert.equal(database.getRunSummary(runId).id, runId);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM tombstones WHERE run_id = ?").get(runId)?.value), 0);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM deletion_command_receipts WHERE command_id = ?").get(deleteCommandId)?.value),
      1,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delete retry rejects ambiguous Flow evidence without mutating the failed job", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-retry-flow-ambiguity-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  const runId = "delete-retry-flow-ambiguity-run";
  const jobId = "delete-retry-flow-ambiguity-job";
  const timestamp = Date.now();
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-retry-flow-ambiguity",
        agentId: "main",
        sessionKey: "agent:main:delete-retry-flow-ambiguity",
        sessionId: "session-delete-retry-flow-ambiguity",
        nativeMessageId: "message-delete-retry-flow-ambiguity",
      },
      goal: "Reject a deletion retry whose prior abandonment is no longer unique",
      capabilitySnapshot: {},
    });
    database.db
      .prepare(
        `UPDATE collaboration_runs
         SET status = 'COMPLETED', dispatch_state = 'CLOSED', reconcile_state = 'ATTENTION_REQUIRED',
             openclaw_flow_id = 'flow-delete-retry-ambiguity', openclaw_flow_revision = 13,
             ended_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(timestamp, timestamp, runId);
    database.insertCommand({
      id: "delete-retry-flow-ambiguity-sync",
      runId,
      kind: "FLOW_SYNC",
      payloadHash: "delete-retry-flow-ambiguity-sync-payload",
      payload: {},
      effectKey: "delete-retry-flow-ambiguity-sync-effect",
    });
    database.settleUnleasedCommand("delete-retry-flow-ambiguity-sync", "PENDING", "FAILED", {
      error: "Terminal Flow state could not be confirmed",
    });
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(
          id, run_id, status, confirmation_digest, last_error, created_at, updated_at
        ) VALUES (?, ?, 'FAILED', 'delete-retry-digest', 'previous deletion failed', ?, ?)`,
      )
      .run(jobId, runId, timestamp, timestamp);
    database.insertCommand({
      id: "delete-retry-flow-ambiguity-previous",
      runId,
      kind: "DELETE",
      entityId: jobId,
      payloadHash: "delete-retry-flow-ambiguity-previous-payload",
      payload: {
        jobId,
        actor: "operator",
        digest: "delete-retry-digest",
        flowReconciliationAbandonment: {
          commandId: "delete-retry-flow-ambiguity-sync",
          commandStatus: "FAILED",
          flowId: "flow-delete-retry-ambiguity",
          flowRevision: 13,
          diagnostic: "Terminal Flow state could not be confirmed",
          reason: "The single failed Flow sync was reviewed.",
        },
      },
      effectKey: "delete-retry-flow-ambiguity-previous-effect",
    });
    database.settleUnleasedCommand("delete-retry-flow-ambiguity-previous", "PENDING", "FAILED", {
      error: "previous deletion failed",
    });

    database.insertCommand({
      id: "delete-retry-flow-ambiguity-provision",
      runId,
      kind: "PROVISION",
      payloadHash: "delete-retry-flow-ambiguity-provision-payload",
      payload: {},
      effectKey: "delete-retry-flow-ambiguity-provision-effect",
    });
    database.settleUnleasedCommand("delete-retry-flow-ambiguity-provision", "PENDING", "FAILED", {
      error: "Provision outcome also requires reconciliation",
    });

    assert.throws(
      () => service.retryDelete(writeParams({
        commandId: "delete-retry-flow-ambiguity-retry",
        jobId,
        expectedRunId: runId,
        expectedRunRevision: database.getRunSummary(runId).revision,
      })),
      (error: unknown) => {
        assert.ok(error instanceof CollaborationError);
        assert.equal(error.code, "FLOW_RECONCILIATION_REQUIRED");
        assert.equal(error.details?.reason, "AMBIGUOUS_FLOW_RECONCILIATION");
        assert.equal(error.details?.blockerCountLowerBound, 2);
        return true;
      },
    );
    assert.equal(service.deleteJobGet({ jobId }).status, "FAILED");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE id = ?").get("delete-retry-flow-ambiguity-retry")?.value),
      0,
    );
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM deletion_command_receipts WHERE command_id = ?").get("delete-retry-flow-ambiguity-retry")?.value),
      0,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delete retry preserves exact Flow abandonment and serializes competing claims", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-retry-flow-exact-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  const runId = "delete-retry-flow-exact-run";
  const jobId = "delete-retry-flow-exact-job";
  const flowCommandId = "delete-retry-flow-exact-sync";
  const retryCommandId = "delete-retry-flow-exact-retry";
  const diagnostic = "Terminal Flow state could not be confirmed";
  const reason = "The exact external Flow state was reviewed before retrying deletion.";
  const timestamp = Date.now();
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-retry-flow-exact",
        agentId: "main",
        sessionKey: "agent:main:delete-retry-flow-exact",
        sessionId: "session-delete-retry-flow-exact",
        nativeMessageId: "message-delete-retry-flow-exact",
      },
      goal: "Preserve exact Flow abandonment while recovering deletion",
      capabilitySnapshot: {},
    });
    database.db
      .prepare(
        `UPDATE collaboration_runs
         SET status = 'COMPLETED', dispatch_state = 'CLOSED', reconcile_state = 'ATTENTION_REQUIRED',
             openclaw_flow_id = 'flow-delete-retry-exact', openclaw_flow_revision = 55,
             ended_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(timestamp, timestamp, runId);
    database.insertCommand({
      id: flowCommandId,
      runId,
      kind: "FLOW_SYNC",
      payloadHash: "delete-retry-flow-exact-sync-payload",
      payload: {},
      effectKey: "delete-retry-flow-exact-sync-effect",
    });
    database.settleUnleasedCommand(flowCommandId, "PENDING", "FAILED", { error: diagnostic });
    const digest = String(service.deletePreview({ runId }).digest);
    const exactAbandonment = {
      commandId: flowCommandId,
      commandStatus: "FAILED",
      flowId: "flow-delete-retry-exact",
      flowRevision: 55,
      diagnostic,
      reason,
    };
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(
          id, run_id, status, confirmation_digest, last_error, created_at, updated_at
        ) VALUES (?, ?, 'FAILED', ?, 'previous deletion failed', ?, ?)`,
      )
      .run(jobId, runId, digest, timestamp, timestamp);
    database.insertCommand({
      id: "delete-retry-flow-exact-previous",
      runId,
      kind: "DELETE",
      entityId: jobId,
      payloadHash: "delete-retry-flow-exact-previous-payload",
      payload: {
        jobId,
        actor: "operator",
        digest,
        flowReconciliationAbandonment: exactAbandonment,
      },
      effectKey: "delete-retry-flow-exact-previous-effect",
    });
    database.settleUnleasedCommand("delete-retry-flow-exact-previous", "PENDING", "FAILED", {
      error: "previous deletion failed",
    });

    assert.throws(
      () => service.retryDelete(writeParams({
        commandId: "delete-retry-flow-exact-wrong-run",
        jobId,
        expectedRunId: "different-run",
        expectedRunRevision: database.getRunSummary(runId).revision,
      })),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "SESSION_IDENTITY_MISMATCH"
        && error.details?.expectedRunId === "different-run"
        && error.details?.actualRunId === runId,
    );
    assert.equal(service.deleteJobGet({ jobId }).status, "FAILED");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE id = ?")
        .get("delete-retry-flow-exact-wrong-run")?.value),
      0,
    );

    let competingError: unknown;
    let competingAttempted = false;
    const originalInsertCommand = database.insertCommand.bind(database);
    database.insertCommand = ((command: Parameters<CollaborationDatabase["insertCommand"]>[0]) => {
      if (command.id === retryCommandId && !competingAttempted) {
        competingAttempted = true;
        try {
          service.retryDelete(writeParams({
            commandId: "delete-retry-flow-exact-competing",
            jobId,
            expectedRunId: runId,
            expectedRunRevision: database.getRunSummary(runId).revision,
          }));
        } catch (error) {
          competingError = error;
        }
      }
      return originalInsertCommand(command);
    }) as CollaborationDatabase["insertCommand"];

    const retried = service.retryDelete(writeParams({
      commandId: retryCommandId,
      jobId,
      expectedRunId: runId,
      expectedRunRevision: database.getRunSummary(runId).revision,
    }));
    assert.equal(competingAttempted, true);
    assert.ok(competingError instanceof CollaborationError);
    assert.equal(competingError.code, "INVALID_TRANSITION");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE id = ?")
        .get("delete-retry-flow-exact-competing")?.value),
      0,
    );
    assert.equal(retried.deletionJobId, jobId);
    assert.equal(service.deleteJobGet({ jobId }).status, "PENDING");
    assert.deepEqual(database.getCommand(retryCommandId).payload.flowReconciliationAbandonment, exactAbandonment);

    service.start();
    await waitUntil(() => service.deleteJobGet({ jobId }).status === "COMPLETED");
    assert.throws(
      () => database.getRunSummary(runId),
      (error: unknown) => error instanceof CollaborationError && error.code === "NOT_FOUND",
    );
    const tombstone = (service.listTombstones({ limit: 10 }).tombstones as Array<Record<string, unknown>>)
      .find((entry) => entry.runId === runId);
    assert.ok(tombstone);
    assert.equal(tombstone.flowReconciliationCommandId, flowCommandId);
    assert.equal(tombstone.openclawFlowId, "flow-delete-retry-exact");
    assert.equal(tombstone.openclawFlowRevision, 55);
    assert.equal(tombstone.flowReconciliationDiagnostic, diagnostic);
    assert.equal(tombstone.flowReconciliationAbandonReason, reason);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("export byte overflow fails the job and removes its temporary artifact", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-export-bytes-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  const runId = "export-byte-overflow";
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-export-overflow",
        agentId: "main",
        sessionKey: "agent:main:export-overflow",
        sessionId: "session-export-overflow",
        nativeMessageId: "message-export-overflow",
      },
      goal: "Export a bounded audit timeline",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(Date.now(), runId);
    const insert = database.db.prepare(
      `INSERT INTO collaboration_events(
        run_id, event_type, entity_type, entity_id, run_revision, payload_json, created_at
      ) VALUES (?, 'EXPORT_SIZE_TEST', 'run', ?, 1, ?, ?)`,
    );
    const payload = JSON.stringify({ data: "x".repeat(2_200) });
    database.transaction(() => {
      for (let index = 0; index < 8_000; index += 1) insert.run(runId, runId, payload, Date.now());
    });

    service.start();
    const response = service.createExport(writeParams({
      commandId: "export-byte-overflow-command",
      runId,
      expectedRunRevision: database.getRunSummary(runId).revision,
      format: "json",
    }));
    const jobId = String(response.exportJobId);
    await waitUntil(() => service.exportGet({ jobId }).status === "FAILED", 10_000);
    assert.match(String(service.exportGet({ jobId }).last_error), /export exceeds/);
    assert.equal(readdirSync(path.join(directory, "exports")).some((name) => name.includes(jobId)), false);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("export reclaims only stale temporary files for the leased job", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-export-temp-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  const runId = "export-temp-cleanup";
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-export-temp",
        agentId: "main",
        sessionKey: "agent:main:export-temp",
        sessionId: "session-export-temp",
        nativeMessageId: "message-export-temp",
      },
      goal: "Export after a writer crash",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(Date.now(), runId);
    const response = service.createExport(writeParams({
      commandId: "export-temp-command",
      runId,
      expectedRunRevision: database.getRunSummary(runId).revision,
      format: "json",
    }));
    const jobId = String(response.exportJobId);
    const exportDirectory = path.join(directory, "exports");
    const stale = path.join(exportDirectory, `.${jobId}.dead-worker.1.tmp`);
    const recent = path.join(exportDirectory, `.${jobId}.live-worker.1.tmp`);
    const other = path.join(exportDirectory, ".other-job.live-worker.1.tmp");
    const orphaned = path.join(exportDirectory, ".orphaned-job.dead-worker.1.tmp");
    writeFileSync(stale, "stale", { mode: 0o600 });
    writeFileSync(recent, "recent", { mode: 0o600 });
    writeFileSync(other, "other", { mode: 0o600 });
    writeFileSync(orphaned, "orphaned", { mode: 0o600 });
    const staleTime = new Date(Date.now() - 11 * 60_000);
    utimesSync(stale, staleTime, staleTime);
    utimesSync(orphaned, staleTime, staleTime);

    service.start();
    await waitUntil(() => service.exportGet({ jobId }).status === "COMPLETED");
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(recent), false);
    assert.equal(existsSync(other), true);
    assert.equal(existsSync(orphaned), false);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy absolute export paths remap only to an existing managed artifact", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-export-migration-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  const runId = "legacy-export-path";
  const content = "legacy export payload";
  const fileName = "legacy-export.json";
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-legacy-export",
        agentId: "main",
        sessionKey: "agent:main:legacy-export",
        sessionId: "session-legacy-export",
        nativeMessageId: "message-legacy-export",
      },
      goal: "Read an export after state relocation",
      capabilitySnapshot: {},
    });
    writeFileSync(path.join(directory, "exports", fileName), content, { mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO export_jobs(id, run_id, status, format, artifact_path, digest, created_at, updated_at)
         VALUES ('legacy-export-job', ?, 'COMPLETED', 'json', ?, ?, ?, ?)`,
      )
      .run(runId, path.join(directory, "old-state", "exports", fileName), sha256(content), Date.now(), Date.now());
    assert.equal(service.exportDownload({ jobId: "legacy-export-job" }).content, content);

    rmSync(path.join(directory, "exports", fileName));
    const failed = service.exportGet({ jobId: "legacy-export-job" });
    assert.equal(failed.status, "FAILED");
    assert.match(String(failed.last_error), /not copied|not found|ENOENT/i);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("interrupted deletion cleanup is recovered durably after database restart", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-recovery-test-"));
  const databasePath = path.join(directory, "state", "collaboration.sqlite");
  const dataDirectory = path.join(directory, "plugin-data");
  const runId = "delete-recovery-run";
  const jobId = "delete-recovery-job";
  let database = new CollaborationDatabase(databasePath);
  let service = new CollaborationService(
    database,
    new FakeRuntime(),
    {
      coordinatorAgentId: "coordinator",
      allowedAgentIds: ["coordinator", "worker"],
      maxConcurrency: 2,
      maxWorkItems: 10,
      attemptTimeoutMs: 60_000,
      retentionDays: 365,
    },
    dataDirectory,
    { info() {}, warn() {}, error() {} },
  );
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-recovery",
        agentId: "main",
        sessionKey: "agent:main:delete-recovery",
        sessionId: "session-delete-recovery",
        nativeMessageId: "message-delete-recovery",
      },
      goal: "Recover a deletion interrupted after its database commit",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(Date.now(), runId);
    const artifactName = "delete-recovery.json";
    const artifactPath = path.join(dataDirectory, "exports", artifactName);
    writeFileSync(artifactPath, "managed export", { mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO export_jobs(id, run_id, status, format, artifact_path, digest, created_at, updated_at)
         VALUES ('delete-recovery-export', ?, 'COMPLETED', 'json', ?, ?, ?, ?)`,
      )
      .run(runId, artifactName, sha256("managed export"), Date.now(), Date.now());
    const digest = String(service.deletePreview({ runId }).digest);
    const stagingDirectory = path.join(dataDirectory, "exports", ".delete-staging", runId);
    mkdirSync(stagingDirectory, { recursive: true });
    const stagedPath = path.join(stagingDirectory, artifactName);
    renameSync(artifactPath, stagedPath);
    database.transaction(() => {
      database.db
        .prepare(
          `INSERT INTO deletion_jobs(id, run_id, status, confirmation_digest, created_at, updated_at)
           VALUES (?, ?, 'COMPLETED', ?, ?, ?)`,
        )
        .run(jobId, runId, digest, Date.now(), Date.now());
      database.db
        .prepare(
          `INSERT INTO tombstones(
            id, run_id, actor, content_digest, deleted_at,
            cleanup_status, cleanup_error, cleanup_updated_at
          ) VALUES ('delete-recovery-tombstone', ?, 'operator', ?, ?, 'PENDING', NULL, ?)`,
        )
        .run(runId, digest, Date.now(), Date.now());
      database.db.prepare("DELETE FROM collaboration_runs WHERE id = ?").run(runId);
    });
    database.close();

    database = new CollaborationDatabase(databasePath);
    service = new CollaborationService(
      database,
      new FakeRuntime(),
      {
        coordinatorAgentId: "coordinator",
        allowedAgentIds: ["coordinator", "worker"],
        maxConcurrency: 2,
        maxWorkItems: 10,
        attemptTimeoutMs: 60_000,
        retentionDays: 365,
      },
      dataDirectory,
      { info() {}, warn() {}, error() {} },
    );
    service.runRetentionSweep(Date.now());
    assert.equal(existsSync(stagedPath), false);
    assert.equal(service.deleteJobGet({ jobId }).status, "COMPLETED");
    const tombstones = service.listTombstones({ limit: 10 }).tombstones as Array<Record<string, unknown>>;
    assert.equal(tombstones[0]?.runId, runId);
    assert.equal(tombstones[0]?.contentDigest, digest);
    assert.equal(tombstones[0]?.cleanupStatus, "COMPLETED");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed retry purge leaves no durable PENDING job and startup recovers legacy PENDING state", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-retry-purge-failure-"));
  const databasePath = path.join(directory, "state", "collaboration.sqlite");
  const dataDirectory = path.join(directory, "plugin-data");
  const runId = "delete-retry-purge-failure-run";
  const jobId = "delete-retry-purge-failure-job";
  let database = new CollaborationDatabase(databasePath);
  let service = createTestService(database, new FakeRuntime(), dataDirectory);
  const timestamp = Date.now();
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-retry-purge-failure",
        agentId: "main",
        sessionKey: "agent:main:delete-retry-purge-failure",
        sessionId: "session-delete-retry-purge-failure",
        nativeMessageId: "message-delete-retry-purge-failure",
      },
      goal: "Recover a retry whose physical purge was interrupted",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(timestamp, runId);

    const digest = "a".repeat(64);
    const stagingDirectory = path.join(dataDirectory, "exports", ".delete-staging", runId);
    const stagedPath = path.join(stagingDirectory, "retry-purge-failure.json");
    mkdirSync(stagingDirectory, { recursive: true });
    writeFileSync(stagedPath, "staged cleanup", { mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(
          id, run_id, status, confirmation_digest, last_error, created_at, updated_at
        ) VALUES (?, ?, 'FAILED', ?, 'previous deletion failed', ?, ?)`,
      )
      .run(jobId, runId, digest, timestamp, timestamp);
    database.db
      .prepare(
        `INSERT INTO tombstones(
          id, run_id, actor, content_digest, deleted_at,
          cleanup_status, cleanup_error, cleanup_updated_at
        ) VALUES ('delete-retry-purge-failure-tombstone', ?, 'operator', ?, ?, 'PENDING', NULL, ?)`,
      )
      .run(runId, digest, timestamp, timestamp);
    database.db.prepare("DELETE FROM collaboration_runs WHERE id = ?").run(runId);

    const serviceInternals = service as unknown as {
      purgeDeletedRunStaging: (candidateRunId: string) => { complete: boolean; error: string | null };
    };
    const originalPurge = serviceInternals.purgeDeletedRunStaging;
    serviceInternals.purgeDeletedRunStaging = () => ({
      complete: false,
      error: "simulated purge interruption",
    });
    assert.throws(
      () => service.retryDelete(writeParams({
        commandId: "delete-retry-purge-failure-command",
        jobId,
        expectedRunId: runId,
      })),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "INVALID_TRANSITION"
        && error.details?.deletionJobId === jobId,
    );
    serviceInternals.purgeDeletedRunStaging = originalPurge;

    assert.equal(service.deleteJobGet({ jobId }).status, "PARTIAL");
    assert.equal(
      database.db.prepare("SELECT status FROM deletion_jobs WHERE id = ?").get(jobId)?.status,
      "PARTIAL",
    );
    assert.equal(
      database.db.prepare("SELECT cleanup_status FROM tombstones WHERE run_id = ?").get(runId)?.cleanup_status,
      "PARTIAL",
    );
    assert.equal(existsSync(stagedPath), true);

    // Model a legacy process crash that left the transient claim committed.
    // Startup recovery must fence it by run and finish the physical purge.
    database.db.prepare("UPDATE deletion_jobs SET status = 'PENDING' WHERE id = ? AND run_id = ?").run(jobId, runId);
    database.close();
    database = new CollaborationDatabase(databasePath);
    service = createTestService(database, new FakeRuntime(), dataDirectory);
    service.runRetentionSweep(Date.now());
    assert.equal(existsSync(stagedPath), false);
    assert.equal(service.deleteJobGet({ jobId }).status, "COMPLETED");
    assert.equal(
      database.db.prepare("SELECT cleanup_status FROM tombstones WHERE run_id = ?").get(runId)?.cleanup_status,
      "COMPLETED",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deletion recovery updates only the tombstone's authoritative job when legacy jobs coexist", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-recovery-job-fence-"));
  const databasePath = path.join(directory, "state", "collaboration.sqlite");
  const dataDirectory = path.join(directory, "plugin-data");
  const runId = "delete-recovery-job-fence-run";
  const authoritativeJobId = "delete-recovery-job-fence-authoritative";
  const legacyJobId = "delete-recovery-job-fence-legacy";
  let database = new CollaborationDatabase(databasePath);
  let service = createTestService(database, new FakeRuntime(), dataDirectory);
  const timestamp = Date.now();
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-recovery-job-fence",
        agentId: "main",
        sessionKey: "agent:main:delete-recovery-job-fence",
        sessionId: "session-delete-recovery-job-fence",
        nativeMessageId: "message-delete-recovery-job-fence",
      },
      goal: "Keep historical deletion jobs immutable during recovery",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(timestamp, runId);
    const digest = "b".repeat(64);
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(id, run_id, status, confirmation_digest, last_error, created_at, updated_at)
         VALUES (?, ?, 'FAILED', 'legacy-digest', 'retain this historical failure', ?, ?)`,
      )
      .run(legacyJobId, runId, timestamp, timestamp);
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(id, run_id, status, confirmation_digest, created_at, updated_at)
         VALUES (?, ?, 'COMPLETED', ?, ?, ?)`,
      )
      .run(authoritativeJobId, runId, digest, timestamp + 1, timestamp + 1);
    const stagingDirectory = path.join(dataDirectory, "exports", ".delete-staging", runId);
    mkdirSync(stagingDirectory, { recursive: true });
    writeFileSync(path.join(stagingDirectory, "authoritative.json"), "staged cleanup", { mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO tombstones(
          id, run_id, actor, content_digest, deletion_job_id, deleted_at,
          cleanup_status, cleanup_error, cleanup_updated_at
        ) VALUES ('delete-recovery-job-fence-tombstone', ?, 'operator', ?, ?, ?, 'PENDING', NULL, ?)`,
      )
      .run(runId, digest, authoritativeJobId, timestamp, timestamp);
    database.db.prepare("DELETE FROM collaboration_runs WHERE id = ?").run(runId);
    database.close();

    database = new CollaborationDatabase(databasePath);
    service = createTestService(database, new FakeRuntime(), dataDirectory);
    service.runRetentionSweep(Date.now());

    assert.equal(service.deleteJobGet({ jobId: authoritativeJobId }).status, "COMPLETED");
    assert.equal(service.deleteJobGet({ jobId: legacyJobId }).status, "FAILED");
    assert.equal(
      database.db.prepare("SELECT last_error FROM deletion_jobs WHERE id = ?").get(legacyJobId)?.last_error,
      "retain this historical failure",
    );
    const tombstone = service.listTombstones({ limit: 10 }).tombstones as Array<Record<string, unknown>>;
    assert.equal(tombstone[0]?.deletionJobId, authoritativeJobId);
    assert.equal(tombstone[0]?.deletionJobStatus, "COMPLETED");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deletion recovery fences a tombstone whose authoritative job is missing", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-recovery-missing-job-"));
  const databasePath = path.join(directory, "state", "collaboration.sqlite");
  const dataDirectory = path.join(directory, "plugin-data");
  const runId = "delete-recovery-missing-job-run";
  const missingJobId = "delete-recovery-missing-job-authority";
  let database = new CollaborationDatabase(databasePath);
  const service = createTestService(database, new FakeRuntime(), dataDirectory);
  const timestamp = Date.now();
  const stagedPath = path.join(dataDirectory, "exports", ".delete-staging", runId, "orphan.json");
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-recovery-missing-job",
        agentId: "main",
        sessionKey: "agent:main:delete-recovery-missing-job",
        sessionId: "session-delete-recovery-missing-job",
        nativeMessageId: "message-delete-recovery-missing-job",
      },
      goal: "Retain evidence when the deletion owner disappeared",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(timestamp, runId);
    mkdirSync(path.dirname(stagedPath), { recursive: true });
    writeFileSync(stagedPath, "retain staged evidence", { mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO tombstones(
          id, run_id, actor, content_digest, deletion_job_id, deleted_at,
          cleanup_status, cleanup_error, cleanup_updated_at
        ) VALUES ('delete-recovery-missing-job-tombstone', ?, 'operator', ?, ?, ?, 'PENDING', NULL, ?)`,
      )
      .run(runId, "c".repeat(64), missingJobId, timestamp, timestamp);
    database.db.prepare("DELETE FROM collaboration_runs WHERE id = ?").run(runId);

    service.runRetentionSweep(Date.now());

    assert.equal(existsSync(stagedPath), true);
    const tombstone = database.db
      .prepare("SELECT cleanup_status, cleanup_error, deletion_job_id FROM tombstones WHERE run_id = ?")
      .get(runId) as { cleanup_status: string; cleanup_error: string | null; deletion_job_id: string | null };
    assert.equal(tombstone.cleanup_status, "PARTIAL");
    assert.equal(tombstone.deletion_job_id, missingJobId);
    assert.match(String(tombstone.cleanup_error), /missing or belongs to another run/i);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM deletion_jobs WHERE run_id = ?").get(runId)?.value), 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deletion recovery refuses to guess when a legacy tombstone has multiple jobs", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-recovery-ambiguous-job-"));
  const databasePath = path.join(directory, "state", "collaboration.sqlite");
  const dataDirectory = path.join(directory, "plugin-data");
  const runId = "delete-recovery-ambiguous-job-run";
  const firstJobId = "delete-recovery-ambiguous-job-first";
  const secondJobId = "delete-recovery-ambiguous-job-second";
  let database = new CollaborationDatabase(databasePath);
  const service = createTestService(database, new FakeRuntime(), dataDirectory);
  const timestamp = Date.now();
  const stagedPath = path.join(dataDirectory, "exports", ".delete-staging", runId, "ambiguous.json");
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-recovery-ambiguous-job",
        agentId: "main",
        sessionKey: "agent:main:delete-recovery-ambiguous-job",
        sessionId: "session-delete-recovery-ambiguous-job",
        nativeMessageId: "message-delete-recovery-ambiguous-job",
      },
      goal: "Retain evidence when legacy deletion ownership is ambiguous",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(timestamp, runId);
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(id, run_id, status, confirmation_digest, last_error, created_at, updated_at)
         VALUES (?, ?, 'FAILED', 'legacy-first', 'preserve first failure', ?, ?)`,
      )
      .run(firstJobId, runId, timestamp, timestamp);
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(id, run_id, status, confirmation_digest, last_error, created_at, updated_at)
         VALUES (?, ?, 'COMPLETED', 'legacy-second', NULL, ?, ?)`,
      )
      .run(secondJobId, runId, timestamp + 1, timestamp + 1);
    mkdirSync(path.dirname(stagedPath), { recursive: true });
    writeFileSync(stagedPath, "retain ambiguous evidence", { mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO tombstones(
          id, run_id, actor, content_digest, deleted_at,
          cleanup_status, cleanup_error, cleanup_updated_at
        ) VALUES ('delete-recovery-ambiguous-job-tombstone', ?, 'operator', ?, ?, 'PENDING', NULL, ?)`,
      )
      .run(runId, "d".repeat(64), timestamp, timestamp);
    database.db.prepare("DELETE FROM collaboration_runs WHERE id = ?").run(runId);

    service.runRetentionSweep(Date.now());

    assert.equal(existsSync(stagedPath), true);
    const tombstone = database.db
      .prepare("SELECT cleanup_status, cleanup_error, deletion_job_id FROM tombstones WHERE run_id = ?")
      .get(runId) as { cleanup_status: string; cleanup_error: string | null; deletion_job_id: string | null };
    assert.equal(tombstone.cleanup_status, "PARTIAL");
    assert.equal(tombstone.deletion_job_id, null);
    assert.match(String(tombstone.cleanup_error), /no authoritative owner/i);
    const jobs = (database.db
      .prepare("SELECT id, status, last_error FROM deletion_jobs WHERE run_id = ? ORDER BY id")
      .all(runId) as Array<{ id: string; status: string; last_error: string | null }>)
      .map((job) => ({ id: job.id, status: job.status, last_error: job.last_error }));
    assert.deepEqual(jobs, [
      { id: firstJobId, status: "FAILED", last_error: "preserve first failure" },
      { id: secondJobId, status: "COMPLETED", last_error: null },
    ]);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deletion recovery fences a live Run beside a pending tombstone after restoring staged artifacts", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-recovery-live-run-"));
  const databasePath = path.join(directory, "state", "collaboration.sqlite");
  const dataDirectory = path.join(directory, "plugin-data");
  const runId = "delete-recovery-live-run";
  const jobId = "delete-recovery-live-job";
  const artifactName = "live-recovery.json";
  const originalPath = path.join(dataDirectory, "exports", artifactName);
  const stagedPath = path.join(dataDirectory, "exports", ".delete-staging", runId, artifactName);
  const database = new CollaborationDatabase(databasePath);
  const service = createTestService(database, new FakeRuntime(), dataDirectory);
  const timestamp = Date.now();
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-recovery-live-run",
        agentId: "main",
        sessionKey: "agent:main:delete-recovery-live-run",
        sessionId: "session-delete-recovery-live-run",
        nativeMessageId: "message-delete-recovery-live-run",
      },
      goal: "Fence contradictory live-run deletion facts",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(timestamp, runId);
    mkdirSync(path.dirname(originalPath), { recursive: true });
    writeFileSync(originalPath, "restored live artifact", { mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO export_jobs(id, run_id, status, format, artifact_path, digest, created_at, updated_at)
         VALUES (?, ?, 'COMPLETED', 'json', ?, ?, ?, ?)`,
      )
      .run("delete-recovery-live-export", runId, artifactName, sha256("restored live artifact"), timestamp, timestamp);
    mkdirSync(path.dirname(stagedPath), { recursive: true });
    renameSync(originalPath, stagedPath);
    database.db
      .prepare(
        `INSERT INTO deletion_jobs(id, run_id, status, confirmation_digest, created_at, updated_at)
         VALUES (?, ?, 'COMPLETED', ?, ?, ?)`,
      )
      .run(jobId, runId, "e".repeat(64), timestamp, timestamp);
    database.db
      .prepare(
        `INSERT INTO tombstones(
          id, run_id, actor, content_digest, deletion_job_id, deleted_at,
          cleanup_status, cleanup_error, cleanup_updated_at
        ) VALUES ('delete-recovery-live-tombstone', ?, 'operator', ?, ?, ?, 'PENDING', NULL, ?)`,
      )
      .run(runId, "e".repeat(64), jobId, timestamp, timestamp);

    service.runRetentionSweep(timestamp);

    assert.equal(existsSync(originalPath), true);
    assert.equal(existsSync(stagedPath), false);
    const tombstone = database.db
      .prepare("SELECT cleanup_status, cleanup_error FROM tombstones WHERE run_id = ?")
      .get(runId) as { cleanup_status: string; cleanup_error: string | null };
    assert.equal(tombstone.cleanup_status, "PARTIAL");
    assert.match(String(tombstone.cleanup_error), /manual reconciliation is required/i);
    assert.equal(database.db.prepare("SELECT status, last_error FROM deletion_jobs WHERE id = ?").get(jobId)?.status, "PARTIAL");
    assert.match(
      String(database.db.prepare("SELECT last_error FROM deletion_jobs WHERE id = ?").get(jobId)?.last_error),
      /manual reconciliation is required/i,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deletion command replay survives plugin restart after the run cascade", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-replay-test-"));
  const databasePath = path.join(directory, "state", "collaboration.sqlite");
  const dataDirectory = path.join(directory, "plugin-data");
  const runId = "delete-replay-run";
  let database = new CollaborationDatabase(databasePath);
  let service = new CollaborationService(
    database,
    new FakeRuntime(),
    {
      coordinatorAgentId: "coordinator",
      allowedAgentIds: ["coordinator", "worker"],
      maxConcurrency: 2,
      maxWorkItems: 10,
      attemptTimeoutMs: 60_000,
      retentionDays: 365,
    },
    dataDirectory,
    { info() {}, warn() {}, error() {} },
  );
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-replay",
        agentId: "main",
        sessionKey: "agent:main:delete-replay",
        sessionId: "session-delete-replay",
        nativeMessageId: "message-delete-replay",
      },
      goal: "Replay a deletion command after restart",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ? WHERE id = ?")
      .run(Date.now(), runId);
    const archiveParams = writeParams({
      commandId: "durable-archive-command",
      runId,
      expectedRunRevision: database.getRunSummary(runId).revision,
    });
    const archived = service.archiveRun(archiveParams, true);
    assert.equal(archived.replayed, false);
    const preview = service.deletePreview({ runId });
    const params = writeParams({
      commandId: "durable-delete-command",
      runId,
      expectedRunRevision: preview.runRevision,
      expiresAt: preview.expiresAt,
      confirmationToken: preview.confirmationToken,
    });
    const accepted = service.deleteRun(params);
    const jobId = String(accepted.deletionJobId);
    service.start();
    await waitUntil(() => service.deleteJobGet({ jobId }).status === "COMPLETED");
    await service.stop();
    database.close();

    database = new CollaborationDatabase(databasePath);
    service = new CollaborationService(
      database,
      new FakeRuntime(),
      {
        coordinatorAgentId: "coordinator",
        allowedAgentIds: ["coordinator", "worker"],
        maxConcurrency: 2,
        maxWorkItems: 10,
        attemptTimeoutMs: 60_000,
        retentionDays: 365,
      },
      dataDirectory,
      { info() {}, warn() {}, error() {} },
    );
    const replayed = service.deleteRun(params);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.deletionJobId, jobId);
    const replayedArchive = service.archiveRun(archiveParams, true);
    assert.equal(replayedArchive.replayed, true);
    assert.equal(replayedArchive.commandId, "durable-archive-command");
    assert.throws(
      () => service.prepareSessionMutation(writeParams({
        commandId: "durable-delete-command",
        runtimeId: "runtime-delete-replay",
        sessionKey: "agent:main:delete-replay",
        sessionId: "session-delete-replay",
        action: "delete",
        policy: "PROCEED",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "IDEMPOTENCY_CONFLICT",
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DELETE rechecks its lease before staging any export artifact", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delete-lease-fence-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  const runId = "delete-lease-fence-run";
  const artifactName = "delete-lease-fence.json";
  const artifactPath = path.join(directory, "exports", artifactName);
  let renewals = 0;
  const originalRenew = database.renewClaimedCommandLease.bind(database);
  database.renewClaimedCommandLease = ((command, leaseMs, referenceTime) => {
    renewals += 1;
    // The first renewal covers the digest phase. Simulate a different worker
    // reclaiming the command before the authoritative deletion transaction.
    if (renewals === 2) return false;
    return originalRenew(command, leaseMs, referenceTime);
  }) as CollaborationDatabase["renewClaimedCommandLease"];
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-delete-lease-fence",
        agentId: "main",
        sessionKey: "agent:main:delete-lease-fence",
        sessionId: "session-delete-lease-fence",
        nativeMessageId: "message-delete-lease-fence",
      },
      goal: "Keep files and durable state intact when a delete lease is lost",
      capabilitySnapshot: {},
    });
    const timestamp = Date.now();
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED', dispatch_state = 'CLOSED', ended_at = ?, updated_at = ? WHERE id = ?")
      .run(timestamp, timestamp, runId);
    writeFileSync(artifactPath, "managed export", { mode: 0o600 });
    database.db
      .prepare(
        `INSERT INTO export_jobs(id, run_id, status, format, artifact_path, digest, created_at, updated_at)
         VALUES ('delete-lease-fence-export', ?, 'COMPLETED', 'json', ?, ?, ?, ?)`,
      )
      .run(runId, artifactName, sha256("managed export"), timestamp, timestamp);

    const preview = service.deletePreview({ runId });
    const accepted = service.deleteRun(writeParams({
      commandId: "delete-lease-fence-command",
      runId,
      expectedRunRevision: preview.runRevision,
      expiresAt: preview.expiresAt,
      confirmationToken: preview.confirmationToken,
    }));
    const jobId = String(accepted.deletionJobId);
    service.start();
    await waitUntil(() => service.deleteJobGet({ jobId }).status === "FAILED");

    assert.ok(renewals >= 2);
    assert.equal(existsSync(artifactPath), true);
    assert.equal(database.getRunSummary(runId).id, runId);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM tombstones WHERE run_id = ?").get(runId)?.value),
      0,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("service closes planner, dependency, synthesis, and exact-delivery loop", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
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
  const origin: OriginRef = {
    runtimeId: "runtime-1",
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "session-1",
    nativeMessageId: "native-message-1",
  };
  service.start();
  try {
    const createParams = writeParams({ commandId: "command-create", origin, goal: "Assess a launch proposal" });
    const created = await service.createPlan(createParams);
    const runId = String(created.runId);
    const replayedCreate = await service.createPlan(createParams);
    assert.equal(replayedCreate.runId, runId);
    assert.equal(replayedCreate.replayed, true);
    assert.equal(runtime.runs.length, 1);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const awaitingApproval = database.getRunSummary(runId);
    assert.ok(awaitingApproval.currentPlanRevisionId);

    assert.throws(
      () => service.archiveRun(writeParams({
        commandId: "command-archive-active",
        runId,
        expectedRunRevision: awaitingApproval.revision,
      }), true),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_TRANSITION",
    );

    assert.throws(
      () => service.approvePlan(
        writeParams({
          commandId: "command-approve-incomplete",
          runId,
          planRevisionId: awaitingApproval.currentPlanRevisionId,
          expectedRunRevision: awaitingApproval.revision,
          assignments: { research: "worker" },
        }),
      ),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "INVALID_REQUEST"
        && /Every work item/.test(error.message),
    );

    service.approvePlan(
      writeParams({
        commandId: "command-approve",
        runId,
        planRevisionId: awaitingApproval.currentPlanRevisionId,
        expectedRunRevision: awaitingApproval.revision,
        assignments: { research: "worker", review: "worker" },
      }),
    );

    await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");
    const snapshot = service.getRun({ runId });
    const workItems = snapshot.workItems as Array<{ status: string }>;
    const attempts = snapshot.attempts as Array<{ kind: string; status: string }>;
    assert.deepEqual(workItems.map((item) => item.status), ["SUCCEEDED", "SUCCEEDED"]);
    assert.deepEqual(
      attempts.map((attempt) => attempt.kind).sort(),
      ["PLANNER", "SYNTHESIZER", "WORKER", "WORKER"],
    );
    assert.ok(attempts.every((attempt) => attempt.status === "SUCCEEDED"));
    const finalArtifact = snapshot.finalArtifact as { content?: string } | null;
    assert.match(finalArtifact?.content ?? "", /Recommendation: proceed/);
    assert.equal(runtime.flowCreates, 1);
    assert.equal(runtime.transcript.length, 1);
    assert.match(runtime.transcript[0]?.text ?? "", /Recommendation: proceed/);
    assert.ok(runtime.changedEvents > 0);

    const exportCommand = service.createExport(writeParams({
      commandId: "command-export",
      runId,
      expectedRunRevision: database.getRunSummary(runId).revision,
      format: "json",
    }));
    const exportJobId = String(exportCommand.exportJobId);
    await waitUntil(() => service.exportGet({ jobId: exportJobId }).status === "COMPLETED");
    const exported = service.exportDownload({ jobId: exportJobId });
    const exportDocument = JSON.parse(String(exported.content)) as Record<string, unknown>;
    assert.equal((exportDocument.run as { id?: string }).id, runId);
    assert.ok(Array.isArray(exportDocument.planRevisions) && exportDocument.planRevisions.length >= 1);
    assert.ok(Array.isArray(exportDocument.commands) && exportDocument.commands.length >= 1);
    assert.ok(Array.isArray(exportDocument.deliveryAttempts) && exportDocument.deliveryAttempts.length >= 1);
    assert.equal((exportDocument.capabilitySnapshot as Record<string, unknown>).capturedAt !== undefined, true);
    assert.ok((exportDocument.commands as Array<Record<string, unknown>>).every((command) => !("payload" in command)));
    assert.equal(path.isAbsolute(String(service.exportGet({ jobId: exportJobId }).artifact_path)), false);

    const deletionPreview = service.deletePreview({ runId });
    const deletionParams = writeParams({
      commandId: "command-delete",
      runId,
      expectedRunRevision: deletionPreview.runRevision,
      expiresAt: deletionPreview.expiresAt,
      confirmationToken: deletionPreview.confirmationToken,
    });
    const deletionCommand = service.deleteRun(deletionParams);
    const deletionJobId = String(deletionCommand.deletionJobId);
    await waitUntil(() => service.deleteJobGet({ jobId: deletionJobId }).status === "COMPLETED");
    assert.throws(
      () => database.getRunSummary(runId),
      (error: unknown) => error instanceof CollaborationError && error.code === "NOT_FOUND",
    );
    const tombstone = database.db
      .prepare("SELECT content_digest FROM tombstones WHERE run_id = ?")
      .get(runId) as { content_digest?: string } | undefined;
    assert.equal(tombstone?.content_digest, deletionPreview.digest);
    const replayedDelete = service.deleteRun(deletionParams);
    assert.equal(replayedDelete.replayed, true);
    assert.equal(replayedDelete.deletionJobId, deletionJobId);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Gateway restart confirms a response-lost terminal Flow update without applying it twice", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-flow-sync-restart-"));
  const databasePath = path.join(directory, "collaboration.sqlite");
  const config = {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  };
  const logger = { info() {}, warn() {}, error() {} };
  const firstRuntime = new FakeRuntime();
  firstRuntime.flowUpdateFailuresAfterWrite = 1;
  const firstDatabase = new CollaborationDatabase(databasePath);
  const firstService = new CollaborationService(firstDatabase, firstRuntime, config, directory, logger);
  let runId = "";
  let terminalRevision = 0;
  firstService.start();
  try {
    ({ runId } = await startCollaborationUntilDelivery(firstService, firstDatabase, {
      runtimeId: "runtime-flow-sync",
      agentId: "main",
      sessionKey: "agent:main:flow-sync",
      sessionId: "session-flow-sync",
      nativeMessageId: "message-flow-sync",
    }, "flow-sync", "DELIVERED"));
    await waitUntil(() => {
      const command = firstDatabase.db
        .prepare("SELECT status FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'")
        .get(runId) as { status?: string } | undefined;
      return command?.status === "PENDING" && firstRuntime.flowStatus === "succeeded";
    });
    terminalRevision = firstDatabase.getRunSummary(runId).revision;
    assert.equal(firstRuntime.flowUpdateCalls, 1);
    assert.equal(firstRuntime.flowRevision, 2);
    assert.equal(firstDatabase.getRunRow(runId).openclaw_flow_revision, 1);
  } finally {
    await firstService.stop();
    firstDatabase.close();
  }

  const restartedRuntime = restartFakeRuntime(firstRuntime);
  const secondDatabase = new CollaborationDatabase(databasePath);
  const secondService = new CollaborationService(secondDatabase, restartedRuntime, config, directory, logger);
  secondService.start();
  try {
    await waitUntil(() => {
      const command = secondDatabase.db
        .prepare("SELECT status FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'")
        .get(runId) as { status?: string } | undefined;
      return command?.status === "SUCCEEDED";
    });
    assert.equal(restartedRuntime.flowUpdateCalls, 0);
    assert.equal(secondDatabase.getRunRow(runId).openclaw_flow_revision, 2);
    assert.equal(secondDatabase.getRunSummary(runId).revision, terminalRevision);
  } finally {
    await secondService.stop();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed terminal Flow mirror exposes RECONCILE and retries the same effect to completion", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-flow-sync-operator-retry-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const originalUpdateManagedFlow = runtime.updateManagedFlow.bind(runtime);
  let rejectFlowUpdates = true;
  runtime.updateManagedFlow = (async (
    ...args: Parameters<RuntimeAdapter["updateManagedFlow"]>
  ) => {
    if (rejectFlowUpdates) {
      runtime.flowUpdateCalls += 1;
      throw new Error("managed Flow transport is unavailable");
    }
    return originalUpdateManagedFlow(...args);
  }) as RuntimeAdapter["updateManagedFlow"];
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const { runId } = await startCollaborationUntilDelivery(service, database, {
      runtimeId: "runtime-flow-sync-operator",
      agentId: "main",
      sessionKey: "agent:main:flow-sync-operator",
      sessionId: "session-flow-sync-operator",
      nativeMessageId: "message-flow-sync-operator",
    }, "flow-sync-operator", "DELIVERED");
    const readFlowCommand = () => database.db
      .prepare(
        "SELECT id, status, attempts, failure_count, effect_key FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC' ORDER BY created_at DESC LIMIT 1",
      )
      .get(runId) as {
        id: string;
        status: string;
        attempts: number;
        failure_count: number;
        effect_key: string;
      } | undefined;
    await waitUntil(() => {
      const command = readFlowCommand();
      return command?.status === "PENDING" || command?.status === "FAILED";
    });
    const original = readFlowCommand()!;

    while (readFlowCommand()!.status !== "FAILED") {
      const before = readFlowCommand()!;
      database.db.prepare("UPDATE commands SET available_at = 0 WHERE id = ?").run(before.id);
      await (service as unknown as { drainCommands(): Promise<void> }).drainCommands();
      await waitUntil(() => {
        const current = readFlowCommand()!;
        return current.status === "FAILED" || Number(current.failure_count) > Number(before.failure_count);
      });
    }

    const failed = readFlowCommand()!;
    assert.equal(failed.id, original.id);
    assert.equal(failed.effect_key, original.effect_key);
    assert.equal(Number(failed.attempts), 5);
    assert.equal(Number(failed.failure_count), 5);
    assert.equal(database.getRunSummary(runId).reconcileState, "ATTENTION_REQUIRED");
    const failedActions = ((service.getRun({ runId }).run as Record<string, unknown>).allowedActions as string[]);
    assert.ok(failedActions.includes("RECONCILE"));

    rejectFlowUpdates = false;
    const terminalRun = database.getRunSummary(runId);
    service.reconcileRun(writeParams({
      commandId: "flow-sync-operator-reconcile",
      runId,
      expectedRunRevision: terminalRun.revision,
    }));
    await (service as unknown as { drainCommands(): Promise<void> }).drainCommands();
    await waitUntil(() => readFlowCommand()!.status === "SUCCEEDED");

    const recovered = readFlowCommand()!;
    assert.equal(recovered.id, original.id);
    assert.equal(recovered.effect_key, original.effect_key);
    assert.equal(Number(recovered.attempts), 6);
    assert.equal(Number(recovered.failure_count), 0);
    assert.equal(database.getRunSummary(runId).reconcileState, "IDLE");
    assert.equal(runtime.flowStatus, "succeeded");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'").get(runId)?.value),
      1,
    );
    const recoveredActions = ((service.getRun({ runId }).run as Record<string, unknown>).allowedActions as string[]);
    assert.equal(recoveredActions.includes("RECONCILE"), false);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("terminal FLOW_SYNC recovery uses failure budget instead of lease generations", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-flow-sync-recovery-budget-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  try {
    database.createRun({
      id: "flow-sync-recovery-run",
      origin: {
        runtimeId: "runtime-flow-sync-recovery",
        agentId: "main",
        sessionKey: "agent:main:flow-sync-recovery",
        sessionId: "session-flow-sync-recovery",
        nativeMessageId: "message-flow-sync-recovery",
      },
      goal: "recover terminal mirror",
      capabilitySnapshot: {},
    });
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'COMPLETED' WHERE id = 'flow-sync-recovery-run'")
      .run();
    database.insertCommand({
      id: "flow-sync-recovery-command",
      runId: "flow-sync-recovery-run",
      kind: "FLOW_SYNC",
      payloadHash: "flow-sync-recovery-payload",
      payload: { terminal: "finished" },
      effectKey: "flow-sync-recovery-effect",
    });
    database.db
      .prepare(
        `UPDATE commands SET status = 'UNKNOWN', attempts = 99, failure_count = 0,
         available_at = 999999 WHERE id = 'flow-sync-recovery-command'`,
      )
      .run();

    (service as unknown as { reconcileTerminalLocalCommands(): void }).reconcileTerminalLocalCommands();
    const retryable = database.getCommand("flow-sync-recovery-command");
    assert.equal(retryable.status, "PENDING");
    assert.equal(retryable.attempts, 99);
    assert.equal(retryable.failureCount, 0);

    database.db
      .prepare(
        `UPDATE commands SET status = 'UNKNOWN', failure_count = 5,
         lease_owner = NULL, lease_expires_at = NULL WHERE id = 'flow-sync-recovery-command'`,
      )
      .run();
    (service as unknown as { reconcileTerminalLocalCommands(): void }).reconcileTerminalLocalCommands();
    const exhausted = database.getCommand("flow-sync-recovery-command");
    assert.equal(exhausted.status, "FAILED");
    assert.equal(exhausted.attempts, 99);
    assert.equal(exhausted.failureCount, 5);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("clone validates the original request once and records its source run", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-clone-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
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
  const origin: OriginRef = {
    runtimeId: "runtime-clone",
    agentId: "main",
    sessionKey: "agent:main:clone",
    sessionId: "session-clone",
    nativeMessageId: "message-clone",
  };
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "clone-source-create",
      origin,
      goal: "Assess the source proposal",
    }));
    const sourceRunId = String(created.runId);
    await waitUntil(() => database.getRunSummary(sourceRunId).status === "AWAITING_APPROVAL");
    const awaitingApproval = database.getRunSummary(sourceRunId);
    service.cancelRun(writeParams({
      commandId: "clone-source-cancel",
      runId: sourceRunId,
      expectedRunRevision: awaitingApproval.revision,
    }));
    await waitUntil(() => database.getRunSummary(sourceRunId).status === "CANCELLED");
    const source = database.getRunSummary(sourceRunId);

    const cloneParams = writeParams({
      commandId: "clone-command",
      runId: sourceRunId,
      expectedRunRevision: source.revision,
    });
    const cloneResponses = await Promise.all([
      service.cloneRun(cloneParams),
      service.cloneRun(cloneParams),
    ]);
    const cloned = cloneResponses.find((response) => response.replayed !== true)!;
    const concurrentlyReplayed = cloneResponses.find((response) => response.replayed === true)!;
    assert.ok(cloned);
    assert.ok(concurrentlyReplayed);
    const clonedRunId = String(cloned.runId);
    assert.notEqual(clonedRunId, sourceRunId);
    assert.equal(cloned.sourceRunId, sourceRunId);
    assert.equal(concurrentlyReplayed.runId, clonedRunId);
    assert.equal(concurrentlyReplayed.replayed, true);
    assert.equal(database.getRunSummary(clonedRunId).goal, source.goal);
    assert.deepEqual(database.getRunSummary(clonedRunId).origin, source.origin);
    assert.equal(database.getCommandReceipt("clone-command")?.source, "junqi.collab.run.clone");
    assert.ok(database.listEvents(clonedRunId, 0, 100).some(
      (event) => event.eventType === "RUN_CLONED" && event.payload.sourceRunId === sourceRunId,
    ));

    const replayed = await service.cloneRun(cloneParams);
    assert.equal(replayed.runId, clonedRunId);
    assert.equal(replayed.sourceRunId, sourceRunId);
    assert.equal(replayed.replayed, true);
    await assert.rejects(
      service.createPlan(cloneParams),
      (error: unknown) => error instanceof CollaborationError && error.code === "IDEMPOTENCY_CONFLICT",
    );
    await waitUntil(() => database.getRunSummary(clonedRunId).status === "AWAITING_APPROVAL");
    assert.equal(runtime.runs.length, 2);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("workflow templates preserve a completed OpenClaw-backed DAG and require fresh approval before provisioning", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-workflow-template-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  const sourceOrigin: OriginRef = {
    runtimeId: "runtime-template-source",
    agentId: "main",
    sessionKey: "agent:main:template-source",
    sessionId: "session-template-source",
    nativeMessageId: "message-template-source",
  };
  const targetOrigin: OriginRef = {
    runtimeId: "runtime-template-target",
    agentId: "main",
    sessionKey: "agent:main:template-target",
    sessionId: "session-template-target",
    nativeMessageId: "message-template-target",
  };
  service.start();
  try {
    const { runId: sourceRunId } = await startCollaborationUntilDelivery(
      service,
      database,
      sourceOrigin,
      "template-source",
      "DELIVERED",
    );
    await waitUntil(() => database.getRunSummary(sourceRunId).status === "COMPLETED");
    const source = database.getRunSummary(sourceRunId);

    const createParams = writeParams({
      commandId: "template-create",
      runId: sourceRunId,
      expectedRunRevision: source.revision,
      name: "Launch assessment",
    });
    const created = service.createWorkflowTemplateFromRun(createParams);
    const createdReplay = service.createWorkflowTemplateFromRun(createParams);
    assert.equal(created.templateName, "Launch assessment");
    assert.equal(createdReplay.replayed, true);
    assert.equal(database.getCommandReceipt("template-create")?.source, "junqi.collab.workflow.template.createFromRun");
    assert.ok(database.listEvents(sourceRunId, 0, 100).some(
      (event) => event.eventType === "WORKFLOW_TEMPLATE_CREATED",
    ));

    const templateId = String(created.templateId);
    const listed = service.listWorkflowTemplates({});
    const templates = listed.templates as Array<Record<string, unknown>>;
    assert.equal(templates.length, 1);
    const currentVersion = templates[0]!.currentVersion as Record<string, unknown>;
    const definition = currentVersion.definition as Record<string, unknown>;
    const templateItems = definition.workItems as Array<Record<string, unknown>>;
    assert.equal("candidateAgentIds" in templateItems[0]!, false);
    assert.equal("candidateAgentIds" in templateItems[1]!, false);

    const flowCreatesBeforeInstantiation = runtime.flowCreates;
    const agentCallsBeforeInstantiation = runtime.runAgentCalls;
    const instantiated = await service.instantiateWorkflowTemplate(writeParams({
      commandId: "template-instantiate",
      templateId,
      origin: targetOrigin,
      goal: "Assess the revised launch proposal",
      parameters: { region: "APAC" },
    }));
    const instantiatedRunId = String(instantiated.runId);
    const awaitingApproval = database.getRunSummary(instantiatedRunId);
    assert.equal(awaitingApproval.status, "AWAITING_APPROVAL");
    assert.equal(runtime.flowCreates, flowCreatesBeforeInstantiation);
    assert.equal(runtime.runAgentCalls, agentCallsBeforeInstantiation);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS count FROM attempts WHERE run_id = ? AND kind = 'PLANNER'").get(instantiatedRunId)?.count),
      0,
    );
    assert.equal(database.getCommandReceipt("template-instantiate")?.source, "junqi.collab.workflow.template.instantiate");

    const snapshot = service.getRun({ runId: instantiatedRunId });
    const workflowTemplate = snapshot.workflowTemplate as Record<string, unknown>;
    assert.equal(workflowTemplate.templateId, templateId);
    assert.equal(workflowTemplate.templateName, "Launch assessment");
    const workItems = snapshot.workItems as Array<Record<string, unknown>>;
    assert.deepEqual(workItems.map((item) => item.candidateAgentIds), [
      ["coordinator", "worker"],
      ["coordinator", "worker"],
    ]);
    assert.ok((snapshot.decisions as Array<Record<string, unknown>>).some(
      (decision) => decision.decisionType === "WORKFLOW_TEMPLATE_INSTANTIATED",
    ));

    runtime.waitMode = "timeout";
    service.approvePlan(writeParams({
      commandId: "template-instantiate-approve",
      runId: instantiatedRunId,
      planRevisionId: awaitingApproval.currentPlanRevisionId,
      expectedRunRevision: awaitingApproval.revision,
      assignments: { research: "worker", review: "worker" },
    }));
    await waitUntil(() => runtime.flowCreates === flowCreatesBeforeInstantiation + 1);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cancelling a running collaboration confirms every active OpenClaw task before terminal state", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-cancel-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
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
  const origin: OriginRef = {
    runtimeId: "runtime-1",
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "session-cancel",
    nativeMessageId: "native-message-cancel",
  };
  service.start();
  try {
    const created = await service.createPlan(
      writeParams({ commandId: "cancel-create", origin, goal: "Assess a launch proposal" }),
    );
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const planned = database.getRunSummary(runId);
    runtime.waitMode = "timeout";
    service.approvePlan(writeParams({
      commandId: "cancel-approve",
      runId,
      planRevisionId: planned.currentPlanRevisionId,
      expectedRunRevision: planned.revision,
      assignments: { research: "worker", review: "worker" },
    }));
    await waitUntil(() => {
      const snapshot = service.getRun({ runId });
      return (snapshot.attempts as Array<{ kind: string; status: string }>).some(
        (attempt) => attempt.kind === "WORKER" && attempt.status === "RUNNING",
      );
    });
    const beforeCancel = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "cancel-run",
      runId,
      expectedRunRevision: beforeCancel.revision,
    }));
    await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");
    const snapshot = service.getRun({ runId });
    const activeAttempts = (snapshot.attempts as Array<{ status: string }>).filter(
      (attempt) => ["CREATED", "DISPATCHING", "RUNNING", "CANCELLING", "UNKNOWN"].includes(attempt.status),
    );
    assert.equal(activeAttempts.length, 0);
    assert.equal(runtime.cancelledRunIds.length, 1);
    assert.match(runtime.cancelledRunIds[0] ?? "", /^openclaw-/);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("work-item input and cancellation are revision-bound, traceable, and use real OpenClaw cancellation", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-work-item-control-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
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
  const origin: OriginRef = {
    runtimeId: "runtime-work-item-control",
    agentId: "main",
    sessionKey: "agent:main:work-item-control",
    sessionId: "session-work-item-control",
    nativeMessageId: "native-message-work-item-control",
  };
  service.start();
  try {
    const runId = await startRunningCollaboration(service, database, runtime, origin, "work-item-control");
    const runningSnapshot = service.getRun({ runId });
    const runningItems = runningSnapshot.workItems as Array<{
      id: string;
      logicalId: string;
      status: string;
      revision: number;
    }>;
    const research = runningItems.find((item) => item.logicalId === "research")!;
    const review = runningItems.find((item) => item.logicalId === "review")!;
    const allowedActions = (runningSnapshot.run as { allowedActions: string[] }).allowedActions;
    assert.ok(allowedActions.includes("WORK_ITEM_INPUT_APPEND"));
    assert.ok(allowedActions.includes("WORK_ITEM_CANCEL"));

    assert.throws(
      () => service.appendWorkItemInput(writeParams({
        commandId: "work-item-input-active",
        workItemId: research.id,
        expectedRunRevision: database.getRunSummary(runId).revision,
        expectedEntityRevision: research.revision,
        content: "This must not leak into the active attempt",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "ACTIVE_ATTEMPT_EXISTS",
    );
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM work_item_inputs WHERE work_item_id = ?").get(research.id)?.value),
      0,
    );

    const runBeforeCancel = database.getRunSummary(runId);
    const cancelResponse = service.cancelWorkItem(writeParams({
      commandId: "work-item-cancel-active",
      workItemId: research.id,
      expectedRunRevision: runBeforeCancel.revision,
      expectedEntityRevision: research.revision,
    }));
    assert.equal(cancelResponse.status, "CANCELLING");
    assert.equal(database.getRunSummary(runId).status, "AWAITING_INTERVENTION");
    assert.equal(database.getRunSummary(runId).dispatchState, "STOPPED");
    assert.equal(
      Number(database.db.prepare(
        "SELECT COUNT(*) AS value FROM interventions WHERE run_id = ? AND code = 'WORK_ITEM_CANCEL_REQUESTED' AND entity_id = ?",
      ).get(runId, research.id)?.value),
      1,
    );
    await waitUntil(() => {
      const item = database.db.prepare("SELECT status FROM work_items WHERE id = ?").get(research.id) as { status: string };
      return item.status === "CANCELLED";
    });
    assert.equal(runtime.cancelledRunIds.length, 1);
    assert.match(runtime.cancelledRunIds[0] ?? "", /^openclaw-/);

    const beforeDirectCancel = database.getRunSummary(runId);
    const currentReview = database.db
      .prepare("SELECT status, revision FROM work_items WHERE id = ?")
      .get(review.id) as { status: string; revision: number };
    assert.equal(currentReview.status, "BLOCKED");
    const directCancel = service.cancelWorkItem(writeParams({
      commandId: "work-item-cancel-blocked",
      workItemId: review.id,
      expectedRunRevision: beforeDirectCancel.revision,
      expectedEntityRevision: Number(currentReview.revision),
    }));
    assert.equal(directCancel.status, "CANCELLED");
    assert.equal(runtime.cancelledRunIds.length, 1);

    const cancelledReview = database.db
      .prepare("SELECT status, revision FROM work_items WHERE id = ?")
      .get(review.id) as { status: string; revision: number };
    assert.throws(
      () => service.cancelWorkItem(writeParams({
        commandId: "work-item-cancel-terminal",
        workItemId: review.id,
        expectedRunRevision: database.getRunSummary(runId).revision,
        expectedEntityRevision: Number(cancelledReview.revision),
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_TRANSITION",
    );

    const cancelledResearch = database.db
      .prepare("SELECT revision FROM work_items WHERE id = ?")
      .get(research.id) as { revision: number };
    assert.throws(
      () => service.appendWorkItemInput(writeParams({
        commandId: "work-item-input-missing-revision",
        workItemId: research.id,
        expectedRunRevision: database.getRunSummary(runId).revision,
        content: "missing revision",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
    );
    const firstInputResponse = service.appendWorkItemInput(writeParams({
      commandId: "work-item-input-first",
      workItemId: research.id,
      expectedRunRevision: database.getRunSummary(runId).revision,
      expectedEntityRevision: Number(cancelledResearch.revision),
      content: "FIRST_NEXT_ATTEMPT_INPUT",
    }));
    assert.equal(firstInputResponse.appliesTo, "NEXT_ATTEMPT");
    const firstInputId = String(database.db
      .prepare("SELECT id FROM work_item_inputs WHERE command_id = ?")
      .get("work-item-input-first")?.id);

    assert.throws(
      () => service.appendWorkItemInput(writeParams({
        commandId: "work-item-input-stale",
        workItemId: research.id,
        expectedRunRevision: database.getRunSummary(runId).revision,
        expectedEntityRevision: Number(cancelledResearch.revision),
        content: "stale overwrite",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "REVISION_CONFLICT",
    );
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM work_item_inputs WHERE work_item_id = ?").get(research.id)?.value),
      1,
    );

    const beforeFirstRetry = database.getRunSummary(runId);
    const researchWithInput = database.db
      .prepare("SELECT revision FROM work_items WHERE id = ?")
      .get(research.id) as { revision: number };
    service.retryWorkItem(writeParams({
      commandId: "work-item-retry-first-input",
      workItemId: research.id,
      expectedRunRevision: beforeFirstRetry.revision,
      expectedEntityRevision: Number(researchWithInput.revision),
    }));
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT status FROM attempts WHERE work_item_id = ? AND attempt_no = 2")
        .get(research.id) as { status: string } | undefined;
      return attempt?.status === "RUNNING";
    });
    const secondAttempt = database.db
      .prepare("SELECT input_json FROM attempts WHERE work_item_id = ? AND attempt_no = 2")
      .get(research.id) as { input_json: string };
    assert.deepEqual(JSON.parse(secondAttempt.input_json), { additionalInputIds: [firstInputId] });
    assert.match(runtime.dispatchedMessages.at(-1) ?? "", /FIRST_NEXT_ATTEMPT_INPUT/);

    const beforeSecondCancel = database.getRunSummary(runId);
    const runningAgain = database.db
      .prepare("SELECT revision FROM work_items WHERE id = ?")
      .get(research.id) as { revision: number };
    service.cancelWorkItem(writeParams({
      commandId: "work-item-cancel-second-attempt",
      workItemId: research.id,
      expectedRunRevision: beforeSecondCancel.revision,
      expectedEntityRevision: Number(runningAgain.revision),
    }));
    await waitUntil(() => {
      const item = database.db.prepare("SELECT status FROM work_items WHERE id = ?").get(research.id) as { status: string };
      return item.status === "CANCELLED";
    });

    const beforeSecondInput = database.getRunSummary(runId);
    const researchCancelledAgain = database.db
      .prepare("SELECT revision FROM work_items WHERE id = ?")
      .get(research.id) as { revision: number };
    service.appendWorkItemInput(writeParams({
      commandId: "work-item-input-second",
      workItemId: research.id,
      expectedRunRevision: beforeSecondInput.revision,
      expectedEntityRevision: Number(researchCancelledAgain.revision),
      content: "SECOND_NEXT_ATTEMPT_INPUT",
    }));
    const secondInputId = String(database.db
      .prepare("SELECT id FROM work_item_inputs WHERE command_id = ?")
      .get("work-item-input-second")?.id);
    const beforeSecondRetry = database.getRunSummary(runId);
    const researchWithSecondInput = database.db
      .prepare("SELECT revision FROM work_items WHERE id = ?")
      .get(research.id) as { revision: number };
    service.retryWorkItem(writeParams({
      commandId: "work-item-retry-second-input",
      workItemId: research.id,
      expectedRunRevision: beforeSecondRetry.revision,
      expectedEntityRevision: Number(researchWithSecondInput.revision),
    }));
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT status FROM attempts WHERE work_item_id = ? AND attempt_no = 3")
        .get(research.id) as { status: string } | undefined;
      return attempt?.status === "RUNNING";
    });
    const thirdAttempt = database.db
      .prepare("SELECT input_json FROM attempts WHERE work_item_id = ? AND attempt_no = 3")
      .get(research.id) as { input_json: string };
    assert.deepEqual(JSON.parse(thirdAttempt.input_json), { additionalInputIds: [secondInputId] });
    assert.doesNotMatch(runtime.dispatchedMessages.at(-1) ?? "", /FIRST_NEXT_ATTEMPT_INPUT/);
    assert.match(runtime.dispatchedMessages.at(-1) ?? "", /SECOND_NEXT_ATTEMPT_INPUT/);

    const publicSnapshot = JSON.stringify(service.getRun({ runId }));
    assert.doesNotMatch(publicSnapshot, /FIRST_NEXT_ATTEMPT_INPUT|SECOND_NEXT_ATTEMPT_INPUT/);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("malformed or oversized planner output fails into a traceable intervention without dispatch", async (t) => {
  const scenarios = [
    { name: "malformed", plannerText: "{not-valid-json" },
    { name: "oversized", plannerText: "X".repeat(PERSISTENCE_LIMITS.planBytes + 1) },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), `junqi-collab-plan-${scenario.name}-`));
      const database = new CollaborationDatabase(":memory:");
      const runtime = new FakeRuntime();
      runtime.plannerText = scenario.plannerText;
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
      const origin: OriginRef = {
        runtimeId: `runtime-plan-${scenario.name}`,
        agentId: "main",
        sessionKey: "agent:main:main",
        sessionId: `session-plan-${scenario.name}`,
        nativeMessageId: `native-message-plan-${scenario.name}`,
      };
      service.start();
      try {
        const created = await service.createPlan(writeParams({
          commandId: `plan-${scenario.name}-create`,
          origin,
          goal: "Assess a launch proposal",
        }));
        const runId = String(created.runId);
        await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_INTERVENTION");
        await new Promise((resolve) => setTimeout(resolve, 30));

        const run = database.getRunSummary(runId);
        const snapshot = service.getRun({ runId });
        const plannerAttempts = snapshot.attempts as Array<{ kind: string; status: string; lastError: string | null }>;
        const interventions = snapshot.interventions as Array<{ code: string; resolvedAt: number | null }>;
        assert.equal(run.status, "AWAITING_INTERVENTION");
        assert.equal(run.dispatchState, "STOPPED");
        assert.equal(run.currentPlanRevisionId, null);
        assert.deepEqual(
          plannerAttempts.map((attempt) => ({ kind: attempt.kind, status: attempt.status })),
          [{ kind: "PLANNER", status: "FAILED" }],
        );
        assert.match(plannerAttempts[0]?.lastError ?? "", scenario.name === "oversized" ? /persistence limit/ : /JSON/);
        assert.ok(interventions.some((entry) => entry.code === "PLAN_INVALID" && entry.resolvedAt == null));
        assert.equal(runtime.runAgentCalls, 1);
        assert.equal(runtime.runs.length, 1);
        assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM plan_revisions WHERE run_id = ?").get(runId)?.value), 0);
        assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM work_items WHERE run_id = ?").get(runId)?.value), 0);
        assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'DISPATCH'").get(runId)?.value), 0);
        assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM collaboration_events WHERE run_id = ? AND event_type = 'PLAN_READY'").get(runId)?.value), 0);
      } finally {
        await service.stop();
        database.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

test("unconfirmed or throwing cancellation never marks the run cancelled", async (t) => {
  const scenarios = [
    { mode: "unconfirmed" as const, expectedRunStatus: "CANCELLING", interventionCode: "CANCEL_UNCONFIRMED" },
    { mode: "throw" as const, expectedRunStatus: "CANCELLING", interventionCode: "CANCEL_UNCONFIRMED" },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.mode, async () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), `junqi-collab-cancel-${scenario.mode}-`));
      const database = new CollaborationDatabase(":memory:");
      const runtime = new FakeRuntime();
      runtime.cancelMode = scenario.mode;
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
      const origin: OriginRef = {
        runtimeId: `runtime-cancel-${scenario.mode}`,
        agentId: "main",
        sessionKey: "agent:main:main",
        sessionId: `session-cancel-${scenario.mode}`,
        nativeMessageId: `native-message-cancel-${scenario.mode}`,
      };
      service.start();
      try {
        const runId = await startRunningCollaboration(
          service,
          database,
          runtime,
          origin,
          `cancel-${scenario.mode}`,
        );
        const beforeCancel = database.getRunSummary(runId);
        service.cancelRun(writeParams({
          commandId: `cancel-${scenario.mode}-request`,
          runId,
          expectedRunRevision: beforeCancel.revision,
        }));
        await waitUntil(() => {
          const intervention = database.db
            .prepare("SELECT code FROM interventions WHERE run_id = ? AND code = ? AND resolved_at IS NULL")
            .get(runId, scenario.interventionCode);
          return Boolean(intervention);
        });
        await new Promise((resolve) => setTimeout(resolve, 30));

        const run = database.getRunSummary(runId);
        const attempts = service.getRun({ runId }).attempts as Array<{ kind: string; status: string }>;
        const worker = attempts.find((attempt) => attempt.kind === "WORKER");
        assert.equal(run.status, scenario.expectedRunStatus);
        assert.notEqual(run.status, "CANCELLED");
        assert.ok(worker);
        assert.equal(worker?.status, "UNKNOWN");
        assert.equal(runtime.cancelledRunIds.length, 1);
        assert.equal(
          Number(database.db.prepare("SELECT COUNT(*) AS value FROM collaboration_events WHERE run_id = ? AND event_type = 'RUN_CANCELLED'").get(runId)?.value),
          0,
        );
        assert.equal(
          Number(database.db.prepare("SELECT COUNT(*) AS value FROM decisions WHERE run_id = ? AND decision_type = 'RUN_CANCEL_REQUESTED'").get(runId)?.value),
          1,
        );
        const cancellationCommand = database.db
          .prepare("SELECT status FROM commands WHERE run_id = ? AND kind = 'CANCEL_ATTEMPT'")
          .get(runId) as { status: string };
        assert.equal(cancellationCommand.status, "SUCCEEDED");
      } finally {
        await service.stop();
        database.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

test("unknown attempt resolution is revision-fenced and immediately closes a settled cancellation", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-resolve-unknown-terminal-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.cancelMode = "unconfirmed";
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
  const origin: OriginRef = {
    runtimeId: "runtime-resolve-unknown-terminal",
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "session-resolve-unknown-terminal",
    nativeMessageId: "native-message-resolve-unknown-terminal",
  };
  service.start();
  try {
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      origin,
      "resolve-unknown-terminal",
    );
    const beforeCancel = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "resolve-unknown-terminal-cancel",
      runId,
      expectedRunRevision: beforeCancel.revision,
    }));
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
        .get(runId) as { status: string } | undefined;
      return attempt?.status === "UNKNOWN";
    });

    const attempt = database.db
      .prepare("SELECT id, revision FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
      .get(runId) as { id: string; revision: number };
    const cancelling = database.getRunSummary(runId);
    assert.throws(
      () => service.resolveUnknownAttempt(writeParams({
        commandId: "resolve-unknown-terminal-forged-success",
        attemptId: attempt.id,
        resolution: "SUCCEEDED",
        expectedRunRevision: cancelling.revision,
        expectedEntityRevision: attempt.revision,
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
    );
    assert.throws(
      () => service.resolveUnknownAttempt(writeParams({
        commandId: "resolve-unknown-terminal-stale",
        attemptId: attempt.id,
        resolution: "CANCELLED",
        expectedRunRevision: cancelling.revision,
        expectedEntityRevision: attempt.revision - 1,
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "REVISION_CONFLICT",
    );
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attempt.id) as { status: string }).status,
      "UNKNOWN",
    );

    const resolution = writeParams({
      commandId: "resolve-unknown-terminal-confirmed",
      attemptId: attempt.id,
      resolution: "CANCELLED",
      expectedRunRevision: cancelling.revision,
      expectedEntityRevision: attempt.revision,
    });
    const response = service.resolveUnknownAttempt(resolution);
    const replay = service.resolveUnknownAttempt(resolution);
    assert.deepEqual({ ...replay, replayed: false }, response);
    assert.equal(replay.replayed, true);
    assert.equal(database.getRunSummary(runId).status, "CANCELLED");
    const snapshot = service.getRun({ runId });
    assert.equal(
      (snapshot.attempts as Array<{ id: string; status: string }>).find((entry) => entry.id === attempt.id)?.status,
      "CANCELLED",
    );
    assert.equal(
      (snapshot.workItems as Array<{ status: string }>).find((entry) => entry.status === "CANCELLED")?.status,
      "CANCELLED",
    );
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM collaboration_events WHERE run_id = ? AND event_type = 'RUN_CANCELLED'").get(runId)?.value),
      1,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("residual-risk abandonment rejects active, unaccepted, unevidenced, and actionable cancellation states without writes", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-residual-risk-rejections-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const watcher = deferred<{ status: "ok" | "error" | "timeout" }>();
  const service = createTestService(database, runtime, directory);
  const origin: OriginRef = {
    runtimeId: "runtime-residual-risk-rejections",
    agentId: "main",
    sessionKey: "agent:main:residual-risk-rejections",
    sessionId: "session-residual-risk-rejections",
    nativeMessageId: "message-residual-risk-rejections",
  };
  service.start();
  try {
    const runId = await startRunningCollaborationWithBlockedWorker(
      service,
      database,
      runtime,
      origin,
      "residual-risk-rejections",
      watcher.promise,
    );
    let attempt = database.db
      .prepare("SELECT * FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
      .get(runId) as Record<string, unknown>;
    let run = database.getRunSummary(runId);
    const projectedAbandonEligibility = (): boolean | undefined => (
      service.getRun({ runId }).attempts as Array<{
        id: string;
        canAbandonWithResidualRisk?: boolean;
      }>
    ).find((entry) => entry.id === String(attempt.id))?.canAbandonWithResidualRisk;
    assert.equal(projectedAbandonEligibility(), false);

    const assertRejectedWithoutReceipt = (
      commandId: string,
      params: Record<string, unknown>,
      code: CollaborationError["code"],
      reason: string,
    ): void => {
      const beforeAttempt = database.db
        .prepare("SELECT status, revision FROM attempts WHERE id = ?")
        .get(String(attempt.id));
      assert.throws(
        () => service.resolveUnknownAttempt(writeParams({ commandId, ...params })),
        (error: unknown) => error instanceof CollaborationError
          && error.code === code
          && error.details?.reason === reason,
      );
      assert.equal(
        Number(database.db.prepare("SELECT COUNT(*) AS value FROM command_receipts WHERE command_id = ?").get(commandId)?.value),
        0,
      );
      assert.equal(
        Number(database.db.prepare("SELECT COUNT(*) AS value FROM decisions WHERE command_id = ?").get(commandId)?.value),
        0,
      );
      assert.deepEqual(
        database.db.prepare("SELECT status, revision FROM attempts WHERE id = ?").get(String(attempt.id)),
        beforeAttempt,
      );
    };

    assertRejectedWithoutReceipt(
      "residual-risk-active-reject",
      {
        attemptId: attempt.id,
        resolution: "ABANDONED",
        acceptResidualRisk: true,
        expectedRunRevision: run.revision,
        expectedEntityRevision: attempt.revision,
      },
      "INVALID_TRANSITION",
      "RUN_NOT_CANCELLING",
    );

    const timestamp = Date.now();
    database.transaction(() => {
      database.db
        .prepare(
          `UPDATE collaboration_runs SET status = 'CANCELLING', dispatch_state = 'STOPPED',
           cancel_requested_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
        )
        .run(timestamp, timestamp, runId);
      database.db
        .prepare(
          `UPDATE attempts SET status = 'UNKNOWN', last_error = 'unconfirmed',
           revision = revision + 1, updated_at = ? WHERE id = ?`,
        )
        .run(timestamp, String(attempt.id));
      database.db
        .prepare(
          `UPDATE work_items SET status = 'CANCELLING', revision = revision + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(timestamp, String(attempt.work_item_id));
    });
    attempt = database.db.prepare("SELECT * FROM attempts WHERE id = ?").get(String(attempt.id)) as Record<string, unknown>;
    run = database.getRunSummary(runId);
    assert.equal(projectedAbandonEligibility(), false);

    assertRejectedWithoutReceipt(
      "residual-risk-unaccepted-reject",
      {
        attemptId: attempt.id,
        resolution: "ABANDONED",
        acceptResidualRisk: false,
        expectedRunRevision: run.revision,
        expectedEntityRevision: attempt.revision,
      },
      "INVALID_REQUEST",
      "RESIDUAL_RISK_NOT_ACCEPTED",
    );
    assertRejectedWithoutReceipt(
      "residual-risk-no-evidence-reject",
      {
        attemptId: attempt.id,
        resolution: "ABANDONED",
        acceptResidualRisk: true,
        expectedRunRevision: run.revision,
        expectedEntityRevision: attempt.revision,
      },
      "INVALID_TRANSITION",
      "NO_DURABLE_CANCELLATION_OR_RECONCILIATION_EVIDENCE",
    );

    database.insertCommand({
      id: "residual-risk-actionable-cancel",
      runId,
      kind: "CANCEL_ATTEMPT",
      entityId: String(attempt.id),
      payloadHash: "residual-risk-actionable-cancel-payload",
      payload: { attemptId: attempt.id },
      effectKey: `collab:${runId}:cancel:${String(attempt.id)}:actionable-test`,
    });
    assertRejectedWithoutReceipt(
      "residual-risk-actionable-reject",
      {
        attemptId: attempt.id,
        resolution: "ABANDONED",
        acceptResidualRisk: true,
        expectedRunRevision: run.revision,
        expectedEntityRevision: attempt.revision,
      },
      "INVALID_TRANSITION",
      "CANCELLATION_STILL_ACTIONABLE",
    );
    assert.equal(projectedAbandonEligibility(), false);
  } finally {
    watcher.resolve({ status: "timeout" });
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cancellation settlement advances the projection watermark when residual-risk authorization changes", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-cancel-projection-watermark-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  let recoveryService: CollaborationService | undefined;
  service.start();
  try {
    const runId = await startRunningCollaboration(service, database, runtime, {
      runtimeId: "runtime-cancel-projection-watermark",
      agentId: "main",
      sessionKey: "agent:main:cancel-projection-watermark",
      sessionId: "session-cancel-projection-watermark",
      nativeMessageId: "message-cancel-projection-watermark",
    }, "cancel-projection-watermark");
    await service.stop();

    const timestamp = Date.now();
    const attempt = database.db
      .prepare("SELECT * FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
      .get(runId) as Record<string, unknown>;
    database.db
      .prepare(
        `UPDATE attempts SET status = 'UNKNOWN', openclaw_run_id = NULL, openclaw_task_id = NULL,
         last_reconciled_at = ?, last_error = 'dispatch identity unavailable', revision = revision + 1,
         updated_at = ? WHERE id = ?`,
      )
      .run(timestamp, timestamp, String(attempt.id));

    const beforeCancel = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "cancel-projection-watermark-run",
      runId,
      expectedRunRevision: beforeCancel.revision,
    }));
    const beforeSettlement = database.getRunSummary(runId);
    const beforeSequence = database.getLastSequence(runId);
    assert.equal(
      (
        service.getRun({ runId }).attempts as Array<{
          id: string;
          canAbandonWithResidualRisk?: boolean;
        }>
      ).find((entry) => entry.id === String(attempt.id))?.canAbandonWithResidualRisk,
      false,
    );

    recoveryService = createTestService(database, runtime, directory);
    const workerId = (recoveryService as unknown as { workerId: string }).workerId;
    const cancellation = database.claimCommands(workerId, 8, 30_000)
      .find((command) => command.kind === "CANCEL_ATTEMPT" && command.entityId === String(attempt.id));
    assert.ok(cancellation);
    await (recoveryService as unknown as {
      executeCommand(command: CommandRecord): Promise<void>;
    }).executeCommand(cancellation);

    const afterSettlement = database.getRunSummary(runId);
    assert.ok(afterSettlement.revision > beforeSettlement.revision);
    assert.ok(database.getLastSequence(runId) > beforeSequence);
    assert.equal(
      (
        recoveryService.getRun({ runId }).attempts as Array<{
          id: string;
          canAbandonWithResidualRisk?: boolean;
        }>
      ).find((entry) => entry.id === String(attempt.id))?.canAbandonWithResidualRisk,
      true,
    );
    const event = database.db
      .prepare(
        `SELECT payload_json FROM collaboration_events
         WHERE run_id = ? AND event_type = 'ATTEMPT_CANCELLATION_COMMAND_SETTLED'
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(runId) as { payload_json: string };
    assert.equal(JSON.parse(event.payload_json).canAbandonWithResidualRisk, true);
  } finally {
    await recoveryService?.stop();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepted residual execution risk is durable, non-resumable, and audit-retained", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-residual-risk-accepted-"));
  const databasePath = path.join(directory, "collaboration.sqlite");
  let database = new CollaborationDatabase(databasePath);
  const runtime = new FakeRuntime();
  const watcher = deferred<{ status: "ok" | "error" | "timeout" }>();
  runtime.cancelMode = "unconfirmed";
  let service = createTestService(database, runtime, directory);
  const origin: OriginRef = {
    runtimeId: "runtime-residual-risk-accepted",
    agentId: "main",
    sessionKey: "agent:main:residual-risk-accepted",
    sessionId: "session-residual-risk-accepted",
    nativeMessageId: "message-residual-risk-accepted",
  };
  service.start();
  try {
    const runId = await startRunningCollaborationWithBlockedWorker(
      service,
      database,
      runtime,
      origin,
      "residual-risk-accepted",
      watcher.promise,
    );
    const beforeCancel = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "residual-risk-accepted-cancel",
      runId,
      expectedRunRevision: beforeCancel.revision,
    }));
    await waitUntil(() => {
      const row = database.db
        .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
        .get(runId) as { status?: string } | undefined;
      return row?.status === "UNKNOWN";
    });

    const attempt = database.db
      .prepare("SELECT * FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
      .get(runId) as Record<string, unknown>;
    const cancellation = database.db
      .prepare(
        `SELECT id, status, attempts, effect_started_at FROM commands
         WHERE run_id = ? AND entity_id = ? AND kind = 'CANCEL_ATTEMPT'
         ORDER BY created_at LIMIT 1`,
      )
      .get(runId, String(attempt.id)) as Record<string, unknown>;
    assert.equal(cancellation.status, "SUCCEEDED");
    assert.ok(Number(cancellation.attempts) > 0);
    assert.ok(Number.isSafeInteger(cancellation.effect_started_at));

    const cancelling = database.getRunSummary(runId);
    assert.equal(
      (
        service.getRun({ runId }).attempts as Array<{
          id: string;
          canAbandonWithResidualRisk?: boolean;
        }>
      ).find((entry) => entry.id === String(attempt.id))?.canAbandonWithResidualRisk,
      true,
    );
    const resolution = writeParams({
      commandId: "residual-risk-accepted-resolution",
      attemptId: attempt.id,
      resolution: "ABANDONED",
      acceptResidualRisk: true,
      expectedRunRevision: cancelling.revision,
      expectedEntityRevision: attempt.revision,
    });
    const response = service.resolveUnknownAttempt(resolution);
    const replay = service.resolveUnknownAttempt(resolution);
    assert.deepEqual({ ...replay, replayed: false }, response);
    assert.equal(replay.replayed, true);

    await waitUntil(() => runtime.flowStatus === "cancelled");
    let terminal = database.getRunSummary(runId);
    assert.equal(terminal.status, "CANCELLED");
    assert.equal(terminal.reconcileState, "ATTENTION_REQUIRED");
    assert.deepEqual(
      (service.getRun({ runId }).run as { allowedActions: string[] }).allowedActions,
      ["EXPORT", "ARCHIVE"],
    );
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(String(attempt.id)) as { status: string }).status,
      "ABANDONED",
    );
    assert.equal(
      (database.db.prepare("SELECT status FROM work_items WHERE id = ?").get(String(attempt.work_item_id)) as { status: string }).status,
      "CANCELLED",
    );

    const riskIntervention = database.db
      .prepare(
        `SELECT * FROM interventions WHERE run_id = ?
         AND code = 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK' AND resolved_at IS NULL`,
      )
      .get(runId) as Record<string, unknown>;
    const diagnostics = JSON.parse(String(riskIntervention.diagnostics_json)) as Record<string, unknown>;
    assert.equal(diagnostics.acceptedResidualRisk, true);
    assert.equal(diagnostics.attemptId, attempt.id);
    assert.equal(diagnostics.attemptKind, "WORKER");
    assert.equal(diagnostics.openclawRunId, attempt.openclaw_run_id);
    assert.equal(diagnostics.openclawTaskId, attempt.openclaw_task_id);
    assert.equal(diagnostics.ownerSessionKey, attempt.worker_owner_session_key);
    assert.equal(diagnostics.childSessionKey, attempt.child_session_key);
    assert.equal(
      diagnostics.terminationSemantics,
      "LOCAL_ORCHESTRATION_STOPPED_REMOTE_TASK_TERMINATION_UNCONFIRMED",
    );
    assert.equal("prompt" in diagnostics, false);
    assert.ok(Number.isSafeInteger(diagnostics.acceptedAt));
    assert.equal(diagnostics.actor, "operator");
    assert.equal(
      Number(database.db.prepare(
        `SELECT COUNT(*) AS value FROM interventions WHERE run_id = ? AND entity_id = ?
         AND code <> 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK' AND resolved_at IS NULL`,
      ).get(runId, String(attempt.id))?.value),
      0,
    );

    for (const table of ["decisions", "collaboration_events"] as const) {
      const column = table === "decisions" ? "payload_json" : "payload_json";
      const row = database.db
        .prepare(
          table === "decisions"
            ? "SELECT payload_json FROM decisions WHERE command_id = ? AND decision_type = 'ATTEMPT_UNKNOWN_RESOLVED'"
            : "SELECT payload_json FROM collaboration_events WHERE run_id = ? AND event_type = 'ATTEMPT_UNKNOWN_RESOLVED' ORDER BY sequence DESC LIMIT 1",
        )
        .get(table === "decisions" ? resolution.commandId : runId) as Record<string, unknown>;
      const payload = JSON.parse(String(row[column])) as Record<string, unknown>;
      assert.equal(payload.acceptedResidualRisk, true);
      assert.equal(payload.attemptId, attempt.id);
      assert.equal(payload.openclawRunId, attempt.openclaw_run_id);
    }

    const evidenceBeforeLateResult = Number(database.db
      .prepare("SELECT COUNT(*) AS value FROM evidence WHERE run_id = ?")
      .get(runId)?.value);
    const lateResult = JSON.stringify({
      summary: "late remote completion",
      outcome: "SUCCEEDED",
      evidence: [{
        type: "analysis",
        title: "must not persist",
        reference: "late",
        verification: "late",
      }],
      createdArtifacts: [],
      handoffNotes: [],
    });
    (service as unknown as {
      completeWorkerAttempt(attempt: Record<string, unknown>, text: string): void;
    }).completeWorkerAttempt(attempt, lateResult);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM evidence WHERE run_id = ?").get(runId)?.value),
      evidenceBeforeLateResult,
    );
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(String(attempt.id)) as { status: string }).status,
      "ABANDONED",
    );

    assert.throws(
      () => service.deletePreview({ runId }),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "INVALID_TRANSITION"
        && error.details?.reason === "OPEN_RESIDUAL_EXECUTION_RISK",
    );
    assert.throws(
      () => service.deleteRun(writeParams({
        commandId: "residual-risk-delete-reject",
        runId,
        expectedRunRevision: terminal.revision,
        expiresAt: Date.now() + 60_000,
        confirmationToken: "not-used-because-policy-blocks-first",
      })),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "INVALID_TRANSITION"
        && error.details?.reason === "OPEN_RESIDUAL_EXECUTION_RISK",
    );
    assert.equal(service.runRetentionSweep(Date.now() + 366 * 24 * 60 * 60_000), 0);
    assert.equal(database.getRunSummary(runId).id, runId);

    await assert.rejects(
      async () => service.cloneRun(writeParams({
        commandId: "residual-risk-clone-reject",
        runId,
        expectedRunRevision: database.getRunSummary(runId).revision,
      })),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "INVALID_TRANSITION"
        && error.details?.reason === "OPEN_RESIDUAL_EXECUTION_RISK",
    );

    const nextOrigin = { ...origin, nativeMessageId: "message-residual-risk-next-run" };
    const next = await service.createPlan(writeParams({
      commandId: "residual-risk-next-run-create",
      origin: nextOrigin,
      goal: "A distinct run after accepted residual risk",
    }));
    assert.notEqual(next.runId, runId);
    const nextRunId = String(next.runId);
    runtime.cancelMode = "confirmed";
    const nextRun = database.getRunSummary(nextRunId);
    service.cancelRun(writeParams({
      commandId: "residual-risk-next-run-cancel",
      runId: nextRunId,
      expectedRunRevision: nextRun.revision,
    }));
    await waitUntil(() => database.getRunSummary(nextRunId).status === "CANCELLED");

    await service.stop();
    database.close();
    const restartedRuntime = restartFakeRuntime(runtime);
    database = new CollaborationDatabase(databasePath);
    service = createTestService(database, restartedRuntime, directory);
    service.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    terminal = database.getRunSummary(runId);
    assert.equal(terminal.status, "CANCELLED");
    assert.equal(terminal.reconcileState, "ATTENTION_REQUIRED");
    assert.deepEqual(
      (service.getRun({ runId }).run as { allowedActions: string[] }).allowedActions,
      ["EXPORT", "ARCHIVE"],
    );
    assert.equal(restartedRuntime.runAgentCalls, 0);
    assert.equal(
      Number(database.db.prepare(
        `SELECT COUNT(*) AS value FROM interventions WHERE run_id = ?
         AND code = 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK' AND resolved_at IS NULL`,
      ).get(runId)?.value),
      1,
    );
    assert.equal(
      Number(database.db.prepare(
        `SELECT COUNT(*) AS value FROM collaboration_events WHERE run_id = ?
         AND event_type = 'RUN_CANCELLED'
         AND json_extract(payload_json, '$.acceptedResidualRisk') = 1`,
      ).get(runId)?.value),
      1,
    );
  } finally {
    watcher.resolve({ status: "timeout" });
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("confirming an unknown attempt is still running preserves sticky cancellation and retries it", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-resolve-unknown-running-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.cancelMode = "unconfirmed";
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
  const origin: OriginRef = {
    runtimeId: "runtime-resolve-unknown-running",
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "session-resolve-unknown-running",
    nativeMessageId: "native-message-resolve-unknown-running",
  };
  service.start();
  try {
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      origin,
      "resolve-unknown-running",
    );
    const beforeCancel = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "resolve-unknown-running-cancel",
      runId,
      expectedRunRevision: beforeCancel.revision,
    }));
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
        .get(runId) as { status: string } | undefined;
      return attempt?.status === "UNKNOWN";
    });
    const attempt = database.db
      .prepare("SELECT id, revision FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
      .get(runId) as { id: string; revision: number };
    const cancelling = database.getRunSummary(runId);
    runtime.cancelMode = "confirmed";
    service.resolveUnknownAttempt(writeParams({
      commandId: "resolve-unknown-running-confirmed",
      attemptId: attempt.id,
      resolution: "RUNNING",
      expectedRunRevision: cancelling.revision,
      expectedEntityRevision: attempt.revision,
    }));

    await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");
    assert.equal(runtime.cancelledRunIds.length, 2);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'CANCEL_ATTEMPT'").get(runId)?.value),
      2,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recovering one of multiple UNKNOWN Attempts keeps the Run and dispatch gate blocked", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-multiple-unknown-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const runId = await startRunningCollaboration(service, database, runtime, {
      runtimeId: "runtime-multiple-unknown",
      agentId: "main",
      sessionKey: "agent:main:multiple-unknown",
      sessionId: "session-multiple-unknown",
      nativeMessageId: "message-multiple-unknown",
    }, "multiple-unknown");
    const first = database.db
      .prepare("SELECT * FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
      .get(runId) as Record<string, unknown>;
    database.transaction(() => {
      const run = database.getRunSummary(runId);
      database.updateRun(runId, run.revision, {
        status: "AWAITING_INTERVENTION",
        dispatchState: "STOPPED",
        resumeStatus: "RUNNING",
        reconcileState: "ATTENTION_REQUIRED",
      });
      database.db
        .prepare(
          `UPDATE attempts SET status = 'UNKNOWN', last_error = 'first uncertain',
           revision = revision + 1, updated_at = ? WHERE id = ?`,
        )
        .run(Date.now(), String(first.id));
      if (first.work_item_id) {
        database.db
          .prepare("UPDATE work_items SET status = 'NEEDS_INTERVENTION', revision = revision + 1, updated_at = ? WHERE id = ?")
          .run(Date.now(), String(first.work_item_id));
      }
      database.db
        .prepare(
          `INSERT INTO attempts(
            id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
            worker_owner_session_key, child_session_key, status, input_json, last_error,
            revision, created_at, updated_at
          ) VALUES (?, ?, NULL, 'WORKER', 99, ?, 'worker', ?, ?, 'UNKNOWN', '{}',
            'second uncertain', 1, ?, ?)`,
        )
        .run(
          "attempt-second-unknown",
          runId,
          `collab:${runId}:second-unknown`,
          "agent:worker:main",
          `agent:worker:subagent:${runId}:second-unknown`,
          Date.now(),
          Date.now(),
        );
    });

    const firstUnknown = database.db
      .prepare("SELECT id, revision FROM attempts WHERE id = ?")
      .get(String(first.id)) as { id: string; revision: number };
    const blocked = database.getRunSummary(runId);
    service.resolveUnknownAttempt(writeParams({
      commandId: "multiple-unknown-resolve-first",
      attemptId: firstUnknown.id,
      resolution: "FAILED",
      expectedRunRevision: blocked.revision,
      expectedEntityRevision: firstUnknown.revision,
    }));

    const after = database.getRunSummary(runId);
    assert.equal(after.status, "AWAITING_INTERVENTION");
    assert.equal(after.dispatchState, "STOPPED");
    assert.equal(after.reconcileState, "ATTENTION_REQUIRED");
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = 'attempt-second-unknown'").get() as { status: string }).status,
      "UNKNOWN",
    );
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'DISPATCH' AND status = 'PENDING'").get(runId)?.value),
      0,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("terminal Task recovery keeps reconciliation blocked by another UNKNOWN Attempt", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-terminal-recovery-blocker-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(database, new FakeRuntime(), {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  const runId = "terminal-recovery-blocker-run";
  const timestamp = Date.now();
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-terminal-recovery-blocker",
        agentId: "main",
        sessionKey: "agent:main:terminal-recovery-blocker",
        sessionId: "session-terminal-recovery-blocker",
        nativeMessageId: "message-terminal-recovery-blocker",
      },
      goal: "Keep every unresolved recovery blocker visible",
      capabilitySnapshot: {},
    });
    const insertAttempt = database.db.prepare(
      `INSERT INTO attempts(
        id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
        worker_owner_session_key, child_session_key, openclaw_run_id, openclaw_task_id,
        status, input_json, revision, created_at, updated_at
      ) VALUES (?, ?, NULL, 'WORKER', ?, ?, 'worker', ?, ?, ?, ?, ?, '{}', 1, ?, ?)`,
    );
    insertAttempt.run(
      "terminal-recovery-settling",
      runId,
      1,
      "terminal-recovery-effect-1",
      "agent:worker:main",
      "agent:worker:subagent:terminal-recovery-1",
      "openclaw-terminal-recovery-1",
      "task-terminal-recovery-1",
      "CANCELLING",
      timestamp,
      timestamp,
    );
    insertAttempt.run(
      "terminal-recovery-unknown",
      runId,
      2,
      "terminal-recovery-effect-2",
      "agent:worker:main",
      "agent:worker:subagent:terminal-recovery-2",
      null,
      null,
      "UNKNOWN",
      timestamp + 1,
      timestamp + 1,
    );
    database.db
      .prepare(
        `UPDATE collaboration_runs SET status = 'CANCELLING', dispatch_state = 'STOPPED',
         reconcile_state = 'ATTENTION_REQUIRED', cancel_requested_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(timestamp, timestamp, runId);

    const settling = database.db
      .prepare("SELECT * FROM attempts WHERE id = 'terminal-recovery-settling'")
      .get() as Record<string, unknown>;
    (service as unknown as {
      settleTerminalTaskDuringCancellation(value: Record<string, unknown>, status: "cancelled"): void;
    }).settleTerminalTaskDuringCancellation(settling, "cancelled");

    const run = database.getRunSummary(runId);
    assert.equal(run.status, "CANCELLING");
    assert.equal(run.dispatchState, "STOPPED");
    assert.equal(run.reconcileState, "ATTENTION_REQUIRED");
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = 'terminal-recovery-settling'").get() as { status: string }).status,
      "CANCELLED",
    );
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = 'terminal-recovery-unknown'").get() as { status: string }).status,
      "UNKNOWN",
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("partial completion remains pending while an active attempt cancellation is unconfirmed", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-partial-unconfirmed-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.cancelMode = "unconfirmed";
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
  const origin: OriginRef = {
    runtimeId: "runtime-partial-unconfirmed",
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "session-partial-unconfirmed",
    nativeMessageId: "native-message-partial-unconfirmed",
  };
  service.start();
  try {
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      origin,
      "partial-unconfirmed",
    );
    const beforeStop = database.getRunSummary(runId);
    service.stopDispatch(writeParams({
      commandId: "partial-unconfirmed-stop",
      runId,
      expectedRunRevision: beforeStop.revision,
    }));
    const preview = service.partialPreview({ runId, workItemIds: ["research"] });
    const beforePartial = database.getRunSummary(runId);
    service.acceptPartial(writeParams({
      commandId: "partial-unconfirmed-accept",
      runId,
      expectedRunRevision: beforePartial.revision,
      workItemIds: ["research"],
      expiresAt: preview.expiresAt,
      confirmationToken: preview.confirmationToken,
    }));
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
        .get(runId) as { status: string } | undefined;
      return attempt?.status === "UNKNOWN";
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const run = database.getRunSummary(runId);
    const snapshot = service.getRun({ runId });
    const workItems = snapshot.workItems as Array<{ status: string }>;
    const attempts = snapshot.attempts as Array<{ kind: string; status: string }>;
    assert.equal(run.status, "AWAITING_INTERVENTION");
    assert.equal(run.completionOutcome, null);
    assert.ok(attempts.some((attempt) => attempt.kind === "WORKER" && attempt.status === "UNKNOWN"));
    assert.equal(attempts.some((attempt) => attempt.kind === "SYNTHESIZER"), false);
    assert.equal(workItems.some((item) => item.status === "WAIVED"), false);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_PENDING'").get(runId)?.value),
      1,
    );
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_APPLIED'").get(runId)?.value),
      0,
    );
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM final_artifacts WHERE run_id = ?").get(runId)?.value), 0);
    assert.equal(runtime.transcript.length, 0);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("partial preview reports an UNKNOWN Attempt as active even when its WorkItem needs intervention", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-partial-unknown-preview-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.cancelMode = "unconfirmed";
  const service = createTestService(database, runtime, directory);
  const origin: OriginRef = {
    runtimeId: "runtime-partial-unknown-preview",
    agentId: "main",
    sessionKey: "agent:main:partial-unknown-preview",
    sessionId: "session-partial-unknown-preview",
    nativeMessageId: "message-partial-unknown-preview",
  };
  service.start();
  try {
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      origin,
      "partial-unknown-preview",
    );
    const running = database.getRunSummary(runId);
    service.stopDispatch(writeParams({
      commandId: "partial-unknown-preview-stop",
      runId,
      expectedRunRevision: running.revision,
    }));
    const researchItem = database.db
      .prepare(
        `SELECT id, revision FROM work_items WHERE run_id = ? AND logical_id = 'research'`,
      )
      .get(runId) as { id: string; revision: number };
    service.cancelWorkItem(writeParams({
      commandId: "partial-unknown-preview-cancel",
      runId,
      workItemId: researchItem.id,
      expectedRunRevision: database.getRunSummary(runId).revision,
      expectedEntityRevision: researchItem.revision,
      confirmed: true,
    }));
    await waitUntil(() => Boolean(database.db
      .prepare(
        `SELECT 1 FROM attempts a JOIN work_items w ON w.id = a.work_item_id
         WHERE a.run_id = ? AND w.logical_id = 'research' AND a.status = 'UNKNOWN'`,
      )
      .get(runId)));
    const preview = service.partialPreview({ runId, workItemIds: ["research"] });
    assert.ok((preview.closure.activeIds as string[]).includes("research"));
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("corrupt pending partial decisions are quarantined without waiving work", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-partial-corrupt-payload-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.cancelMode = "unconfirmed";
  const service = createTestService(database, runtime, directory);
  const origin: OriginRef = {
    runtimeId: "runtime-partial-corrupt-payload",
    agentId: "main",
    sessionKey: "agent:main:partial-corrupt-payload",
    sessionId: "session-partial-corrupt-payload",
    nativeMessageId: "message-partial-corrupt-payload",
  };
  service.start();
  try {
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      origin,
      "partial-corrupt-payload",
    );
    const running = database.getRunSummary(runId);
    service.stopDispatch(writeParams({
      commandId: "partial-corrupt-payload-stop",
      runId,
      expectedRunRevision: running.revision,
    }));
    const preview = service.partialPreview({ runId, workItemIds: ["research"] });
    const stopped = database.getRunSummary(runId);
    service.acceptPartial(writeParams({
      commandId: "partial-corrupt-payload-accept",
      runId,
      expectedRunRevision: stopped.revision,
      workItemIds: ["research"],
      expiresAt: preview.expiresAt,
      confirmationToken: preview.confirmationToken,
    }));
    await waitUntil(() => Boolean(database.db
      .prepare("SELECT 1 FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_PENDING'")
      .get(runId)));

    const decision = database.db
      .prepare("SELECT id FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_PENDING'")
      .get(runId) as { id: string };
    database.db
      .prepare("UPDATE decisions SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify({
        planRevisionId: database.getRunSummary(runId).currentPlanRevisionId,
        closure: { waiveIds: "research", blockedDescendantIds: [], activeIds: [] },
      }), decision.id);

    (service as unknown as { applyPendingPartialIfSettled(value: string): void })
      .applyPendingPartialIfSettled(runId);

    assert.equal(
      (database.db.prepare("SELECT decision_type FROM decisions WHERE id = ?").get(decision.id) as { decision_type: string }).decision_type,
      "PARTIAL_SUPERSEDED",
    );
    assert.equal(
      Number(database.db.prepare(
        "SELECT COUNT(*) AS value FROM work_items WHERE run_id = ? AND status = 'WAIVED'",
      ).get(runId)?.value),
      0,
    );
    assert.equal(
      Number(database.db.prepare(
        "SELECT COUNT(*) AS value FROM interventions WHERE run_id = ? AND code = 'PARTIAL_DECISION_CORRUPT' AND resolved_at IS NULL",
      ).get(runId)?.value),
      1,
    );

    await service.stop();
    const freshPreview = service.partialPreview({ runId, workItemIds: ["research"] });
    const beforeFreshDecision = database.getRunSummary(runId);
    service.acceptPartial(writeParams({
      commandId: "partial-corrupt-payload-recreated",
      runId,
      expectedRunRevision: beforeFreshDecision.revision,
      workItemIds: ["research"],
      expiresAt: freshPreview.expiresAt,
      confirmationToken: freshPreview.confirmationToken,
    }));
    const recoveredIntervention = database.db
      .prepare(
        `SELECT resolved_at, resolved_by, resolution_json
         FROM interventions WHERE run_id = ? AND code = 'PARTIAL_DECISION_CORRUPT'`,
      )
      .get(runId) as {
        resolved_at: number | null;
        resolved_by: string | null;
        resolution_json: string | null;
      };
    assert.ok(Number.isSafeInteger(recoveredIntervention.resolved_at));
    assert.equal(recoveredIntervention.resolved_by, "operator");
    assert.deepEqual(JSON.parse(recoveredIntervention.resolution_json!), {
      commandId: "partial-corrupt-payload-recreated",
      planRevisionId: beforeFreshDecision.currentPlanRevisionId,
      resolution: "fresh-partial-accepted",
    });
    assert.equal(
      Number(database.db.prepare(
        "SELECT COUNT(*) AS value FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_PENDING'",
      ).get(runId)?.value),
      1,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pending partial closure drift is quarantined instead of waiving an unapproved current-plan item", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-partial-closure-drift-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.cancelMode = "unconfirmed";
  const service = createTestService(database, runtime, directory);
  const origin: OriginRef = {
    runtimeId: "runtime-partial-closure-drift",
    agentId: "main",
    sessionKey: "agent:main:partial-closure-drift",
    sessionId: "session-partial-closure-drift",
    nativeMessageId: "message-partial-closure-drift",
  };
  service.start();
  try {
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      origin,
      "partial-closure-drift",
    );
    const running = database.getRunSummary(runId);
    service.stopDispatch(writeParams({
      commandId: "partial-closure-drift-stop",
      runId,
      expectedRunRevision: running.revision,
    }));
    const preview = service.partialPreview({ runId, workItemIds: ["research"] });
    const stopped = database.getRunSummary(runId);
    service.acceptPartial(writeParams({
      commandId: "partial-closure-drift-accept",
      runId,
      expectedRunRevision: stopped.revision,
      workItemIds: ["research"],
      expiresAt: preview.expiresAt,
      confirmationToken: preview.confirmationToken,
    }));
    await waitUntil(() => Boolean(database.db
      .prepare("SELECT 1 FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_PENDING'")
      .get(runId)));

    const decision = database.db
      .prepare("SELECT id, payload_json FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_PENDING'")
      .get(runId) as { id: string; payload_json: string };
    const payload = JSON.parse(decision.payload_json) as {
      closure: { blockedDescendantIds: unknown; activeIds: unknown };
    };
    payload.closure.blockedDescendantIds = [];
    payload.closure.activeIds = [];
    database.db.prepare("UPDATE decisions SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify(payload), decision.id);

    (service as unknown as { applyPendingPartialIfSettled(value: string): void })
      .applyPendingPartialIfSettled(runId);

    assert.equal(
      (database.db.prepare("SELECT decision_type FROM decisions WHERE id = ?").get(decision.id) as { decision_type: string }).decision_type,
      "PARTIAL_SUPERSEDED",
    );
    assert.equal(
      Number(database.db.prepare(
        "SELECT COUNT(*) AS value FROM work_items WHERE run_id = ? AND status = 'WAIVED'",
      ).get(runId)?.value),
      0,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("partial completion waits for an independent current-plan Worker before synthesis", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-partial-independent-worker-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.plannerText = JSON.stringify({
    ...plan,
    workItems: plan.workItems.map((item) => ({ ...item, dependencies: [] })),
  });
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
  const origin: OriginRef = {
    runtimeId: "runtime-partial-independent-worker",
    agentId: "main",
    sessionKey: "agent:main:partial-independent-worker",
    sessionId: "session-partial-independent-worker",
    nativeMessageId: "message-partial-independent-worker",
  };
  const workerAttempt = (runId: string, logicalId: string) => database.db
    .prepare(
      `SELECT a.* FROM attempts a
       JOIN work_items w ON w.id = a.work_item_id
       WHERE a.run_id = ? AND w.logical_id = ?
       ORDER BY a.created_at DESC LIMIT 1`,
    )
    .get(runId, logicalId) as Record<string, unknown> | undefined;

  service.start();
  try {
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      origin,
      "partial-independent-worker",
    );
    await waitUntil(() => (
      workerAttempt(runId, "research")?.status === "RUNNING"
      && workerAttempt(runId, "review")?.status === "RUNNING"
    ));

    const running = database.getRunSummary(runId);
    service.stopDispatch(writeParams({
      commandId: "partial-independent-worker-stop",
      runId,
      expectedRunRevision: running.revision,
    }));
    const preview = service.partialPreview({ runId, workItemIds: ["research"] });
    const stopped = database.getRunSummary(runId);
    service.acceptPartial(writeParams({
      commandId: "partial-independent-worker-accept",
      runId,
      expectedRunRevision: stopped.revision,
      workItemIds: ["research"],
      expiresAt: preview.expiresAt,
      confirmationToken: preview.confirmationToken,
    }));

    await waitUntil(() => (
      workerAttempt(runId, "research")?.status === "CANCELLED"
      && workerAttempt(runId, "review")?.status === "RUNNING"
    ));
    const pending = database.getRunSummary(runId);
    assert.equal(pending.status, "AWAITING_INTERVENTION");
    assert.equal(pending.completionOutcome, null);
    assert.equal(
      Number(database.db.prepare(
        "SELECT COUNT(*) AS value FROM attempts WHERE run_id = ? AND kind = 'SYNTHESIZER'",
      ).get(runId)?.value),
      0,
    );
    assert.equal(
      Number(database.db.prepare(
        "SELECT COUNT(*) AS value FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_PENDING'",
      ).get(runId)?.value),
      1,
    );

    const pendingResearch = database.db
      .prepare("SELECT id, revision FROM work_items WHERE run_id = ? AND logical_id = 'research' AND plan_revision_id = ?")
      .get(runId, pending.currentPlanRevisionId) as { id: string; revision: number };
    assert.throws(
      () => service.retryWorkItem(writeParams({
        commandId: "partial-independent-worker-retry-blocked",
        runId,
        workItemId: pendingResearch.id,
        expectedRunRevision: pending.revision,
        expectedEntityRevision: pendingResearch.revision,
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_TRANSITION",
    );
    assert.equal(
      Number(database.db.prepare(
        "SELECT COUNT(*) AS value FROM attempts WHERE run_id = ? AND kind = 'WORKER'",
      ).get(runId)?.value),
      2,
    );
    assert.throws(
      () => service.revisePlan(writeParams({
        commandId: "partial-independent-worker-revise-blocked",
        runId,
        expectedRunRevision: pending.revision,
        instruction: "This must wait for the pending partial decision",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_TRANSITION",
    );

    const transitionProbe = service as unknown as {
      transitionRun(
        runId: string,
        expectedRevision: number,
        to: "FAILED",
        patch: { endedAt: number },
        eventType: string,
        payload: Record<string, never>,
      ): unknown;
    };
    assert.throws(
      () => transitionProbe.transitionRun(
        runId,
        pending.revision,
        "FAILED",
        { endedAt: Date.now() },
        "INVARIANT_PROBE",
        {},
      ),
      (error: unknown) => error instanceof CollaborationError && error.code === "ACTIVE_ATTEMPT_EXISTS",
    );
    assert.equal(database.getRunSummary(runId).status, "AWAITING_INTERVENTION");

    const independentAttempt = workerAttempt(runId, "review")!;
    const remoteRun = runtime.runs.find((candidate) => candidate.runId === independentAttempt.openclaw_run_id);
    assert.ok(remoteRun);
    remoteRun.status = "succeeded";

    await waitUntil(() => (
      workerAttempt(runId, "review")?.status === "SUCCEEDED"
      && database.getRunSummary(runId).status === "SYNTHESIZING"
    ));
    const synthesizing = database.getRunSummary(runId);
    assert.equal(synthesizing.completionOutcome, "PARTIAL");
    assert.equal(workerAttempt(runId, "review")?.status, "SUCCEEDED");
    assert.equal(
      (database.db.prepare(
        `SELECT status FROM work_items
         WHERE run_id = ? AND plan_revision_id = ? AND logical_id = 'research'`,
      ).get(runId, synthesizing.currentPlanRevisionId) as { status: string }).status,
      "WAIVED",
    );
    assert.equal(
      Number(database.db.prepare(
        "SELECT COUNT(*) AS value FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_APPLIED'",
      ).get(runId)?.value),
      1,
    );
    assert.equal(
      Number(database.db.prepare(
        `SELECT COUNT(*) AS value FROM attempts
         WHERE run_id = ? AND kind = 'SYNTHESIZER'
           AND status IN ('CREATED', 'DISPATCHING', 'RUNNING', 'CANCELLING', 'UNKNOWN')`,
      ).get(runId)?.value),
      1,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("planner dispatch rechecks sticky cancellation after deferred origin reads", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-planner-read-cancel-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const readStarted = deferred();
  const releaseRead = deferred();
  let readCount = 0;
  runtime.readOriginBarrier = async () => {
    readCount += 1;
    if (readCount === 2) {
      readStarted.resolve();
      await releaseRead.promise;
    }
  };
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "planner-read-cancel-create",
      origin: {
        runtimeId: "runtime-planner-read-cancel", agentId: "main", sessionKey: "agent:main:planner-read-cancel",
        sessionId: "session-planner-read-cancel", nativeMessageId: "message-planner-read-cancel",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitForSignal(readStarted.promise);
    const planning = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "planner-read-cancel-run",
      runId,
      expectedRunRevision: planning.revision,
    }));
    releaseRead.resolve();
    await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");
    assert.equal(runtime.runAgentCalls, 0);
    assert.deepEqual(
      (database.db.prepare("SELECT status FROM attempts WHERE run_id = ?").all(runId) as Array<{ status: string }>)
        .map((attempt) => attempt.status),
      ["CANCELLED"],
    );
  } finally {
    releaseRead.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an uncertain remote start recovers the persistent task without calling runAgent again", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-dispatch-unknown-retry-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.runAgentFailuresAfterStart = 1;
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "dispatch-unknown-create",
      origin: {
        runtimeId: "runtime-dispatch-unknown", agentId: "main", sessionKey: "agent:main:dispatch-unknown",
        sessionId: "session-dispatch-unknown", nativeMessageId: "message-dispatch-unknown",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => {
      const attempt = database.db.prepare("SELECT status FROM attempts WHERE run_id = ?").get(runId) as { status: string };
      return attempt.status === "UNKNOWN";
    });
    assert.equal(runtime.runs.length, 1);
    assert.equal(runtime.runAgentCalls, 1);
    const uncertainAttempt = database.db
      .prepare("SELECT id, idempotency_key FROM attempts WHERE run_id = ?")
      .get(runId) as { id: string; idempotency_key: string };
    const uncertainCommand = database.db
      .prepare("SELECT id, effect_key, status, attempts FROM commands WHERE entity_id = ? AND kind = 'PLAN'")
      .get(uncertainAttempt.id) as { id: string; effect_key: string; status: string; attempts: number };
    assert.equal(uncertainCommand.status, "UNKNOWN");
    assert.equal(Number(uncertainCommand.attempts), 1);

    const blocked = database.getRunSummary(runId);
    assert.equal(
      ((service.getRun({ runId }).run as Record<string, unknown>).allowedActions as string[])
        .includes("DISPATCH_RESUME"),
      false,
    );
    assert.throws(
      () => service.resumeDispatch(writeParams({
        commandId: "dispatch-unknown-resume-forbidden",
        runId,
        expectedRunRevision: blocked.revision,
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_TRANSITION",
    );
    assert.equal(runtime.runAgentCalls, 1);

    const run = database.getRunSummary(runId);
    service.reconcileRun(writeParams({
      commandId: "dispatch-unknown-reconcile",
      runId,
      expectedRunRevision: run.revision,
    }));
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const recoveredAttempt = database.db
      .prepare("SELECT id, idempotency_key, openclaw_run_id, status FROM attempts WHERE run_id = ?")
      .get(runId) as { id: string; idempotency_key: string; openclaw_run_id: string; status: string };
    const recoveredCommand = database.db
      .prepare("SELECT id, effect_key, status, attempts FROM commands WHERE id = ?")
      .get(uncertainCommand.id) as { id: string; effect_key: string; status: string; attempts: number };
    assert.equal(recoveredAttempt.id, uncertainAttempt.id);
    assert.equal(recoveredAttempt.idempotency_key, uncertainAttempt.idempotency_key);
    assert.equal(recoveredCommand.effect_key, uncertainCommand.effect_key);
    assert.equal(recoveredCommand.status, "SUCCEEDED");
    assert.equal(Number(recoveredCommand.attempts), 1);
    assert.equal(runtime.runAgentCalls, 1);
    assert.equal(runtime.runs.length, 1);
    assert.equal(runtime.runs[0]?.idempotencyKey, uncertainAttempt.idempotency_key);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent reconcilers idempotently accept the same recovered Task identity", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-concurrent-task-recovery-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.runAgentFailuresAfterStart = 1;
  runtime.waitMode = "timeout";
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "concurrent-task-recovery-create",
      origin: {
        runtimeId: "runtime-concurrent-task-recovery",
        agentId: "main",
        sessionKey: "agent:main:concurrent-task-recovery",
        sessionId: "session-concurrent-task-recovery",
        nativeMessageId: "message-concurrent-task-recovery",
      },
      goal: "Recover one persistent Task exactly once",
    }));
    const runId = String(created.runId);
    await waitUntil(() => {
      const attempt = database.db.prepare("SELECT status FROM attempts WHERE run_id = ?").get(runId) as { status: string };
      return attempt.status === "UNKNOWN";
    });
    const staleAttempt = database.db
      .prepare("SELECT * FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(runId) as Record<string, unknown>;
    const reconciler = service as unknown as {
      reconcileUnknownDispatchAttempt(value: Record<string, unknown>): Promise<boolean>;
    };

    assert.equal(await reconciler.reconcileUnknownDispatchAttempt(staleAttempt), true);
    assert.equal(await reconciler.reconcileUnknownDispatchAttempt(staleAttempt), true);

    const attempt = database.db
      .prepare("SELECT status, openclaw_run_id, openclaw_task_id FROM attempts WHERE run_id = ?")
      .get(runId) as { status: string; openclaw_run_id: string; openclaw_task_id: string };
    const command = database.db
      .prepare("SELECT status FROM commands WHERE run_id = ? AND kind = 'PLAN'")
      .get(runId) as { status: string };
    assert.equal(attempt.status, "RUNNING");
    assert.equal(attempt.openclaw_run_id, runtime.runs[0]?.runId);
    assert.equal(attempt.openclaw_task_id, `task-${runtime.runs[0]?.runId}`);
    assert.equal(command.status, "SUCCEEDED");
    assert.equal(runtime.runAgentCalls, 1);
    assert.equal(
      Number(database.db
        .prepare("SELECT COUNT(*) AS value FROM collaboration_events WHERE run_id = ? AND event_type = 'RECONCILE_FAILED'")
        .get(runId)?.value),
      0,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a post-dispatch persistence fault stays UNKNOWN and recovers the original Task", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-dispatch-local-fault-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const originalAppendEvent = database.appendEvent.bind(database);
  let injected = false;
  database.appendEvent = ((...args: Parameters<CollaborationDatabase["appendEvent"]>) => {
    if (!injected && args[1] === "ATTEMPT_RUNNING") {
      injected = true;
      throw new Error("injected local persistence fault after remote start");
    }
    return originalAppendEvent(...args);
  }) as CollaborationDatabase["appendEvent"];
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "dispatch-local-fault-create",
      origin: {
        runtimeId: "runtime-dispatch-local-fault",
        agentId: "main",
        sessionKey: "agent:main:dispatch-local-fault",
        sessionId: "session-dispatch-local-fault",
        nativeMessageId: "message-dispatch-local-fault",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
        .get(runId) as { status: string } | undefined;
      return attempt?.status === "UNKNOWN";
    });

    const uncertain = database.db
      .prepare(
        `SELECT a.status AS attempt_status, c.status AS command_status
         FROM attempts a JOIN commands c ON c.entity_id = a.id
         WHERE a.run_id = ? AND a.kind = 'PLANNER' AND c.kind = 'PLAN'`,
      )
      .get(runId) as { attempt_status: string; command_status: string };
    assert.equal(injected, true);
    assert.equal(uncertain.attempt_status, "UNKNOWN");
    assert.notEqual(uncertain.attempt_status, "FAILED");
    assert.equal(uncertain.command_status, "UNKNOWN");
    assert.equal(runtime.runAgentCalls, 1);
    assert.equal(runtime.runs.length, 1);

    const run = database.getRunSummary(runId);
    service.reconcileRun(writeParams({
      commandId: "dispatch-local-fault-reconcile",
      runId,
      expectedRunRevision: run.revision,
    }));
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    assert.equal(runtime.runAgentCalls, 1);
    assert.equal(runtime.runs.length, 1);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a reclaimed command for an UNKNOWN Attempt settles before exact Task recovery", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-unknown-command-reclaim-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.runAgentFailuresAfterStart = 1;
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "unknown-command-reclaim-create",
      origin: {
        runtimeId: "runtime-unknown-command-reclaim",
        agentId: "main",
        sessionKey: "agent:main:unknown-command-reclaim",
        sessionId: "session-unknown-command-reclaim",
        nativeMessageId: "message-unknown-command-reclaim",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
        .get(runId) as { status: string } | undefined;
      return attempt?.status === "UNKNOWN";
    });
    database.db
      .prepare(
        `UPDATE commands SET status = 'PENDING', available_at = 0, lease_owner = NULL,
         lease_expires_at = NULL, updated_at = ? WHERE run_id = ? AND kind = 'PLAN'`,
      )
      .run(Date.now(), runId);

    await (service as unknown as { drainCommands(): Promise<void> }).drainCommands();
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const command = database.db
      .prepare("SELECT status, attempts FROM commands WHERE run_id = ? AND kind = 'PLAN'")
      .get(runId) as { status: string; attempts: number };
    assert.equal(command.status, "SUCCEEDED");
    assert.equal(Number(command.attempts), 2);
    assert.equal(runtime.runAgentCalls, 1);
    assert.equal(runtime.runs.length, 1);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("orphan recovery cannot take a command that another worker just reclaimed", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-orphan-lease-race-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(database, new FakeRuntime(), {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  const runId = "orphan-lease-race-run";
  const attemptId = "orphan-lease-race-attempt";
  const commandId = "orphan-lease-race-command";
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-orphan-lease-race",
        agentId: "main",
        sessionKey: "agent:main:orphan-lease-race",
        sessionId: "session-orphan-lease-race",
        nativeMessageId: "message-orphan-lease-race",
      },
      goal: "Preserve a freshly reclaimed command lease",
      capabilitySnapshot: {},
    });
    const timestamp = Date.now();
    database.db
      .prepare(
        `INSERT INTO attempts(
          id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
          worker_owner_session_key, child_session_key, status, input_json, revision, created_at, updated_at
        ) VALUES (?, ?, NULL, 'PLANNER', 1, ?, 'coordinator', ?, ?, 'DISPATCHING', '{}', 1, ?, ?)`,
      )
      .run(
        attemptId,
        runId,
        "orphan-lease-race-effect",
        "agent:coordinator:main",
        "agent:coordinator:subagent:orphan-lease-race",
        timestamp,
        timestamp,
      );
    database.insertCommand({
      id: commandId,
      runId,
      kind: "PLAN",
      entityId: attemptId,
      payloadHash: "orphan-lease-race-payload",
      payload: { attemptId },
      effectKey: "orphan-lease-race-effect",
    });
    const [expiredClaim] = database.claimCommands("expired-worker", 1, -1);
    assert.ok(expiredClaim);

    const originalGetCommand = database.getCommand.bind(database);
    let injectFreshClaim = true;
    database.getCommand = ((id: string) => {
      const staleSnapshot = originalGetCommand(id);
      if (id === commandId && injectFreshClaim) {
        injectFreshClaim = false;
        const [freshClaim] = database.claimCommands("fresh-worker", 1, 30_000);
        assert.ok(freshClaim);
        assert.equal(freshClaim.id, commandId);
      }
      return staleSnapshot;
    }) as CollaborationDatabase["getCommand"];

    const attempt = database.db.prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId) as Record<string, unknown>;
    const recovered = (service as unknown as {
      recoverOrphanedDispatchingAttempt(value: Record<string, unknown>): boolean;
    }).recoverOrphanedDispatchingAttempt(attempt);
    assert.equal(recovered, false);
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attemptId) as { status: string }).status,
      "DISPATCHING",
    );
    const command = originalGetCommand(commandId);
    assert.equal(command.status, "LEASED");
    assert.equal(command.leaseOwner, "fresh-worker");
    assert.equal(command.attempts, 2);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("orphaned dispatch without a recoverable command becomes operator-visible UNKNOWN", async (t) => {
  for (const scenario of ["missing", "cancelled"] as const) {
    await t.test(scenario, async () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), `junqi-collab-orphan-${scenario}-command-`));
      const database = new CollaborationDatabase(":memory:");
      const service = new CollaborationService(database, new FakeRuntime(), {
        coordinatorAgentId: "coordinator",
        allowedAgentIds: ["coordinator", "worker"],
        maxConcurrency: 2,
        maxWorkItems: 10,
        attemptTimeoutMs: 60_000,
        retentionDays: 365,
      }, directory, { info() {}, warn() {}, error() {} });
      const runId = `orphan-${scenario}-command-run`;
      const attemptId = `orphan-${scenario}-command-attempt`;
      const timestamp = Date.now();
      try {
        database.createRun({
          id: runId,
          origin: {
            runtimeId: `runtime-orphan-${scenario}-command`,
            agentId: "main",
            sessionKey: `agent:main:orphan-${scenario}-command`,
            sessionId: `session-orphan-${scenario}-command`,
            nativeMessageId: `message-orphan-${scenario}-command`,
          },
          goal: "Expose an orphaned dispatch to the operator",
          capabilitySnapshot: {},
        });
        database.db
          .prepare("UPDATE collaboration_runs SET status = 'PLANNING' WHERE id = ?")
          .run(runId);
        database.db
          .prepare(
            `INSERT INTO attempts(
              id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
              worker_owner_session_key, child_session_key, status, input_json, revision, created_at, updated_at
            ) VALUES (?, ?, NULL, 'PLANNER', 1, ?, 'coordinator', ?, ?, 'DISPATCHING', '{}', 1, ?, ?)`,
          )
          .run(
            attemptId,
            runId,
            `orphan-${scenario}-command-effect`,
            "agent:coordinator:main",
            `agent:coordinator:subagent:orphan-${scenario}-command`,
            timestamp,
            timestamp,
          );
        if (scenario === "cancelled") {
          database.insertCommand({
            id: "orphan-cancelled-command",
            runId,
            kind: "PLAN",
            entityId: attemptId,
            payloadHash: "orphan-cancelled-command-payload",
            payload: { attemptId },
            effectKey: "orphan-cancelled-command-effect",
          });
          assert.equal(
            database.settleUnleasedCommand(
              "orphan-cancelled-command",
              "PENDING",
              "CANCELLED",
              { error: "cancelled before recovery" },
            ),
            true,
          );
        }

        const attempt = database.db.prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId) as Record<string, unknown>;
        const recovered = (service as unknown as {
          recoverOrphanedDispatchingAttempt(value: Record<string, unknown>): boolean;
        }).recoverOrphanedDispatchingAttempt(attempt);
        assert.equal(recovered, true);
        assert.equal(
          (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attemptId) as { status: string }).status,
          "UNKNOWN",
        );
        const run = database.getRunSummary(runId);
        assert.equal(run.status, "AWAITING_INTERVENTION");
        assert.equal(run.reconcileState, "ATTENTION_REQUIRED");
        assert.equal(
          Number(database.db
            .prepare("SELECT COUNT(*) AS value FROM interventions WHERE run_id = ? AND entity_id = ? AND resolved_at IS NULL")
            .get(runId, attemptId)?.value),
          1,
        );
      } finally {
        await service.stop();
        database.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

test("service stop aborts a hung OpenClaw dispatch and persists an uncertain outcome before returning", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-stop-abort-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const dispatchStarted = deferred();
  const releaseDispatch = deferred();
  runtime.runAgentReturnBarrier = async () => {
    dispatchStarted.resolve();
    await releaseDispatch.promise;
  };
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "stop-abort-create",
      origin: {
        runtimeId: "runtime-stop-abort",
        agentId: "main",
        sessionKey: "agent:main:stop-abort",
        sessionId: "session-stop-abort",
        nativeMessageId: "message-stop-abort",
      },
      goal: "Test shutdown recovery",
    }));
    await waitForSignal(dispatchStarted.promise);
    await waitForSignal(service.stop(), 1_000);
    const attempt = database.db
      .prepare("SELECT status, openclaw_run_id FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(String(created.runId)) as { status: string; openclaw_run_id: string | null };
    assert.equal(attempt.status, "UNKNOWN");
    assert.equal(attempt.openclaw_run_id, null);
    assert.equal(runtime.runs.length, 1);
  } finally {
    releaseDispatch.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("service stop releases every unprocessed lease from a claimed command batch", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-stop-batch-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const dispatchStarted = deferred();
  const releaseDispatch = deferred();
  runtime.runAgentReturnBarrier = async () => {
    dispatchStarted.resolve();
    await releaseDispatch.promise;
  };
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  try {
    const created = await service.createPlan(writeParams({
      commandId: "stop-batch-create",
      origin: {
        runtimeId: "runtime-stop-batch", agentId: "main", sessionKey: "agent:main:stop-batch",
        sessionId: "session-stop-batch", nativeMessageId: "message-stop-batch",
      },
      goal: "Test batch lease release",
    }));
    const runId = String(created.runId);
    for (let index = 0; index < 5; index += 1) {
      database.insertCommand({
        id: `stop-batch-noop-${index}`,
        runId,
        kind: "EXPORT",
        payloadHash: `stop-batch-payload-${index}`,
        payload: { noop: true },
        effectKey: `stop-batch-effect-${index}`,
      });
    }
    service.start();
    await waitForSignal(dispatchStarted.promise);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND status = 'LEASED'").get(runId)?.value),
      6,
    );
    await waitForSignal(service.stop(), 1_000);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND status = 'LEASED'").get(runId)?.value),
      0,
    );
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND id LIKE 'stop-batch-noop-%' AND status = 'PENDING'").get(runId)?.value),
      5,
    );
  } finally {
    releaseDispatch.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Gateway restart recovers a response-lost dispatch without process-local deduplication", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-dispatch-gateway-restart-"));
  const databasePath = path.join(directory, "collaboration.sqlite");
  const config = {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  };
  const logger = { info() {}, warn() {}, error() {} };
  const firstRuntime = new FakeRuntime();
  firstRuntime.runAgentFailuresAfterStart = 1;
  const firstDatabase = new CollaborationDatabase(databasePath);
  const firstService = new CollaborationService(firstDatabase, firstRuntime, config, directory, logger);
  firstService.start();
  let runId = "";
  try {
    const created = await firstService.createPlan(writeParams({
      commandId: "dispatch-restart-create",
      origin: {
        runtimeId: "runtime-dispatch-restart",
        agentId: "main",
        sessionKey: "agent:main:dispatch-restart",
        sessionId: "session-dispatch-restart",
        nativeMessageId: "message-dispatch-restart",
      },
      goal: "Assess a launch proposal",
    }));
    runId = String(created.runId);
    await waitUntil(() => {
      const attempt = firstDatabase.db
        .prepare("SELECT status FROM attempts WHERE run_id = ?")
        .get(runId) as { status: string };
      return attempt.status === "UNKNOWN";
    });
    assert.equal(firstRuntime.runAgentCalls, 1);
    assert.equal(firstRuntime.runs.length, 1);
  } finally {
    await firstService.stop();
    firstDatabase.close();
  }

  const restartedRuntime = restartFakeRuntime(firstRuntime);
  assert.equal(restartedRuntime.processRunIdempotency.size, 0);
  const secondDatabase = new CollaborationDatabase(databasePath);
  const secondService = new CollaborationService(secondDatabase, restartedRuntime, config, directory, logger);
  secondService.start();
  try {
    await waitUntil(() => secondDatabase.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const attempt = secondDatabase.db
      .prepare("SELECT status, openclaw_run_id, openclaw_task_id FROM attempts WHERE run_id = ?")
      .get(runId) as { status: string; openclaw_run_id: string; openclaw_task_id: string };
    assert.equal(attempt.status, "SUCCEEDED");
    assert.equal(attempt.openclaw_run_id, firstRuntime.runs[0]!.runId);
    assert.equal(attempt.openclaw_task_id, `task-${firstRuntime.runs[0]!.runId}`);
    assert.equal(restartedRuntime.runAgentCalls, 0);
    assert.equal(restartedRuntime.runs.length, 1);
  } finally {
    await secondService.stop();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an absent persistent Task leaves the response-lost Attempt UNKNOWN without redispatch", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-dispatch-task-absent-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.runAgentFailuresAfterStart = 1;
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "dispatch-task-absent-create",
      origin: {
        runtimeId: "runtime-task-absent", agentId: "main", sessionKey: "agent:main:task-absent",
        sessionId: "session-task-absent", nativeMessageId: "message-task-absent",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => {
      const attempt = database.db.prepare("SELECT status FROM attempts WHERE run_id = ?").get(runId) as { status: string };
      return attempt.status === "UNKNOWN";
    });
    runtime.runs.length = 0;
    const run = database.getRunSummary(runId);
    service.reconcileRun(writeParams({
      commandId: "dispatch-task-absent-reconcile",
      runId,
      expectedRunRevision: run.revision,
    }));
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT last_error FROM attempts WHERE run_id = ?")
        .get(runId) as { last_error: string | null };
      return attempt.last_error?.includes("automatic redispatch is forbidden") === true;
    });
    const attempt = database.db
      .prepare("SELECT status, openclaw_run_id FROM attempts WHERE run_id = ?")
      .get(runId) as { status: string; openclaw_run_id: string | null };
    const command = database.db
      .prepare("SELECT status, attempts FROM commands WHERE run_id = ? AND kind = 'PLAN'")
      .get(runId) as { status: string; attempts: number };
    assert.equal(attempt.status, "UNKNOWN");
    assert.equal(attempt.openclaw_run_id, null);
    assert.equal(command.status, "UNKNOWN");
    assert.equal(Number(command.attempts), 1);
    assert.equal(runtime.runAgentCalls, 1);
    assert.equal(database.getRunSummary(runId).reconcileState, "ATTENTION_REQUIRED");
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ambiguous persistent Tasks leave the response-lost Attempt UNKNOWN without redispatch", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-dispatch-task-ambiguous-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.runAgentFailuresAfterStart = 1;
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "dispatch-task-ambiguous-create",
      origin: {
        runtimeId: "runtime-task-ambiguous", agentId: "main", sessionKey: "agent:main:task-ambiguous",
        sessionId: "session-task-ambiguous", nativeMessageId: "message-task-ambiguous",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => {
      const attempt = database.db.prepare("SELECT status FROM attempts WHERE run_id = ?").get(runId) as { status: string };
      return attempt.status === "UNKNOWN";
    });
    runtime.runs.push({ ...runtime.runs[0]!, runId: "openclaw-duplicate" });
    const run = database.getRunSummary(runId);
    service.reconcileRun(writeParams({
      commandId: "dispatch-task-ambiguous-reconcile",
      runId,
      expectedRunRevision: run.revision,
    }));
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT last_error FROM attempts WHERE run_id = ?")
        .get(runId) as { last_error: string | null };
      return attempt.last_error?.includes("Multiple fake Tasks") === true;
    });
    const attempt = database.db
      .prepare("SELECT status, openclaw_run_id FROM attempts WHERE run_id = ?")
      .get(runId) as { status: string; openclaw_run_id: string | null };
    const command = database.db
      .prepare("SELECT status, attempts FROM commands WHERE run_id = ? AND kind = 'PLAN'")
      .get(runId) as { status: string; attempts: number };
    const intervention = database.db
      .prepare("SELECT code FROM interventions WHERE run_id = ? AND resolved_at IS NULL AND code = 'DISPATCH_TASK_AMBIGUOUS'")
      .get(runId) as { code: string } | undefined;
    assert.equal(attempt.status, "UNKNOWN");
    assert.equal(attempt.openclaw_run_id, null);
    assert.equal(command.status, "UNKNOWN");
    assert.equal(Number(command.attempts), 1);
    assert.equal(runtime.runAgentCalls, 1);
    assert.equal(intervention?.code, "DISPATCH_TASK_AMBIGUOUS");
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a remote run returned after cancellation is durably identified and then cancelled", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-dispatch-return-after-cancel-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const workerStarted = deferred();
  const releaseWorker = deferred();
  let runAgentCall = 0;
  runtime.runAgentReturnBarrier = async () => {
    runAgentCall += 1;
    if (runAgentCall === 2) {
      workerStarted.resolve();
      await releaseWorker.promise;
    }
  };
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "dispatch-return-cancel-create",
      origin: {
        runtimeId: "runtime-dispatch-return-cancel", agentId: "main", sessionKey: "agent:main:dispatch-return-cancel",
        sessionId: "session-dispatch-return-cancel", nativeMessageId: "message-dispatch-return-cancel",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const planned = database.getRunSummary(runId);
    runtime.waitMode = "timeout";
    service.approvePlan(writeParams({
      commandId: "dispatch-return-cancel-approve", runId, planRevisionId: planned.currentPlanRevisionId,
      expectedRunRevision: planned.revision, assignments: { research: "worker", review: "worker" },
    }));
    await waitForSignal(workerStarted.promise);
    const beforeCancel = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "dispatch-return-cancel-run", runId, expectedRunRevision: beforeCancel.revision,
    }));
    releaseWorker.resolve();
    await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");
    const attempt = database.db
      .prepare("SELECT status, openclaw_run_id, openclaw_task_id FROM attempts WHERE run_id = ? AND kind = 'WORKER'")
      .get(runId) as { status: string; openclaw_run_id: string; openclaw_task_id: string };
    assert.equal(attempt.status, "CANCELLED");
    assert.match(attempt.openclaw_run_id, /^openclaw-/);
    assert.match(attempt.openclaw_task_id, /^task-openclaw-/);
    assert.ok(runtime.cancelledRunIds.includes(attempt.openclaw_run_id));
    assert.equal(runtime.runs.filter((run) => run.idempotencyKey.includes("work:research")).length, 1);
  } finally {
    releaseWorker.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("attempt completion and cancellation races preserve one terminal outcome and consistent evidence", async (t) => {
  await t.test("cancellation wins while completed messages are still unread", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-race-cancel-wins-"));
    const database = new CollaborationDatabase(":memory:");
    const runtime = new FakeRuntime();
    const messagesStarted = deferred();
    const releaseMessages = deferred();
    const service = new CollaborationService(database, runtime, {
      coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
      maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
    }, directory, { info() {}, warn() {}, error() {} });
    service.start();
    try {
      const runId = await startRunningCollaboration(service, database, runtime, {
        runtimeId: "runtime-race-cancel", agentId: "main", sessionKey: "agent:main:race-cancel",
        sessionId: "session-race-cancel", nativeMessageId: "message-race-cancel",
      }, "race-cancel");
      runtime.messagesBarrier = async () => {
        messagesStarted.resolve();
        await releaseMessages.promise;
      };
      runtime.waitForRunHook = async () => ({ status: "ok" });
      await waitForSignal(messagesStarted.promise);
      const beforeCancel = database.getRunSummary(runId);
      service.cancelRun(writeParams({ commandId: "race-cancel-run", runId, expectedRunRevision: beforeCancel.revision }));
      await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");
      releaseMessages.resolve();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const workerAttempt = database.db
        .prepare("SELECT id, status FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY attempt_no LIMIT 1")
        .get(runId) as { id: string; status: string };
      assert.equal(workerAttempt.status, "CANCELLED");
      assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM evidence WHERE attempt_id = ?").get(workerAttempt.id)?.value), 0);
      assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM final_artifacts WHERE run_id = ?").get(runId)?.value), 0);
    } finally {
      releaseMessages.resolve();
      await service.stop();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  await t.test("cancellation wins while the watcher wait result is still in flight", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-race-wait-cancel-"));
    const database = new CollaborationDatabase(":memory:");
    const runtime = new FakeRuntime();
    const waitStarted = deferred();
    const releaseWait = deferred();
    const service = new CollaborationService(database, runtime, {
      coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
      maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
    }, directory, { info() {}, warn() {}, error() {} });
    service.start();
    try {
      const runId = await startRunningCollaboration(service, database, runtime, {
        runtimeId: "runtime-race-wait", agentId: "main", sessionKey: "agent:main:race-wait",
        sessionId: "session-race-wait", nativeMessageId: "message-race-wait",
      }, "race-wait");
      runtime.waitForRunHook = async () => {
        waitStarted.resolve();
        await releaseWait.promise;
        return { status: "ok" };
      };
      await waitForSignal(waitStarted.promise);
      const beforeCancel = database.getRunSummary(runId);
      service.cancelRun(writeParams({ commandId: "race-wait-cancel", runId, expectedRunRevision: beforeCancel.revision }));
      await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");
      releaseWait.resolve();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const worker = database.db
        .prepare("SELECT id, status FROM attempts WHERE run_id = ? AND kind = 'WORKER'")
        .get(runId) as { id: string; status: string };
      assert.equal(worker.status, "CANCELLED");
      assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM evidence WHERE attempt_id = ?").get(worker.id)?.value), 0);
    } finally {
      releaseWait.resolve();
      await service.stop();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  await t.test("committed completion is not overwritten by later cancellation", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-race-complete-wins-"));
    const database = new CollaborationDatabase(":memory:");
    const runtime = new FakeRuntime();
    const service = new CollaborationService(database, runtime, {
      coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
      maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
    }, directory, { info() {}, warn() {}, error() {} });
    service.start();
    try {
      const runId = await startRunningCollaboration(service, database, runtime, {
        runtimeId: "runtime-race-complete", agentId: "main", sessionKey: "agent:main:race-complete",
        sessionId: "session-race-complete", nativeMessageId: "message-race-complete",
      }, "race-complete");
      runtime.waitForRunHook = async () => {
        runtime.waitForRunHook = undefined;
        return { status: "ok" };
      };
      await waitUntil(() => {
        const item = database.db.prepare("SELECT status FROM work_items WHERE run_id = ? AND logical_id = 'research'").get(runId) as { status: string };
        return item.status === "SUCCEEDED";
      });
      const beforeCancel = database.getRunSummary(runId);
      service.cancelRun(writeParams({ commandId: "race-complete-cancel", runId, expectedRunRevision: beforeCancel.revision }));
      await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");
      const research = database.db
        .prepare("SELECT id, status FROM work_items WHERE run_id = ? AND logical_id = 'research'")
        .get(runId) as { id: string; status: string };
      assert.equal(research.status, "SUCCEEDED");
      assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM evidence WHERE work_item_id = ?").get(research.id)?.value), 1);
      assert.equal(
        Number(database.db.prepare("SELECT COUNT(*) AS value FROM attempts WHERE work_item_id = ? AND status = 'SUCCEEDED'").get(research.id)?.value),
        1,
      );
    } finally {
      await service.stop();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("a timeout intent cannot overwrite a completion that already committed", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-timeout-completion-race-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const runId = await startRunningCollaboration(service, database, runtime, {
      runtimeId: "runtime-timeout-race", agentId: "main", sessionKey: "agent:main:timeout-race",
      sessionId: "session-timeout-race", nativeMessageId: "message-timeout-race",
    }, "timeout-race");
    const attempt = database.db
      .prepare("SELECT id FROM attempts WHERE run_id = ? AND kind = 'WORKER' AND status = 'RUNNING'")
      .get(runId) as { id: string };
    await (service as unknown as { completeAttempt(attemptId: string): Promise<void> }).completeAttempt(attempt.id);
    await (service as unknown as { timeoutAttempt(attemptId: string): Promise<void> }).timeoutAttempt(attempt.id);
    const settled = database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attempt.id) as { status: string };
    assert.equal(settled.status, "SUCCEEDED");
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM evidence WHERE attempt_id = ?").get(attempt.id)?.value), 1);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM collaboration_events WHERE run_id = ? AND event_type = 'ATTEMPT_FAILED'").get(runId)?.value),
      0,
    );
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE entity_id = ? AND kind = 'CANCEL_ATTEMPT'").get(attempt.id)?.value),
      0,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("timeout cancellation is a durable outbox intent and survives restart after the remote Task settled", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-timeout-outbox-restart-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const config = {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  };
  const logger = { info() {}, warn() {}, error() {} };
  const firstService = new CollaborationService(database, runtime, config, directory, logger);
  let restartedService: CollaborationService | undefined;
  firstService.start();
  try {
    const runId = await startRunningCollaboration(firstService, database, runtime, {
      runtimeId: "runtime-timeout-outbox", agentId: "main", sessionKey: "agent:main:timeout-outbox",
      sessionId: "session-timeout-outbox", nativeMessageId: "message-timeout-outbox",
    }, "timeout-outbox");
    const attempt = database.db
      .prepare("SELECT id, openclaw_run_id FROM attempts WHERE run_id = ? AND kind = 'WORKER' AND status = 'RUNNING'")
      .get(runId) as { id: string; openclaw_run_id: string };
    await firstService.stop();

    await (firstService as unknown as { timeoutAttempt(attemptId: string): Promise<void> }).timeoutAttempt(attempt.id);
    assert.equal(runtime.cancelledRunIds.length, 0);
    const command = database.db
      .prepare("SELECT status, payload_json FROM commands WHERE entity_id = ? AND kind = 'CANCEL_ATTEMPT'")
      .get(attempt.id) as { status: string; payload_json: string };
    assert.equal(command.status, "PENDING");
    assert.deepEqual(JSON.parse(command.payload_json), { attemptId: attempt.id, terminalReason: "TIMEOUT" });
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attempt.id) as { status: string }).status,
      "CANCELLING",
    );

    const remoteTask = runtime.runs.find((candidate) => candidate.runId === attempt.openclaw_run_id);
    assert.ok(remoteTask);
    remoteTask.status = "cancelled";

    restartedService = new CollaborationService(database, runtime, config, directory, logger);
    restartedService.start();
    await (restartedService as unknown as { drainCommands(): Promise<void> }).drainCommands();
    await waitUntil(() => (
      database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attempt.id) as { status: string }
    ).status === "TIMED_OUT");
    assert.equal(database.getRunSummary(runId).status, "AWAITING_INTERVENTION");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM interventions WHERE run_id = ? AND code = 'ATTEMPT_TIMED_OUT'").get(runId)?.value),
      1,
    );
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM interventions WHERE run_id = ? AND code = 'AGENT_TASK_CANCELLED'").get(runId)?.value),
      0,
    );
  } finally {
    await restartedService?.stop();
    await firstService.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("planner timeout intent remains sticky through UNKNOWN Task recovery and retry", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-planner-timeout-recovery-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.waitMode = "timeout";
  runtime.cancelMode = "unconfirmed";
  const service = createTestService(database, runtime, directory);
  let recoveryService: CollaborationService | undefined;
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "planner-timeout-recovery-create",
      origin: {
        runtimeId: "runtime-planner-timeout", agentId: "main",
        sessionKey: "agent:main:planner-timeout", sessionId: "session-planner-timeout",
        nativeMessageId: "message-planner-timeout",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => Boolean(database.db
      .prepare("SELECT 1 FROM attempts WHERE run_id = ? AND kind = 'PLANNER' AND status = 'RUNNING'")
      .get(runId)));
    const attempt = database.db
      .prepare("SELECT id FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(runId) as { id: string };
    await service.stop();
    await (service as unknown as { timeoutAttempt(attemptId: string): Promise<void> }).timeoutAttempt(attempt.id);

    recoveryService = createTestService(database, runtime, directory);
    const workerId = (recoveryService as unknown as { workerId: string }).workerId;
    const timeoutCommand = database.claimCommands(workerId, 8, 30_000)
      .find((command) => command.kind === "CANCEL_ATTEMPT" && command.entityId === attempt.id);
    assert.ok(timeoutCommand);
    await (recoveryService as unknown as { executeCommand(command: CommandRecord): Promise<void> })
      .executeCommand(timeoutCommand);
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attempt.id) as { status: string }).status,
      "UNKNOWN",
    );

    const unknown = database.db.prepare("SELECT * FROM attempts WHERE id = ?").get(attempt.id) as Record<string, unknown>;
    await (recoveryService as unknown as { reconcileKnownTaskAttempt(attempt: Record<string, unknown>): Promise<void> })
      .reconcileKnownTaskAttempt(unknown);
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attempt.id) as { status: string }).status,
      "CANCELLING",
    );
    assert.equal(database.getRunSummary(runId).status, "AWAITING_INTERVENTION");
    const retry = database.db
      .prepare(
        `SELECT payload_json FROM commands
         WHERE entity_id = ? AND kind = 'CANCEL_ATTEMPT' AND status = 'PENDING'
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(attempt.id) as { payload_json: string };
    assert.deepEqual(JSON.parse(retry.payload_json), { attemptId: attempt.id, terminalReason: "TIMEOUT" });
  } finally {
    await recoveryService?.stop();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("timeout keeps the attempt UNKNOWN when remote cancellation is unconfirmed", async (t) => {
  for (const mode of ["unconfirmed", "throw"] as const) {
    await t.test(mode, async () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), `junqi-collab-timeout-${mode}-`));
      const database = new CollaborationDatabase(":memory:");
      const runtime = new FakeRuntime();
      runtime.cancelMode = mode;
      const service = new CollaborationService(database, runtime, {
        coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
        maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
      }, directory, { info() {}, warn() {}, error() {} });
      service.start();
      try {
        const runId = await startRunningCollaboration(service, database, runtime, {
          runtimeId: `runtime-timeout-${mode}`, agentId: "main", sessionKey: `agent:main:timeout-${mode}`,
          sessionId: `session-timeout-${mode}`, nativeMessageId: `message-timeout-${mode}`,
        }, `timeout-${mode}`);
        const attempt = database.db
          .prepare("SELECT id FROM attempts WHERE run_id = ? AND kind = 'WORKER' AND status = 'RUNNING'")
          .get(runId) as { id: string };
        await (service as unknown as { timeoutAttempt(attemptId: string): Promise<void> }).timeoutAttempt(attempt.id);
        await (service as unknown as { drainCommands(): Promise<void> }).drainCommands();
        await waitUntil(() => (
          database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attempt.id) as { status: string }
        ).status === "UNKNOWN");
        const settled = database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attempt.id) as { status: string };
        assert.equal(settled.status, "UNKNOWN");
        assert.equal(database.getRunSummary(runId).status, "AWAITING_INTERVENTION");
        assert.equal(
          Number(database.db.prepare("SELECT COUNT(*) AS value FROM interventions WHERE run_id = ? AND code = 'TIMEOUT_CANCEL_UNCONFIRMED'").get(runId)?.value),
          1,
        );
        assert.equal(
          Number(database.db.prepare("SELECT COUNT(*) AS value FROM attempts WHERE id = ? AND status = 'TIMED_OUT'").get(attempt.id)?.value),
          0,
        );
      } finally {
        await service.stop();
        database.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

test("cancellation terminal state and Flow sync outbox commit atomically and missing historical sync is repaired", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-cancel-flow-atomic-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const runId = await startRunningCollaboration(service, database, runtime, {
      runtimeId: "runtime-cancel-flow-atomic", agentId: "main",
      sessionKey: "agent:main:cancel-flow-atomic", sessionId: "session-cancel-flow-atomic",
      nativeMessageId: "message-cancel-flow-atomic",
    }, "cancel-flow-atomic");
    await service.stop();
    const running = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "cancel-flow-atomic-run",
      runId,
      expectedRunRevision: running.revision,
    }));
    database.transaction(() => {
      const timestamp = Date.now();
      database.db
        .prepare(
          `UPDATE attempts SET status = 'CANCELLED', ended_at = ?, revision = revision + 1, updated_at = ?
           WHERE run_id = ? AND status IN ('CREATED', 'DISPATCHING', 'RUNNING', 'CANCELLING', 'UNKNOWN')`,
        )
        .run(timestamp, timestamp, runId);
      database.db
        .prepare(
          `UPDATE work_items SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
           WHERE run_id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED')`,
        )
        .run(timestamp, runId);
    });

    const mutableDatabase = database as CollaborationDatabase & {
      insertCommand: CollaborationDatabase["insertCommand"];
    };
    const originalInsertCommand = database.insertCommand.bind(database);
    mutableDatabase.insertCommand = ((params: Parameters<CollaborationDatabase["insertCommand"]>[0]) => {
      if (params.kind === "FLOW_SYNC") throw new Error("injected Flow outbox failure");
      return originalInsertCommand(params);
    }) as CollaborationDatabase["insertCommand"];
    assert.throws(
      () => (service as unknown as { finishCancellationIfSettled(runId: string): void })
        .finishCancellationIfSettled(runId),
      /injected Flow outbox failure/,
    );
    assert.equal(database.getRunSummary(runId).status, "CANCELLING");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'").get(runId)?.value),
      0,
    );

    mutableDatabase.insertCommand = originalInsertCommand;
    (service as unknown as { finishCancellationIfSettled(runId: string): void })
      .finishCancellationIfSettled(runId);
    assert.equal(database.getRunSummary(runId).status, "CANCELLED");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'").get(runId)?.value),
      1,
    );

    database.db.prepare("DELETE FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'").run(runId);
    (service as unknown as { reconcileTerminalLocalCommands(): void }).reconcileTerminalLocalCommands();
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'").get(runId)?.value),
      1,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PROVISION rejects an already-cancelled controller Flow instead of starting the Run", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-provision-cancelled-flow-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const prepared = await preparePendingProvision(database, runtime, directory, {
    runtimeId: "runtime-provision-cancelled", agentId: "main",
    sessionKey: "agent:main:provision-cancelled", sessionId: "session-provision-cancelled",
    nativeMessageId: "message-provision-cancelled",
  }, "provision-cancelled");
  const workerService = createTestService(database, runtime, directory);
  try {
    const pending = database.getCommand(prepared.provisionCommandId);
    const domainRevision = Number(pending.payload.flowDomainRevision);
    assert.ok(Number.isSafeInteger(domainRevision) && domainRevision > 0);
    runtime.flowRevision = 9;
    runtime.flowControllerId = `junqi-collab/${prepared.runId}`;
    runtime.flowStatus = "cancelled";
    runtime.flowState = { runId: prepared.runId, domainRevision };
    runtime.flowCancelRequestedAt = Date.now();

    const workerId = (workerService as unknown as { workerId: string }).workerId;
    const claimed = database.claimCommands(workerId, 8, 30_000)
      .find((command) => command.id === prepared.provisionCommandId);
    assert.ok(claimed);
    await (workerService as unknown as { executeCommand(command: CommandRecord): Promise<void> })
      .executeCommand(claimed);

    assert.equal(database.getRunSummary(prepared.runId).status, "PROVISIONING");
    assert.equal(database.getRunRow(prepared.runId).openclaw_flow_id, null);
    const retriable = database.getCommand(prepared.provisionCommandId);
    assert.equal(retriable.status, "PENDING");
    assert.equal(retriable.attempts, 1);
    assert.equal(runtime.runAgentCalls, 1, "only the planner may have run");
  } finally {
    await workerService.stop();
    await prepared.controlService.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("run cancellation supersedes a deferred partial decision and never synthesizes it", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-partial-cancel-race-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const cancelStarted = deferred();
  const releaseCancel = deferred();
  runtime.cancelBarrier = async () => {
    cancelStarted.resolve();
    await releaseCancel.promise;
  };
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const runId = await startRunningCollaboration(service, database, runtime, {
      runtimeId: "runtime-partial-cancel", agentId: "main", sessionKey: "agent:main:partial-cancel",
      sessionId: "session-partial-cancel", nativeMessageId: "message-partial-cancel",
    }, "partial-cancel");
    const running = database.getRunSummary(runId);
    service.stopDispatch(writeParams({ commandId: "partial-cancel-stop", runId, expectedRunRevision: running.revision }));
    const preview = service.partialPreview({ runId, workItemIds: ["research"] });
    const stopped = database.getRunSummary(runId);
    service.acceptPartial(writeParams({
      commandId: "partial-cancel-accept",
      runId,
      expectedRunRevision: stopped.revision,
      workItemIds: ["research"],
      expiresAt: preview.expiresAt,
      confirmationToken: preview.confirmationToken,
    }));
    await waitForSignal(cancelStarted.promise);
    const pending = database.getRunSummary(runId);
    service.cancelRun(writeParams({ commandId: "partial-cancel-run", runId, expectedRunRevision: pending.revision }));
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_SUPERSEDED'").get(runId)?.value),
      1,
    );
    releaseCancel.resolve();
    await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_APPLIED'").get(runId)?.value), 0);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM attempts WHERE run_id = ? AND kind = 'SYNTHESIZER'").get(runId)?.value), 0);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM final_artifacts WHERE run_id = ?").get(runId)?.value), 0);
    assert.throws(
      () => service.partialPreview({ runId, workItemIds: ["research"] }),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_TRANSITION",
    );
    const terminal = database.getRunSummary(runId);
    assert.throws(
      () => service.acceptPartial(writeParams({
        commandId: "partial-cancel-terminal-accept",
        runId,
        expectedRunRevision: terminal.revision,
        workItemIds: ["research"],
        expiresAt: Date.now() + 60_000,
        confirmationToken: "terminal-token",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_TRANSITION",
    );
  } finally {
    releaseCancel.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delivery submission fences cancel, retry, retarget, and abandon until exact append confirms", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delivery-submit-race-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const appendStarted = deferred();
  const releaseAppend = deferred();
  runtime.appendBarrier = async () => {
    appendStarted.resolve();
    await releaseAppend.promise;
  };
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "delivery-submit-create",
      origin: {
        runtimeId: "runtime-delivery-submit", agentId: "main", sessionKey: "agent:main:delivery-submit",
        sessionId: "session-delivery-submit", nativeMessageId: "message-delivery-submit",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const planned = database.getRunSummary(runId);
    service.approvePlan(writeParams({
      commandId: "delivery-submit-approve",
      runId,
      planRevisionId: planned.currentPlanRevisionId,
      expectedRunRevision: planned.revision,
      assignments: { research: "worker", review: "worker" },
    }));
    await waitForSignal(appendStarted.promise);
    const pending = database.getRunSummary(runId);
    const delivery = database.db
      .prepare("SELECT id, revision, status FROM deliveries WHERE run_id = ? ORDER BY target_revision DESC LIMIT 1")
      .get(runId) as { id: string; revision: number; status: string };
    assert.equal(pending.status, "DELIVERY_PENDING");
    assert.equal(delivery.status, "SENDING");
    const expectInvalid = (run: () => unknown) => assert.throws(
      run,
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_TRANSITION",
    );
    expectInvalid(() => service.retryDelivery(writeParams({
      commandId: "delivery-submit-retry", runId, deliveryId: delivery.id,
      expectedRunRevision: pending.revision, expectedEntityRevision: Number(delivery.revision),
    })));
    expectInvalid(() => service.retargetDelivery(writeParams({
      commandId: "delivery-submit-retarget", runId, deliveryId: delivery.id,
      expectedRunRevision: pending.revision, expectedEntityRevision: Number(delivery.revision),
      target: {
        runtimeId: "runtime-delivery-submit", agentId: "main", sessionKey: "agent:main:delivery-submit-new",
        sessionId: "session-delivery-submit-new", nativeMessageId: "message-delivery-submit-new",
      },
    })));
    expectInvalid(() => service.abandonDelivery(writeParams({
      commandId: "delivery-submit-abandon", runId, deliveryId: delivery.id,
      expectedRunRevision: pending.revision, expectedEntityRevision: Number(delivery.revision), confirm: true,
    })));
    expectInvalid(() => service.cancelRun(writeParams({
      commandId: "delivery-submit-cancel-run", runId, expectedRunRevision: pending.revision,
    })));
    releaseAppend.resolve();
    await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");
    assert.equal(runtime.transcript.length, 1);
    const confirmed = database.db.prepare("SELECT status, transcript_status FROM deliveries WHERE id = ?").get(delivery.id) as {
      status: string; transcript_status: string;
    };
    assert.deepEqual({ status: confirmed.status, transcriptStatus: confirmed.transcript_status }, {
      status: "DELIVERED", transcriptStatus: "CONFIRMED",
    });
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM delivery_attempts WHERE delivery_id = ?").get(delivery.id)?.value), 1);
  } finally {
    releaseAppend.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delivery completion preserves attention while an unrelated recovery intervention remains open", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delivery-open-intervention-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const appendStarted = deferred();
  const releaseAppend = deferred();
  runtime.appendBarrier = async () => {
    appendStarted.resolve();
    await releaseAppend.promise;
  };
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "delivery-open-intervention-create",
      origin: {
        runtimeId: "runtime-delivery-open-intervention",
        agentId: "main",
        sessionKey: "agent:main:delivery-open-intervention",
        sessionId: "session-delivery-open-intervention",
        nativeMessageId: "message-delivery-open-intervention",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const planned = database.getRunSummary(runId);
    service.approvePlan(writeParams({
      commandId: "delivery-open-intervention-approve",
      runId,
      planRevisionId: planned.currentPlanRevisionId,
      expectedRunRevision: planned.revision,
      assignments: { research: "worker", review: "worker" },
    }));
    await waitForSignal(appendStarted.promise);
    (service as unknown as {
      insertIntervention(
        runId: string,
        code: string,
        entityType: string,
        entityId: string,
        requiredAction: string,
        diagnostics: Record<string, unknown>,
        resumeStatus: "DELIVERY_PENDING",
      ): void;
    }).insertIntervention(
      runId,
      "UNRELATED_RECOVERY_BLOCKER",
      "run",
      runId,
      "Resolve this recovery blocker explicitly",
      {},
      "DELIVERY_PENDING",
    );

    releaseAppend.resolve();
    await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");
    assert.equal(database.getRunSummary(runId).reconcileState, "ATTENTION_REQUIRED");
    const event = database.db
      .prepare(
        `SELECT payload_json FROM collaboration_events
         WHERE run_id = ? AND event_type = 'DELIVERY_CONFIRMED'
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(runId) as { payload_json: string };
    assert.deepEqual(JSON.parse(event.payload_json).recoveryBlockers, ["OPEN_INTERVENTION"]);
  } finally {
    releaseAppend.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retargeting atomically abandons the latest uncertain delivery before creating its successor", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delivery-retarget-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.transcriptFailuresRemaining = 1;
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "delivery-retarget-create",
      origin: {
        runtimeId: "runtime-delivery-retarget", agentId: "main", sessionKey: "agent:main:delivery-retarget",
        sessionId: "session-delivery-retarget", nativeMessageId: "message-delivery-retarget",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const planned = database.getRunSummary(runId);
    service.approvePlan(writeParams({
      commandId: "delivery-retarget-approve", runId, planRevisionId: planned.currentPlanRevisionId,
      expectedRunRevision: planned.revision, assignments: { research: "worker", review: "worker" },
    }));
    await waitUntil(() => {
      const delivery = database.db.prepare("SELECT status FROM deliveries WHERE run_id = ?").get(runId) as { status?: string } | undefined;
      return delivery?.status === "UNKNOWN";
    });
    const pending = database.getRunSummary(runId);
    const original = database.db
      .prepare("SELECT id, revision FROM deliveries WHERE run_id = ? ORDER BY target_revision DESC LIMIT 1")
      .get(runId) as { id: string; revision: number };
    assert.throws(
      () => service.retargetDelivery(writeParams({
        commandId: "delivery-retarget-same-session",
        runId,
        deliveryId: original.id,
        expectedRunRevision: pending.revision,
        expectedEntityRevision: Number(original.revision),
        target: {
          runtimeId: database.instanceId,
          agentId: "main",
          sessionKey: "agent:main:delivery-retarget",
          sessionId: "session-delivery-retarget",
          nativeMessageId: "a-different-message-in-the-same-session",
        },
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_REQUEST",
    );
    const response = service.retargetDelivery(writeParams({
      commandId: "delivery-retarget-change", runId, deliveryId: original.id,
      expectedRunRevision: pending.revision, expectedEntityRevision: Number(original.revision),
      target: {
        runtimeId: database.instanceId, agentId: "main", sessionKey: "agent:main:delivery-retarget-new",
        sessionId: "session-delivery-retarget-new", nativeMessageId: "message-delivery-retarget-new",
      },
    }));
    const successorId = String(response.deliveryId);
    assert.notEqual(successorId, original.id);
    assert.equal((database.db.prepare("SELECT status FROM deliveries WHERE id = ?").get(original.id) as { status: string }).status, "ABANDONED");
    assert.equal((database.db.prepare("SELECT target_revision FROM deliveries WHERE id = ?").get(successorId) as { target_revision: number }).target_revision, 2);
    assert.throws(
      () => service.retargetDelivery(writeParams({
        commandId: "delivery-retarget-stale-old", runId, deliveryId: original.id,
        expectedRunRevision: database.getRunSummary(runId).revision, expectedEntityRevision: Number(original.revision) + 1,
        target: {
          runtimeId: "runtime-delivery-retarget", agentId: "main", sessionKey: "agent:main:stale",
          sessionId: "session-stale", nativeMessageId: "message-stale",
        },
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_TRANSITION",
    );
    await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");
    assert.equal(runtime.transcript.length, 1);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("service restart reattaches a running task without issuing a duplicate dispatch", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-restart-test-"));
  const databasePath = path.join(directory, "collaboration.sqlite");
  const runtime = new FakeRuntime();
  const config = {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  };
  const logger = { info() {}, warn() {}, error() {} };
  const origin: OriginRef = {
    runtimeId: "runtime-1",
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "session-restart",
    nativeMessageId: "native-message-restart",
  };
  const firstDatabase = new CollaborationDatabase(databasePath);
  const firstService = new CollaborationService(firstDatabase, runtime, config, directory, logger);
  let runId = "";
  firstService.start();
  try {
    const created = await firstService.createPlan(
      writeParams({ commandId: "restart-create", origin, goal: "Assess a launch proposal" }),
    );
    runId = String(created.runId);
    await waitUntil(() => firstDatabase.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const planned = firstDatabase.getRunSummary(runId);
    runtime.waitMode = "timeout";
    firstService.approvePlan(writeParams({
      commandId: "restart-approve",
      runId,
      planRevisionId: planned.currentPlanRevisionId,
      expectedRunRevision: planned.revision,
      assignments: { research: "worker", review: "worker" },
    }));
    await waitUntil(() => {
      const snapshot = firstService.getRun({ runId });
      return (snapshot.attempts as Array<{ kind: string; status: string }>).some(
        (attempt) => attempt.kind === "WORKER" && attempt.status === "RUNNING",
      );
    });
    assert.equal(runtime.runAgentCalls, 2);
  } finally {
    await firstService.stop();
    firstDatabase.close();
  }

  runtime.waitMode = "ok";
  const secondDatabase = new CollaborationDatabase(databasePath);
  const secondService = new CollaborationService(secondDatabase, runtime, config, directory, logger);
  secondService.start();
  try {
    await waitUntil(() => secondDatabase.getRunSummary(runId).status === "COMPLETED");
    assert.equal(runtime.runAgentCalls, 4);
    assert.deepEqual(
      runtime.runs.map((run) => run.idempotencyKey),
      [...new Set(runtime.runs.map((run) => run.idempotencyKey))],
    );
    assert.equal(runtime.transcript.length, 1);
  } finally {
    await secondService.stop();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("waitForRun is only a wakeup hint while persistent Task state remains authoritative", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-wait-hint-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const runId = await startRunningCollaboration(service, database, runtime, {
      runtimeId: "runtime-wait-hint", agentId: "main", sessionKey: "agent:main:wait-hint",
      sessionId: "session-wait-hint", nativeMessageId: "message-wait-hint",
    }, "wait-hint");
    runtime.waitOkCompletesTask = false;
    runtime.waitForRunHook = async () => ({ status: "ok" });
    const callsBefore = runtime.waitForRunCalls;
    await new Promise((resolve) => setTimeout(resolve, 180));
    const workerAttempt = database.db
      .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
      .get(runId) as { status: string };
    assert.equal(workerAttempt.status, "RUNNING");
    const hintCalls = runtime.waitForRunCalls - callsBefore;
    assert.ok(hintCalls >= 1 && hintCalls <= 6, `expected bounded wait polling, observed ${hintCalls}`);

    const workerTask = runtime.runs.find((run) => run.idempotencyKey.includes("work:research"));
    assert.ok(workerTask);
    workerTask.status = "succeeded";
    runtime.waitForRunHook = undefined;
    runtime.waitOkCompletesTask = true;
    runtime.waitMode = "ok";
    await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persistent Task success overrides timeout and error wait hints", async (t) => {
  for (const hint of ["timeout", "error"] as const) {
    await t.test(hint, async () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), `junqi-collab-task-authority-${hint}-`));
      const database = new CollaborationDatabase(":memory:");
      const runtime = new FakeRuntime();
      const service = new CollaborationService(database, runtime, {
        coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
        maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
      }, directory, { info() {}, warn() {}, error() {} });
      service.start();
      try {
        const runId = await startRunningCollaboration(service, database, runtime, {
          runtimeId: `runtime-task-authority-${hint}`, agentId: "main",
          sessionKey: `agent:main:task-authority-${hint}`, sessionId: `session-task-authority-${hint}`,
          nativeMessageId: `message-task-authority-${hint}`,
        }, `task-authority-${hint}`);
        runtime.waitForRunHook = async () => {
          const workerTask = runtime.runs.find((run) => run.idempotencyKey.includes("work:research"));
          assert.ok(workerTask);
          workerTask.status = "succeeded";
          runtime.waitForRunHook = undefined;
          runtime.waitMode = "ok";
          return hint === "error"
            ? { status: "error", error: "stale process-local waiter" }
            : { status: "timeout" };
        };
        await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");
        const firstWorker = database.db
          .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
          .get(runId) as { status: string };
        assert.equal(firstWorker.status, "SUCCEEDED");
      } finally {
        await service.stop();
        database.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

test("a succeeded Task with blocked terminal outcome fails without producing evidence", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-task-blocked-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const runId = await startRunningCollaboration(service, database, runtime, {
      runtimeId: "runtime-task-blocked", agentId: "main", sessionKey: "agent:main:task-blocked",
      sessionId: "session-task-blocked", nativeMessageId: "message-task-blocked",
    }, "task-blocked");
    const workerTask = runtime.runs.find((run) => run.idempotencyKey.includes("work:research"));
    assert.ok(workerTask);
    workerTask.status = "succeeded";
    workerTask.terminalOutcome = "blocked";
    workerTask.terminalSummary = "required deliverable was not produced";
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_INTERVENTION");
    const workerAttempt = database.db
      .prepare("SELECT status, last_error FROM attempts WHERE run_id = ? AND kind = 'WORKER' ORDER BY created_at LIMIT 1")
      .get(runId) as { status: string; last_error: string };
    assert.equal(workerAttempt.status, "FAILED");
    assert.match(workerAttempt.last_error, /required deliverable/);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM evidence WHERE run_id = ?").get(runId)?.value), 0);
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM final_artifacts WHERE run_id = ?").get(runId)?.value), 0);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unknown transcript delivery reconciles the original effect without duplicate-risk acknowledgement", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delivery-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.transcriptFailuresAfterWrite = 1;
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
  const origin: OriginRef = {
    runtimeId: "runtime-1",
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "session-1",
    nativeMessageId: "native-message-delivery-unknown",
  };
  service.start();
  try {
    const created = await service.createPlan(
      writeParams({ commandId: "unknown-create", origin, goal: "Assess a launch proposal" }),
    );
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const approval = database.getRunSummary(runId);
    service.approvePlan(writeParams({
      commandId: "unknown-approve",
      runId,
      planRevisionId: approval.currentPlanRevisionId,
      expectedRunRevision: approval.revision,
      assignments: { research: "worker", review: "worker" },
    }));

    await waitUntil(() => {
      const delivery = (service.getRun({ runId }).deliveries as Array<{ status: string }>)[0];
      return database.getRunSummary(runId).status === "DELIVERY_PENDING" && delivery?.status === "UNKNOWN";
    });
    const pending = database.getRunSummary(runId);
    const delivery = (service.getRun({ runId }).deliveries as Array<{ id: string; revision: number; status: string }>)[0]!;
    assert.equal(pending.status, "DELIVERY_PENDING");
    assert.equal(pending.reconcileState, "ATTENTION_REQUIRED");
    assert.equal(runtime.transcript.length, 1);

    service.retryDelivery(writeParams({
      commandId: "unknown-retry-same-effect",
      runId,
      deliveryId: delivery.id,
      expectedRunRevision: pending.revision,
      expectedEntityRevision: delivery.revision,
    }));
    await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");
    assert.equal(runtime.transcript.length, 1);
    const attempts = database.db
      .prepare("SELECT status FROM delivery_attempts WHERE delivery_id = ? ORDER BY attempt_no")
      .all(delivery.id) as Array<{ status: string }>;
    assert.deepEqual(attempts.map((attempt) => attempt.status), ["CONFIRMED"]);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("abandoning an uncertain delivery enqueues and completes a cancelled terminal Flow sync", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delivery-abandon-flow-sync-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.transcriptFailuresRemaining = 1;
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const { runId, deliveryId } = await startCollaborationUntilDelivery(service, database, {
      runtimeId: "runtime-delivery-abandon-flow",
      agentId: "main",
      sessionKey: "agent:main:delivery-abandon-flow",
      sessionId: "session-delivery-abandon-flow",
      nativeMessageId: "message-delivery-abandon-flow",
    }, "delivery-abandon-flow", "UNKNOWN");
    const pending = database.getRunSummary(runId);
    const delivery = database.db
      .prepare("SELECT revision FROM deliveries WHERE id = ?")
      .get(deliveryId) as { revision: number };

    service.abandonDelivery(writeParams({
      commandId: "delivery-abandon-flow-confirm",
      runId,
      deliveryId,
      expectedRunRevision: pending.revision,
      expectedEntityRevision: Number(delivery.revision),
      confirm: true,
    }));
    await waitUntil(() => {
      const command = database.db
        .prepare("SELECT status FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'")
        .get(runId) as { status?: string } | undefined;
      return command?.status === "SUCCEEDED";
    });

    const flowCommand = database.db
      .prepare("SELECT status, payload_json FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'")
      .get(runId) as { status: string; payload_json: string };
    const payload = JSON.parse(flowCommand.payload_json) as Record<string, unknown>;
    const abandoned = database.db
      .prepare("SELECT status FROM deliveries WHERE id = ?")
      .get(deliveryId) as { status: string };
    assert.equal(database.getRunSummary(runId).status, "CANCELLED");
    assert.equal(abandoned.status, "ABANDONED");
    assert.equal(flowCommand.status, "SUCCEEDED");
    assert.equal(payload.terminal, "cancelled");
    assert.equal(payload.domainStatus, "CANCELLED");
    assert.equal(runtime.flowStatus, "cancelled");
    assert.equal(runtime.flowUpdateCalls, 1);
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC'").get(runId)?.value),
      1,
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("same-key delivery reconciliation stays UNKNOWN when a replay is not confirmed", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delivery-replay-unconfirmed-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.transcriptFailuresAfterWrite = 1;
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const { runId, deliveryId } = await startCollaborationUntilDelivery(service, database, {
      runtimeId: "runtime-delivery-replay", agentId: "main", sessionKey: "agent:main:delivery-replay",
      sessionId: "session-delivery-replay", nativeMessageId: "message-delivery-replay",
    }, "delivery-replay", "UNKNOWN");
    const before = database.getRunSummary(runId);
    const delivery = database.db
      .prepare("SELECT revision FROM deliveries WHERE id = ?")
      .get(deliveryId) as { revision: number };
    runtime.transcriptReplayResults.push({ code: "session-rebound", reason: "session identity changed" });
    service.retryDelivery(writeParams({
      commandId: "delivery-replay-reconcile",
      runId,
      deliveryId,
      expectedRunRevision: before.revision,
      expectedEntityRevision: Number(delivery.revision),
    }));
    await waitUntil(() => {
      const command = database.db
        .prepare("SELECT status, attempts FROM commands WHERE kind = 'DELIVER' AND entity_id = ?")
        .get(deliveryId) as { status: string; attempts: number };
      return command.status === "UNKNOWN" && Number(command.attempts) === 2;
    });
    const after = database.db
      .prepare("SELECT status, transcript_status, message_id FROM deliveries WHERE id = ?")
      .get(deliveryId) as { status: string; transcript_status: string; message_id: string | null };
    const attempts = database.db
      .prepare("SELECT status FROM delivery_attempts WHERE delivery_id = ?")
      .all(deliveryId) as Array<{ status: string }>;
    assert.equal(after.status, "UNKNOWN");
    assert.equal(after.transcript_status, "UNKNOWN");
    assert.equal(after.message_id, null);
    assert.deepEqual(attempts.map((attempt) => attempt.status), ["UNKNOWN"]);
    assert.equal(runtime.transcript.length, 1);
    assert.equal(database.getRunSummary(runId).status, "DELIVERY_PENDING");
    assert.equal(database.getRunSummary(runId).reconcileState, "ATTENTION_REQUIRED");
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("operator reconciliation can reuse the original delivery key after the automatic retry limit", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delivery-retry-limit-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.transcriptFailuresRemaining = 3;
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const { runId, deliveryId } = await startCollaborationUntilDelivery(service, database, {
      runtimeId: "runtime-delivery-limit", agentId: "main", sessionKey: "agent:main:delivery-limit",
      sessionId: "session-delivery-limit", nativeMessageId: "message-delivery-limit",
    }, "delivery-limit", "UNKNOWN");
    const deliveryCommand = () => database.db
      .prepare("SELECT status, attempts, effect_key FROM commands WHERE kind = 'DELIVER' AND entity_id = ?")
      .get(deliveryId) as { status: string; attempts: number; effect_key: string };
    for (const expectedAttempts of [2, 3]) {
      const run = database.getRunSummary(runId);
      service.reconcileRun(writeParams({
        commandId: `delivery-limit-auto-${expectedAttempts}`,
        runId,
        expectedRunRevision: run.revision,
      }));
      await waitUntil(() => {
        const command = deliveryCommand();
        return command.status === "UNKNOWN" && Number(command.attempts) === expectedAttempts;
      });
    }
    const originalEffectKey = deliveryCommand().effect_key;
    const limited = database.getRunSummary(runId);
    service.reconcileRun(writeParams({
      commandId: "delivery-limit-auto-blocked",
      runId,
      expectedRunRevision: limited.revision,
    }));
    await waitUntil(() => database.getRunSummary(runId).reconcileState === "ATTENTION_REQUIRED");
    assert.equal(Number(deliveryCommand().attempts), 3);

    const beforeOperator = database.getRunSummary(runId);
    const delivery = database.db
      .prepare("SELECT revision FROM deliveries WHERE id = ?")
      .get(deliveryId) as { revision: number };
    service.retryDelivery(writeParams({
      commandId: "delivery-limit-operator-reconcile",
      runId,
      deliveryId,
      expectedRunRevision: beforeOperator.revision,
      expectedEntityRevision: Number(delivery.revision),
    }));
    await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");
    const command = deliveryCommand();
    const attempts = database.db
      .prepare("SELECT effect_key, status FROM delivery_attempts WHERE delivery_id = ?")
      .all(deliveryId) as Array<{ effect_key: string; status: string }>;
    assert.equal(command.status, "SUCCEEDED");
    assert.equal(Number(command.attempts), 4);
    assert.equal(command.effect_key, originalEffectKey);
    assert.deepEqual(
      attempts.map((attempt) => ({ effectKey: attempt.effect_key, status: attempt.status })),
      [{ effectKey: originalEffectKey, status: "CONFIRMED" }],
    );
    assert.equal(runtime.transcript.length, 1);
    assert.equal(runtime.transcript[0]!.idempotencyKey, originalEffectKey);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Gateway restart confirms a committed transcript append with the original effect key", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delivery-gateway-restart-"));
  const databasePath = path.join(directory, "collaboration.sqlite");
  const config = {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  };
  const logger = { info() {}, warn() {}, error() {} };
  const firstRuntime = new FakeRuntime();
  firstRuntime.transcriptFailuresAfterWrite = 1;
  const firstDatabase = new CollaborationDatabase(databasePath);
  const firstService = new CollaborationService(firstDatabase, firstRuntime, config, directory, logger);
  firstService.start();
  let runId = "";
  let deliveryId = "";
  let effectKey = "";
  try {
    const created = await firstService.createPlan(writeParams({
      commandId: "delivery-restart-create",
      origin: {
        runtimeId: "runtime-delivery-restart",
        agentId: "main",
        sessionKey: "agent:main:delivery-restart",
        sessionId: "session-delivery-restart",
        nativeMessageId: "message-delivery-restart",
      },
      goal: "Assess a launch proposal",
    }));
    runId = String(created.runId);
    await waitUntil(() => firstDatabase.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const planned = firstDatabase.getRunSummary(runId);
    firstService.approvePlan(writeParams({
      commandId: "delivery-restart-approve",
      runId,
      planRevisionId: planned.currentPlanRevisionId,
      expectedRunRevision: planned.revision,
      assignments: { research: "worker", review: "worker" },
    }));
    await waitUntil(() => {
      const delivery = firstDatabase.db
        .prepare("SELECT status FROM deliveries WHERE run_id = ?")
        .get(runId) as { status?: string } | undefined;
      return delivery?.status === "UNKNOWN";
    });
    const delivery = firstDatabase.db
      .prepare("SELECT id, message_id FROM deliveries WHERE run_id = ?")
      .get(runId) as { id: string; message_id: string | null };
    deliveryId = delivery.id;
    const attempt = firstDatabase.db
      .prepare("SELECT effect_key, status FROM delivery_attempts WHERE delivery_id = ?")
      .get(deliveryId) as { effect_key: string; status: string };
    effectKey = attempt.effect_key;
    const command = firstDatabase.db
      .prepare("SELECT status, attempts FROM commands WHERE effect_key = ?")
      .get(effectKey) as { status: string; attempts: number };
    assert.equal(attempt.status, "UNKNOWN");
    assert.equal(command.status, "UNKNOWN");
    assert.equal(Number(command.attempts), 1);
    assert.equal(delivery.message_id, null);
    assert.equal(firstRuntime.transcript.length, 1);
    assert.equal(firstRuntime.transcript[0]!.idempotencyKey, effectKey);
  } finally {
    await firstService.stop();
    firstDatabase.close();
  }

  const restartedRuntime = restartFakeRuntime(firstRuntime);
  assert.equal(restartedRuntime.processRunIdempotency.size, 0);
  const secondDatabase = new CollaborationDatabase(databasePath);
  const secondService = new CollaborationService(secondDatabase, restartedRuntime, config, directory, logger);
  secondService.start();
  try {
    await waitUntil(() => secondDatabase.getRunSummary(runId).status === "COMPLETED");
    const delivery = secondDatabase.db
      .prepare("SELECT status, transcript_status, message_id FROM deliveries WHERE id = ?")
      .get(deliveryId) as { status: string; transcript_status: string; message_id: string };
    const attempts = secondDatabase.db
      .prepare("SELECT effect_key, status FROM delivery_attempts WHERE delivery_id = ? ORDER BY attempt_no")
      .all(deliveryId) as Array<{ effect_key: string; status: string }>;
    const command = secondDatabase.db
      .prepare("SELECT status, attempts FROM commands WHERE effect_key = ?")
      .get(effectKey) as { status: string; attempts: number };
    assert.equal(delivery.status, "DELIVERED");
    assert.equal(delivery.transcript_status, "CONFIRMED");
    assert.equal(delivery.message_id, "message-1");
    assert.deepEqual(
      attempts.map((attempt) => ({ effectKey: attempt.effect_key, status: attempt.status })),
      [{ effectKey, status: "CONFIRMED" }],
    );
    assert.equal(command.status, "SUCCEEDED");
    assert.equal(Number(command.attempts), 2);
    assert.equal(restartedRuntime.transcript.length, 1);
    assert.equal(restartedRuntime.transcript[0]!.idempotencyKey, effectKey);
    assert.equal(restartedRuntime.runAgentCalls, 0);
  } finally {
    await secondService.stop();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("capability storage, run snapshots, and exports enforce the persistence whitelist", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-whitelist-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.agents[0]!.model = {
    apiKey: "PRIVATE_MODEL_API_KEY",
    systemPrompt: "PRIVATE_MODEL_PROMPT",
  };
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
  const origin: OriginRef = {
    runtimeId: "runtime-security",
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "session-security",
    nativeMessageId: "native-message-security",
  };
  const revisionInstruction = "REVISION_INPUT_MUST_NOT_BE_EXPORTED";
  const additionalInput = "WORK_ITEM_INPUT_MUST_NOT_BE_EXPORTED";
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "security-create",
      origin,
      goal: "Assess a launch proposal",
      capabilitySnapshot: {
        capturedAt: Date.now(),
        desktopObservedFacts: {
          targetFingerprint: "target-security",
          deploymentKind: "system_service",
          persistence: "desktop_independent",
          gatewayVersion: "2026.7.1",
          token: "PRIVATE_GATEWAY_TOKEN",
          prompt: "PRIVATE_DESKTOP_PROMPT",
          reasoning: "PRIVATE_DESKTOP_REASONING",
          toolOutput: "PRIVATE_DESKTOP_TOOL_OUTPUT",
        },
        token: "PRIVATE_TOP_LEVEL_TOKEN",
        prompt: "PRIVATE_TOP_LEVEL_PROMPT",
      },
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");

    const storedCapability = JSON.parse(String(
      database.db.prepare("SELECT capability_snapshot_json FROM collaboration_runs WHERE id = ?").get(runId)?.capability_snapshot_json,
    )) as Record<string, unknown>;
    assert.deepEqual(storedCapability.desktopObservedFacts, {
      deploymentKind: "system_service",
      gatewayVersion: "2026.7.1",
      persistence: "desktop_independent",
      targetFingerprint: "target-security",
    });
    const capabilityJson = JSON.stringify(storedCapability);
    assert.doesNotMatch(capabilityJson, /PRIVATE_|apiKey|systemPrompt|token|prompt|reasoning|toolOutput/i);

    const firstPlan = database.getRunSummary(runId);
    service.revisePlan(writeParams({
      commandId: "security-revise",
      runId,
      expectedRunRevision: firstPlan.revision,
      instruction: revisionInstruction,
    }));
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");

    const workItems = service.getRun({ runId }).workItems as Array<{ id: string; logicalId: string }>;
    const research = workItems.find((item) => item.logicalId === "research")!;
    const review = workItems.find((item) => item.logicalId === "review")!;
    const aggregateChunk = `${additionalInput}${"A".repeat(
      PERSISTENCE_LIMITS.additionalInputBytes - Buffer.byteLength(additionalInput),
    )}`;
    const insertInput = database.db.prepare(
      "INSERT INTO work_item_inputs(id, work_item_id, command_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (let index = 0; index < 8; index += 1) {
      insertInput.run(`aggregate-${index}`, research.id, `aggregate-command-${index}`, aggregateChunk, Date.now() + index);
    }
    for (let index = 0; index < PERSISTENCE_LIMITS.additionalInputsPerWorkItem; index += 1) {
      insertInput.run(`count-${index}`, review.id, `count-command-${index}`, "x", Date.now() + index);
    }
    const expectedRunRevision = database.getRunSummary(runId).revision;
    assert.throws(
      () => service.appendWorkItemInput(writeParams({
        commandId: "security-input-aggregate-overflow",
        workItemId: research.id,
        expectedRunRevision,
        expectedEntityRevision: 1,
        content: "overflow",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "CAPACITY_EXCEEDED",
    );
    assert.throws(
      () => service.appendWorkItemInput(writeParams({
        commandId: "security-input-count-overflow",
        workItemId: review.id,
        expectedRunRevision,
        expectedEntityRevision: 1,
        content: "overflow",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "CAPACITY_EXCEEDED",
    );

    const snapshotJson = JSON.stringify(service.getRun({ runId }));
    assert.doesNotMatch(snapshotJson, new RegExp(revisionInstruction));
    assert.doesNotMatch(snapshotJson, new RegExp(additionalInput));
    assert.doesNotMatch(snapshotJson, /input_json|outcome_json|plan_json|payload_json|diagnostics_json|target_json/);
    assert.doesNotMatch(snapshotJson, /You are the planner|PRIVATE_/);

    const exportCommand = service.createExport(writeParams({
      commandId: "security-export",
      runId,
      expectedRunRevision: database.getRunSummary(runId).revision,
      format: "json",
    }));
    const exportJobId = String(exportCommand.exportJobId);
    await waitUntil(() => service.exportGet({ jobId: exportJobId }).status === "COMPLETED");
    const exported = String(service.exportDownload({ jobId: exportJobId }).content);
    assert.doesNotMatch(exported, new RegExp(revisionInstruction));
    assert.doesNotMatch(exported, new RegExp(additionalInput));
    assert.doesNotMatch(exported, /input_json|outcome_json|plan_json|payload_json|diagnostics_json|target_json/);
    assert.doesNotMatch(exported, /You are the planner|PRIVATE_/);
    assert.match(exported, /Assess a launch proposal/);
    assert.match(exported, /Evidence is explicit/);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("goal, origin, and additional-input oversize requests fail before persistence", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-capacity-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
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
  const origin: OriginRef = {
    runtimeId: "runtime-capacity",
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "session-capacity",
    nativeMessageId: "native-message-capacity",
  };
  try {
    await assert.rejects(
      () => service.createPlan(writeParams({
        commandId: "oversized-goal",
        origin,
        goal: "g".repeat(PERSISTENCE_LIMITS.goalBytes + 1),
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "CAPACITY_EXCEEDED",
    );
    await assert.rejects(
      () => service.createPlan(writeParams({
        commandId: "oversized-origin",
        origin: {
          ...origin,
          sessionKey: "s".repeat(PERSISTENCE_LIMITS.originSessionKeyBytes + 1),
        },
        goal: "Valid goal",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "CAPACITY_EXCEEDED",
    );
    assert.equal(Number(database.db.prepare("SELECT COUNT(*) AS value FROM collaboration_runs").get()?.value), 0);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an oversized final artifact fails closed without storing a truncated conclusion", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-artifact-capacity-test-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.synthesisText = "F".repeat(PERSISTENCE_LIMITS.finalArtifactBytes + 1);
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
  const origin: OriginRef = {
    runtimeId: "runtime-artifact-capacity",
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "session-artifact-capacity",
    nativeMessageId: "native-message-artifact-capacity",
  };
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "artifact-capacity-create",
      origin,
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const planned = database.getRunSummary(runId);
    service.approvePlan(writeParams({
      commandId: "artifact-capacity-approve",
      runId,
      planRevisionId: planned.currentPlanRevisionId,
      expectedRunRevision: planned.revision,
      assignments: { research: "worker", review: "worker" },
    }));
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_INTERVENTION");
    assert.equal(
      Number(database.db.prepare("SELECT COUNT(*) AS value FROM final_artifacts WHERE run_id = ?").get(runId)?.value),
      0,
    );
    const synthesizer = database.db
      .prepare("SELECT status, last_error FROM attempts WHERE run_id = ? AND kind = 'SYNTHESIZER'")
      .get(runId) as { status: string; last_error: string };
    assert.equal(synthesizer.status, "FAILED");
    assert.match(synthesizer.last_error, /final artifact exceeds/);
    assert.ok(Buffer.byteLength(synthesizer.last_error) <= PERSISTENCE_LIMITS.diagnosticBytes);
    assert.doesNotMatch(JSON.stringify(service.getRun({ runId })), /F{100}/);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("run snapshots expose every immutable plan revision in revision order", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-plan-history-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  const runId = "plan-history-run";
  const timestamp = Date.now();
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-plan-history",
        agentId: "main",
        sessionKey: "agent:main:plan-history",
        sessionId: "session-plan-history",
        nativeMessageId: "message-plan-history",
      },
      goal: "Keep the complete plan history",
      capabilitySnapshot: {},
    });
    const insertPlan = database.db.prepare(
      `INSERT INTO plan_revisions(
        id, run_id, revision_no, plan_json, digest, source_attempt_id, approved_at, approved_by, created_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    );
    const firstPlan = { ...plan, goal: "First plan" };
    const secondPlan = { ...plan, goal: "Revised plan" };
    insertPlan.run(
      "plan-history-1",
      runId,
      1,
      JSON.stringify(firstPlan),
      sha256(JSON.stringify(firstPlan)),
      timestamp,
      "operator-a",
      timestamp,
    );
    insertPlan.run(
      "plan-history-2",
      runId,
      2,
      JSON.stringify(secondPlan),
      sha256(JSON.stringify(secondPlan)),
      null,
      null,
      timestamp + 1,
    );
    database.db
      .prepare("UPDATE collaboration_runs SET current_plan_revision_id = ? WHERE id = ?")
      .run("plan-history-2", runId);

    const response = service.getRun({ runId });
    const revisions = response.planRevisions as Array<Record<string, unknown>>;
    assert.deepEqual(revisions.map((revision) => revision.id), ["plan-history-1", "plan-history-2"]);
    assert.deepEqual(revisions.map((revision) => revision.revisionNo), [1, 2]);
    assert.deepEqual(revisions.map((revision) => revision.approvedBy), ["operator-a", null]);
    assert.equal((response.plan as Record<string, unknown>).id, "plan-history-2");
    assert.deepEqual(
      ((response.snapshot as Record<string, unknown>).planRevisions as Array<Record<string, unknown>>)
        .map((revision) => revision.id),
      ["plan-history-1", "plan-history-2"],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("run snapshots expose resolve-unknown only while an UNKNOWN attempt exists", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-unknown-action-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  const runId = "unknown-action-run";
  const timestamp = Date.now();
  try {
    database.createRun({
      id: runId,
      origin: {
        runtimeId: "runtime-unknown-action",
        agentId: "main",
        sessionKey: "agent:main:unknown-action",
        sessionId: "session-unknown-action",
        nativeMessageId: "message-unknown-action",
      },
      goal: "Resolve an uncertain external attempt",
      capabilitySnapshot: {},
    });
    const readAllowedActions = () => {
      const response = service.getRun({ runId });
      return ((response.run as Record<string, unknown>).allowedActions as string[]);
    };
    assert.equal(readAllowedActions().includes("ATTEMPT_RESOLVE_UNKNOWN"), false);

    database.db.prepare(
      `INSERT INTO attempts(
        id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
        worker_owner_session_key, child_session_key, status, input_json, revision, created_at, updated_at
       ) VALUES (?, ?, NULL, 'PLANNER', 1, ?, 'coordinator', ?, ?, 'UNKNOWN', '{}', 1, ?, ?)`,
    ).run(
      "unknown-action-attempt",
      runId,
      "unknown-action-effect",
      "agent:coordinator:main",
      "agent:coordinator:subagent:unknown-action",
      timestamp,
      timestamp,
    );
    const unknownActions = readAllowedActions();
    assert.equal(unknownActions.filter((action) => action === "ATTEMPT_RESOLVE_UNKNOWN").length, 1);

    database.db
      .prepare("UPDATE attempts SET status = 'FAILED', revision = revision + 1, updated_at = ? WHERE id = ?")
      .run(timestamp + 1, "unknown-action-attempt");
    assert.equal(readAllowedActions().includes("ATTEMPT_RESOLVE_UNKNOWN"), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tombstone reads expose only the authoritative deletion job recovery handle", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-tombstone-job-test-"));
  const database = new CollaborationDatabase(":memory:");
  const service = new CollaborationService(
    database,
    new FakeRuntime(),
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
  const timestamp = Date.now();
  try {
    database.db.prepare(
      `INSERT INTO tombstones(
        id, run_id, actor, content_digest, deletion_job_id, deleted_at,
        cleanup_status, cleanup_error, cleanup_updated_at
       ) VALUES (?, ?, 'operator', ?, ?, ?, 'PARTIAL', 'cleanup pending', ?)`,
    ).run("tombstone-with-job", "deleted-run-with-job", "content-digest", "latest-deletion-job", timestamp, timestamp);
    database.db.prepare(
      `INSERT INTO tombstones(
        id, run_id, actor, content_digest, deleted_at, cleanup_status, cleanup_error, cleanup_updated_at
       ) VALUES (?, ?, 'operator', ?, ?, 'COMPLETED', NULL, ?)`,
    ).run("tombstone-without-job", "deleted-run-without-job", "other-digest", timestamp - 1, timestamp - 1);
    const insertJob = database.db.prepare(
      `INSERT INTO deletion_jobs(
        id, run_id, status, confirmation_digest, last_error, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertJob.run(
      "old-deletion-job",
      "deleted-run-with-job",
      "FAILED",
      "PRIVATE_OLD_CONFIRMATION_DIGEST",
      "PRIVATE_OLD_ERROR",
      timestamp - 20,
      timestamp + 20,
    );
    insertJob.run(
      "latest-deletion-job",
      "deleted-run-with-job",
      "PARTIAL",
      "PRIVATE_LATEST_CONFIRMATION_DIGEST",
      "PRIVATE_LATEST_ERROR",
      timestamp - 10,
      timestamp - 10,
    );

    const response = service.listTombstones({ limit: 10 });
    const tombstones = response.tombstones as Array<Record<string, unknown>>;
    const withJob = tombstones.find((entry) => entry.runId === "deleted-run-with-job")!;
    const withoutJob = tombstones.find((entry) => entry.runId === "deleted-run-without-job")!;
    assert.equal(withJob.deletionJobId, "latest-deletion-job");
    assert.equal(withJob.deletionJobStatus, "PARTIAL");
    assert.equal(withoutJob.deletionJobId, null);
    assert.equal(withoutJob.deletionJobStatus, null);
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE_|confirmation_digest|last_error/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a delivery Worker that loses its command lease cannot commit transcript success", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-delivery-lease-loss-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const appendStarted = deferred();
  const releaseAppend = deferred();
  runtime.appendBarrier = async () => {
    appendStarted.resolve();
    await releaseAppend.promise;
  };
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const { runId, deliveryId } = await startCollaborationUntilDelivery(service, database, {
      runtimeId: "runtime-delivery-lease-loss", agentId: "main", sessionKey: "agent:main:delivery-lease-loss",
      sessionId: "session-delivery-lease-loss", nativeMessageId: "message-delivery-lease-loss",
    }, "delivery-lease-loss", "SENDING");
    await waitForSignal(appendStarted.promise);

    const commandId = String((database.db
      .prepare("SELECT id FROM commands WHERE run_id = ? AND entity_id = ? AND kind = 'DELIVER'")
      .get(runId, deliveryId) as { id: string }).id);
    const staleCommand = database.getCommand(commandId);
    assert.equal(staleCommand.status, "LEASED");
    assert.ok(staleCommand.leaseOwner);
    const before = database.db
      .prepare("SELECT status, transcript_status, revision FROM deliveries WHERE id = ?")
      .get(deliveryId) as { status: string; transcript_status: string; revision: number };
    assert.equal(before.status, "SENDING");

    database.db
      .prepare("UPDATE commands SET lease_expires_at = ? WHERE id = ?")
      .run(Date.now() - 1, commandId);
    const replacement = database.claimCommands("replacement-delivery-worker", 64, 60_000)
      .find((command) => command.id === commandId);
    assert.ok(replacement);
    assert.equal(replacement.leaseOwner, "replacement-delivery-worker");
    assert.equal(replacement.attempts, staleCommand.attempts + 1);

    const staleSettlement = deferred<boolean>();
    const originalSettle = database.settleClaimedCommand.bind(database);
    database.settleClaimedCommand = ((
      ...args: Parameters<CollaborationDatabase["settleClaimedCommand"]>
    ) => {
      const settled = originalSettle(...args);
      const candidate = args[0];
      if (
        candidate.id === commandId
        && candidate.leaseOwner === staleCommand.leaseOwner
        && candidate.attempts === staleCommand.attempts
      ) {
        staleSettlement.resolve(settled);
      }
      return settled;
    }) as CollaborationDatabase["settleClaimedCommand"];

    releaseAppend.resolve();
    assert.equal(await waitForSignal(staleSettlement.promise), false);

    const delivery = database.db
      .prepare("SELECT status, transcript_status, revision, message_id FROM deliveries WHERE id = ?")
      .get(deliveryId) as { status: string; transcript_status: string; revision: number; message_id: string | null };
    const deliveryAttempt = database.db
      .prepare("SELECT status FROM delivery_attempts WHERE delivery_id = ?")
      .get(deliveryId) as { status: string };
    const command = database.getCommand(commandId);
    assert.deepEqual({ ...delivery }, {
      status: before.status,
      transcript_status: before.transcript_status,
      revision: Number(before.revision),
      message_id: null,
    });
    assert.equal(deliveryAttempt.status, "SUBMITTING");
    assert.equal(database.getRunSummary(runId).status, "DELIVERY_PENDING");
    assert.equal(command.status, "LEASED");
    assert.equal(command.leaseOwner, "replacement-delivery-worker");
    assert.equal(command.attempts, staleCommand.attempts + 1);
    assert.equal(runtime.transcript.length, 1);

    await (service as unknown as {
      executeCommand(command: typeof replacement): Promise<void>;
    }).executeCommand(replacement);
    await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");
    assert.equal(database.getCommand(commandId).status, "SUCCEEDED");
    assert.equal(
      (database.db.prepare("SELECT status FROM deliveries WHERE id = ?").get(deliveryId) as { status: string }).status,
      "DELIVERED",
    );
    assert.equal(runtime.transcript.length, 1);
  } finally {
    releaseAppend.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a cancellation Worker that loses its command lease cannot commit Task cancellation", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-cancel-lease-loss-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  const cancellationStarted = deferred();
  const releaseCancellation = deferred();
  service.start();
  try {
    const runId = await startRunningCollaboration(service, database, runtime, {
      runtimeId: "runtime-cancel-lease-loss", agentId: "main", sessionKey: "agent:main:cancel-lease-loss",
      sessionId: "session-cancel-lease-loss", nativeMessageId: "message-cancel-lease-loss",
    }, "cancel-lease-loss");
    runtime.cancelBarrier = async () => {
      cancellationStarted.resolve();
      await releaseCancellation.promise;
    };

    const running = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "cancel-lease-loss-run",
      runId,
      expectedRunRevision: running.revision,
    }));
    await waitForSignal(cancellationStarted.promise);

    const workerAttempt = database.db
      .prepare("SELECT id, status FROM attempts WHERE run_id = ? AND kind = 'WORKER' AND openclaw_run_id IS NOT NULL")
      .get(runId) as { id: string; status: string };
    assert.equal(workerAttempt.status, "CANCELLING");
    const commandId = String((database.db
      .prepare("SELECT id FROM commands WHERE run_id = ? AND entity_id = ? AND kind = 'CANCEL_ATTEMPT'")
      .get(runId, workerAttempt.id) as { id: string }).id);
    const staleCommand = database.getCommand(commandId);
    assert.equal(staleCommand.status, "LEASED");
    assert.ok(staleCommand.leaseOwner);

    database.db
      .prepare("UPDATE commands SET lease_expires_at = ? WHERE id = ?")
      .run(Date.now() - 1, commandId);
    const replacement = database.claimCommands("replacement-cancellation-worker", 64, 60_000)
      .find((command) => command.id === commandId);
    assert.ok(replacement);
    assert.equal(replacement.leaseOwner, "replacement-cancellation-worker");
    assert.equal(replacement.attempts, staleCommand.attempts + 1);

    const staleSettlement = deferred<boolean>();
    const originalSettle = database.settleClaimedCommand.bind(database);
    database.settleClaimedCommand = ((
      ...args: Parameters<CollaborationDatabase["settleClaimedCommand"]>
    ) => {
      const settled = originalSettle(...args);
      const candidate = args[0];
      if (
        candidate.id === commandId
        && candidate.leaseOwner === staleCommand.leaseOwner
        && candidate.attempts === staleCommand.attempts
      ) {
        staleSettlement.resolve(settled);
      }
      return settled;
    }) as CollaborationDatabase["settleClaimedCommand"];
    (service as unknown as { scheduleRunReconciliation(runId: string): void }).scheduleRunReconciliation = () => {};

    releaseCancellation.resolve();
    assert.equal(await waitForSignal(staleSettlement.promise), false);

    const attempt = database.db
      .prepare("SELECT status FROM attempts WHERE id = ?")
      .get(workerAttempt.id) as { status: string };
    const command = database.getCommand(commandId);
    assert.equal(attempt.status, "CANCELLING");
    assert.equal(database.getRunSummary(runId).status, "CANCELLING");
    assert.equal(command.status, "LEASED");
    assert.equal(command.leaseOwner, "replacement-cancellation-worker");
    assert.equal(command.attempts, staleCommand.attempts + 1);
    assert.equal(runtime.cancelledRunIds.length, 1);

    await (service as unknown as {
      executeCommand(command: typeof replacement): Promise<void>;
    }).executeCommand(replacement);
    await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");
    assert.equal(database.getCommand(commandId).status, "SUCCEEDED");
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(workerAttempt.id) as { status: string }).status,
      "CANCELLED",
    );
    assert.equal(runtime.cancelledRunIds.length, 2);
  } finally {
    releaseCancellation.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reconciliation binds a persistent Task even when its DISPATCH command was already cancelled", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-cancelled-dispatch-recovery-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  runtime.runAgentFailuresAfterStart = 1;
  const service = new CollaborationService(database, runtime, {
    coordinatorAgentId: "coordinator", allowedAgentIds: ["coordinator", "worker"], maxConcurrency: 2,
    maxWorkItems: 10, attemptTimeoutMs: 60_000, retentionDays: 365,
  }, directory, { info() {}, warn() {}, error() {} });
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "cancelled-dispatch-recovery-create",
      origin: {
        runtimeId: "runtime-cancelled-dispatch-recovery", agentId: "main",
        sessionKey: "agent:main:cancelled-dispatch-recovery",
        sessionId: "session-cancelled-dispatch-recovery",
        nativeMessageId: "message-cancelled-dispatch-recovery",
      },
      goal: "Recover the persistent planner Task",
    }));
    const runId = String(created.runId);
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
        .get(runId) as { status: string } | undefined;
      return attempt?.status === "UNKNOWN";
    });
    const originalAttempt = database.db
      .prepare("SELECT id, child_session_key, idempotency_key FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(runId) as { id: string; child_session_key: string; idempotency_key: string };
    const originalCommand = database.db
      .prepare("SELECT id FROM commands WHERE run_id = ? AND entity_id = ? AND kind = 'PLAN'")
      .get(runId, originalAttempt.id) as { id: string };
    database.db
      .prepare("UPDATE attempts SET status = 'DISPATCHING', revision = revision + 1, updated_at = ? WHERE id = ?")
      .run(Date.now(), originalAttempt.id);
    database.db
      .prepare(
        `UPDATE commands SET status = 'CANCELLED', lease_owner = NULL, lease_expires_at = NULL,
         updated_at = ? WHERE id = ?`,
      )
      .run(Date.now(), originalCommand.id);

    const blocked = database.getRunSummary(runId);
    service.reconcileRun(writeParams({
      commandId: "cancelled-dispatch-recovery-reconcile",
      runId,
      expectedRunRevision: blocked.revision,
    }));
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");

    const recoveredAttempt = database.db
      .prepare(
        `SELECT id, status, child_session_key, idempotency_key, openclaw_run_id, openclaw_task_id
         FROM attempts WHERE run_id = ? AND kind = 'PLANNER'`,
      )
      .get(runId) as {
        id: string;
        status: string;
        child_session_key: string;
        idempotency_key: string;
        openclaw_run_id: string;
        openclaw_task_id: string;
      };
    assert.equal(recoveredAttempt.id, originalAttempt.id);
    assert.equal(recoveredAttempt.child_session_key, originalAttempt.child_session_key);
    assert.equal(recoveredAttempt.idempotency_key, originalAttempt.idempotency_key);
    assert.equal(recoveredAttempt.status, "SUCCEEDED");
    assert.equal(recoveredAttempt.openclaw_run_id, runtime.runs[0]?.runId);
    assert.equal(recoveredAttempt.openclaw_task_id, `task-${runtime.runs[0]?.runId}`);
    assert.equal(database.getCommand(originalCommand.id).status, "SUCCEEDED");
    assert.equal(runtime.runAgentCalls, 1);
    assert.equal(runtime.runs.length, 1);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restart repairs the cancellation outbox when a CANCELLING Run has a recovered RUNNING Task", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-cancel-outbox-repair-"));
  const database = new CollaborationDatabase(":memory:");
  const config = {
    coordinatorAgentId: "coordinator",
    allowedAgentIds: ["coordinator", "worker"],
    maxConcurrency: 2,
    maxWorkItems: 10,
    attemptTimeoutMs: 60_000,
    retentionDays: 365,
  };
  const logger = { info() {}, warn() {}, error() {} };
  const firstRuntime = new FakeRuntime();
  firstRuntime.cancelMode = "unconfirmed";
  const firstService = new CollaborationService(database, firstRuntime, config, directory, logger);
  let secondService: CollaborationService | undefined;
  firstService.start();
  try {
    const runId = await startRunningCollaboration(firstService, database, firstRuntime, {
      runtimeId: "runtime-cancel-outbox-repair", agentId: "main",
      sessionKey: "agent:main:cancel-outbox-repair", sessionId: "session-cancel-outbox-repair",
      nativeMessageId: "message-cancel-outbox-repair",
    }, "cancel-outbox-repair");
    const running = database.getRunSummary(runId);
    firstService.cancelRun(writeParams({
      commandId: "cancel-outbox-repair-run",
      runId,
      expectedRunRevision: running.revision,
    }));
    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'WORKER' AND openclaw_run_id IS NOT NULL")
        .get(runId) as { status: string } | undefined;
      return attempt?.status === "UNKNOWN";
    });
    await firstService.stop();

    const attempt = database.db
      .prepare("SELECT id FROM attempts WHERE run_id = ? AND kind = 'WORKER' AND openclaw_run_id IS NOT NULL")
      .get(runId) as { id: string };
    database.transaction(() => {
      database.db.prepare("DELETE FROM commands WHERE run_id = ? AND kind = 'CANCEL_ATTEMPT'").run(runId);
      database.db
        .prepare("UPDATE attempts SET status = 'CANCELLING', revision = revision + 1, updated_at = ? WHERE id = ?")
        .run(Date.now(), attempt.id);
    });
    assert.equal(database.getRunSummary(runId).status, "CANCELLING");
    assert.equal(
      Number(database.db
        .prepare("SELECT COUNT(*) AS value FROM commands WHERE run_id = ? AND kind = 'CANCEL_ATTEMPT'")
        .get(runId)?.value),
      0,
    );

    const restartedRuntime = restartFakeRuntime(firstRuntime);
    restartedRuntime.cancelMode = "confirmed";
    secondService = new CollaborationService(database, restartedRuntime, config, directory, logger);
    secondService.start();
    await (secondService as unknown as { reconcileActiveRuns(): Promise<void> }).reconcileActiveRuns();
    await (secondService as unknown as { drainCommands(): Promise<void> }).drainCommands();
    await waitUntil(() => database.getRunSummary(runId).status === "CANCELLED");

    const repairedCommand = database.db
      .prepare("SELECT status FROM commands WHERE run_id = ? AND kind = 'CANCEL_ATTEMPT'")
      .get(runId) as { status: string };
    assert.equal(repairedCommand.status, "SUCCEEDED");
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attempt.id) as { status: string }).status,
      "CANCELLED",
    );
    assert.equal(restartedRuntime.runAgentCalls, 0);
    assert.equal(restartedRuntime.cancelledRunIds.length, 1);
  } finally {
    await secondService?.stop();
    await firstService.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restart drain fails a queued Worker attempt when its authorization was revoked while stopped", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-worker-auth-revoked-"));
  const database = new CollaborationDatabase(":memory:");
  const firstRuntime = new FakeRuntime();
  const firstService = createTestService(database, firstRuntime, directory);
  let restartedService: CollaborationService | undefined;
  firstService.start();
  try {
    const created = await firstService.createPlan(writeParams({
      commandId: "worker-auth-revoked-create",
      origin: {
        runtimeId: "runtime-worker-auth-revoked",
        agentId: "main",
        sessionKey: "agent:main:worker-auth-revoked",
        sessionId: "session-worker-auth-revoked",
        nativeMessageId: "message-worker-auth-revoked",
      },
      goal: "Do not dispatch after authorization is revoked",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    await firstService.stop();

    const approvalRun = database.getRunSummary(runId);
    database.updateRun(runId, approvalRun.revision, { status: "RUNNING", dispatchState: "OPEN" });
    const workItem = database.db
      .prepare("SELECT * FROM work_items WHERE run_id = ? ORDER BY created_at, id LIMIT 1")
      .get(runId) as Record<string, unknown>;
    database.db
      .prepare("UPDATE work_items SET assigned_agent_id = 'worker', status = 'READY', revision = revision + 1 WHERE id = ?")
      .run(String(workItem.id));
    const readyItem = database.db.prepare("SELECT * FROM work_items WHERE id = ?").get(String(workItem.id)) as Record<string, unknown>;
    (firstService as unknown as {
      enqueueWorkerAttempt(runId: string, item: Record<string, unknown>, commandSeed: string): void;
    }).enqueueWorkerAttempt(runId, readyItem, "worker-auth-revoked");

    const queuedAttempt = database.db
      .prepare("SELECT id, status FROM attempts WHERE run_id = ? AND kind = 'WORKER'")
      .get(runId) as { id: string; status: string };
    const queuedCommand = database.db
      .prepare("SELECT id, status FROM commands WHERE run_id = ? AND kind = 'DISPATCH'")
      .get(runId) as { id: string; status: string };
    assert.equal(queuedAttempt.status, "CREATED");
    assert.equal(queuedCommand.status, "PENDING");

    const restartedRuntime = restartFakeRuntime(firstRuntime);
    restartedRuntime.agents[1] = { ...restartedRuntime.agents[1]!, allowed: false };
    restartedService = createTestService(database, restartedRuntime, directory);
    (restartedService as unknown as { reconcileActiveRuns(): Promise<void> }).reconcileActiveRuns = async () => {};
    restartedService.start();
    await (restartedService as unknown as { drainCommands(): Promise<void> }).drainCommands();
    await waitUntil(() => database.getCommand(queuedCommand.id).status !== "PENDING");

    const attempt = database.db
      .prepare("SELECT status, last_error FROM attempts WHERE id = ?")
      .get(queuedAttempt.id) as { status: string; last_error: string };
    const item = database.db
      .prepare("SELECT status FROM work_items WHERE id = ?")
      .get(String(workItem.id)) as { status: string };
    const run = database.getRunSummary(runId);
    const persistedRun = database.getRunRow(runId);
    const intervention = database.db
      .prepare("SELECT code, entity_type, entity_id, resume_status, resolved_at FROM interventions WHERE run_id = ? AND code = 'AGENT_AUTHORIZATION_REVOKED'")
      .get(runId) as {
        code: string;
        entity_type: string;
        entity_id: string;
        resume_status: string;
        resolved_at: number | null;
      };
    assert.equal(restartedRuntime.runAgentCalls, 0);
    assert.equal(database.getCommand(queuedCommand.id).status, "FAILED");
    assert.equal(attempt.status, "FAILED");
    assert.match(attempt.last_error, /authorization/i);
    assert.equal(item.status, "NEEDS_INTERVENTION");
    assert.equal(run.status, "AWAITING_INTERVENTION");
    assert.equal(persistedRun.resume_status, "RUNNING");
    assert.equal(run.dispatchState, "STOPPED");
    assert.equal(run.reconcileState, "ATTENTION_REQUIRED");
    assert.deepEqual({ ...intervention }, {
      code: "AGENT_AUTHORIZATION_REVOKED",
      entity_type: "attempt",
      entity_id: queuedAttempt.id,
      resume_status: "RUNNING",
      resolved_at: null,
    });
    assert.equal(
      database.listEvents(runId).filter((event) => event.eventType === "AGENT_AUTHORIZATION_REVOKED").length,
      1,
    );
  } finally {
    await restartedService?.stop();
    await firstService.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restart drain fails a queued Planner attempt when coordinator authorization was revoked while stopped", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-planner-auth-revoked-"));
  const database = new CollaborationDatabase(":memory:");
  const firstRuntime = new FakeRuntime();
  const firstService = createTestService(database, firstRuntime, directory);
  let restartedService: CollaborationService | undefined;
  try {
    const created = await firstService.createPlan(writeParams({
      commandId: "planner-auth-revoked-create",
      origin: {
        runtimeId: "runtime-planner-auth-revoked",
        agentId: "main",
        sessionKey: "agent:main:planner-auth-revoked",
        sessionId: "session-planner-auth-revoked",
        nativeMessageId: "message-planner-auth-revoked",
      },
      goal: "Do not plan after coordinator authorization is revoked",
    }));
    const runId = String(created.runId);
    const queuedAttempt = database.db
      .prepare("SELECT id, status FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(runId) as { id: string; status: string };
    const queuedCommand = database.db
      .prepare("SELECT id, status FROM commands WHERE run_id = ? AND kind = 'PLAN'")
      .get(runId) as { id: string; status: string };
    assert.equal(queuedAttempt.status, "CREATED");
    assert.equal(queuedCommand.status, "PENDING");
    await firstService.stop();

    const restartedRuntime = restartFakeRuntime(firstRuntime);
    restartedRuntime.agents[0] = { ...restartedRuntime.agents[0]!, allowed: false };
    restartedService = createTestService(database, restartedRuntime, directory);
    (restartedService as unknown as { reconcileActiveRuns(): Promise<void> }).reconcileActiveRuns = async () => {};
    restartedService.start();
    await (restartedService as unknown as { drainCommands(): Promise<void> }).drainCommands();
    await waitUntil(() => database.getCommand(queuedCommand.id).status !== "PENDING");

    const run = database.getRunSummary(runId);
    const persistedRun = database.getRunRow(runId);
    const attempt = database.db
      .prepare("SELECT status FROM attempts WHERE id = ?")
      .get(queuedAttempt.id) as { status: string };
    const intervention = database.db
      .prepare("SELECT code, entity_id, resume_status FROM interventions WHERE run_id = ? AND code = 'AGENT_AUTHORIZATION_REVOKED'")
      .get(runId) as { code: string; entity_id: string; resume_status: string };
    assert.equal(restartedRuntime.runAgentCalls, 0);
    assert.equal(database.getCommand(queuedCommand.id).status, "FAILED");
    assert.equal(attempt.status, "FAILED");
    assert.equal(run.status, "AWAITING_INTERVENTION");
    assert.equal(persistedRun.resume_status, "PLANNING");
    assert.deepEqual({ ...intervention }, {
      code: "AGENT_AUTHORIZATION_REVOKED",
      entity_id: queuedAttempt.id,
      resume_status: "PLANNING",
    });
  } finally {
    await restartedService?.stop();
    await firstService.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restart drain enforces the persisted capability fence even while the target Agent remains allowed", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-capability-fence-drift-"));
  const database = new CollaborationDatabase(":memory:");
  const firstRuntime = new FakeRuntime();
  const firstService = createTestService(database, firstRuntime, directory);
  let restartedService: CollaborationService | undefined;
  try {
    const created = await firstService.createPlan(writeParams({
      commandId: "capability-fence-drift-create",
      origin: {
        runtimeId: "runtime-capability-fence-drift",
        agentId: "main",
        sessionKey: "agent:main:capability-fence-drift",
        sessionId: "session-capability-fence-drift",
        nativeMessageId: "message-capability-fence-drift",
      },
      goal: "Do not dispatch across a changed capability fence",
    }));
    const runId = String(created.runId);
    const attempt = database.db
      .prepare("SELECT id FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(runId) as { id: string };
    const command = database.db
      .prepare("SELECT id FROM commands WHERE run_id = ? AND kind = 'PLAN'")
      .get(runId) as { id: string };
    await firstService.stop();

    const restartedRuntime = restartFakeRuntime(firstRuntime);
    restartedRuntime.agents[1] = { ...restartedRuntime.agents[1]!, name: "Renamed Worker" };
    assert.equal(restartedRuntime.agents[0]?.allowed, true);
    restartedService = createTestService(database, restartedRuntime, directory);
    (restartedService as unknown as { reconcileActiveRuns(): Promise<void> }).reconcileActiveRuns = async () => {};
    restartedService.start();
    await (restartedService as unknown as { drainCommands(): Promise<void> }).drainCommands();
    await waitUntil(() => database.getCommand(command.id).status === "FAILED");

    const event = database.listEvents(runId)
      .find((candidate) => candidate.eventType === "AGENT_AUTHORIZATION_REVOKED");
    assert.equal(restartedRuntime.runAgentCalls, 0);
    assert.equal(
      (database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(attempt.id) as { status: string }).status,
      "FAILED",
    );
    assert.equal(database.getRunSummary(runId).status, "AWAITING_INTERVENTION");
    assert.equal(event?.payload.reason, "CAPABILITY_FENCE_CHANGED");
  } finally {
    await restartedService?.stop();
    await firstService.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a revised plan dispatches and settles only its current work graph", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-current-plan-graph-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "current-plan-graph-create",
      origin: {
        runtimeId: "runtime-current-plan-graph",
        agentId: "main",
        sessionKey: "agent:main:current-plan-graph",
        sessionId: "session-current-plan-graph",
        nativeMessageId: "message-current-plan-graph",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const first = database.getRunSummary(runId);
    const firstPlanRevisionId = first.currentPlanRevisionId!;
    database.db
      .prepare(
        `UPDATE work_items SET status = CASE logical_id
           WHEN 'research' THEN 'READY' ELSE 'NEEDS_INTERVENTION' END
         WHERE run_id = ? AND plan_revision_id = ?`,
      )
      .run(runId, firstPlanRevisionId);

    runtime.plannerText = JSON.stringify({
      ...plan,
      synthesis: {
        ...plan.synthesis,
        finalAnswerContract: "Return the revised concise recommendation",
      },
    });
    service.revisePlan(writeParams({
      commandId: "current-plan-graph-revise",
      runId,
      expectedRunRevision: first.revision,
      instruction: "Use the revised acceptance contract",
    }));
    await waitUntil(() => {
      const run = database.getRunSummary(runId);
      return run.status === "AWAITING_APPROVAL" && run.currentPlanRevisionId !== firstPlanRevisionId;
    });

    const second = database.getRunSummary(runId);
    service.approvePlan(writeParams({
      commandId: "current-plan-graph-approve",
      runId,
      planRevisionId: second.currentPlanRevisionId,
      expectedRunRevision: second.revision,
      assignments: { research: "worker", review: "worker" },
    }));
    await waitUntil(() => database.getRunSummary(runId).status === "COMPLETED");

    const historicalWorkerAttempts = database.db
      .prepare(
        `SELECT COUNT(*) AS value FROM attempts a
         JOIN work_items w ON w.id = a.work_item_id
         WHERE w.plan_revision_id = ? AND a.kind = 'WORKER'`,
      )
      .get(firstPlanRevisionId) as { value: number };
    const currentWorkerAttempts = database.db
      .prepare(
        `SELECT COUNT(*) AS value FROM attempts a
         JOIN work_items w ON w.id = a.work_item_id
         WHERE w.plan_revision_id = ? AND a.kind = 'WORKER'`,
      )
      .get(second.currentPlanRevisionId) as { value: number };
    assert.equal(historicalWorkerAttempts.value, 0);
    assert.equal(currentWorkerAttempts.value, 2);
    assert.equal(
      (database.db
        .prepare("SELECT status FROM work_items WHERE run_id = ? AND plan_revision_id = ? AND logical_id = 'research'")
        .get(runId, firstPlanRevisionId) as { status: string }).status,
      "READY",
    );
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("plan revision waits for active Attempts across kinds and historical revisions to settle", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-revise-worker-fence-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "revise-worker-fence-create",
      origin: {
        runtimeId: "runtime-revise-worker-fence",
        agentId: "main",
        sessionKey: "agent:main:revise-worker-fence",
        sessionId: "session-revise-worker-fence",
        nativeMessageId: "message-revise-worker-fence",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    await service.stop();

    const planned = database.getRunSummary(runId);
    const workItem = database.db
      .prepare("SELECT id FROM work_items WHERE run_id = ? AND plan_revision_id = ? AND logical_id = 'research'")
      .get(runId, planned.currentPlanRevisionId) as { id: string };
    const attemptId = "attempt-revise-worker-fence";
    const timestamp = Date.now();
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'AWAITING_INTERVENTION', dispatch_state = 'STOPPED', revision = revision + 1 WHERE id = ?")
      .run(runId);
    database.db
      .prepare("UPDATE work_items SET status = 'NEEDS_INTERVENTION', revision = revision + 1, updated_at = ? WHERE id = ?")
      .run(timestamp, workItem.id);
    database.db
      .prepare(
        `INSERT INTO attempts(
          id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
          worker_owner_session_key, child_session_key, status, input_json, revision, created_at, updated_at
        ) VALUES (?, ?, ?, 'WORKER', 1, ?, 'worker', 'agent:worker:main', ?, 'UNKNOWN', '{}', 1, ?, ?)`,
      )
      .run(attemptId, runId, workItem.id, "effect-revise-worker-fence", "agent:worker:subagent:revise-worker-fence", timestamp, timestamp);

    const blocked = database.getRunSummary(runId);
    assert.throws(
      () => service.revisePlan(writeParams({
        commandId: "revise-worker-fence-blocked",
        runId,
        expectedRunRevision: blocked.revision,
        instruction: "Revise only after the worker is resolved",
      })),
      (error: unknown) => error instanceof CollaborationError
        && error.code === "ACTIVE_ATTEMPT_EXISTS"
        && /cancel|resolve/i.test(error.message),
    );

    service.resolveUnknownAttempt(writeParams({
      commandId: "revise-worker-fence-resolve",
      runId,
      attemptId,
      resolution: "CANCELLED",
      expectedRunRevision: blocked.revision,
      expectedEntityRevision: 1,
    }));
    const workerResolved = database.getRunSummary(runId);
    const historicalSynthesizerAttemptId = "attempt-revise-historical-synthesizer";
    database.db
      .prepare(
        `INSERT INTO plan_revisions(id, run_id, revision_no, plan_json, digest, created_at)
         VALUES ('plan-revise-worker-fence-current', ?, 2, ?, 'digest-revise-worker-fence-current', ?)`,
      )
      .run(runId, JSON.stringify(plan), timestamp + 1);
    database.db
      .prepare(
        `UPDATE collaboration_runs SET current_plan_revision_id = 'plan-revise-worker-fence-current',
         revision = revision + 1 WHERE id = ?`,
      )
      .run(runId);
    database.db
      .prepare(
        `INSERT INTO attempts(
          id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
          worker_owner_session_key, child_session_key, status, input_json, revision, created_at, updated_at
        ) VALUES (?, ?, NULL, 'SYNTHESIZER', 1, ?, 'coordinator', 'agent:coordinator:main', ?,
          'UNKNOWN', ?, 1, ?, ?)`,
      )
      .run(
        historicalSynthesizerAttemptId,
        runId,
        "effect-revise-historical-synthesizer",
        "agent:coordinator:subagent:revise-historical-synthesizer",
        JSON.stringify({ planRevisionId: planned.currentPlanRevisionId }),
        timestamp + 2,
        timestamp + 2,
      );
    const historicalBlocked = database.getRunSummary(runId);
    assert.equal(historicalBlocked.revision, workerResolved.revision + 1);
    assert.throws(
      () => service.revisePlan(writeParams({
        commandId: "revise-historical-synthesizer-blocked",
        runId,
        expectedRunRevision: historicalBlocked.revision,
        instruction: "Do not cross the historical synthesis epoch",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "ACTIVE_ATTEMPT_EXISTS",
    );
    service.resolveUnknownAttempt(writeParams({
      commandId: "revise-historical-synthesizer-resolve",
      runId,
      attemptId: historicalSynthesizerAttemptId,
      resolution: "CANCELLED",
      expectedRunRevision: historicalBlocked.revision,
      expectedEntityRevision: 1,
    }));

    const resolved = database.getRunSummary(runId);
    const accepted = service.revisePlan(writeParams({
      commandId: "revise-worker-fence-accepted",
      runId,
      expectedRunRevision: resolved.revision,
      instruction: "Create the replacement plan",
    }));
    assert.equal(accepted.runId, runId);
    assert.equal(database.getRunSummary(runId).status, "PLANNING");
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("historical work-item commands and partial waivers cannot cross the current plan pointer", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-historical-work-item-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "historical-work-item-create",
      origin: {
        runtimeId: "runtime-historical-work-item",
        agentId: "main",
        sessionKey: "agent:main:historical-work-item",
        sessionId: "session-historical-work-item",
        nativeMessageId: "message-historical-work-item",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    const first = database.getRunSummary(runId);
    const firstPlanRevisionId = first.currentPlanRevisionId!;
    service.revisePlan(writeParams({
      commandId: "historical-work-item-revise",
      runId,
      expectedRunRevision: first.revision,
      instruction: "Create a clean replacement plan",
    }));
    await waitUntil(() => {
      const run = database.getRunSummary(runId);
      return run.status === "AWAITING_APPROVAL" && run.currentPlanRevisionId !== firstPlanRevisionId;
    });
    await service.stop();

    const current = database.getRunSummary(runId);
    const historical = database.db
      .prepare("SELECT id, revision FROM work_items WHERE run_id = ? AND plan_revision_id = ? AND logical_id = 'research'")
      .get(runId, firstPlanRevisionId) as { id: string; revision: number };
    database.db
      .prepare("UPDATE work_items SET status = 'CANCELLED', revision = revision + 1 WHERE id = ?")
      .run(historical.id);
    database.db
      .prepare(
        `UPDATE work_items SET status = CASE logical_id
           WHEN 'research' THEN 'NEEDS_INTERVENTION' ELSE 'CANCELLED' END,
           revision = revision + 1
         WHERE run_id = ? AND plan_revision_id = ?`,
      )
      .run(runId, current.currentPlanRevisionId);
    database.db
      .prepare("UPDATE collaboration_runs SET status = 'AWAITING_INTERVENTION', dispatch_state = 'STOPPED', revision = revision + 1 WHERE id = ?")
      .run(runId);
    const intervention = database.getRunSummary(runId);
    const historicalRevision = historical.revision + 1;

    for (const invoke of [
      () => service.retryWorkItem(writeParams({
        commandId: "historical-work-item-retry",
        workItemId: historical.id,
        expectedRunRevision: intervention.revision,
        expectedEntityRevision: historicalRevision,
      })),
      () => service.reassignWorkItem(writeParams({
        commandId: "historical-work-item-reassign",
        workItemId: historical.id,
        agentId: "worker",
        expectedRunRevision: intervention.revision,
        expectedEntityRevision: historicalRevision,
      })),
    ]) {
      assert.throws(
        invoke,
        (error: unknown) => error instanceof CollaborationError && error.code === "REVISION_CONFLICT",
      );
    }

    const preview = service.partialPreview({ runId, workItemIds: ["research"] });
    service.acceptPartial(writeParams({
      commandId: "historical-work-item-partial",
      runId,
      workItemIds: ["research"],
      expiresAt: preview.expiresAt,
      confirmationToken: preview.confirmationToken,
      expectedRunRevision: intervention.revision,
    }));
    assert.equal(
      (database.db.prepare("SELECT status FROM work_items WHERE id = ?").get(historical.id) as { status: string }).status,
      "CANCELLED",
    );
    const currentStatuses = database.db
      .prepare("SELECT status FROM work_items WHERE run_id = ? AND plan_revision_id = ? ORDER BY logical_id")
      .all(runId, current.currentPlanRevisionId) as Array<{ status: string }>;
    assert.deepEqual(currentStatuses.map((item) => item.status), ["WAIVED", "WAIVED"]);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a worker completion from a historical plan cannot commit across the plan epoch", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-late-worker-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  try {
    const runId = "run-late-worker";
    const origin: OriginRef = {
      runtimeId: "runtime-late-worker",
      agentId: "main",
      sessionKey: "agent:main:late-worker",
      sessionId: "session-late-worker",
      nativeMessageId: "message-late-worker",
    };
    database.createRun({ id: runId, origin, goal: "Assess a launch proposal", capabilitySnapshot: {} });
    const timestamp = Date.now();
    for (const [revisionId, revisionNo] of [["plan-old", 1], ["plan-current", 2]] as const) {
      database.db
        .prepare(
          `INSERT INTO plan_revisions(id, run_id, revision_no, plan_json, digest, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(revisionId, runId, revisionNo, JSON.stringify(plan), `digest-${revisionNo}`, timestamp + revisionNo);
    }
    database.db
      .prepare(
        `INSERT INTO work_items(
          id, run_id, plan_revision_id, logical_id, title, input_scope_json, dependencies_json,
          required_capabilities_json, candidate_agent_ids_json, acceptance_criteria_json,
          risk_level, side_effect_class, assigned_agent_id, status, revision, created_at, updated_at
        ) VALUES ('work-old', ?, 'plan-old', 'research', 'Old research', '[]', '[]', '[]', '["worker"]', '[]',
          'LOW', 'READ_ONLY', 'worker', 'RUNNING', 1, ?, ?)`,
      )
      .run(runId, timestamp, timestamp);
    database.db
      .prepare(
        `INSERT INTO attempts(
          id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
          worker_owner_session_key, child_session_key, status, input_json, revision, started_at, created_at, updated_at
        ) VALUES ('attempt-old', ?, 'work-old', 'WORKER', 1, 'effect-old', 'worker',
          'agent:worker:main', 'agent:worker:subagent:old', 'RUNNING', '{}', 1, ?, ?, ?)`,
      )
      .run(runId, timestamp, timestamp, timestamp);
    database.db
      .prepare(
        `UPDATE collaboration_runs SET current_plan_revision_id = 'plan-current', status = 'RUNNING',
         dispatch_state = 'OPEN', revision = revision + 1 WHERE id = ?`,
      )
      .run(runId);

    const attempt = database.db.prepare("SELECT * FROM attempts WHERE id = 'attempt-old'").get() as never;
    (service as unknown as { completeWorkerAttempt(attempt: never, text: string): void }).completeWorkerAttempt(
      attempt,
      JSON.stringify({
        summary: "Late result",
        outcome: "SUCCEEDED",
        evidence: [{
          type: "analysis",
          title: "Late old evidence",
          reference: "old-plan",
          verification: "too late",
        }],
        createdArtifacts: [],
        handoffNotes: [],
      }),
    );

    assert.notEqual(
      (database.db.prepare("SELECT status FROM attempts WHERE id = 'attempt-old'").get() as { status: string }).status,
      "SUCCEEDED",
    );
    assert.equal(
      (database.db.prepare("SELECT status FROM work_items WHERE id = 'work-old'").get() as { status: string }).status,
      "RUNNING",
    );
    assert.equal(
      (database.db.prepare("SELECT COUNT(*) AS value FROM evidence WHERE run_id = ?").get(runId) as { value: number }).value,
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("forged origin runtimes cannot create parallel runs and exact instance commands still replay", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-instance-origin-"));
  const database = new CollaborationDatabase(":memory:");
  const service = createTestService(database, new FakeRuntime(), directory);
  try {
    const baseOrigin = {
      agentId: "main",
      sessionKey: "agent:main:instance-origin",
      sessionId: "session-instance-origin",
      nativeMessageId: "message-instance-origin",
    };
    const firstRequest = writeParams({
      commandId: "instance-origin-create-a",
      origin: { ...baseOrigin, runtimeId: "forged-runtime-a" },
      goal: "Enforce one authoritative runtime",
    });
    const first = await service.createPlan(firstRequest);
    const replay = await service.createPlan(firstRequest);

    assert.equal(first.collaborationInstanceId, database.instanceId);
    assert.equal(replay.collaborationInstanceId, database.instanceId);
    assert.equal(replay.replayed, true);
    assert.equal(replay.runId, first.runId);
    assert.equal(database.getRunSummary(String(first.runId)).origin.runtimeId, database.instanceId);

    await assert.rejects(
      service.createPlan(writeParams({
        commandId: "instance-origin-create-b",
        origin: {
          ...baseOrigin,
          runtimeId: "forged-runtime-b",
          nativeMessageId: "message-instance-origin-b",
        },
        goal: "Attempt a parallel run through another forged runtime",
      })),
      (error: unknown) => error instanceof CollaborationError && error.code === "ACTIVE_RUN_EXISTS",
    );
    assert.equal(database.listRuns({ includeArchived: true }).length, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("commands captured before database replacement fail closed across plan maintenance and session mutation", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-instance-replacement-"));
  const previousDatabase = new CollaborationDatabase(":memory:");
  const staleInstanceId = previousDatabase.instanceId;
  const stalePlan = writeParams({
    commandId: "stale-instance-plan",
    origin: {
      runtimeId: "forged-stale-origin",
      agentId: "main",
      sessionKey: "agent:main:stale-instance",
      sessionId: "session-stale-instance",
      nativeMessageId: "message-stale-instance",
    },
    goal: "This command belongs to the replaced database",
  });
  const staleMaintenance = writeParams({
    commandId: "stale-instance-maintenance",
    reason: "replacement-test",
  });
  const stalePrepare = writeParams({
    commandId: "stale-instance-session-prepare",
    sessionKey: "agent:main:stale-instance",
    sessionId: "session-stale-instance",
    action: "delete",
    policy: "PROCEED",
  });
  const staleComplete = writeParams({
    commandId: "stale-instance-session-complete",
    mutationId: "mutation-from-replaced-database",
    success: false,
  });

  const replacementDatabase = new CollaborationDatabase(":memory:");
  const replacementService = createTestService(replacementDatabase, new FakeRuntime(), directory);
  const isInstanceMismatch = (error: unknown) => error instanceof CollaborationError
    && error.code === "INSTANCE_MISMATCH"
    && error.details?.expectedCollaborationInstanceId === staleInstanceId
    && error.details?.actualCollaborationInstanceId === replacementDatabase.instanceId;
  try {
    assert.notEqual(replacementDatabase.instanceId, staleInstanceId);
    await assert.rejects(replacementService.createPlan(stalePlan), isInstanceMismatch);
    assert.throws(() => replacementService.enterMaintenance(staleMaintenance), isInstanceMismatch);
    assert.throws(() => replacementService.prepareSessionMutation(stalePrepare), isInstanceMismatch);
    assert.throws(() => replacementService.completeSessionMutation(staleComplete), isInstanceMismatch);
    assert.throws(
      () => replacementService.sessionMutationImpact({
        runtimeId: staleInstanceId,
        sessionKey: "agent:main:stale-instance",
        sessionId: "session-stale-instance",
        action: "delete",
      }),
      isInstanceMismatch,
    );
    assert.equal(replacementDatabase.listRuns({ includeArchived: true }).length, 0);
    assert.equal(replacementDatabase.getMetadata("maintenance_lease"), null);
    assert.equal(
      Number(replacementDatabase.db.prepare("SELECT COUNT(*) AS value FROM session_mutations").get()?.value),
      0,
    );
  } finally {
    previousDatabase.close();
    replacementDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a hung runAgent becomes UNKNOWN without blocking the next durable command or accepting a late result", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-runtime-deadline-dispatch-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const firstStarted = deferred();
  const releaseFirst = deferred();
  runtime.runAgentReturnBarrier = async () => {
    if (runtime.runAgentCalls !== 1) return;
    firstStarted.resolve();
    await releaseFirst.promise;
  };
  const service = createTestService(
    database,
    runtime,
    directory,
    { info() {}, warn() {}, error() {} },
    testRuntimeDeadlinePolicy({ runAgent: 15 }),
  );
  service.start();
  try {
    const first = await service.createPlan(writeParams({
      commandId: "deadline-dispatch-first",
      origin: {
        runtimeId: "runtime-deadline-dispatch",
        agentId: "main",
        sessionKey: "agent:main:deadline-dispatch-first",
        sessionId: "session-deadline-dispatch-first",
        nativeMessageId: "message-deadline-dispatch-first",
      },
      goal: "The first planner call has an unknown remote outcome",
    }));
    const firstRunId = String(first.runId);
    await waitForSignal(firstStarted.promise);

    const second = await service.createPlan(writeParams({
      commandId: "deadline-dispatch-second",
      origin: {
        runtimeId: "runtime-deadline-dispatch",
        agentId: "main",
        sessionKey: "agent:main:deadline-dispatch-second",
        sessionId: "session-deadline-dispatch-second",
        nativeMessageId: "message-deadline-dispatch-second",
      },
      goal: "The command behind the hung planner call must still execute",
    }));
    const secondRunId = String(second.runId);

    await waitUntil(() => {
      const attempt = database.db
        .prepare("SELECT status FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
        .get(firstRunId) as { status?: string } | undefined;
      return attempt?.status === "UNKNOWN";
    });
    await waitUntil(() => database.getRunSummary(secondRunId).status === "AWAITING_APPROVAL");

    const firstAttemptBeforeLateResult = database.db
      .prepare("SELECT status, openclaw_run_id, last_error FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(firstRunId) as { status: string; openclaw_run_id: string | null; last_error: string };
    const firstCommandBeforeLateResult = database.getCommand("deadline-dispatch-first");
    assert.equal(firstAttemptBeforeLateResult.status, "UNKNOWN");
    assert.equal(firstAttemptBeforeLateResult.openclaw_run_id, null);
    assert.match(firstAttemptBeforeLateResult.last_error, /deadline/i);
    assert.equal(firstCommandBeforeLateResult.status, "UNKNOWN");
    assert.equal(runtime.runAgentCalls, 2);

    releaseFirst.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const firstAttemptAfterLateResult = database.db
      .prepare("SELECT status, openclaw_run_id FROM attempts WHERE run_id = ? AND kind = 'PLANNER'")
      .get(firstRunId) as { status: string; openclaw_run_id: string | null };
    assert.equal(firstAttemptAfterLateResult.status, "UNKNOWN");
    assert.equal(firstAttemptAfterLateResult.openclaw_run_id, null);
    assert.equal(database.getCommand("deadline-dispatch-first").status, "UNKNOWN");
    assert.equal(runtime.runAgentCalls, 2);
  } finally {
    releaseFirst.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a hung transcript append preserves one UNKNOWN effect and ignores its late acknowledgement", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-runtime-deadline-delivery-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const releaseAppend = deferred();
  runtime.appendBarrier = async () => releaseAppend.promise;
  const service = createTestService(
    database,
    runtime,
    directory,
    { info() {}, warn() {}, error() {} },
    testRuntimeDeadlinePolicy({ appendTranscript: 15 }),
  );
  service.start();
  try {
    const { runId, deliveryId } = await startCollaborationUntilDelivery(
      service,
      database,
      {
        runtimeId: "runtime-deadline-delivery",
        agentId: "main",
        sessionKey: "agent:main:deadline-delivery",
        sessionId: "session-deadline-delivery",
        nativeMessageId: "message-deadline-delivery",
      },
      "deadline-delivery",
      "UNKNOWN",
      15_000,
    );
    const beforeLateResult = database.db
      .prepare(
        `SELECT d.status, d.transcript_status, da.status AS attempt_status, da.effect_key,
                c.status AS command_status, c.last_error
         FROM deliveries d
         JOIN delivery_attempts da ON da.delivery_id = d.id
         JOIN commands c ON c.entity_id = d.id AND c.kind = 'DELIVER'
         WHERE d.id = ?`,
      )
      .get(deliveryId) as {
        status: string;
        transcript_status: string;
        attempt_status: string;
        effect_key: string;
        command_status: string;
        last_error: string;
      };
    assert.equal(beforeLateResult.status, "UNKNOWN");
    assert.equal(beforeLateResult.transcript_status, "UNKNOWN");
    assert.equal(beforeLateResult.attempt_status, "UNKNOWN");
    assert.equal(beforeLateResult.command_status, "UNKNOWN");
    assert.match(beforeLateResult.last_error, /deadline/i);

    releaseAppend.resolve();
    await waitUntil(() => runtime.transcript.length === 1);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const afterLateResult = database.db
      .prepare("SELECT status, transcript_status FROM deliveries WHERE id = ?")
      .get(deliveryId) as { status: string; transcript_status: string };
    const deliveryAttempts = database.db
      .prepare("SELECT status, effect_key FROM delivery_attempts WHERE delivery_id = ? ORDER BY attempt_no")
      .all(deliveryId) as Array<{ status: string; effect_key: string }>;
    assert.equal(afterLateResult.status, "UNKNOWN");
    assert.equal(afterLateResult.transcript_status, "UNKNOWN");
    assert.deepEqual(
      deliveryAttempts.map((attempt) => ({ status: attempt.status, effectKey: attempt.effect_key })),
      [{ status: "UNKNOWN", effectKey: beforeLateResult.effect_key }],
    );
    assert.equal(database.getRunSummary(runId).status, "DELIVERY_PENDING");
    assert.equal(runtime.transcript.length, 1);
  } finally {
    releaseAppend.resolve();
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("work-item retry resolves the terminal predecessor Attempt intervention", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-retry-intervention-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const runId = await startRunningCollaboration(
      service,
      database,
      runtime,
      {
        runtimeId: "runtime-retry-intervention",
        agentId: "main",
        sessionKey: "agent:main:retry-intervention",
        sessionId: "session-retry-intervention",
        nativeMessageId: "message-retry-intervention",
      },
      "retry-intervention",
    );
    await service.stop();

    const failedAttempt = database.db
      .prepare(
        `SELECT a.* FROM attempts a
         JOIN work_items w ON w.id = a.work_item_id
         WHERE a.run_id = ? AND w.logical_id = 'research' AND a.status = 'RUNNING'
         ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(runId) as Record<string, unknown>;
    const failAttempt = service as unknown as {
      failAttempt(attempt: Record<string, unknown>, message: string, status: "FAILED", code: string): boolean;
    };
    assert.equal(
      failAttempt.failAttempt(failedAttempt, "simulated worker failure", "FAILED", "WORKER_REPORTED_FAILURE"),
      true,
    );
    const failedRun = database.getRunSummary(runId);
    const workItem = database.db
      .prepare("SELECT id, revision FROM work_items WHERE run_id = ? AND logical_id = 'research' AND plan_revision_id = ?")
      .get(runId, failedRun.currentPlanRevisionId) as { id: string; revision: number };
    const beforeRetryInterventions = database.db
      .prepare("SELECT entity_type, entity_id, resolved_at FROM interventions WHERE run_id = ? ORDER BY created_at")
      .all(runId) as Array<{ entity_type: string; entity_id: string; resolved_at: number | null }>;
    assert.ok(beforeRetryInterventions.some((row) => row.entity_type === "attempt" && row.resolved_at == null));

    service.retryWorkItem(writeParams({
      commandId: "retry-intervention-command",
      runId,
      workItemId: workItem.id,
      expectedRunRevision: failedRun.revision,
      expectedEntityRevision: workItem.revision,
    }));

    const afterRetryInterventions = database.db
      .prepare("SELECT entity_type, entity_id, resolved_at, resolution_json FROM interventions WHERE run_id = ? ORDER BY created_at")
      .all(runId) as Array<{ entity_type: string; entity_id: string; resolved_at: number | null; resolution_json: string | null }>;
    assert.ok(afterRetryInterventions.every((row) => row.resolved_at != null));
    assert.ok(afterRetryInterventions.every((row) => JSON.parse(row.resolution_json ?? "{}").resolution === "retry"));
    assert.equal(database.getRunSummary(runId).status, "RUNNING");
    assert.equal(database.getRunSummary(runId).reconcileState, "IDLE");
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("run cancellation resolves superseded local interventions but preserves external blockers", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "junqi-collab-cancel-intervention-"));
  const database = new CollaborationDatabase(":memory:");
  const runtime = new FakeRuntime();
  const service = createTestService(database, runtime, directory);
  service.start();
  try {
    const created = await service.createPlan(writeParams({
      commandId: "cancel-intervention-create",
      origin: {
        runtimeId: "runtime-cancel-intervention",
        agentId: "main",
        sessionKey: "agent:main:cancel-intervention",
        sessionId: "session-cancel-intervention",
        nativeMessageId: "message-cancel-intervention",
      },
      goal: "Assess a launch proposal",
    }));
    const runId = String(created.runId);
    await waitUntil(() => database.getRunSummary(runId).status === "AWAITING_APPROVAL");
    await service.stop();

    const run = database.getRunSummary(runId);
    const updated = database.updateRun(runId, run.revision, {
      status: "AWAITING_INTERVENTION",
      dispatchState: "STOPPED",
      resumeStatus: "RUNNING",
      reconcileState: "IDLE",
    });
    void updated;
    const insertIntervention = service as unknown as {
      insertIntervention(
        runId: string,
        code: string,
        entityType: string | null,
        entityId: string | null,
        requiredAction: string,
        diagnostics: Record<string, unknown>,
        resumeStatus: string,
      ): void;
    };
    insertIntervention.insertIntervention(
      runId,
      "DISPATCH_STOPPED",
      null,
      null,
      "Resume dispatch or cancel the run",
      {},
      "RUNNING",
    );
    insertIntervention.insertIntervention(
      runId,
      "FLOW_RECOVERY_CONFLICT",
      "command",
      "flow-conflict-1",
      "Resolve the conflicting Flow before deleting",
      {},
      "AWAITING_INTERVENTION",
    );
    const cancellable = database.getRunSummary(runId);
    service.cancelRun(writeParams({
      commandId: "cancel-intervention-command",
      runId,
      expectedRunRevision: cancellable.revision,
    }));

    const terminal = database.getRunSummary(runId);
    assert.equal(terminal.status, "CANCELLED");
    assert.equal(terminal.reconcileState, "ATTENTION_REQUIRED");
    const interventions = database.db
      .prepare("SELECT code, resolved_at FROM interventions WHERE run_id = ? ORDER BY created_at")
      .all(runId) as Array<{ code: string; resolved_at: number | null }>;
    assert.equal(interventions.find((row) => row.code === "DISPATCH_STOPPED")?.resolved_at != null, true);
    assert.equal(interventions.find((row) => row.code === "FLOW_RECOVERY_CONFLICT")?.resolved_at, null);
  } finally {
    await service.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
