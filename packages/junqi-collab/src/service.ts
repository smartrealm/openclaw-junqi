import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import type { SQLOutputValue } from "node:sqlite";
import { CollaborationDatabase, type RunListCursor } from "./database.js";
import { AgentDispatchNotStartedError } from "./agent-dispatcher.js";
import { DatabaseHealthMonitor } from "./database-health-monitor.js";
import {
  CURRENT_PLAN_ACTIVE_ATTEMPT_STATUSES,
  CurrentPlanScopeRepository,
} from "./current-plan-scope-repository.js";
import {
  decideAgentDispatchAuthorization,
  type AgentDispatchAuthorizationDecision,
  type AgentDispatchKind,
} from "./agent-authorization-specification.js";
import {
  assertRunTransition,
  computePartialClosure,
  parseAndValidatePlan,
  parseWorkerResult,
  plannerPrompt,
  synthesizerPrompt,
  validateWriteEnvelope,
  workerPrompt,
} from "./domain.js";
import { CollaborationError, assertCondition } from "./errors.js";
import { InstanceIdentitySpecification } from "./instance-identity-specification.js";
import { MaintenanceLeaseRepository } from "./maintenance-lease-repository.js";
import {
  MaintenanceLeaseSpecification,
  type MaintenanceLease,
  type MaintenanceLeaseInspection,
} from "./maintenance-lease-specification.js";
import {
  buildTranscriptDeliveryEffectKey,
  decideTranscriptDeliveryEffect,
  normalizeTranscriptDeliverySpec,
  sameTranscriptTarget,
} from "./delivery-specification.js";
import {
  BackgroundLifecycleSupervisor,
  LifecycleAbortedError,
  LifecycleClosedError,
} from "./async-lifecycle.js";
import {
  decideAttemptRecovery,
  decideTaskRecovery,
  type TaskLookupObservation,
} from "./task-recovery-policy.js";
import { verifyManagedFlowProvisioning } from "./managed-flow-provisioning-specification.js";
import {
  assessManagedFlowClosure,
  type ClosingRunStatus,
  type ManagedFlowClosureAssessment,
} from "./managed-flow-closure-specification.js";
import { decideProvisionExecution } from "./provision-execution-policy.js";
import {
  decideTerminalAttemptCompletion,
  type TerminalAttemptCompletionDecision,
} from "./terminal-attempt-completion-policy.js";
import { decideWorkerPhaseRestoration } from "./worker-phase-restoration-policy.js";
import { SettlementSpecification } from "./settlement-specification.js";
import {
  PartialDecisionSpecification,
  type DurablePartialDecisionPayload,
} from "./partial-decision-specification.js";
import { decidePartialApplication } from "./partial-application-policy.js";
import {
  decideRunCancellationInterventionResolution,
  decideWorkItemRetryInterventionResolution,
} from "./intervention-resolution-policy.js";
import {
  ResidualExecutionRiskSpecification,
  type ResidualCancellationEvidence,
  type ResidualExecutionRiskDecision,
} from "./residual-execution-risk-specification.js";
import { RunDeletionRepository } from "./run-deletion-repository.js";
import { CommandHandlerRegistry } from "./command-handler-registry.js";
import { WorkflowTemplateRepository } from "./workflow-template-repository.js";
import {
  materializeWorkflowTemplatePlan,
  workflowTemplateDefinitionFromPlan,
} from "./workflow-template-domain.js";
import {
  DEFAULT_RUNTIME_DEADLINE_POLICY,
  type RuntimeDeadlinePolicy,
  type RuntimeOperation,
  withRuntimeDeadline,
} from "./runtime-deadline.js";
import {
  assessExplicitRunDeletion,
  assessRetentionRunDeletion,
  assessRunDeletionPreview,
  recoverFlowReconciliationAbandonment,
  type FlowReconciliationAbandonment,
  type RunDeletionAssessment,
} from "./run-deletion-policy.js";
import {
  PERSISTENCE_LIMITS,
  assertAttemptNumber,
  assertBoundedJson,
  assertBoundedStringArray,
  assertBoundedText,
  assertOriginBounded,
  assertPersistableText,
  boundedDiagnostic,
  byteLength,
  sanitizeConfiguredAgents,
  sanitizeDesktopObservedFacts,
  sanitizeStoredJsonForOutput,
} from "./persistence-policy.js";
import { RUN_STATUSES } from "./types.js";
import type {
  AgentTaskLookupResult,
  AgentTaskStatus,
  AgentExecutionRuntime,
  AttemptStatus,
  CapabilityAgent,
  CollaborationPlan,
  CommandRecord,
  OriginRef,
  PluginConfig,
  RunStatus,
  RuntimeAdapter,
  SessionMutationAction,
  SessionMutationPolicy,
  SessionMutationStatus,
} from "./types.js";
import {
  latestAssistantText,
  newId,
  nowMs,
  parseJsonObject,
  readInteger,
  readOptionalString,
  readString,
  sha256,
  stableStringify,
} from "./util.js";
import { PLUGIN_VERSION } from "./version.js";

type SqlRow = Record<string, SQLOutputValue>;
type WorkItemWriteEnvelope = ReturnType<typeof validateWriteEnvelope> & { expectedEntityRevision: number };
type DeliveryWriteEnvelope = ReturnType<typeof validateWriteEnvelope> & { expectedEntityRevision: number };
type FailureRetrySchedulingResult = "SCHEDULED" | "EXHAUSTED" | "LEASE_LOST";

interface FailureRetryPolicy {
  maxFailures: number;
  backoffMs: readonly [number, ...number[]];
}

const ACTIVE_ATTEMPT_STATUSES = [...CURRENT_PLAN_ACTIVE_ATTEMPT_STATUSES];
const TERMINAL_RUN_STATUSES = ["COMPLETED", "CANCELLED", "FAILED"];
const WORK_ITEM_INPUT_STATUSES = ["BLOCKED", "READY", "NEEDS_INTERVENTION", "CANCELLED"];
const WORK_ITEM_CANCEL_STATUSES = ["BLOCKED", "READY", "DISPATCHING", "RUNNING", "NEEDS_INTERVENTION"];
const ACTIVE_RUN_STATUSES_SQL = "'COMPLETED','CANCELLED','FAILED'";
const COMMAND_LEASE_MS = 30_000;
// Digesting a run and synchronously staging its exports are bounded local
// work. Use a longer lease for that phase and re-check ownership in the write
// transaction before the first filesystem mutation.
const LOCAL_ARTIFACT_COMMAND_LEASE_MS = 5 * 60_000;
const COMMAND_BATCH_SIZE = 16;
const MAX_AUTOMATIC_CANCEL_COMMANDS = 3;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const INFRASTRUCTURE_DEFER_MS = 5_000;
const PROVISION_RETRY_POLICY = {
  maxFailures: 3,
  backoffMs: [1_000, 5_000],
} as const satisfies FailureRetryPolicy;
const FLOW_SYNC_RETRY_POLICY = {
  maxFailures: 5,
  backoffMs: [1_000, 5_000, 30_000, 120_000],
} as const satisfies FailureRetryPolicy;
const WATCH_SLICE_MS = 30_000;
const SESSION_MUTATION_LEASE_MS = 2 * 60_000;
const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
const RETENTION_SWEEP_BATCH_SIZE = 25;
const RETENTION_SWEEP_SCAN_SIZE = 500;
const RETENTION_SWEEP_TIME_BUDGET_MS = 250;
const RETENTION_CONTINUATION_DELAY_MS = 1_000;
const DELETION_STAGING_DIRECTORY = ".delete-staging";
const EXPORT_MATERIALIZATION_BUDGET_BYTES = 64 * 1024 * 1024;
const EXPORT_TEMP_STALE_MS = 10 * 60_000;
const RUN_LIST_CURSOR_VERSION = 2;
const RUN_LIST_CURSOR_MAX_BYTES = 512;
const RUN_LIST_CURSOR_ID_MAX_LENGTH = 256;
const MAINTENANCE_ACTIVE_RUN_REFERENCE_LIMIT = 100;
const MAINTENANCE_ACTIVE_RUN_REFERENCE_BUDGET_BYTES = PERSISTENCE_LIMITS.commandResponseBytes / 2;
// OpenClaw update commands have a 30 minute backend deadline. Keep a bounded
// release/reconnect margin so the collaboration gate cannot expire first.
const MAINTENANCE_LEASE_MS = 45 * 60_000;
const MAINTENANCE_RECOVERY_SUSPEND_STATUSES = new Set<RunStatus>([
  "PLANNING",
  "PROVISIONING",
  "RUNNING",
  "SYNTHESIZING",
  "FINALIZING",
]);
const VALID_RUN_STATUSES = new Set<string>(RUN_STATUSES);

interface AttemptRow extends SqlRow {
  id: string;
  run_id: string;
  work_item_id: string | null;
  kind: string;
  attempt_no: number;
  idempotency_key: string;
  worker_agent_id: string;
  execution_runtime: AgentExecutionRuntime;
  worker_owner_session_key: string;
  child_session_key: string;
  openclaw_run_id: string | null;
  openclaw_task_id: string | null;
  status: string;
  input_json: string;
  started_at: number | null;
  created_at: number;
}

interface SessionMutationRow extends SqlRow {
  id: string;
  runtime_id: string;
  session_key: string;
  session_id: string;
  action: SessionMutationAction;
  policy: SessionMutationPolicy;
  status: SessionMutationStatus;
  lease_expires_at: number;
  result_json: string | null;
  created_at: number;
  updated_at: number;
}

interface StagedExportArtifact {
  originalPath: string;
  stagedPath: string;
}

interface RetentionCursor {
  endedAt: number;
  runId: string;
}

interface RunContentDigest {
  digest: string;
  revision: number;
  lastEventSequence: number;
}

export class CollaborationService {
  private readonly workerId = newId("worker");
  private readonly lifecycle: BackgroundLifecycleSupervisor;
  private readonly deletionRepository: RunDeletionRepository;
  private readonly databaseHealth: DatabaseHealthMonitor;
  private readonly instanceIdentity: InstanceIdentitySpecification;
  private readonly settlementSpecification: SettlementSpecification;
  private readonly partialDecisionSpecification: PartialDecisionSpecification;
  private readonly residualExecutionRiskSpecification: ResidualExecutionRiskSpecification;
  private readonly currentPlanScope: CurrentPlanScopeRepository;
  private readonly maintenanceLeaseSpecification: MaintenanceLeaseSpecification;
  private readonly maintenanceLeases: MaintenanceLeaseRepository;
  private readonly workflowTemplates: WorkflowTemplateRepository;
  private readonly runtimeDeadlinePolicy: RuntimeDeadlinePolicy;
  private readonly commandHandlers: CommandHandlerRegistry;
  private scheduledCommandDrainAt: number | null = null;
  private cancelScheduledCommandDrain: (() => void) | null = null;
  private cancelScheduledRetentionContinuation: (() => void) | null = null;
  private stopped = true;

  constructor(
    readonly database: CollaborationDatabase,
    readonly runtime: RuntimeAdapter,
    readonly config: PluginConfig,
    readonly dataDir: string,
    private readonly logger: { info(message: string): void; warn(message: string): void; error(message: string): void },
    databaseHealth?: DatabaseHealthMonitor,
    runtimeDeadlinePolicy: RuntimeDeadlinePolicy = DEFAULT_RUNTIME_DEADLINE_POLICY,
  ) {
    this.lifecycle = new BackgroundLifecycleSupervisor((label, error) => {
      this.logger.error(`${label} failed: ${boundedDiagnostic(error)}`);
    });
    this.deletionRepository = new RunDeletionRepository(database);
    this.databaseHealth = databaseHealth ?? new DatabaseHealthMonitor(database);
    this.instanceIdentity = new InstanceIdentitySpecification(database.instanceId);
    this.settlementSpecification = new SettlementSpecification();
    this.partialDecisionSpecification = new PartialDecisionSpecification();
    this.residualExecutionRiskSpecification = new ResidualExecutionRiskSpecification();
    this.currentPlanScope = new CurrentPlanScopeRepository(database, this.settlementSpecification);
    this.maintenanceLeaseSpecification = new MaintenanceLeaseSpecification();
    this.maintenanceLeases = new MaintenanceLeaseRepository(database, this.maintenanceLeaseSpecification);
    this.workflowTemplates = new WorkflowTemplateRepository(database);
    this.runtimeDeadlinePolicy = runtimeDeadlinePolicy;
    this.commandHandlers = new CommandHandlerRegistry([
      ["PLAN", async (command) => !(await this.executeAgentCommand(command, "PLANNER"))],
      ["PROVISION", (command) => this.executeProvision(command)],
      ["DISPATCH", async (command) => !(await this.executeAgentCommand(command, "WORKER"))],
      ["SYNTHESIZE", async (command) => !(await this.executeAgentCommand(command, "SYNTHESIZER"))],
      ["DELIVER", (command) => this.executeDelivery(command)],
      ["CANCEL_ATTEMPT", (command) => this.executeCancellation(command)],
      ["FLOW_SYNC", (command) => this.executeFlowSync(command)],
      ["EXPORT", (command) => {
        if (command.payload.noop !== true) this.executeExport(command);
        return false;
      }],
      ["DELETE", (command) => {
        this.executeDelete(command);
        return true;
      }],
    ]);
    const exportDir = path.join(dataDir, "exports");
    mkdirSync(exportDir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(exportDir, 0o700);
    } catch (error) {
      if (process.platform !== "win32") throw error;
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.databaseHealth.refresh();
    this.reconcileMaintenanceLease();
    this.stopped = false;
    this.lifecycle.every(
      "command-drain-trigger",
      "collaboration command drain",
      500,
      async () => this.drainCommands(),
      { immediate: true },
    );
    this.lifecycle.every(
      "active-run-reconciliation",
      "active-run reconciliation",
      15_000,
      async () => this.reconcileActiveRuns(),
      { immediate: true },
    );
    this.lifecycle.every(
      "retention-sweep",
      "retention sweep",
      RETENTION_SWEEP_INTERVAL_MS,
      async () => this.runRetentionSweepSafely(),
      { immediate: true },
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.lifecycle.close();
    this.scheduledCommandDrainAt = null;
    this.cancelScheduledCommandDrain = null;
    this.cancelScheduledRetentionContinuation = null;
    this.database.releaseCommandLeases(this.workerId);
    this.database.checkpoint();
  }

  private scheduleCommandDrain(delayMs = 0): void {
    if (this.stopped) return;
    if (delayMs <= 0) {
      void this.drainCommands();
      return;
    }
    this.scheduleCommandDrainWake(delayMs);
  }

  private scheduleCommandDrainWake(delayMs: number): void {
    if (this.stopped) return;
    if (!Number.isFinite(delayMs)) return;
    const boundedDelay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, Math.ceil(delayMs)));
    const scheduledAt = nowMs() + boundedDelay;
    if (this.scheduledCommandDrainAt != null && this.scheduledCommandDrainAt <= scheduledAt) return;

    this.cancelScheduledCommandDrain?.();
    this.scheduledCommandDrainAt = scheduledAt;
    this.cancelScheduledCommandDrain = this.lifecycle.defer(
      "command-drain-wakeup",
      "scheduled collaboration command drain",
      boundedDelay,
      async () => {
        this.scheduledCommandDrainAt = null;
        this.cancelScheduledCommandDrain = null;
        await this.drainCommands();
      },
    );
  }

  private scheduleNextPendingCommandDrain(): void {
    if (this.stopped) return;
    const row = this.database.db
      .prepare("SELECT MIN(available_at) AS available_at FROM commands WHERE status = 'PENDING'")
      .get() as SqlRow | undefined;
    if (row?.available_at == null) {
      this.cancelScheduledCommandDrain?.();
      this.scheduledCommandDrainAt = null;
      this.cancelScheduledCommandDrain = null;
      return;
    }
    this.scheduleCommandDrainWake(Math.max(0, numberValue(row.available_at) - nowMs()));
  }

  private scheduleActiveRunReconciliation(): void {
    if (this.stopped) return;
    void this.lifecycle.runOnce(
      "active-run-reconciliation",
      "active-run reconciliation",
      async () => this.reconcileActiveRuns(),
    );
  }

  private scheduleRunReconciliation(runId: string): void {
    if (this.stopped) return;
    void this.lifecycle.runOnce(
      `run-reconciliation:${runId}`,
      `run reconciliation ${runId}`,
      async () => this.reconcileOneRun(runId),
    );
  }

  private awaitRuntime<T>(
    operation: RuntimeOperation,
    label: string,
    invoke: () => T | PromiseLike<T>,
  ): Promise<T> {
    return withRuntimeDeadline(invoke, {
      label,
      timeoutMs: this.runtimeDeadlinePolicy.deadlineMs(operation),
      signal: this.lifecycle.signal,
    });
  }

  private rethrowLifecycleStop(error: unknown): void {
    if (error instanceof LifecycleAbortedError || error instanceof LifecycleClosedError) throw error;
  }

  runRetentionSweep(referenceTime = nowMs()): number {
    const sweepStartedAt = nowMs();
    this.cleanupOrphanedExportTemps();
    this.recoverStagedExportArtifacts();
    this.reconcileTerminalLocalCommands();
    const cutoff = referenceTime - this.config.retentionDays * 24 * 60 * 60_000;
    this.cleanupExpiredOperationalRecords(cutoff);
    const cursor = this.readRetentionCursor();
    const cursorEndedAt = cursor?.endedAt ?? -1;
    const cursorRunId = cursor?.runId ?? "";
    const candidates = this.deletionRepository.listRetentionCandidates({
      cutoff,
      cursorEndedAt,
      cursorRunId,
      limit: RETENTION_SWEEP_SCAN_SIZE,
    });

    let removed = 0;
    let processed = 0;
    let lastCursor: RetentionCursor | null = null;
    for (const candidate of candidates) {
      const runId = candidate.runId;
      lastCursor = {
        endedAt: candidate.endedAt,
        runId,
      };
      processed += 1;
      try {
        const result = this.deleteRunWithStagedArtifacts({
          runId,
          actor: "retention-policy",
          deletedAt: referenceTime,
          retentionCutoff: cutoff,
        });
        if (result.deleted) {
          const cleanup = this.finalizeStagedExportArtifacts(runId, result.staged);
          this.updateTombstoneCleanup(runId, cleanup);
          if (!cleanup.complete) {
            this.logger.warn(`retention cleanup ${runId} committed with staged purge pending: ${cleanup.error}`);
          }
          removed += 1;
        }
      } catch (error) {
        const diagnostic = boundedDiagnostic(error);
        this.logger.warn(`retention cleanup ${runId} failed: ${diagnostic}`);
        this.recordRetentionFailure(runId, diagnostic);
      }
      if (removed >= RETENTION_SWEEP_BATCH_SIZE) break;
      if (nowMs() - sweepStartedAt >= RETENTION_SWEEP_TIME_BUDGET_MS) break;
    }
    if (lastCursor) {
      const exhaustedPage = processed === candidates.length && candidates.length < RETENTION_SWEEP_SCAN_SIZE;
      this.writeRetentionCursor(exhaustedPage ? null : lastCursor);
      if (exhaustedPage) this.clearRetentionContinuation();
      else this.scheduleRetentionContinuation();
    } else if (cursor) {
      this.writeRetentionCursor(null);
      this.clearRetentionContinuation();
    } else {
      this.clearRetentionContinuation();
    }
    if (removed > 0) this.logger.info(`retention cleanup removed ${removed} expired collaboration run(s)`);
    return removed;
  }

  private runRetentionSweepSafely(): void {
    try {
      this.runRetentionSweep();
    } catch (error) {
      this.logger.warn(`retention sweep failed: ${boundedDiagnostic(error)}`);
    }
  }

  private scheduleRetentionContinuation(): void {
    if (this.stopped || this.cancelScheduledRetentionContinuation) return;
    this.cancelScheduledRetentionContinuation = this.lifecycle.defer(
      "retention-sweep-continuation",
      "retention sweep continuation",
      RETENTION_CONTINUATION_DELAY_MS,
      async () => {
        this.cancelScheduledRetentionContinuation = null;
        this.runRetentionSweepSafely();
      },
    );
  }

  private clearRetentionContinuation(): void {
    this.cancelScheduledRetentionContinuation?.();
    this.cancelScheduledRetentionContinuation = null;
  }

  private cleanupExpiredOperationalRecords(cutoff: number): void {
    this.database.transaction(() => {
      this.database.db
        .prepare(
          `DELETE FROM command_receipts
           WHERE run_id IN (
             SELECT run_id FROM tombstones
             WHERE deleted_at < ? AND cleanup_status = 'COMPLETED'
           )`,
        )
        .run(cutoff);
      this.database.db
        .prepare(
          `DELETE FROM command_receipts
           WHERE run_id IS NULL AND created_at < ?
             AND NOT EXISTS (
               SELECT 1 FROM session_mutation_commands smc
               JOIN session_mutations sm ON sm.id = smc.mutation_id
               WHERE smc.command_id = command_receipts.command_id
                 AND sm.status IN ('PREPARED', 'EXPIRED')
             )`,
        )
        .run(cutoff);
      this.database.db
        .prepare(
          `DELETE FROM deletion_command_receipts
           WHERE run_id IN (
             SELECT run_id FROM tombstones
             WHERE deleted_at < ? AND cleanup_status = 'COMPLETED'
           )`,
        )
        .run(cutoff);
      this.database.db
        .prepare(
          `DELETE FROM deletion_jobs
           WHERE status = 'COMPLETED' AND updated_at < ?
             AND run_id IN (
               SELECT run_id FROM tombstones WHERE cleanup_status = 'COMPLETED'
             )`,
        )
        .run(cutoff);
      this.database.db
        .prepare(
          `DELETE FROM session_mutations
           WHERE status IN ('COMPLETED', 'FAILED') AND updated_at < ?`,
        )
        .run(cutoff);
    });
  }

  private settleUnknownCommand(
    commandId: string,
    status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CANCELLED",
    params: { error?: string } = {},
  ): boolean {
    const command = this.database.getCommand(commandId);
    if (command.status !== "UNKNOWN") return false;
    return this.database.settleUnleasedCommandSnapshot(command, status, params);
  }

  private repairMissingTerminalFlowSyncCommands(): void {
    const batchSize = 128;
    while (true) {
      const rows = this.database.db
        .prepare(
          `SELECT r.id
           FROM collaboration_runs r
           WHERE r.status IN ('COMPLETED', 'CANCELLED', 'FAILED')
             AND r.openclaw_flow_id IS NOT NULL
             AND r.openclaw_flow_revision IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM commands c
               WHERE c.run_id = r.id AND c.kind = 'FLOW_SYNC'
                 AND json_extract(c.payload_json, '$.terminal') = CASE r.status
                   WHEN 'COMPLETED' THEN 'finished'
                   WHEN 'CANCELLED' THEN 'cancelled'
                   ELSE 'failed'
                 END
             )
           ORDER BY r.ended_at, r.id
           LIMIT ?`,
        )
        .all(batchSize) as SqlRow[];
      if (rows.length === 0) return;
      for (const row of rows) {
        this.database.transaction(() => {
          const run = this.database.getRunSummary(String(row.id));
          if (!TERMINAL_RUN_STATUSES.includes(run.status)) return;
          const terminal = terminalFlowIntentForRunStatus(run.status);
          const existing = this.database.db
            .prepare(
              `SELECT 1 FROM commands
               WHERE run_id = ? AND kind = 'FLOW_SYNC'
                 AND json_extract(payload_json, '$.terminal') = ?
               LIMIT 1`,
            )
            .get(run.id, terminal);
          if (!existing) this.enqueueTerminalFlowSync(run, terminal);
        });
      }
      if (rows.length < batchSize) return;
    }
  }

  private reconcileTerminalLocalCommands(): void {
    this.repairMissingTerminalFlowSyncCommands();
    const rows = this.database.db
      .prepare(
        `SELECT c.* FROM commands c
         JOIN collaboration_runs r ON r.id = c.run_id
         WHERE c.status = 'UNKNOWN' AND c.kind IN ('EXPORT', 'DELETE')
           AND r.status IN ('COMPLETED', 'CANCELLED', 'FAILED')
         ORDER BY c.created_at, c.id`,
      )
      .all() as SqlRow[];
    for (const row of rows) {
      const commandId = String(row.id);
      const kind = String(row.kind);
      const jobTable = kind === "EXPORT" ? "export_jobs" : "deletion_jobs";
      const job = this.database.db
        .prepare(`SELECT * FROM ${jobTable} WHERE id = ?`)
        .get(String(row.entity_id ?? "")) as SqlRow | undefined;
      if (!job) {
        this.settleUnknownCommand(commandId, "FAILED", { error: `${kind} job is missing` });
        continue;
      }
      if (job.status === "PENDING") {
        this.database.db
          .prepare(
            `UPDATE commands SET status = 'PENDING', lease_owner = NULL, lease_expires_at = NULL,
             last_error = NULL, updated_at = ? WHERE id = ? AND status = 'UNKNOWN'`,
          )
          .run(nowMs(), commandId);
        continue;
      }
      if (kind === "EXPORT" && job.status === "COMPLETED" && typeof job.artifact_path === "string") {
        try {
          const artifactPath = this.resolveStoredExportPath(job.artifact_path);
          assertCondition(statSync(artifactPath).size <= PERSISTENCE_LIMITS.exportBytes, "CAPACITY_EXCEEDED", "Recovered export is oversized");
          const content = readFileSync(artifactPath, "utf8");
          assertCondition(sha256(content) === job.digest, "INVALID_RESPONSE", "Recovered export digest mismatch");
          this.settleUnknownCommand(commandId, "SUCCEEDED");
        } catch (error) {
          const diagnostic = boundedDiagnostic(error);
          this.database.db
            .prepare("UPDATE export_jobs SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?")
            .run(diagnostic, nowMs(), String(job.id));
          this.settleUnknownCommand(commandId, "FAILED", { error: diagnostic });
        }
        continue;
      }
      if (kind === "DELETE" && job.status === "COMPLETED") {
        const diagnostic = "Deletion job is completed but its run still exists";
        this.database.db
          .prepare("UPDATE deletion_jobs SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?")
          .run(diagnostic, nowMs(), String(job.id));
        this.settleUnknownCommand(commandId, "FAILED", { error: diagnostic });
        continue;
      }
      this.settleUnknownCommand(commandId, "FAILED", {
        error: `${kind} job is ${String(job.status)}`,
      });
    }

    const remoteRows = this.database.db
      .prepare(
        `SELECT c.* FROM commands c
         JOIN collaboration_runs r ON r.id = c.run_id
         WHERE c.status = 'UNKNOWN' AND c.kind NOT IN ('EXPORT', 'DELETE')
           AND r.status IN ('COMPLETED', 'CANCELLED', 'FAILED')
         ORDER BY c.created_at, c.id`,
      )
      .all() as SqlRow[];
    for (const row of remoteRows) {
      const commandId = String(row.id);
      const kind = String(row.kind);
      if (kind === "FLOW_SYNC") {
        const failureCount = numberValue(row.failure_count);
        if (failureCount < FLOW_SYNC_RETRY_POLICY.maxFailures) {
          this.database.db
            .prepare(
              `UPDATE commands SET status = 'PENDING', available_at = ?, lease_owner = NULL,
               lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'UNKNOWN'`,
            )
            .run(nowMs(), nowMs(), commandId);
        } else {
          this.settleUnknownCommand(commandId, "FAILED", { error: "Managed Flow sync retry limit was reached" });
        }
        continue;
      }
      if (["PLAN", "DISPATCH", "SYNTHESIZE", "CANCEL_ATTEMPT"].includes(kind) && row.entity_id) {
        const attempt = this.database.db.prepare("SELECT status FROM attempts WHERE id = ?").get(row.entity_id) as SqlRow | undefined;
        if (!attempt) {
          this.settleUnknownCommand(commandId, "FAILED", { error: "Attempt is missing" });
          continue;
        }
        const status = String(attempt.status);
        if (["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED", "ABANDONED"].includes(status)) {
          this.settleUnknownCommand(commandId, status === "SUCCEEDED" || status === "CANCELLED" ? "SUCCEEDED" : "FAILED", {
            ...(status === "SUCCEEDED" || status === "CANCELLED" ? {} : { error: `Attempt is ${status}` }),
          });
        }
        continue;
      }
      if (kind === "DELIVER" && row.entity_id) {
        const delivery = this.database.db.prepare("SELECT status FROM deliveries WHERE id = ?").get(row.entity_id) as SqlRow | undefined;
        if (!delivery) {
          this.settleUnknownCommand(commandId, "FAILED", { error: "Delivery is missing" });
          continue;
        }
        const status = String(delivery.status);
        if (["DELIVERED", "ABANDONED", "RETRY_REQUIRED"].includes(status)) {
          this.settleUnknownCommand(commandId, status === "DELIVERED" ? "SUCCEEDED" : "FAILED", {
            ...(status === "DELIVERED" ? {} : { error: `Delivery is ${status}` }),
          });
        }
        continue;
      }
      if (kind === "PROVISION") {
        this.settleUnknownCommand(commandId, "FAILED", { error: "Run became terminal before provisioning was confirmed" });
      }
    }
  }

  private recordRetentionFailure(runId: string, diagnostic: string): void {
    try {
      this.database.transaction(() => {
        const run = this.database.getRunSummary(runId);
        const updated = this.database.updateRun(runId, run.revision, {});
        this.database.appendEvent(
          runId,
          "RETENTION_CLEANUP_FAILED",
          "run",
          runId,
          updated.revision,
          { diagnostic },
        );
        this.insertIntervention(
          runId,
          "RETENTION_CLEANUP_FAILED",
          "run",
          runId,
          "Repair the managed export path or delete the run explicitly",
          { diagnostic },
          run.status,
        );
      });
    } catch {
      // The run may have been removed concurrently after the failed candidate read.
    }
  }

  private assertManagedExportPath(artifactPath: string): void {
    const exportDir = path.resolve(this.dataDir, "exports");
    const resolved = path.resolve(artifactPath);
    const relative = path.relative(exportDir, resolved);
    if (
      !relative
      || relative.startsWith("..")
      || path.isAbsolute(relative)
      || relative === DELETION_STAGING_DIRECTORY
      || relative.startsWith(`${DELETION_STAGING_DIRECTORY}${path.sep}`)
    ) {
      throw new Error("Export artifact path is outside the managed export directory");
    }
  }

  private resolveStoredExportPath(storedPath: string): string {
    const exportDir = path.resolve(this.dataDir, "exports");
    if (!path.isAbsolute(storedPath)) {
      assertCondition(
        /^[A-Za-z0-9._-]+\.json$/.test(storedPath),
        "INVALID_REQUEST",
        "Managed export artifact id is invalid",
      );
      const resolved = path.join(exportDir, storedPath);
      this.assertManagedExportPath(resolved);
      return resolved;
    }
    try {
      this.assertManagedExportPath(storedPath);
      return path.resolve(storedPath);
    } catch {
      const fileName = path.basename(storedPath);
      assertCondition(
        /^[A-Za-z0-9._-]+\.json$/.test(fileName),
        "INVALID_REQUEST",
        "Legacy export artifact path cannot be remapped safely",
      );
      const remapped = path.join(exportDir, fileName);
      assertCondition(
        existsSync(remapped),
        "NOT_FOUND",
        "Legacy export artifact was not copied into the current managed state directory",
      );
      return remapped;
    }
  }

  private deleteRunWithStagedArtifacts(params: {
    runId: string;
    actor: string;
    deletedAt: number;
    retentionCutoff?: number;
    expectedDigest?: string;
    deletionJobId?: string;
    currentDeleteCommandId?: string;
    currentDeleteCommand?: CommandRecord;
    flowReconciliationAbandonment?: FlowReconciliationAbandonment | null;
  }): { deleted: boolean; staged: StagedExportArtifact[] } {
    let staged: StagedExportArtifact[] = [];
    if (params.retentionCutoff != null) {
      const preflight = assessRetentionRunDeletion(
        this.deletionRepository.readSnapshot(params.runId),
        params.retentionCutoff,
      );
      if (preflight.kind === "BLOCKED") return { deleted: false, staged };
    }
    const content = this.computeRunContentDigest(params.runId);
    try {
      const deleted = this.database.transaction(() => {
        const deletionSnapshot = this.deletionRepository.readSnapshot(
          params.runId,
          params.currentDeleteCommandId ?? null,
        );
        const deletionAssessment = params.retentionCutoff != null
          ? assessRetentionRunDeletion(deletionSnapshot, params.retentionCutoff)
          : assessExplicitRunDeletion(
              deletionSnapshot,
              params.flowReconciliationAbandonment ?? null,
            );
        if (params.retentionCutoff != null && deletionAssessment.kind === "BLOCKED") return false;
        assertRunDeletionAssessmentSatisfied(deletionAssessment);

        const run = this.database.getRunSummary(params.runId);
        const lastEventSequence = this.database.getLastSequence(params.runId);
        if (run.revision !== content.revision || lastEventSequence !== content.lastEventSequence) {
          if (params.retentionCutoff != null) return false;
          throw new CollaborationError("REVISION_CONFLICT", "Run changed while deletion was being prepared", {
            expectedRevision: content.revision,
            actualRevision: run.revision,
            expectedLastEventSequence: content.lastEventSequence,
            actualLastEventSequence: lastEventSequence,
          });
        }
        const digest = content.digest;
        if (params.expectedDigest) {
          assertCondition(
            digest === params.expectedDigest,
            "REVISION_CONFLICT",
            "Run content changed after deletion confirmation; preview deletion again",
          );
        }
        if (params.currentDeleteCommand) {
          assertCondition(
            params.currentDeleteCommand.id === params.currentDeleteCommandId
              && params.currentDeleteCommand.runId === params.runId,
            "REVISION_CONFLICT",
            "Delete command identity changed before the deletion transaction",
          );
          this.extendDeleteCommandLease(params.currentDeleteCommand);
        }
        const exportPaths = (this.database.db
          .prepare("SELECT artifact_path FROM export_jobs WHERE run_id = ? AND artifact_path IS NOT NULL")
          .all(params.runId) as SqlRow[]).map((row) => this.resolveStoredExportPath(String(row.artifact_path)));
        for (const artifactPath of exportPaths) this.assertManagedExportPath(artifactPath);
        this.stageExportArtifacts(params.runId, exportPaths, staged);

        this.database.db
          .prepare(
            `INSERT INTO tombstones(
              id, run_id, actor, content_digest, deletion_job_id, deleted_at,
              cleanup_status, cleanup_error, cleanup_updated_at,
              flow_reconciliation_command_id, openclaw_flow_id, openclaw_flow_revision,
              flow_reconciliation_diagnostic, flow_reconciliation_abandoned_at,
              flow_reconciliation_abandon_reason
            ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            newId("tombstone"),
            params.runId,
            params.actor,
            digest,
            params.deletionJobId ?? null,
            params.deletedAt,
            params.deletedAt,
            params.flowReconciliationAbandonment?.commandId ?? null,
            params.flowReconciliationAbandonment?.flowId ?? null,
            params.flowReconciliationAbandonment?.flowRevision ?? null,
            params.flowReconciliationAbandonment?.diagnostic ?? null,
            params.flowReconciliationAbandonment ? params.deletedAt : null,
            params.flowReconciliationAbandonment?.reason ?? null,
          );
        const result = this.database.db.prepare("DELETE FROM collaboration_runs WHERE id = ?").run(params.runId);
        assertCondition(Number(result.changes) === 1, "NOT_FOUND", `Collaboration run ${params.runId} was not found`);
        if (params.deletionJobId) {
          const jobUpdate = this.database.db
            .prepare("UPDATE deletion_jobs SET status = 'COMPLETED', updated_at = ? WHERE id = ?")
            .run(params.deletedAt, params.deletionJobId);
          assertCondition(
            Number(jobUpdate.changes) === 1,
            "NOT_FOUND",
            `Deletion job ${params.deletionJobId} was not found`,
          );
        }
        return true;
      });
      return { deleted, staged };
    } catch (error) {
      this.restoreStagedExportArtifacts(params.runId, staged);
      throw error;
    }
  }

  private stageExportArtifacts(
    runId: string,
    exportPaths: string[],
    staged: StagedExportArtifact[],
  ): void {
    const stagingDirectory = this.deletionStagingDirectory(runId);
    mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 });
    this.fsyncDirectory(path.resolve(this.dataDir, "exports"));
    this.fsyncDirectory(this.deletionStagingRoot());
    this.fsyncDirectory(stagingDirectory);
    for (const originalPath of exportPaths) {
      if (!existsSync(originalPath)) continue;
      const stagedPath = path.join(stagingDirectory, path.basename(originalPath));
      if (existsSync(stagedPath)) {
        throw new Error(`A staged export artifact already exists for ${path.basename(originalPath)}`);
      }
      renameSync(originalPath, stagedPath);
      staged.push({ originalPath, stagedPath });
    }
    if (staged.length > 0) {
      this.fsyncDirectory(path.resolve(this.dataDir, "exports"));
      this.fsyncDirectory(this.deletionStagingRoot());
      this.fsyncDirectory(stagingDirectory);
    }
  }

  private restoreStagedExportArtifacts(runId: string, artifacts: StagedExportArtifact[]): void {
    for (const artifact of [...artifacts].reverse()) {
      try {
        if (!existsSync(artifact.stagedPath)) continue;
        if (existsSync(artifact.originalPath)) {
          throw new Error(`Refusing to overwrite restored export artifact ${path.basename(artifact.originalPath)}`);
        }
        renameSync(artifact.stagedPath, artifact.originalPath);
      } catch (error) {
        this.logger.error(`failed to restore staged export for ${runId}: ${boundedDiagnostic(error)}`);
      }
    }
    if (artifacts.length > 0) {
      try {
        this.fsyncDirectory(path.resolve(this.dataDir, "exports"));
      } catch (error) {
        this.logger.error(`failed to sync restored export directory for ${runId}: ${boundedDiagnostic(error)}`);
      }
    }
    try {
      this.removeEmptyStagingDirectory(runId);
    } catch (error) {
      this.logger.error(`failed to clean restored export staging for ${runId}: ${boundedDiagnostic(error)}`);
    }
  }

  private finalizeStagedExportArtifacts(
    runId: string,
    artifacts: StagedExportArtifact[],
  ): { complete: boolean; error: string | null } {
    const errors: string[] = [];
    for (const artifact of artifacts) {
      try {
        rmSync(artifact.stagedPath, { recursive: true, force: true });
      } catch (error) {
        const diagnostic = boundedDiagnostic(error);
        errors.push(diagnostic);
        this.logger.warn(`staged export cleanup ${runId} failed and will be retried: ${diagnostic}`);
      }
    }
    try {
      this.removeEmptyStagingDirectory(runId);
    } catch (error) {
      const diagnostic = boundedDiagnostic(error);
      errors.push(diagnostic);
      this.logger.warn(`staged export directory cleanup ${runId} failed and will be retried: ${diagnostic}`);
    }
    const directory = this.deletionStagingDirectory(runId);
    if (existsSync(directory) && errors.length === 0) errors.push("staged export directory is not empty");
    if (errors.length === 0) {
      try {
        this.fsyncDirectory(path.resolve(this.dataDir, "exports"));
      } catch (error) {
        errors.push(boundedDiagnostic(error));
      }
    }
    return {
      complete: errors.length === 0,
      error: errors.length === 0 ? null : boundedDiagnostic(errors.join("; ")),
    };
  }

  private updateTombstoneCleanup(
    runId: string,
    cleanup: { complete: boolean; error: string | null },
    expectedDeletionJobId?: string,
  ): void {
    const where = expectedDeletionJobId == null
      ? "WHERE run_id = ?"
      : "WHERE run_id = ? AND deletion_job_id = ?";
    const result = this.database.db
      .prepare(
        `UPDATE tombstones
         SET cleanup_status = ?, cleanup_error = ?, cleanup_updated_at = ?
         ${where}`,
      )
      .run(
        cleanup.complete ? "COMPLETED" : "PARTIAL",
        cleanup.error,
        nowMs(),
        runId,
        ...(expectedDeletionJobId == null ? [] : [expectedDeletionJobId]),
      );
    if (expectedDeletionJobId != null && Number(result.changes) !== 1) {
      throw new CollaborationError(
        "REVISION_CONFLICT",
        "Deletion tombstone no longer belongs to the claimed deletion job",
        { runId, deletionJobId: expectedDeletionJobId },
      );
    }
  }

  private recoveryDeletionJobReference(runId: string): {
    jobId: string | null;
    usable: boolean;
    diagnostic: string | null;
  } {
    return this.database.transaction(() => {
      const tombstone = this.database.db
        .prepare("SELECT deletion_job_id FROM tombstones WHERE run_id = ?")
        .get(runId) as SqlRow | undefined;
      if (!tombstone) return { jobId: null, usable: true, diagnostic: null };
      const recordedJobId = typeof tombstone.deletion_job_id === "string"
        && tombstone.deletion_job_id.length > 0
        ? tombstone.deletion_job_id
        : null;
      if (recordedJobId) {
        const job = this.database.db
          .prepare("SELECT run_id FROM deletion_jobs WHERE id = ?")
          .get(recordedJobId) as SqlRow | undefined;
        if (job && String(job.run_id) === runId) {
          return { jobId: recordedJobId, usable: true, diagnostic: null };
        }
        const diagnostic = `Authoritative deletion job ${recordedJobId} is missing or belongs to another run`;
        this.logger.warn(`deletion tombstone ${runId} references a missing or mismatched job ${recordedJobId}`);
        return { jobId: recordedJobId, usable: false, diagnostic };
      }

      // Legacy tombstones predate the authoritative job reference. Only a
      // single candidate can be adopted safely; ambiguity is retained rather
      // than rewriting historical jobs by run id. The adoption itself is a
      // CAS so two recovery workers cannot choose different owners.
      const candidates = this.database.db
        .prepare("SELECT id FROM deletion_jobs WHERE run_id = ? ORDER BY created_at DESC, updated_at DESC, id DESC")
        .all(runId) as SqlRow[];
      if (candidates.length === 1) {
        const candidateId = String(candidates[0]!.id);
        const adopted = this.database.db
          .prepare(
            "UPDATE tombstones SET deletion_job_id = ? WHERE run_id = ? AND deletion_job_id IS NULL AND cleanup_status IN ('PENDING', 'PARTIAL')",
          )
          .run(candidateId, runId);
        if (Number(adopted.changes) === 1) {
          return { jobId: candidateId, usable: true, diagnostic: null };
        }
        const current = this.database.db
          .prepare("SELECT deletion_job_id FROM tombstones WHERE run_id = ?")
          .get(runId) as SqlRow | undefined;
        if (typeof current?.deletion_job_id === "string" && current.deletion_job_id.length > 0) {
          return {
            jobId: current.deletion_job_id,
            usable: current.deletion_job_id === candidateId,
            diagnostic: current.deletion_job_id === candidateId
              ? null
              : "Deletion tombstone owner changed during recovery",
          };
        }
        return { jobId: null, usable: false, diagnostic: "Deletion tombstone owner could not be adopted safely" };
      }
      if (candidates.length > 1) {
        this.logger.warn(`deletion tombstone ${runId} has ${candidates.length} legacy jobs; recovery will not guess an owner`);
        return {
          jobId: null,
          usable: false,
          diagnostic: `Deletion tombstone has ${candidates.length} legacy jobs and no authoritative owner`,
        };
      }
      return { jobId: null, usable: true, diagnostic: null };
    });
  }

  private transitionRecoveryDeletionJob(params: {
    runId: string;
    jobId: string | null;
    status: "PARTIAL" | "COMPLETED";
    lastError: string | null;
    expectedStatuses: readonly string[];
    allowCompletedToPartial?: boolean;
  }): void {
    if (!params.jobId) return;
    const current = this.database.db
      .prepare("SELECT run_id, status FROM deletion_jobs WHERE id = ?")
      .get(params.jobId) as SqlRow | undefined;
    if (!current || String(current.run_id) !== params.runId) {
      this.logger.warn(`deletion recovery ignored job identity mismatch for ${params.runId}/${params.jobId}`);
      return;
    }
    const currentStatus = String(current.status);
    if (currentStatus === params.status) return;
    if (
      params.status === "PARTIAL"
      && currentStatus === "COMPLETED"
      && params.allowCompletedToPartial !== true
    ) {
      return;
    }
    const placeholders = params.expectedStatuses.map(() => "?").join(", ");
    const result = this.database.db
      .prepare(
        `UPDATE deletion_jobs SET status = ?, last_error = ?, updated_at = ?
         WHERE id = ? AND run_id = ? AND status IN (${placeholders})`,
      )
      .run(
        params.status,
        params.lastError,
        nowMs(),
        params.jobId,
        params.runId,
        ...params.expectedStatuses,
      );
    if (Number(result.changes) !== 1) {
      this.logger.warn(`deletion recovery CAS lost for ${params.runId}/${params.jobId}`);
    }
  }

  private recoverStagedExportArtifacts(): void {
    const stagingRoot = this.deletionStagingRoot();
    const candidateRunIds = new Set<string>();
    if (existsSync(stagingRoot)) {
      for (const entry of readdirSync(stagingRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          this.logger.warn(`unexpected entry in collaboration deletion staging: ${entry.name}`);
          continue;
        }
        candidateRunIds.add(entry.name);
      }
    }
    const pendingTombstones = this.database.db
      .prepare("SELECT run_id FROM tombstones WHERE cleanup_status IN ('PENDING', 'PARTIAL')")
      .all() as SqlRow[];
    for (const row of pendingTombstones) candidateRunIds.add(String(row.run_id));

    for (const runId of candidateRunIds) {
      const recoveryReference = this.recoveryDeletionJobReference(runId);
      const recoveryJobId = recoveryReference.usable ? recoveryReference.jobId : null;
      try {
        if (!recoveryReference.usable) {
          const diagnostic = recoveryReference.diagnostic ?? "Deletion tombstone owner is invalid";
          this.updateTombstoneCleanup(
            runId,
            { complete: false, error: diagnostic },
            recoveryReference.jobId ?? undefined,
          );
          continue;
        }
        const runExists = Boolean(this.database.db.prepare("SELECT 1 FROM collaboration_runs WHERE id = ?").get(runId));
        const runDirectory = this.deletionStagingDirectory(runId);
        if (!runExists) {
          const pendingDiagnostic = "Physical cleanup is being reconciled after an interrupted deletion";
          this.database.transaction(() => {
            this.database.db
              .prepare(
                `UPDATE tombstones SET cleanup_status = 'PARTIAL', cleanup_error = ?, cleanup_updated_at = ?
                 WHERE run_id = ? AND cleanup_status <> 'COMPLETED'`,
              )
              .run(pendingDiagnostic, nowMs(), runId);
            this.transitionRecoveryDeletionJob({
              runId,
              jobId: recoveryJobId,
              status: "PARTIAL",
              lastError: pendingDiagnostic,
              expectedStatuses: ["COMPLETED", "PARTIAL", "FAILED", "PENDING"],
              allowCompletedToPartial: true,
            });
          });
          const cleanup = this.purgeDeletedRunStaging(runId);
          this.database.transaction(() => {
            this.updateTombstoneCleanup(runId, cleanup, recoveryJobId ?? undefined);
            this.transitionRecoveryDeletionJob({
              runId,
              jobId: recoveryJobId,
              status: cleanup.complete ? "COMPLETED" : "PARTIAL",
              lastError: cleanup.error,
              expectedStatuses: ["COMPLETED", "PARTIAL", "FAILED", "PENDING"],
            });
          });
          if (!cleanup.complete) {
            this.logger.warn(`staged export recovery ${runId} is still pending: ${cleanup.error}`);
          }
          continue;
        }
        if (existsSync(runDirectory)) {
          const originalPaths = (this.database.db
            .prepare("SELECT artifact_path FROM export_jobs WHERE run_id = ? AND artifact_path IS NOT NULL")
            .all(runId) as SqlRow[]).map((row) => this.resolveStoredExportPath(String(row.artifact_path)));
          for (const originalPath of originalPaths) this.assertManagedExportPath(originalPath);
          const originalByName = new Map(originalPaths.map((originalPath) => [path.basename(originalPath), originalPath]));
          for (const stagedEntry of readdirSync(runDirectory, { withFileTypes: true })) {
            const originalPath = originalByName.get(stagedEntry.name);
            if (!originalPath) {
              this.logger.warn(`staged export ${stagedEntry.name} has no authoritative row for ${runId}`);
              continue;
            }
            const stagedPath = path.join(runDirectory, stagedEntry.name);
            if (existsSync(originalPath)) {
              this.logger.warn(`staged export ${stagedEntry.name} cannot be restored because its destination exists`);
              continue;
            }
            renameSync(stagedPath, originalPath);
          }
          this.fsyncDirectory(path.resolve(this.dataDir, "exports"));
          this.removeEmptyStagingDirectory(runId);
        }
        // A committed deletion must remove the Run in the same SQLite
        // transaction as its tombstone. Seeing both means the durable facts
        // disagree (for example after manual repair or legacy corruption).
        // Restore artifacts, then retain an explicit PARTIAL fence instead of
        // silently marking the deletion complete or retrying the delete.
        const diagnostic = "Deletion tombstone references a Run that still exists; manual reconciliation is required";
        const hasTombstone = Boolean(
          this.database.db.prepare("SELECT 1 FROM tombstones WHERE run_id = ?").get(runId),
        );
        if (hasTombstone) {
          this.database.transaction(() => {
            this.updateTombstoneCleanup(runId, { complete: false, error: diagnostic }, recoveryJobId ?? undefined);
            this.transitionRecoveryDeletionJob({
              runId,
              jobId: recoveryJobId,
              status: "PARTIAL",
              lastError: diagnostic,
              expectedStatuses: ["COMPLETED", "PARTIAL", "FAILED", "PENDING"],
              allowCompletedToPartial: true,
            });
          });
        }
        this.logger.warn(`staged export recovery ${runId} found a live Run beside its tombstone`);
      } catch (error) {
        const diagnostic = boundedDiagnostic(error);
        this.updateTombstoneCleanup(
          runId,
          { complete: false, error: diagnostic },
          recoveryJobId ?? undefined,
        );
        this.transitionRecoveryDeletionJob({
          runId,
          jobId: recoveryJobId,
          status: "PARTIAL",
          lastError: diagnostic,
          expectedStatuses: ["COMPLETED", "PARTIAL", "FAILED", "PENDING"],
          allowCompletedToPartial: true,
        });
        this.logger.warn(`staged export recovery ${runId} failed: ${diagnostic}`);
      }
    }
  }

  private deletionStagingRoot(): string {
    return path.join(this.dataDir, "exports", DELETION_STAGING_DIRECTORY);
  }

  private deletionStagingDirectory(runId: string): string {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(runId)) throw new Error("Run id is unsafe for deletion staging");
    return path.join(this.deletionStagingRoot(), runId);
  }

  private removeEmptyStagingDirectory(runId: string): void {
    const directory = this.deletionStagingDirectory(runId);
    const root = this.deletionStagingRoot();
    if (existsSync(directory) && readdirSync(directory).length === 0) {
      rmSync(directory, { recursive: true, force: true });
      if (existsSync(root)) this.fsyncDirectory(root);
    }
    if (existsSync(root) && readdirSync(root).length === 0) {
      rmSync(root, { recursive: true, force: true });
      this.fsyncDirectory(path.resolve(this.dataDir, "exports"));
    }
  }

  private fsyncDirectory(directory: string): void {
    if (process.platform === "win32") return;
    const descriptor = openSync(directory, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  private readRetentionCursor(): RetentionCursor | null {
    const raw = this.database.getMetadata("retention_cursor");
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<RetentionCursor>;
      return Number.isSafeInteger(value.endedAt)
        && typeof value.runId === "string"
        && value.runId
        ? { endedAt: value.endedAt!, runId: value.runId }
        : null;
    } catch {
      return null;
    }
  }

  private writeRetentionCursor(cursor: RetentionCursor | null): void {
    this.database.setMetadata("retention_cursor", cursor ? stableStringify(cursor) : "");
  }

  private purgeDeletedRunStaging(runId: string): { complete: boolean; error: string | null } {
    const directory = this.deletionStagingDirectory(runId);
    try {
      rmSync(directory, { recursive: true, force: true });
      const root = this.deletionStagingRoot();
      if (existsSync(root)) this.fsyncDirectory(root);
      if (existsSync(root) && readdirSync(root).length === 0) {
        rmSync(root, { recursive: true, force: true });
      }
      this.fsyncDirectory(path.resolve(this.dataDir, "exports"));
      return { complete: !existsSync(directory), error: null };
    } catch (error) {
      return { complete: false, error: boundedDiagnostic(error) };
    }
  }

  capabilities(): Record<string, unknown> {
    const configuredAgents = this.configuredAgents();
    const allowed = configuredAgents.filter((agent) => agent.allowed);
    const coordinator = configuredAgents.find((agent) => agent.coordinator);
    const configured = Boolean(coordinator?.allowed && allowed.length > 0);
    const { databaseIntegrity } = this.databaseHealth.snapshot();
    return {
      collaborationInstanceId: this.database.instanceId,
      pluginId: "junqi-collab",
      pluginVersion: PLUGIN_VERSION,
      schemaVersion: Number(this.database.getMetadata("schema_version") ?? 0),
      runtimeVersion: this.runtime.runtimeVersion,
      databaseIntegrity,
      configured,
      durableState: true,
      durableRuntime: {
        supported: true,
        required: true,
        reason: null,
      },
      trustTier: "portable-core",
      workboard: { supported: false, reason: "trusted-official runtime is not available" },
      sessionCapabilities: {
        deleteExpectedSessionId: true,
        resetExpectedSessionId: false,
      },
      features: [
        "SQLITE_AUTHORITY",
        "COMMAND_OUTBOX",
        "TASK_RECONCILE",
        "EXACT_TRANSCRIPT_DELIVERY",
        "EXACT_TRANSCRIPT_IDENTITY",
        "PLUGIN_SUBAGENT_TASK_LOOKUP",
        "PLUGIN_SUBAGENT_TASK_CANCEL",
        "EVENT_CURSOR",
        "SESSION_DELETE_CAS",
        "WRITE_INSTANCE_FENCE",
        "WORKFLOW_TEMPLATES",
      ],
      featureFlags: {
        sqliteAuthority: true,
        commandOutbox: true,
        taskReconcile: true,
        exactTranscriptDelivery: true,
        eventCursor: true,
        sessionDeleteCas: true,
        writeInstanceFence: true,
        workflowTemplates: true,
        sessionResetCas: false,
        workboardMirror: false,
      },
      featureEvidence: {
        kind: "DECLARED_PLUGIN_CONTRACT",
        behaviorVerified: false,
        structuralChecks: {
          pluginServiceStarted: true,
          databaseIntegrity,
          configured,
        },
        requiredBehaviorGate: "ISOLATED_REAL_GATEWAY",
      },
      configuredAgents,
      coordinatorAgentId: coordinator?.id ?? null,
      allowedAgentIds: allowed.map((agent) => agent.id),
      repairs: configured
        ? []
          : [
            !coordinator ? "Set plugins.entries.junqi-collab.config.coordinatorAgentId" : null,
            coordinator && !coordinator.allowed
              ? "Include the coordinator in both allowedAgentIds and its effective subagents.allowAgents policy"
              : null,
            allowed.length === 0 ? "Set plugins.entries.junqi-collab.config.allowedAgentIds" : null,
          ].filter(Boolean),
      maintenance: this.maintenanceStatus(),
    };
  }

  async createPlan(paramsInput: Record<string, unknown>): Promise<Record<string, unknown>> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const operation = "junqi.collab.plan.create";
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, operation);
    if (replay) return replay;
    const origin = this.instanceIdentity.bindOrigin(parseOrigin(params.origin));
    const goal = readBoundedRequiredString(params.goal, "goal", PERSISTENCE_LIMITS.goalBytes);
    const capabilityInput = params.capabilitySnapshot == null
      ? {}
      : parseJsonObject(params.capabilitySnapshot, "capabilitySnapshot");
    return this.createPlanFromResolvedInput({ envelope, operation, origin, goal, capabilityInput });
  }

  private async createPlanFromResolvedInput(params: {
    envelope: ReturnType<typeof validateWriteEnvelope>;
    operation: "junqi.collab.plan.create" | "junqi.collab.run.clone";
    origin: OriginRef;
    goal: string;
    capabilityInput: Record<string, unknown>;
    sourceRun?: { id: string; revision: number };
  }): Promise<Record<string, unknown>> {
    const { envelope, operation, origin, goal, capabilityInput, sourceRun } = params;
    this.assertConfigured();
    this.assertMaintenanceInactive();
    this.reconcileExpiredSessionMutations();
    const identity = await this.awaitRuntime(
      "readOrigin",
      `read origin for ${operation}`,
      () => this.runtime.readOrigin(origin),
    );
    assertCondition(identity.found, "ORIGIN_NOT_DURABLE", "The origin message is not present in the exact transcript");
    assertCondition(identity.role === "user", "INVALID_REQUEST", "Collaboration must originate from a user message");
    const concurrentReplay = this.replayedResponse(envelope.commandId, envelope.payloadHash, operation);
    if (concurrentReplay) return concurrentReplay;
    const capabilitySnapshot = this.buildCapabilitySnapshot(capabilityInput);
    const runId = newId("run");
    const attemptId = newId("attempt");
    const coordinator = this.requireCoordinator();
    const attemptNo = 1;
    const effectKey = `collab:${runId}:plan:pending:attempt:${attemptNo}`;
    let response: Record<string, unknown>;
    this.reconcileExpiredSessionMutations();
    this.database.transaction(() => {
      this.assertMaintenanceInactive();
      if (sourceRun) {
        const currentSource = this.requireRunRevision(sourceRun.id, sourceRun.revision);
        assertCondition(
          TERMINAL_RUN_STATUSES.includes(currentSource.status),
          "INVALID_TRANSITION",
          "Only a terminal run can be cloned",
        );
        this.assertNoOpenResidualExecutionRisk(currentSource.id, "clone");
      }
      this.assertSessionMutationInactive(origin);
      const run = this.database.createRun({
        id: runId,
        origin,
        goal,
        capabilitySnapshot,
        ...(typeof capabilitySnapshot.configHash === "string" ? { configHash: capabilitySnapshot.configHash } : {}),
      });
      if (sourceRun) {
        this.database.appendEvent(runId, "RUN_CLONED", "run", runId, run.revision, {
          sourceRunId: sourceRun.id,
        });
      }
      this.insertAttempt({
        id: attemptId,
        runId,
        kind: "PLANNER",
        attemptNo,
        effectKey,
        agentId: coordinator.id,
        executionRuntime: coordinator.runtimeType,
        input: { revisionInstruction: null },
      });
      response = this.acceptedResponse(runId, envelope.commandId, run.revision, false, {
        ...(sourceRun ? { sourceRunId: sourceRun.id } : {}),
      });
      this.database.insertCommand({
        id: envelope.commandId,
        runId,
        kind: "PLAN",
        receiptSource: operation,
        entityId: attemptId,
        payloadHash: envelope.payloadHash,
        payload: { attemptId, ...(sourceRun ? { sourceRunId: sourceRun.id } : {}) },
        effectKey,
        response,
      });
    });
    this.emitChanged(runId);
    void this.drainCommands();
    return response!;
  }

  revisePlan(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, "junqi.collab.plan.revise");
    if (replay) return replay;
    this.assertMaintenanceInactive();
    const runId = readString(params.runId, "runId");
    const instruction = readBoundedRequiredString(
      params.instruction,
      "instruction",
      PERSISTENCE_LIMITS.revisionInstructionBytes,
    );
    const run = this.requireRunRevision(runId, envelope.expectedRunRevision);
    assertCondition(
      run.status === "AWAITING_APPROVAL" || run.status === "AWAITING_INTERVENTION",
      "INVALID_TRANSITION",
      "Only a plan awaiting approval or intervention can be revised",
    );
    this.partialDecisionSpecification.assertMutationAllowed(Boolean(this.pendingPartialDecision(runId)), "PLAN_REVISION");
    this.assertPlanRevisionQuiescent(runId);
    const coordinator = this.requireCoordinator();
    const attemptNo = this.nextAttemptNo(runId, null, "PLANNER");
    const attemptId = newId("attempt");
    const effectKey = `collab:${runId}:plan:revision:${attemptNo}:attempt:${attemptNo}`;
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      this.assertMaintenanceInactive();
      this.partialDecisionSpecification.assertMutationAllowed(Boolean(this.pendingPartialDecision(runId)), "PLAN_REVISION");
      this.assertPlanRevisionQuiescent(runId);
      const updated = this.transitionRun(runId, run.revision, "PLANNING", {
        dispatchState: "CLOSED",
        resumeStatus: null,
      }, "PLAN_REVISION_REQUESTED", { instructionDigest: sha256(instruction) });
      this.insertAttempt({
        id: attemptId,
        runId,
        kind: "PLANNER",
        attemptNo,
        effectKey,
        agentId: coordinator.id,
        executionRuntime: coordinator.runtimeType,
        input: { revisionInstruction: instruction },
      });
      response = this.acceptedResponse(runId, envelope.commandId, updated.revision, false);
      this.database.insertCommand({
        id: envelope.commandId,
        runId,
        kind: "PLAN",
        receiptSource: "junqi.collab.plan.revise",
        entityId: attemptId,
        payloadHash: envelope.payloadHash,
        payload: { attemptId },
        effectKey,
        response,
      });
    });
    this.emitChanged(runId);
    void this.drainCommands();
    return response!;
  }

  approvePlan(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, "junqi.collab.plan.approve");
    if (replay) return replay;
    this.assertMaintenanceInactive();
    const runId = readString(params.runId, "runId");
    const planRevisionId = readString(params.planRevisionId, "planRevisionId");
    const actor = "operator";
    const run = this.requireRunRevision(runId, envelope.expectedRunRevision);
    assertCondition(run.status === "AWAITING_APPROVAL", "INVALID_TRANSITION", "Run is not awaiting approval");
    assertCondition(run.currentPlanRevisionId === planRevisionId, "REVISION_CONFLICT", "Plan revision is no longer current");
    const planRow = this.getPlanRow(planRevisionId);
    assertCondition(planRow.run_id === runId, "INVALID_REQUEST", "Plan revision belongs to another run");
    const assignments = parseAssignments(params.assignments);
    this.validateAssignments(runId, planRevisionId, assignments);
    const effectKey = `collab:${runId}:provision:${planRevisionId}`;
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      this.assertMaintenanceInactive();
      const now = nowMs();
      this.database.db
        .prepare("UPDATE plan_revisions SET approved_at = ?, approved_by = ? WHERE id = ? AND approved_at IS NULL")
        .run(now, actor, planRevisionId);
      for (const [logicalId, agentId] of Object.entries(assignments)) {
        this.database.db
          .prepare(
            "UPDATE work_items SET assigned_agent_id = ?, revision = revision + 1, updated_at = ? WHERE run_id = ? AND plan_revision_id = ? AND logical_id = ?",
          )
          .run(agentId, now, runId, planRevisionId, logicalId);
      }
      const updated = this.transitionRun(runId, run.revision, "PROVISIONING", {
        dispatchState: "CLOSED",
      }, "PLAN_APPROVED", { planRevisionId, actor, assignments });
      response = this.acceptedResponse(runId, envelope.commandId, updated.revision, false);
      this.database.insertCommand({
        id: envelope.commandId,
        runId,
        kind: "PROVISION",
        receiptSource: "junqi.collab.plan.approve",
        payloadHash: envelope.payloadHash,
        payload: { planRevisionId, flowDomainRevision: updated.revision },
        effectKey,
        response,
      });
      this.insertDecision(runId, envelope.commandId, actor, "PLAN_APPROVED", { planRevisionId, assignments });
    });
    this.emitChanged(runId);
    void this.drainCommands();
    return response!;
  }

  stopDispatch(paramsInput: Record<string, unknown>): Record<string, unknown> {
    return this.simpleRunCommand(paramsInput, "DISPATCH_STOPPED", (runId, run, commandId, actor) => {
      assertCondition(run.status === "RUNNING", "INVALID_TRANSITION", "Only a running collaboration can stop dispatch");
      const updated = this.transitionRun(runId, run.revision, "AWAITING_INTERVENTION", {
        dispatchState: "STOPPED",
        resumeStatus: "RUNNING",
      }, "DISPATCH_STOPPED", { actor });
      this.closeQueuedDispatches(runId, "Dispatch was stopped before this queued Attempt started");
      this.insertIntervention(runId, "DISPATCH_STOPPED", null, null, "Resume dispatch or cancel the run", {}, "RUNNING");
      this.insertDecision(runId, commandId, actor, "DISPATCH_STOPPED", {});
      return this.database.getRunSummary(updated.id);
    });
  }

  resumeDispatch(paramsInput: Record<string, unknown>): Record<string, unknown> {
    this.reconcileExpiredSessionMutations();
    this.assertMaintenanceInactive();
    return this.simpleRunCommand(paramsInput, "DISPATCH_RESUMED", (runId, run, commandId, actor) => {
      this.assertMaintenanceInactive();
      assertCondition(run.status === "AWAITING_INTERVENTION", "INVALID_TRANSITION", "Run is not awaiting intervention");
      assertCondition(!this.pendingPartialDecision(runId), "INVALID_TRANSITION", "Resolve the pending partial decision before resuming dispatch");
      this.assertSessionMutationInactive(run.origin);
      this.assertCapabilitiesUnchanged(runId);
      const stopIntervention = this.resumableDispatchIntervention(runId);
      assertCondition(
        stopIntervention,
        "INVALID_TRANSITION",
        "Dispatch can resume only from an explicit stop with no unresolved recovery blockers",
      );
      this.database.db
        .prepare(
          "UPDATE interventions SET resolved_at = ?, resolved_by = ?, resolution_json = ? WHERE id = ? AND resolved_at IS NULL",
        )
        .run(nowMs(), actor, stableStringify({ action: "resume" }), String(stopIntervention.id));
      const synthesisReady = this.currentPlanScope.synthesisReadiness(runId).ready;
      const nextStatus: RunStatus = synthesisReady ? "SYNTHESIZING" : "RUNNING";
      const updated = this.transitionRun(runId, run.revision, nextStatus, {
        dispatchState: synthesisReady ? "CLOSED" : "OPEN",
        resumeStatus: null,
      }, "DISPATCH_RESUMED", { actor });
      this.insertDecision(runId, commandId, actor, "DISPATCH_RESUMED", {});
      if (synthesisReady) this.enqueueSynthesis(runId, commandId);
      else this.scheduleReadyWork(runId);
      return updated;
    });
  }

  cancelRun(paramsInput: Record<string, unknown>): Record<string, unknown> {
    return this.simpleRunCommand(paramsInput, "RUN_CANCEL_REQUESTED", (runId, run, commandId, actor) => {
      assertCondition(!TERMINAL_RUN_STATUSES.includes(run.status), "INVALID_TRANSITION", "Run is already terminal");
      assertCondition(
        run.status !== "DELIVERY_PENDING",
        "INVALID_TRANSITION",
        "A delivery-pending run requires explicit delivery abandonment",
      );
      const updated = this.transitionRun(runId, run.revision, "CANCELLING", {
        dispatchState: "CLOSED",
        cancelRequestedAt: nowMs(),
      }, "RUN_CANCEL_REQUESTED", { actor });
      this.closeQueuedDispatches(runId, "Run cancellation stopped this queued dispatch", {
        cancelledWorkItemIds: "ALL",
      });
      const cancellationRun = this.database.getRunSummary(updated.id);
      this.supersedePendingPartial(runId, cancellationRun.revision, "RUN_CANCEL_REQUESTED");
      this.insertDecision(runId, commandId, actor, "RUN_CANCEL_REQUESTED", {});
      this.enqueueActiveAttemptCancellations(runId, commandId);
      this.finishCancellationIfSettled(runId);
      return this.database.getRunSummary(runId);
    });
  }

  reconcileRun(paramsInput: Record<string, unknown>): Record<string, unknown> {
    return this.simpleRunCommand(paramsInput, "RECONCILE_REQUESTED", (runId, run, _commandId, actor) => {
      if (TERMINAL_RUN_STATUSES.includes(run.status)) {
        const failedFlowSync = this.database.db
          .prepare(
            `SELECT * FROM commands
             WHERE run_id = ? AND kind = 'FLOW_SYNC' AND status = 'FAILED'
             ORDER BY created_at DESC, id DESC LIMIT 1`,
          )
          .get(runId) as SqlRow | undefined;
        const failedProvision = this.database.db
          .prepare(
            `SELECT * FROM commands
             WHERE run_id = ? AND kind = 'PROVISION' AND status = 'FAILED'
             ORDER BY created_at DESC, id DESC LIMIT 1`,
          )
          .get(runId) as SqlRow | undefined;
        assertCondition(
          failedFlowSync || failedProvision,
          "INVALID_TRANSITION",
          "Terminal run does not have a failed Managed Flow command to reconcile",
        );
        const timestamp = nowMs();
        const failedCommand = failedFlowSync ?? failedProvision!;
        const failedKind = failedFlowSync ? "FLOW_SYNC" : "PROVISION";
        const retried = this.database.reopenFailedCommand(
          String(failedCommand.id),
          failedKind,
          timestamp,
        );
        assertCondition(
          retried,
          "REVISION_CONFLICT",
          "Managed Flow command changed before retry",
        );
        const updated = this.database.updateRun(runId, run.revision, { reconcileState: "RUNNING" });
        this.resolveInterventions(runId, "command", String(failedCommand.id), "retry");
        this.database.appendEvent(
          runId,
          failedKind === "FLOW_SYNC" ? "FLOW_MIRROR_RETRY_REQUESTED" : "FLOW_PROVISION_RETRY_REQUESTED",
          "command",
          String(failedCommand.id),
          updated.revision,
          { actor },
        );
        return updated;
      }
      const failedProvision = this.database.db
        .prepare(
          `SELECT * FROM commands
           WHERE run_id = ? AND kind = 'PROVISION' AND status = 'FAILED'
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .get(runId) as SqlRow | undefined;
      if (failedProvision) {
        assertCondition(
          run.status === "AWAITING_INTERVENTION",
          "INVALID_TRANSITION",
          "Failed provisioning can be retried only from intervention",
        );
        const retried = this.database.reopenFailedCommand(
          String(failedProvision.id),
          "PROVISION",
        );
        assertCondition(
          retried,
          "REVISION_CONFLICT",
          "Provision command changed before retry",
        );
        this.resolveInterventions(runId, "command", String(failedProvision.id), "retry");
        return this.transitionRun(runId, run.revision, "PROVISIONING", {
          dispatchState: "CLOSED",
          resumeStatus: null,
          reconcileState: "RUNNING",
        }, "RUN_PROVISION_RETRY_REQUESTED", { commandId: String(failedProvision.id), actor });
      }
      const updated = this.database.updateRun(runId, run.revision, { reconcileState: "RUNNING" });
      const sequence = this.database.appendEvent(runId, "RECONCILE_REQUESTED", "run", runId, updated.revision, { actor });
      this.lifecycle.defer(
        `reconcile-request:${runId}:${sequence}`,
        `deferred run reconciliation ${runId}`,
        0,
        async () => {
          await this.lifecycle.runOnce(
            `run-reconciliation:${runId}`,
            `run reconciliation ${runId}`,
            async () => this.reconcileOneRun(runId),
          );
        },
      );
      return { ...updated, lastSequence: sequence } as never;
    });
  }

  partialPreview(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const runId = readString(params.runId, "runId");
    const run = this.database.getRunSummary(runId);
    assertCondition(run.status === "AWAITING_INTERVENTION", "INVALID_TRANSITION", "Run is not awaiting intervention");
    assertCondition(run.cancelRequestedAt == null, "INVALID_TRANSITION", "Cancellation supersedes partial completion");
    assertCondition(!this.pendingPartialDecision(runId), "INVALID_TRANSITION", "A partial decision is already pending");
    const requestedIds = [...this.partialDecisionSpecification.selectLogicalIds(params.workItemIds, "workItemIds")];
    const partial = this.partialClosureForRun(runId, requestedIds);
    const closure = partial.closure;
    const expiresAt = nowMs() + 5 * 60_000;
    const token = this.confirmationToken("partial", runId, run.revision, {
      closure,
      expiresAt,
      planRevisionId: partial.planRevisionId,
    });
    return { runId, runRevision: run.revision, closure, expiresAt, confirmationToken: token };
  }

  acceptPartial(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, "junqi.collab.run.partial.accept");
    if (replay) return replay;
    const runId = readString(params.runId, "runId");
    const run = this.requireRunRevision(runId, envelope.expectedRunRevision);
    assertCondition(run.status === "AWAITING_INTERVENTION", "INVALID_TRANSITION", "Run is not awaiting intervention");
    assertCondition(run.cancelRequestedAt == null, "INVALID_TRANSITION", "Cancellation supersedes partial completion");
    const requestedIds = [...this.partialDecisionSpecification.selectLogicalIds(params.workItemIds, "workItemIds")];
    const expiresAt = readInteger(params.expiresAt, "expiresAt");
    assertCondition(expiresAt >= nowMs(), "INVALID_REQUEST", "Partial confirmation expired");
    const partial = this.partialClosureForRun(runId, requestedIds);
    const closure = partial.closure;
    const expectedToken = this.confirmationToken("partial", runId, run.revision, {
      closure,
      expiresAt,
      planRevisionId: partial.planRevisionId,
    });
    assertCondition(params.confirmationToken === expectedToken, "REVISION_CONFLICT", "Partial closure changed; preview again");
    const actor = "operator";
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      assertCondition(!this.pendingPartialDecision(runId), "INVALID_TRANSITION", "A partial decision is already pending");
      const currentRun = this.database.getRunSummary(runId);
      assertCondition(currentRun.currentPlanRevisionId === partial.planRevisionId, "REVISION_CONFLICT", "Current plan changed; preview again");
      const updated = this.database.updateRun(runId, run.revision, {
        status: "AWAITING_INTERVENTION",
        resumeStatus: "RUNNING",
        dispatchState: "CLOSED",
      });
      this.resolvePartialAcceptanceInterventions(
        runId,
        envelope.commandId,
        partial.planRevisionId,
      );
      this.insertDecision(runId, envelope.commandId, actor, "PARTIAL_PENDING", {
        planRevisionId: partial.planRevisionId,
        closure,
      });
      this.database.appendEvent(runId, "PARTIAL_ACCEPTED", "run", runId, updated.revision, { closure, actor });
      this.closeQueuedDispatches(runId, "Partial completion stopped this queued dispatch");
      const partialRun = this.database.getRunSummary(runId);
      response = this.acceptedResponse(runId, envelope.commandId, partialRun.revision, false);
      this.database.insertCommand({
        id: envelope.commandId,
        runId,
        kind: "EXPORT",
        receiptSource: "junqi.collab.run.partial.accept",
        payloadHash: envelope.payloadHash,
        payload: { noop: true },
        effectKey: `collab:${runId}:partial:${partialRun.revision}`,
        response,
      });
      assertCondition(
        this.database.settleUnleasedCommand(envelope.commandId, "PENDING", "SUCCEEDED", { response }),
        "REVISION_CONFLICT",
        "Partial decision receipt changed before it could be committed",
      );
      this.enqueueCancellationsForLogicalIds(runId, [...closure.waiveIds, ...closure.blockedDescendantIds], envelope.commandId);
      this.applyPendingPartialIfSettled(runId);
    });
    this.emitChanged(runId);
    return response!;
  }

  appendWorkItemInput(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const workItemId = readString(params.workItemId, "workItemId");
    const content = readBoundedRequiredString(
      params.content,
      "content",
      PERSISTENCE_LIMITS.additionalInputBytes,
    );
    return this.workItemCommand(params, workItemId, "INPUT_APPENDED", (runId, item, envelope) => {
      const existing = this.database.db
        .prepare(
          `SELECT COUNT(*) AS input_count, COALESCE(SUM(LENGTH(CAST(content AS BLOB))), 0) AS total_bytes
           FROM work_item_inputs WHERE work_item_id = ?`,
        )
        .get(workItemId) as SqlRow;
      const inputCount = numberValue(existing.input_count);
      const totalBytes = numberValue(existing.total_bytes) + byteLength(content);
      assertCondition(
        inputCount < PERSISTENCE_LIMITS.additionalInputsPerWorkItem,
        "CAPACITY_EXCEEDED",
        `work item additional inputs exceed the ${PERSISTENCE_LIMITS.additionalInputsPerWorkItem}-item limit`,
      );
      assertCondition(
        totalBytes <= PERSISTENCE_LIMITS.additionalInputsTotalBytes,
        "CAPACITY_EXCEEDED",
        `work item additional inputs exceed the ${PERSISTENCE_LIMITS.additionalInputsTotalBytes}-byte aggregate limit`,
      );
      const run = this.database.getRunSummary(runId);
      assertCondition(
        ["RUNNING", "AWAITING_INTERVENTION"].includes(run.status),
        "INVALID_TRANSITION",
        "Additional input is only accepted while work is running or awaiting intervention",
      );
      assertCondition(
        !this.hasActiveAttempt(workItemId),
        "ACTIVE_ATTEMPT_EXISTS",
        "Additional input cannot change an active attempt; wait for it to settle or cancel it first",
      );
      assertCondition(
        WORK_ITEM_INPUT_STATUSES.includes(String(item.status)),
        "INVALID_TRANSITION",
        "Additional input can only be attached before the next work-item attempt",
      );
      const timestamp = nowMs();
      const updated = this.database.db
        .prepare(
          `UPDATE work_items SET revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status IN ('BLOCKED', 'READY', 'NEEDS_INTERVENTION', 'CANCELLED')`,
        )
        .run(timestamp, workItemId, envelope.expectedEntityRevision);
      assertCondition(Number(updated.changes) === 1, "REVISION_CONFLICT", "Work item changed before input could be attached");
      this.database.db
        .prepare("INSERT INTO work_item_inputs(id, work_item_id, command_id, content, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(newId("input"), workItemId, envelope.commandId, content, timestamp);
      return {
        runId,
        workItemId,
        newEntityRevision: numberValue(item.revision) + 1,
        contentDigest: sha256(content),
        appliesTo: "NEXT_ATTEMPT",
      };
    });
  }

  reassignWorkItem(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const workItemId = readString(params.workItemId, "workItemId");
    const agentId = readString(params.agentId, "agentId");
    return this.workItemCommand(params, workItemId, "WORK_ITEM_REASSIGNED", (runId, item, envelope) => {
      const run = this.database.getRunSummary(runId);
      assertCondition(run.status === "AWAITING_INTERVENTION", "INVALID_TRANSITION", "Run is not awaiting intervention");
      assertCondition(!this.hasActiveAttempt(workItemId), "ACTIVE_ATTEMPT_EXISTS", "Cannot reassign an active work item");
      assertCondition(
        ["NEEDS_INTERVENTION", "CANCELLED"].includes(String(item.status)),
        "INVALID_TRANSITION",
        "Work item is not reassignable",
      );
      const candidates = parseJson<string[]>(item.candidate_agent_ids_json, []);
      assertCondition(candidates.includes(agentId), "CAPABILITY_CHANGED", "Agent was not approved for this work item");
      assertCondition(this.allowedAgentIds().has(agentId), "CAPABILITY_CHANGED", "Agent is no longer allowed");
      const updated = this.database.db
        .prepare(
          `UPDATE work_items SET assigned_agent_id = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status IN ('NEEDS_INTERVENTION', 'CANCELLED')`,
        )
        .run(agentId, nowMs(), workItemId, envelope.expectedEntityRevision);
      assertCondition(Number(updated.changes) === 1, "REVISION_CONFLICT", "Work item changed before reassignment");
      return { runId, agentId, newEntityRevision: numberValue(item.revision) + 1 };
    });
  }

  retryWorkItem(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const workItemId = readString(params.workItemId, "workItemId");
    return this.workItemCommand(params, workItemId, "WORK_ITEM_RETRY_CREATED", (runId, item, envelope) => {
      const run = this.database.getRunSummary(runId);
      assertCondition(run.status === "AWAITING_INTERVENTION", "INVALID_TRANSITION", "Run is not awaiting intervention");
      assertCondition(!this.hasActiveAttempt(workItemId), "ACTIVE_ATTEMPT_EXISTS", "Work item already has an active attempt");
      assertCondition(
        ["NEEDS_INTERVENTION", "CANCELLED"].includes(String(item.status)),
        "INVALID_TRANSITION",
        "Work item is not retryable",
      );
      this.resolveWorkItemRetryInterventions(runId, workItemId, envelope.commandId);
      const updatedItem = this.database.db
        .prepare(
          `UPDATE work_items SET status = 'READY', revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status IN ('NEEDS_INTERVENTION', 'CANCELLED')`,
        )
        .run(nowMs(), workItemId, envelope.expectedEntityRevision);
      assertCondition(Number(updatedItem.changes) === 1, "REVISION_CONFLICT", "Work item changed before retry");
      this.enqueueWorkerAttempt(runId, item, envelope.commandId);
      const currentRun = this.database.getRunSummary(runId);
      if (currentRun.status === "AWAITING_INTERVENTION") {
        const updated = this.database.updateRun(runId, currentRun.revision, {
          status: "RUNNING",
          dispatchState: "OPEN",
          resumeStatus: null,
          reconcileState: this.recoveryBlockers(runId).length > 0 ? "ATTENTION_REQUIRED" : "IDLE",
        });
        this.database.appendEvent(runId, "RUN_RESUMED_FOR_RETRY", "run", runId, updated.revision, { workItemId });
      }
      return { runId, workItemId, newEntityRevision: numberValue(this.getWorkItem(workItemId).revision) };
    });
  }

  cancelWorkItem(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const workItemId = readString(params.workItemId, "workItemId");
    return this.workItemCommand(params, workItemId, "WORK_ITEM_CANCEL_REQUESTED", (runId, item, envelope) => {
      const run = this.database.getRunSummary(runId);
      assertCondition(
        ["RUNNING", "AWAITING_INTERVENTION"].includes(run.status),
        "INVALID_TRANSITION",
        "Work items can only be cancelled while work is running or awaiting intervention",
      );
      assertCondition(
        WORK_ITEM_CANCEL_STATUSES.includes(String(item.status)),
        "INVALID_TRANSITION",
        "Work item is already terminal or cannot be cancelled from its current state",
      );
      const hadActiveAttempt = this.hasActiveAttempt(workItemId);
      const targetStatus = hadActiveAttempt ? "CANCELLING" : "CANCELLED";
      const timestamp = nowMs();
      const updatedItem = this.database.db
        .prepare(
          `UPDATE work_items SET status = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?
             AND status IN ('BLOCKED', 'READY', 'DISPATCHING', 'RUNNING', 'NEEDS_INTERVENTION')`,
        )
        .run(targetStatus, timestamp, workItemId, envelope.expectedEntityRevision);
      assertCondition(Number(updatedItem.changes) === 1, "REVISION_CONFLICT", "Work item changed before cancellation");

      if (run.status === "RUNNING") {
        this.transitionRun(runId, run.revision, "AWAITING_INTERVENTION", {
          dispatchState: "STOPPED",
          resumeStatus: "RUNNING",
        }, "WORK_ITEM_CANCEL_STOPPED_DISPATCH", { workItemId });
      }
      const closedDispatches = this.closeQueuedDispatches(
        runId,
        `Work item ${workItemId} cancellation stopped new dispatch`,
        { cancelledWorkItemIds: new Set([workItemId]) },
      );
      const stoppedPendingDispatches = closedDispatches.safelyCancelled + closedDispatches.uncertain;
      const runtimeCancellationQueued = this.hasActiveAttempt(workItemId);
      this.insertIntervention(
        runId,
        "WORK_ITEM_CANCEL_REQUESTED",
        "work_item",
        workItemId,
        "Resume dispatch, retry this work item, accept partial completion, or cancel the run",
        {
          workItemId,
          previousStatus: String(item.status),
          activeAttemptCancellation: hadActiveAttempt,
          runtimeCancellationQueued,
          stoppedPendingDispatches,
        },
        "RUNNING",
      );
      this.insertDecision(runId, envelope.commandId, "operator", "WORK_ITEM_CANCEL_REQUESTED", {
        workItemId,
        previousStatus: String(item.status),
        activeAttemptCancellation: hadActiveAttempt,
        runtimeCancellationQueued,
        stoppedPendingDispatches,
      });
      if (runtimeCancellationQueued) {
        this.enqueueCancellationsForLogicalIds(runId, [String(item.logical_id)], envelope.commandId);
      }
      const currentItem = this.getWorkItem(workItemId);
      return {
        runId,
        workItemId,
        status: String(currentItem.status),
        newEntityRevision: numberValue(currentItem.revision),
        activeAttemptCancellation: hadActiveAttempt,
        runtimeCancellationQueued,
        stoppedPendingDispatches,
      };
    });
  }

  resolveUnknownAttempt(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, "junqi.collab.attempt.resolveUnknown");
    if (replay) return replay;
    const attemptId = readString(params.attemptId, "attemptId");
    const resolution = readString(params.resolution, "resolution");
    const attempt = this.getAttempt(attemptId);
    const expectedEntityRevision = envelope.expectedEntityRevision;
    assertCondition(expectedEntityRevision != null, "INVALID_REQUEST", "expectedEntityRevision is required");
    assertCondition(
      numberValue(attempt.revision) === expectedEntityRevision,
      "REVISION_CONFLICT",
      "Attempt revision changed",
      { expectedRevision: expectedEntityRevision, actualRevision: numberValue(attempt.revision) },
    );
    const allowed = ["RUNNING", "FAILED", "TIMED_OUT", "CANCELLED", "ABANDONED"];
    assertCondition(allowed.includes(resolution), "INVALID_REQUEST", "Unsupported unknown-attempt resolution");
    const run = this.requireRunRevision(String(attempt.run_id), envelope.expectedRunRevision);
    if (resolution === "ABANDONED") {
      return this.abandonUnknownAttemptWithResidualRisk(
        attemptId,
        params.acceptResidualRisk === true,
        envelope,
        expectedEntityRevision,
        attempt,
        run,
      );
    }
    assertCondition(attempt.status === "UNKNOWN", "INVALID_TRANSITION", "Attempt is not UNKNOWN");
    if (resolution === "RUNNING") {
      assertCondition(
        typeof attempt.openclaw_run_id === "string" && attempt.openclaw_run_id.length > 0,
        "INVALID_REQUEST",
        "An UNKNOWN attempt can be confirmed RUNNING only after an exact OpenClaw run identity is known",
      );
    }
    const cancellationWins = resolution === "RUNNING"
      && (run.status === "CANCELLING" || this.hasTimeoutCancellationIntent(attemptId));
    const persistedStatus = cancellationWins ? "CANCELLING" : resolution;
    const actor = "operator";
    this.database.transaction(() => {
      const timestamp = nowMs();
      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET status = ?, revision = revision + 1, ended_at = ?, updated_at = ?
           WHERE id = ? AND run_id = ? AND status = 'UNKNOWN' AND revision = ?`,
        )
        .run(
          persistedStatus,
          resolution === "RUNNING" ? null : timestamp,
          timestamp,
          attemptId,
          run.id,
          expectedEntityRevision,
        );
      assertCondition(Number(changed.changes) === 1, "REVISION_CONFLICT", "Attempt revision changed", {
        expectedRevision: expectedEntityRevision,
      });
      if (cancellationWins) {
        assertCondition(
          this.ensureAttemptCancellationCommand(this.getAttempt(attemptId), envelope.commandId),
          "REVISION_CONFLICT",
          "A durable Task cancellation command could not be ensured",
        );
      }
      if (attempt.work_item_id && resolution !== "RUNNING") {
        const workItemStatus = run.status === "CANCELLING" || ["CANCELLED", "ABANDONED"].includes(resolution)
          ? "CANCELLED"
          : "NEEDS_INTERVENTION";
        this.database.db
          .prepare(
            `UPDATE work_items SET status = ?, revision = revision + 1, updated_at = ?
             WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED')`,
          )
          .run(workItemStatus, timestamp, attempt.work_item_id);
      }
      this.resolveInterventions(run.id, "attempt", attemptId, resolution);
      const resumeStatus: RunStatus = attempt.kind === "PLANNER"
        ? "PLANNING"
        : attempt.kind === "SYNTHESIZER"
          ? "SYNTHESIZING"
          : "RUNNING";
      const recoveryBlockers = this.recoveryBlockers(run.id);
      const attentionRequired = recoveryBlockers.length > 0
        || (resolution !== "RUNNING" && run.status !== "CANCELLING");
      const updated = resolution === "RUNNING"
        && run.status === "AWAITING_INTERVENTION"
        && recoveryBlockers.length === 0
        ? this.transitionRun(run.id, run.revision, resumeStatus, {
            dispatchState: resumeStatus === "RUNNING" ? "OPEN" : run.dispatchState,
            resumeStatus: null,
            reconcileState: "IDLE",
          }, "ATTEMPT_UNKNOWN_RUNNING_CONFIRMED", { attemptId, actor })
        : resolution !== "RUNNING" && run.status !== "AWAITING_INTERVENTION" && run.status !== "CANCELLING"
          ? this.transitionRun(run.id, run.revision, "AWAITING_INTERVENTION", {
              dispatchState: "STOPPED",
              resumeStatus,
              reconcileState: "ATTENTION_REQUIRED",
            }, "ATTEMPT_TERMINAL_OUTCOME_CONFIRMED", { attemptId, resolution, actor })
          : this.database.updateRun(run.id, run.revision, {
              dispatchState: attentionRequired ? "STOPPED" : run.dispatchState,
              reconcileState: attentionRequired ? "ATTENTION_REQUIRED" : "IDLE",
            });
      if (resolution !== "RUNNING" && run.status !== "CANCELLING") {
        this.insertIntervention(
          run.id,
          "ATTEMPT_TERMINAL_OUTCOME_CONFIRMED",
          "attempt",
          attemptId,
          attempt.kind === "PLANNER"
            ? "Revise or retry planning, or cancel the run"
            : attempt.kind === "SYNTHESIZER"
              ? "Revise the plan to rerun synthesis, or cancel the run"
              : "Retry or reassign the work item, accept partial completion, or cancel the run",
          { resolution, actor },
          resumeStatus,
        );
      }
      const response = this.acceptedResponse(run.id, envelope.commandId, updated.revision, false);
      this.database.insertCommand({
        id: envelope.commandId,
        runId: run.id,
        kind: "EXPORT",
        receiptSource: "junqi.collab.attempt.resolveUnknown",
        entityId: attemptId,
        payloadHash: envelope.payloadHash,
        payload: { noop: true },
        effectKey: `collab:${run.id}:resolve-unknown:${attemptId}:${resolution}`,
        response,
      });
      assertCondition(
        this.database.settleUnleasedCommand(envelope.commandId, "PENDING", "SUCCEEDED", { response }),
        "REVISION_CONFLICT",
        "Attempt resolution receipt changed before it could be committed",
      );
      this.insertDecision(run.id, envelope.commandId, actor, "ATTEMPT_UNKNOWN_RESOLVED", {
        attemptId,
        resolution,
        persistedStatus,
      });
      this.database.appendEvent(run.id, "ATTEMPT_UNKNOWN_RESOLVED", "attempt", attemptId, updated.revision, {
        resolution,
        persistedStatus,
        actor,
      });
    });
    const resolvedAttempt = this.getAttempt(attemptId);
    if (resolution === "RUNNING") {
      if (cancellationWins) {
        void this.drainCommands();
      } else {
        this.watchAttempt(resolvedAttempt);
      }
    } else {
      this.applyPendingPartialIfSettled(run.id);
      this.finishCancellationIfSettled(run.id);
    }
    this.emitChanged(run.id);
    return this.database.getCommandResponse(envelope.commandId)!;
  }

  private abandonUnknownAttemptWithResidualRisk(
    attemptId: string,
    acceptResidualRisk: boolean,
    envelope: ReturnType<typeof validateWriteEnvelope>,
    expectedEntityRevision: number,
    observedAttempt: AttemptRow,
    observedRun: ReturnType<CollaborationDatabase["getRunSummary"]>,
  ): Record<string, unknown> {
    this.assertResidualExecutionRiskAllowed(
      observedRun.status,
      observedAttempt,
      acceptResidualRisk,
    );

    this.database.transaction(() => {
      const attempt = this.getAttempt(attemptId);
      assertCondition(
        numberValue(attempt.revision) === expectedEntityRevision,
        "REVISION_CONFLICT",
        "Attempt revision changed",
        { expectedRevision: expectedEntityRevision, actualRevision: numberValue(attempt.revision) },
      );
      const run = this.requireRunRevision(String(attempt.run_id), envelope.expectedRunRevision);
      const decision = this.assertResidualExecutionRiskAllowed(
        run.status,
        attempt,
        acceptResidualRisk,
      );
      const acceptedAt = nowMs();
      const actor = "operator";
      const identity = this.residualAttemptIdentity(attempt);
      const acceptedRisk = {
        resolution: "ABANDONED",
        persistedStatus: "ABANDONED",
        acceptedResidualRisk: true,
        acceptedAt,
        actor,
        ...identity,
        cancellationEvidence: decision.cancellationEvidence,
        lastReconciledAt: decision.lastReconciledAt,
        terminationSemantics: "LOCAL_ORCHESTRATION_STOPPED_REMOTE_TASK_TERMINATION_UNCONFIRMED",
      };
      assertBoundedJson(
        acceptedRisk,
        "residual execution risk acceptance",
        PERSISTENCE_LIMITS.interventionDiagnosticsBytes,
      );

      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET status = 'ABANDONED', last_error = ?, ended_at = ?,
           revision = revision + 1, updated_at = ?
           WHERE id = ? AND run_id = ? AND status = 'UNKNOWN' AND revision = ?`,
        )
        .run(
          "Local orchestration stopped after explicit residual execution risk acceptance; remote Task termination is unconfirmed",
          acceptedAt,
          acceptedAt,
          attemptId,
          run.id,
          expectedEntityRevision,
        );
      assertCondition(Number(changed.changes) === 1, "REVISION_CONFLICT", "Attempt revision changed", {
        expectedRevision: expectedEntityRevision,
      });
      if (attempt.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
             WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED')`,
          )
          .run(acceptedAt, attempt.work_item_id);
      }

      this.resolveInterventions(run.id, "attempt", attemptId, "ABANDONED_WITH_RESIDUAL_RISK");
      const updated = this.database.updateRun(run.id, run.revision, {
        dispatchState: "STOPPED",
        reconcileState: "ATTENTION_REQUIRED",
      });
      this.insertIntervention(
        run.id,
        "ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK",
        "attempt",
        attemptId,
        "Inspect the exact OpenClaw Task independently; local orchestration is stopped and remote termination remains unconfirmed",
        acceptedRisk,
        "CANCELLING",
      );

      const response = this.acceptedResponse(run.id, envelope.commandId, updated.revision, false);
      this.database.insertCommand({
        id: envelope.commandId,
        runId: run.id,
        kind: "EXPORT",
        receiptSource: "junqi.collab.attempt.resolveUnknown",
        entityId: attemptId,
        payloadHash: envelope.payloadHash,
        payload: { noop: true },
        effectKey: `collab:${run.id}:resolve-unknown:${attemptId}:ABANDONED`,
        response,
      });
      assertCondition(
        this.database.settleUnleasedCommand(envelope.commandId, "PENDING", "SUCCEEDED", { response }),
        "REVISION_CONFLICT",
        "Attempt resolution receipt changed before it could be committed",
      );
      this.insertDecision(run.id, envelope.commandId, actor, "ATTEMPT_UNKNOWN_RESOLVED", acceptedRisk);
      this.database.appendEvent(
        run.id,
        "ATTEMPT_UNKNOWN_RESOLVED",
        "attempt",
        attemptId,
        updated.revision,
        acceptedRisk,
      );
    });

    this.finishCancellationIfSettled(observedRun.id);
    this.emitChanged(observedRun.id);
    return this.database.getCommandResponse(envelope.commandId)!;
  }

  private assertResidualExecutionRiskAllowed(
    runStatus: RunStatus,
    attempt: AttemptRow,
    acceptResidualRisk: boolean,
  ): Extract<ResidualExecutionRiskDecision, { kind: "ALLOWED" }> {
    const decision = this.assessResidualExecutionRisk(runStatus, attempt, acceptResidualRisk);
    assertCondition(
      decision.kind === "ALLOWED",
      decision.kind === "DENIED" && decision.reason === "RESIDUAL_RISK_NOT_ACCEPTED"
        ? "INVALID_REQUEST"
        : "INVALID_TRANSITION",
      "Unknown Attempt cannot be abandoned with residual execution risk from its current durable state",
      { reason: decision.kind === "DENIED" ? decision.reason : undefined },
    );
    return decision;
  }

  private assessResidualExecutionRisk(
    runStatus: RunStatus,
    attempt: AttemptRow,
    acceptResidualRisk: boolean,
  ): ResidualExecutionRiskDecision {
    const actionable = this.database.db
      .prepare(
        `SELECT id FROM commands
         WHERE run_id = ? AND entity_id = ? AND kind = 'CANCEL_ATTEMPT'
           AND status IN ('PENDING', 'LEASED')
         ORDER BY created_at, id LIMIT 1`,
      )
      .get(String(attempt.run_id), String(attempt.id)) as SqlRow | undefined;
    const evidenceRow = this.database.db
      .prepare(
        `SELECT id, status, attempts, effect_started_at FROM commands
         WHERE run_id = ? AND entity_id = ? AND kind = 'CANCEL_ATTEMPT'
           AND status IN ('SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED')
           AND effect_started_at IS NOT NULL
         ORDER BY effect_started_at DESC, created_at DESC, id DESC LIMIT 1`,
      )
      .get(String(attempt.run_id), String(attempt.id)) as SqlRow | undefined;
    const cancellationEvidence: ResidualCancellationEvidence | null = evidenceRow
      ? {
          commandId: String(evidenceRow.id),
          status: String(evidenceRow.status) as ResidualCancellationEvidence["status"],
          leaseGeneration: numberValue(evidenceRow.attempts),
          effectStartedAt: numberValue(evidenceRow.effect_started_at),
        }
      : null;
    return this.residualExecutionRiskSpecification.assess({
      runStatus,
      attemptStatus: String(attempt.status) as AttemptStatus,
      acceptResidualRisk,
      actionableCancellationCommandId: actionable ? String(actionable.id) : null,
      cancellationEvidence,
      lastReconciledAt: attempt.last_reconciled_at == null
        ? null
        : numberValue(attempt.last_reconciled_at),
    });
  }

  private canAbandonUnknownAttemptWithResidualRisk(runStatus: RunStatus, attempt: AttemptRow): boolean {
    if (runStatus !== "CANCELLING" || attempt.status !== "UNKNOWN") return false;
    return this.assessResidualExecutionRisk(runStatus, attempt, true).kind === "ALLOWED";
  }

  private residualAttemptIdentity(attempt: AttemptRow): Record<string, unknown> {
    return {
      attemptId: assertPersistableText(String(attempt.id), "attempt id", PERSISTENCE_LIMITS.externalReferenceBytes),
      attemptKind: assertPersistableText(String(attempt.kind), "attempt kind", PERSISTENCE_LIMITS.externalReferenceBytes),
      openclawRunId: attempt.openclaw_run_id == null
        ? null
        : assertPersistableText(String(attempt.openclaw_run_id), "OpenClaw run id", PERSISTENCE_LIMITS.externalReferenceBytes),
      openclawTaskId: attempt.openclaw_task_id == null
        ? null
        : assertPersistableText(String(attempt.openclaw_task_id), "OpenClaw Task id", PERSISTENCE_LIMITS.externalReferenceBytes),
      ownerSessionKey: assertPersistableText(
        String(attempt.worker_owner_session_key),
        "attempt owner session key",
        PERSISTENCE_LIMITS.externalReferenceBytes,
      ),
      childSessionKey: assertPersistableText(
        String(attempt.child_session_key),
        "attempt child session key",
        PERSISTENCE_LIMITS.externalReferenceBytes,
      ),
    };
  }

  private assertNoOpenResidualExecutionRisk(runId: string, operation: string): void {
    const openRisk = this.database.db
      .prepare(
        `SELECT id FROM interventions
         WHERE run_id = ? AND code = 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK'
           AND resolved_at IS NULL
         ORDER BY created_at, id LIMIT 1`,
      )
      .get(runId) as SqlRow | undefined;
    assertCondition(
      !openRisk,
      "INVALID_TRANSITION",
      `Run ${operation} is blocked while accepted residual execution risk remains open`,
      {
        reason: "OPEN_RESIDUAL_EXECUTION_RISK",
        interventionId: openRisk ? String(openRisk.id) : undefined,
      },
    );
  }

  retryDelivery(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const deliveryId = readString(params.deliveryId, "deliveryId");
    return this.deliveryCommand(params, deliveryId, "DELIVERY_RETRY_CREATED", (runId, delivery, envelope) => {
      assertCondition(
        ["RETRY_REQUIRED", "UNKNOWN"].includes(String(delivery.status)),
        "INVALID_TRANSITION",
        "Delivery is not retryable from its current state",
      );
      this.assertDeliveryIdle(deliveryId);
      if (delivery.status === "UNKNOWN") {
        assertCondition(
          this.requeueUnknownDeliveryAttemptInTransaction(runId, deliveryId, true),
          "DELIVERY_UNKNOWN",
          "The original uncertain delivery attempt cannot be reconciled automatically",
        );
      } else {
        this.enqueueDelivery(runId, delivery, envelope.commandId);
        this.resolveInterventions(runId, "delivery", deliveryId, "retry");
      }
      return { runId, deliveryId };
    });
  }

  retargetDelivery(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const deliveryId = readString(params.deliveryId, "deliveryId");
    return this.deliveryCommand(params, deliveryId, "DELIVERY_RETARGETED", (runId, delivery, envelope) => {
      assertCondition(
        ["PREPARED", "RETRY_REQUIRED", "UNKNOWN"].includes(String(delivery.status)),
        "INVALID_TRANSITION",
        "Delivery cannot be retargeted from its current state",
      );
      this.assertDeliveryIdle(deliveryId);
      const target = parseOrigin(params.target);
      const previousTarget = parseOrigin(parseJson(delivery.target_json, {}));
      assertCondition(
        !sameTranscriptTarget(target, previousTarget),
        "INVALID_REQUEST",
        "Delivery retargeting requires a different OpenClaw session; reconcile the original target with its existing key",
      );
      const revision = Number(delivery.target_revision) + 1;
      const newDeliveryId = newId("delivery");
      const now = nowMs();
      this.resolveInterventions(runId, "delivery", deliveryId, "retarget");
      const superseded = this.database.db
        .prepare(
          `UPDATE deliveries SET status = 'ABANDONED', revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status IN ('PREPARED', 'RETRY_REQUIRED', 'UNKNOWN')`,
        )
        .run(now, deliveryId, envelope.expectedEntityRevision);
      assertCondition(Number(superseded.changes) === 1, "REVISION_CONFLICT", "Delivery changed before retargeting");
      this.database.db
        .prepare(
          `INSERT INTO deliveries(id, run_id, final_artifact_id, target_revision, requirement, status,
           transcript_status, channel_status, target_json, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'TRANSCRIPT', 'PREPARED', 'PENDING', 'NOT_REQUIRED', ?, 1, ?, ?)`,
        )
        .run(newDeliveryId, runId, String(delivery.final_artifact_id), revision, stableStringify(target), now, now);
      this.enqueueDelivery(runId, this.getDelivery(newDeliveryId), envelope.commandId);
      return { runId, deliveryId: newDeliveryId, targetRevision: revision };
    });
  }

  abandonDelivery(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const deliveryId = readString(params.deliveryId, "deliveryId");
    return this.deliveryCommand(params, deliveryId, "DELIVERY_ABANDONED", (runId, delivery, envelope) => {
      assertCondition(params.confirm === true, "INVALID_REQUEST", "Delivery abandonment requires confirmation");
      assertCondition(
        ["PREPARED", "RETRY_REQUIRED", "UNKNOWN"].includes(String(delivery.status)),
        "INVALID_TRANSITION",
        "Delivery cannot be abandoned from its current state",
      );
      this.assertDeliveryIdle(deliveryId);
      const abandoned = this.database.db
        .prepare(
          `UPDATE deliveries SET status = 'ABANDONED', revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status IN ('PREPARED', 'RETRY_REQUIRED', 'UNKNOWN')`,
        )
        .run(nowMs(), deliveryId, envelope.expectedEntityRevision);
      assertCondition(Number(abandoned.changes) === 1, "REVISION_CONFLICT", "Delivery changed before abandonment");
      const run = this.database.getRunSummary(runId);
      const cancelling = this.transitionRun(runId, run.revision, "CANCELLING", { dispatchState: "CLOSED" }, "DELIVERY_ABANDONED", {
        deliveryId,
      });
      const cancelled = this.transitionRun(runId, cancelling.revision, "CANCELLED", { endedAt: nowMs() }, "RUN_CANCELLED", {
        reason: "DELIVERY_ABANDONED",
      });
      this.enqueueTerminalFlowSync(cancelled, "cancelled");
      this.insertDecision(runId, envelope.commandId, "operator", "DELIVERY_ABANDONED", { deliveryId });
      return { runId, deliveryId };
    });
  }

  archiveRun(paramsInput: Record<string, unknown>, archived: boolean): Record<string, unknown> {
    return this.simpleRunCommand(paramsInput, archived ? "RUN_ARCHIVED" : "RUN_UNARCHIVED", (runId, run, commandId, actor) => {
      assertCondition(
        TERMINAL_RUN_STATUSES.includes(run.status),
        "INVALID_TRANSITION",
        "Only a terminal collaboration run can be archived or unarchived",
      );
      const updated = this.database.updateRun(runId, run.revision, { archiveState: archived ? "ARCHIVED" : "ACTIVE" });
      this.database.appendEvent(runId, archived ? "RUN_ARCHIVED" : "RUN_UNARCHIVED", "run", runId, updated.revision, { actor });
      this.insertDecision(runId, commandId, actor, archived ? "RUN_ARCHIVED" : "RUN_UNARCHIVED", {});
      return updated;
    });
  }

  cloneRun(paramsInput: Record<string, unknown>): Promise<Record<string, unknown>> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const operation = "junqi.collab.run.clone";
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, operation);
    if (replay) return Promise.resolve(replay);
    const sourceRunId = readString(params.runId, "runId");
    const source = this.requireRunRevision(sourceRunId, envelope.expectedRunRevision);
    assertCondition(TERMINAL_RUN_STATUSES.includes(source.status), "INVALID_TRANSITION", "Only a terminal run can be cloned");
    this.assertNoOpenResidualExecutionRisk(source.id, "clone");
    const goal = readBoundedOptionalString(params.goal, "goal", PERSISTENCE_LIMITS.goalBytes) ?? source.goal;
    const origin = this.instanceIdentity.bindOrigin(params.origin ? parseOrigin(params.origin) : source.origin);
    const capabilityInput = params.capabilitySnapshot == null
      ? {}
      : parseJsonObject(params.capabilitySnapshot, "capabilitySnapshot");
    return this.createPlanFromResolvedInput({
      envelope,
      operation,
      origin,
      goal,
      capabilityInput,
      sourceRun: { id: source.id, revision: source.revision },
    });
  }

  createWorkflowTemplateFromRun(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const operation = "junqi.collab.workflow.template.createFromRun";
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, operation);
    if (replay) return replay;
    const sourceRunId = readString(params.runId, "runId");
    const name = readBoundedRequiredString(
      params.name,
      "name",
      PERSISTENCE_LIMITS.workflowTemplateNameBytes,
    );
    const source = this.requireRunRevision(sourceRunId, envelope.expectedRunRevision);
    assertCondition(
      source.status === "COMPLETED",
      "INVALID_TRANSITION",
      "Only a completed collaboration run can become a workflow template",
    );
    this.assertNoOpenResidualExecutionRisk(source.id, "create workflow template");
    const sourcePlanRevisionId = source.currentPlanRevisionId;
    if (!sourcePlanRevisionId) {
      throw new CollaborationError("NOT_FOUND", "Completed run does not have a plan revision");
    }
    const sourcePlan = this.getPlanRow(sourcePlanRevisionId);
    assertCondition(sourcePlan.run_id === source.id, "INVALID_REQUEST", "Plan revision belongs to another run");
    const definition = workflowTemplateDefinitionFromPlan(
      parseJson(sourcePlan.plan_json, {}),
      { maxWorkItems: this.config.maxWorkItems },
    );
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      const current = this.requireRunRevision(source.id, source.revision);
      assertCondition(
        current.status === "COMPLETED",
        "INVALID_TRANSITION",
        "Only a completed collaboration run can become a workflow template",
      );
      this.assertNoOpenResidualExecutionRisk(current.id, "create workflow template");
      const template = this.workflowTemplates.createPublishedFromRun({
        name,
        definition,
        sourceRunId: current.id,
        sourcePlanRevisionId,
        actor: "operator",
      });
      const eventPayload = {
        templateId: template.id,
        templateVersionId: template.currentVersion.id,
        templateDigest: template.currentVersion.digest,
      };
      this.database.appendEvent(current.id, "WORKFLOW_TEMPLATE_CREATED", "workflow_template", template.id, current.revision, eventPayload);
      this.insertDecision(current.id, envelope.commandId, "operator", "WORKFLOW_TEMPLATE_CREATED", eventPayload);
      response = this.acceptedResponse(current.id, envelope.commandId, current.revision, false, {
        ...eventPayload,
        templateName: template.name,
      });
      this.recordImmediateCommandReceipt({
        runId: current.id,
        envelope,
        operation,
        payload: eventPayload,
        effectKey: `collab:${current.id}:workflow-template:create:${envelope.commandId}`,
        response,
      });
    });
    this.emitChanged(source.id);
    return response!;
  }

  listWorkflowTemplates(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const requestedLimit = params.limit == null ? PERSISTENCE_LIMITS.workflowTemplates : readInteger(params.limit, "limit");
    assertCondition(
      requestedLimit >= 1 && requestedLimit <= PERSISTENCE_LIMITS.workflowTemplates,
      "INVALID_REQUEST",
      `limit must be between 1 and ${PERSISTENCE_LIMITS.workflowTemplates}`,
    );
    return {
      collaborationInstanceId: this.database.instanceId,
      templates: this.workflowTemplates.listPublished(requestedLimit).map((template) => this.workflowTemplates.toPublicRecord(template)),
    };
  }

  async instantiateWorkflowTemplate(paramsInput: Record<string, unknown>): Promise<Record<string, unknown>> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const operation = "junqi.collab.workflow.template.instantiate";
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, operation);
    if (replay) return replay;
    const templateId = readString(params.templateId, "templateId");
    const origin = this.instanceIdentity.bindOrigin(parseOrigin(params.origin));
    const goal = readBoundedRequiredString(params.goal, "goal", PERSISTENCE_LIMITS.goalBytes);
    const capabilityInput = params.capabilitySnapshot == null
      ? {}
      : parseJsonObject(params.capabilitySnapshot, "capabilitySnapshot");
    const parameters = params.parameters == null
      ? {}
      : parseJsonObject(params.parameters, "parameters");
    this.assertConfigured();
    this.assertMaintenanceInactive();
    this.reconcileExpiredSessionMutations();
    const identity = await this.awaitRuntime(
      "readOrigin",
      `read origin for ${operation}`,
      () => this.runtime.readOrigin(origin),
    );
    assertCondition(identity.found, "ORIGIN_NOT_DURABLE", "The origin message is not present in the exact transcript");
    assertCondition(identity.role === "user", "INVALID_REQUEST", "Workflow instantiation must originate from a user message");
    const concurrentReplay = this.replayedResponse(envelope.commandId, envelope.payloadHash, operation);
    if (concurrentReplay) return concurrentReplay;
    const capabilitySnapshot = this.buildCapabilitySnapshot(capabilityInput);
    const template = this.workflowTemplates.requirePublished(templateId);
    materializeWorkflowTemplatePlan(template.currentVersion.definition, {
      goal,
      allowedAgentIds: this.allowedAgentIds(),
      maxWorkItems: this.config.maxWorkItems,
    });
    const runId = newId("run");
    const planId = newId("plan");
    const now = nowMs();
    let response: Record<string, unknown>;
    this.reconcileExpiredSessionMutations();
    this.database.transaction(() => {
      this.assertMaintenanceInactive();
      this.assertSessionMutationInactive(origin);
      const currentTemplate = this.workflowTemplates.requirePublished(templateId);
      const currentPlan = materializeWorkflowTemplatePlan(currentTemplate.currentVersion.definition, {
        goal,
        allowedAgentIds: this.allowedAgentIds(),
        maxWorkItems: this.config.maxWorkItems,
      });
      const run = this.database.createRun({
        id: runId,
        origin,
        goal: currentPlan.goal,
        capabilitySnapshot,
        ...(typeof capabilitySnapshot.configHash === "string" ? { configHash: capabilitySnapshot.configHash } : {}),
      });
      this.database.db
        .prepare(
          `INSERT INTO plan_revisions(id, run_id, revision_no, plan_json, digest, source_attempt_id, created_at)
           VALUES (?, ?, 1, ?, ?, NULL, ?)`,
        )
        .run(planId, runId, stableStringify(currentPlan), sha256(currentPlan), now);
      for (const item of currentPlan.workItems) this.insertWorkItem(runId, planId, item, now);
      const link = this.workflowTemplates.linkRun({
        runId,
        templateId: currentTemplate.id,
        templateVersionId: currentTemplate.currentVersion.id,
        parameters,
      });
      const eventPayload = {
        templateId: currentTemplate.id,
        templateVersionId: currentTemplate.currentVersion.id,
        templateDigest: currentTemplate.currentVersion.digest,
        templateParameterDigest: link.parameterDigest,
        planRevisionId: planId,
      };
      const updated = this.transitionRun(
        runId,
        run.revision,
        "AWAITING_APPROVAL",
        { currentPlanRevisionId: planId, dispatchState: "CLOSED" },
        "WORKFLOW_TEMPLATE_INSTANTIATED",
        eventPayload,
      );
      this.insertDecision(runId, envelope.commandId, "operator", "WORKFLOW_TEMPLATE_INSTANTIATED", eventPayload);
      response = this.acceptedResponse(runId, envelope.commandId, updated.revision, false, eventPayload);
      this.recordImmediateCommandReceipt({
        runId,
        envelope,
        operation,
        payload: eventPayload,
        effectKey: `collab:${runId}:workflow-template:instantiate:${envelope.commandId}`,
        response,
      });
    });
    this.emitChanged(runId);
    return response!;
  }

  deletePreview(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const runId = readString(params.runId, "runId");
    const run = this.database.getRunSummary(runId);
    const deletionAssessment = assessRunDeletionPreview(this.deletionRepository.readSnapshot(runId));
    assertRunDeletionAssessmentSatisfied(deletionAssessment);
    const expiresAt = nowMs() + 5 * 60_000;
    const digest = this.runContentDigest(runId);
    const flowReconciliationBlocker = deletionAssessment.blocker;
    const token = this.confirmationToken("delete", runId, run.revision, {
      digest,
      expiresAt,
      flowReconciliationBlocker,
    });
    return {
      runId,
      runRevision: run.revision,
      digest,
      expiresAt,
      confirmationToken: token,
      ...(flowReconciliationBlocker ? { flowReconciliationBlocker } : {}),
    };
  }

  deleteRun(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, "junqi.collab.run.delete");
    if (replay) return replay;
    const runId = readString(params.runId, "runId");
    const run = this.requireRunRevision(runId, envelope.expectedRunRevision);
    const previewAssessment = assessRunDeletionPreview(this.deletionRepository.readSnapshot(runId));
    assertRunDeletionAssessmentSatisfied(previewAssessment);
    const expiresAt = readInteger(params.expiresAt, "expiresAt");
    assertCondition(expiresAt >= nowMs(), "INVALID_REQUEST", "Delete confirmation expired");
    const digest = this.runContentDigest(runId);
    const flowReconciliationBlocker = previewAssessment.blocker;
    let flowReconciliationAbandonment: FlowReconciliationAbandonment | null = null;
    if (flowReconciliationBlocker) {
      assertCondition(
        params.abandonFlowReconciliation === true,
        "FLOW_RECONCILIATION_REQUIRED",
        "Delete requires explicit abandonment of the failed Managed Flow reconciliation",
        { ...flowReconciliationBlocker },
      );
      const reason = readBoundedRequiredString(
        params.abandonmentReason,
        "abandonmentReason",
        PERSISTENCE_LIMITS.flowAbandonReasonBytes,
      );
      flowReconciliationAbandonment = { ...flowReconciliationBlocker, reason };
    } else {
      assertCondition(
        params.abandonFlowReconciliation !== true && params.abandonmentReason == null,
        "INVALID_REQUEST",
        "Managed Flow abandonment was requested but no failed reconciliation exists",
      );
    }
    const expected = this.confirmationToken("delete", runId, run.revision, {
      digest,
      expiresAt,
      flowReconciliationBlocker,
    });
    assertCondition(params.confirmationToken === expected, "REVISION_CONFLICT", "Run changed; preview deletion again");
    const jobId = newId("delete");
    const actor = "operator";
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      const now = nowMs();
      this.database.db
        .prepare(
          "INSERT INTO deletion_jobs(id, run_id, status, confirmation_digest, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, ?, ?)",
        )
        .run(jobId, runId, digest, now, now);
      response = this.acceptedResponse(runId, envelope.commandId, run.revision, false, { deletionJobId: jobId });
      this.database.insertCommand({
        id: envelope.commandId,
        runId,
        kind: "DELETE",
        receiptSource: "junqi.collab.run.delete",
        entityId: jobId,
        payloadHash: envelope.payloadHash,
        payload: {
          jobId,
          actor,
          digest,
          ...(flowReconciliationAbandonment ? { flowReconciliationAbandonment } : {}),
        },
        effectKey: `collab:${runId}:delete:${digest}`,
        response,
      });
      this.insertDeletionCommandReceipt({
        commandId: envelope.commandId,
        source: "junqi.collab.run.delete",
        runId,
        deletionJobId: jobId,
        payloadHash: envelope.payloadHash,
        response,
      });
    });
    void this.drainCommands();
    return response!;
  }

  deleteJobGet(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const jobId = readString(params.jobId, "jobId");
    const row = this.database.db.prepare("SELECT * FROM deletion_jobs WHERE id = ?").get(jobId) as SqlRow | undefined;
    if (!row) throw new CollaborationError("NOT_FOUND", `Deletion job ${jobId} was not found`);
    return deletionJobObject(row);
  }

  retryDelete(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, "junqi.collab.run.delete.retry");
    if (replay) return replay;
    const jobId = readString(params.jobId, "jobId");
    const expectedRunId = readString(params.expectedRunId, "expectedRunId");
    type RetryClaim =
      | { kind: "QUEUED"; response: Record<string, unknown> }
      | { kind: "COMPLETED"; response: Record<string, unknown> }
      | { kind: "PURGE_FAILED"; jobId: string; runId: string; diagnostic: string | null };

    const claim = this.database.transaction<RetryClaim>(() => {
      const row = this.database.db
        .prepare("SELECT * FROM deletion_jobs WHERE id = ?")
        .get(jobId) as SqlRow | undefined;
      if (!row) throw new CollaborationError("NOT_FOUND", `Deletion job ${jobId} was not found`);
      const runId = String(row.run_id);
      assertCondition(
        runId === expectedRunId,
        "SESSION_IDENTITY_MISMATCH",
        "Deletion job belongs to a different collaboration run",
        { expectedRunId, actualRunId: runId, deletionJobId: jobId },
      );

      const tombstone = this.database.db
        .prepare("SELECT cleanup_status FROM tombstones WHERE run_id = ?")
        .get(runId) as SqlRow | undefined;
      const stagingExists = existsSync(this.deletionStagingDirectory(runId));
      let status = String(row.status);
      if (status === "COMPLETED" && tombstone?.cleanup_status === "COMPLETED" && !stagingExists) {
        const response = this.writeResponse({
          accepted: true,
          replayed: false,
          commandId: envelope.commandId,
          runId,
          newRunRevision: envelope.expectedRunRevision ?? 0,
          lastEventSequence: 0,
          deletionJobId: jobId,
          status: "COMPLETED",
        });
        this.insertDeletionCommandReceipt({
          commandId: envelope.commandId,
          source: "junqi.collab.run.delete.retry",
          runId,
          deletionJobId: jobId,
          payloadHash: envelope.payloadHash,
          response,
        });
        return { kind: "COMPLETED", response };
      }
      if (status === "COMPLETED") {
        assertCondition(tombstone, "NOT_FOUND", "Completed deletion has no tombstone and cannot be recovered safely");
        const diagnostic = "Deletion was logically committed but physical cleanup is still pending";
        const transition = this.database.db
          .prepare(
            `UPDATE deletion_jobs SET status = 'PARTIAL', last_error = ?, updated_at = ?
             WHERE id = ? AND run_id = ? AND status = 'COMPLETED'`,
          )
          .run(diagnostic, nowMs(), jobId, runId);
        assertCondition(
          Number(transition.changes) === 1,
          "REVISION_CONFLICT",
          "Deletion job changed while recovery was being claimed",
          { deletionJobId: jobId, runId },
        );
        status = "PARTIAL";
      }
      assertCondition(status === "FAILED" || status === "PARTIAL", "INVALID_TRANSITION", "Deletion job is not retryable");

      const runExists = Boolean(this.database.db.prepare("SELECT 1 FROM collaboration_runs WHERE id = ?").get(runId));
      if (!runExists) {
        const persistedTombstone = this.database.db
          .prepare("SELECT 1 FROM tombstones WHERE run_id = ?")
          .get(runId);
        assertCondition(persistedTombstone, "NOT_FOUND", "Deleted run has no tombstone and cannot be recovered safely");
        const transition = this.database.db
          .prepare(
            `UPDATE deletion_jobs SET status = 'PENDING', last_error = NULL, updated_at = ?
             WHERE id = ? AND run_id = ? AND status IN ('FAILED', 'PARTIAL')`,
          )
          .run(nowMs(), jobId, runId);
        assertCondition(
          Number(transition.changes) === 1,
          "REVISION_CONFLICT",
          "Deletion cleanup is already being recovered",
          { deletionJobId: jobId, runId },
        );
        // Keep the transient PENDING claim, bounded physical purge, and the
        // final audit/job CAS in one IMMEDIATE transaction. If the process
        // dies during purge, SQLite rolls the claim back to FAILED/PARTIAL;
        // startup recovery can then safely reclaim the staging directory.
        const cleanup = this.purgeDeletedRunStaging(runId);
        const now = nowMs();
        const tombstoneUpdate = this.database.db
          .prepare(
            `UPDATE tombstones SET cleanup_status = ?, cleanup_error = ?, cleanup_updated_at = ?
             WHERE run_id = ?
               AND EXISTS (
                 SELECT 1 FROM deletion_jobs
                 WHERE id = ? AND run_id = ? AND status = 'PENDING'
               )`,
          )
          .run(cleanup.complete ? "COMPLETED" : "PARTIAL", cleanup.error, now, runId, jobId, runId);
        assertCondition(
          Number(tombstoneUpdate.changes) === 1,
          "REVISION_CONFLICT",
          "Deletion tombstone changed while cleanup was being recovered",
          { deletionJobId: jobId, runId },
        );
        const jobUpdate = this.database.db
          .prepare(
            `UPDATE deletion_jobs SET status = ?, last_error = ?, updated_at = ?
             WHERE id = ? AND run_id = ? AND status = 'PENDING'`,
          )
          .run(cleanup.complete ? "COMPLETED" : "PARTIAL", cleanup.error, now, jobId, runId);
        assertCondition(
          Number(jobUpdate.changes) === 1,
          "REVISION_CONFLICT",
          "Deletion cleanup job changed while cleanup was being committed",
          { deletionJobId: jobId, runId },
        );
        if (!cleanup.complete) {
          return { kind: "PURGE_FAILED", jobId, runId, diagnostic: cleanup.error };
        }
        const response = this.writeResponse({
          accepted: true,
          replayed: false,
          commandId: envelope.commandId,
          runId,
          newRunRevision: envelope.expectedRunRevision ?? 0,
          lastEventSequence: 0,
          deletionJobId: jobId,
          status: "COMPLETED",
        });
        this.insertDeletionCommandReceipt({
          commandId: envelope.commandId,
          source: "junqi.collab.run.delete.retry",
          runId,
          deletionJobId: jobId,
          payloadHash: envelope.payloadHash,
          response,
        });
        return { kind: "COMPLETED", response };
      }

      const run = this.requireRunRevision(runId, envelope.expectedRunRevision);
      const actor = "operator";
      const previousDelete = this.database.db
        .prepare(
          `SELECT payload_json FROM commands
           WHERE run_id = ? AND kind = 'DELETE' AND entity_id = ?
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .get(runId, jobId) as SqlRow | undefined;
      const previousPayload = parseJson<Record<string, unknown>>(previousDelete?.payload_json, {});
      const previousAbandonment = previousPayload.flowReconciliationAbandonment == null
        ? null
        : parseFlowReconciliationAbandonment(previousPayload.flowReconciliationAbandonment);
      const recoveryAssessment = recoverFlowReconciliationAbandonment(
        this.deletionRepository.readSnapshot(runId),
        previousAbandonment,
      );
      assertRunDeletionAssessmentSatisfied(recoveryAssessment);
      const flowReconciliationAbandonment = recoveryAssessment.abandonment;
      const transition = this.database.db
        .prepare(
          `UPDATE deletion_jobs SET status = 'PENDING', last_error = NULL, updated_at = ?
           WHERE id = ? AND run_id = ? AND status IN ('FAILED', 'PARTIAL')`,
        )
        .run(nowMs(), jobId, runId);
      assertCondition(
        Number(transition.changes) === 1,
        "REVISION_CONFLICT",
        "Deletion job is already being recovered",
        { deletionJobId: jobId, runId },
      );
      const response = this.acceptedResponse(runId, envelope.commandId, run.revision, false, { deletionJobId: jobId });
      this.database.insertCommand({
        id: envelope.commandId,
        runId,
        kind: "DELETE",
        receiptSource: "junqi.collab.run.delete.retry",
        entityId: jobId,
        payloadHash: envelope.payloadHash,
        payload: {
          jobId,
          actor,
          digest: String(row.confirmation_digest),
          ...(flowReconciliationAbandonment ? { flowReconciliationAbandonment } : {}),
        },
        effectKey: `collab:${runId}:delete-retry:${jobId}:${envelope.commandId}`,
        response,
      });
      this.insertDeletionCommandReceipt({
        commandId: envelope.commandId,
        source: "junqi.collab.run.delete.retry",
        runId,
        deletionJobId: jobId,
        payloadHash: envelope.payloadHash,
        response,
      });
      return { kind: "QUEUED", response };
    });

    if (claim.kind === "QUEUED") {
      void this.drainCommands();
      return claim.response;
    }
    if (claim.kind === "COMPLETED") return claim.response;
    if (claim.kind === "PURGE_FAILED") {
      throw new CollaborationError("INVALID_TRANSITION", "Physical artifact cleanup is still pending", {
        deletionJobId: claim.jobId,
        diagnostic: claim.diagnostic,
      });
    }
    throw new CollaborationError("REVISION_CONFLICT", "Deletion retry did not produce a terminal response");
  }

  createExport(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, "junqi.collab.export.create");
    if (replay) return replay;
    const runId = readString(params.runId, "runId");
    const run = this.requireRunRevision(runId, envelope.expectedRunRevision);
    const format = readOptionalString(params.format, "format") ?? "json";
    assertCondition(format === "json", "INVALID_REQUEST", "V1 exports support json only");
    const jobId = newId("export");
    const now = nowMs();
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      this.database.db
        .prepare(
          "INSERT INTO export_jobs(id, run_id, status, format, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, ?, ?)",
        )
        .run(jobId, runId, format, now, now);
      response = this.acceptedResponse(runId, envelope.commandId, run.revision, false, { exportJobId: jobId });
      this.database.insertCommand({
        id: envelope.commandId,
        runId,
        kind: "EXPORT",
        receiptSource: "junqi.collab.export.create",
        entityId: jobId,
        payloadHash: envelope.payloadHash,
        payload: {
          jobId,
          format,
          runRevision: run.revision,
          lastEventSequence: this.database.getLastSequence(runId),
        },
        effectKey: `collab:${runId}:export:${jobId}`,
        response,
      });
    });
    void this.drainCommands();
    return response!;
  }

  exportGet(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const jobId = readString(params.jobId, "jobId");
    let row = this.database.db.prepare("SELECT * FROM export_jobs WHERE id = ?").get(jobId) as SqlRow | undefined;
    if (!row) throw new CollaborationError("NOT_FOUND", `Export job ${jobId} was not found`);
    if (row.status === "COMPLETED") {
      try {
        assertCondition(typeof row.artifact_path === "string", "INVALID_RESPONSE", "Completed export has no artifact id");
        assertCondition(typeof row.digest === "string", "INVALID_RESPONSE", "Completed export has no digest");
        const artifactPath = this.resolveStoredExportPath(row.artifact_path);
        assertCondition(
          statSync(artifactPath).size <= PERSISTENCE_LIMITS.exportBytes,
          "CAPACITY_EXCEEDED",
          "Stored export exceeds its size contract",
        );
        const content = readFileSync(artifactPath, "utf8");
        assertBoundedText(content, "collaboration export", PERSISTENCE_LIMITS.exportBytes);
        assertCondition(sha256(content) === row.digest, "INVALID_RESPONSE", "Stored export digest does not match its job record");
      } catch (error) {
        const diagnostic = boundedDiagnostic(error);
        this.database.db
          .prepare(
            `UPDATE export_jobs SET status = 'FAILED', last_error = ?, updated_at = ?
             WHERE id = ? AND status = 'COMPLETED'`,
          )
          .run(diagnostic, nowMs(), jobId);
        row = this.database.db.prepare("SELECT * FROM export_jobs WHERE id = ?").get(jobId) as SqlRow;
      }
    }
    return exportJobObject(row);
  }

  exportDownload(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const job = this.exportGet(paramsInput);
    assertCondition(job.status === "COMPLETED" && typeof job.artifact_path === "string", "INVALID_TRANSITION", "Export is not ready");
    const artifactPath = this.resolveStoredExportPath(job.artifact_path);
    assertCondition(
      statSync(artifactPath).size <= PERSISTENCE_LIMITS.exportBytes,
      "CAPACITY_EXCEEDED",
      "Stored export exceeds its size contract",
    );
    const content = readFileSync(artifactPath, "utf8");
    assertBoundedText(content, "collaboration export", PERSISTENCE_LIMITS.exportBytes);
    assertCondition(sha256(content) === job.digest, "INVALID_RESPONSE", "Stored export digest does not match its job record");
    return { jobId: job.id, format: job.format, digest: job.digest, content };
  }

  sessionMutationImpact(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const runtimeId = this.instanceIdentity.assertRuntimeId(params.runtimeId);
    const sessionKey = readBoundedRequiredString(params.sessionKey, "sessionKey", PERSISTENCE_LIMITS.originSessionKeyBytes);
    const sessionId = readBoundedRequiredString(params.sessionId, "sessionId", PERSISTENCE_LIMITS.originSessionIdBytes);
    const action = this.parseSessionMutationAction(params.action);
    this.reconcileExpiredSessionMutations();
    const activeRuns = this.listSessionRunsForCurrentInstance({
      sessionKey,
      sessionId,
      activeOnly: true,
      limit: 100,
    });
    const mutation = this.findUnresolvedSessionMutation({ runtimeId, sessionKey, sessionId });
    return {
      runtimeId,
      sessionKey,
      sessionId,
      action,
      activeRuns,
      blocked: activeRuns.length > 0,
      runtimeMatches: true,
      activeMutation: mutation ? this.sessionMutationObject(mutation) : null,
      mutationFenceActive: Boolean(mutation),
      recoveryRequired: mutation?.status === "EXPIRED",
      coreRpcAllowed: Boolean(
        mutation
        && mutation.status === "PREPARED"
        && (mutation.policy === "STOP_AND_RETARGET_LATER" || activeRuns.length === 0)
      ),
      resetCasSupported: false,
      strategies: mutation?.status === "EXPIRED"
        ? ["RECOVER"]
        : activeRuns.length === 0
        ? ["PROCEED"]
        : action === "delete"
          ? ["CANCEL_AND_WAIT", "STOP_AND_RETARGET_LATER", "ABORT"]
          : ["CANCEL_AND_WAIT", "ABORT"],
    };
  }

  prepareSessionMutation(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const runtimeId = this.instanceIdentity.assertRuntimeId(params.runtimeId);
    const replay = this.replayedSessionMutationResponse(
      envelope.commandId,
      envelope.payloadHash,
      "SESSION_MUTATION:PREPARE",
    );
    if (replay) return replay;
    const sessionKey = readBoundedRequiredString(params.sessionKey, "sessionKey", PERSISTENCE_LIMITS.originSessionKeyBytes);
    const sessionId = readBoundedRequiredString(params.sessionId, "sessionId", PERSISTENCE_LIMITS.originSessionIdBytes);
    const action = this.parseSessionMutationAction(params.action);
    const policy = this.parseSessionMutationPolicy(params.policy);
    assertCondition(
      policy !== "STOP_AND_RETARGET_LATER" || action === "delete",
      "INVALID_REQUEST",
      "STOP_AND_RETARGET_LATER is only valid for session deletion",
    );
    this.reconcileExpiredSessionMutations();
    const sessionRuns = this.listSessionRunsForCurrentInstance({
      sessionKey,
      sessionId,
      activeOnly: true,
      limit: 100,
    });
    assertCondition(
      sessionRuns.length === 0 || policy !== "PROCEED",
      "INVALID_REQUEST",
      "PROCEED is only valid when no active collaboration is bound to the session",
    );
    const mutationId = newId("mutation");
    const timestamp = nowMs();
    const expiresAt = timestamp + SESSION_MUTATION_LEASE_MS;
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      const unresolved = this.findUnresolvedSessionMutation({ runtimeId, sessionKey, sessionId });
      if (unresolved) this.throwSessionMutationActive(unresolved);
      this.database.db
        .prepare(
          `INSERT INTO session_mutations(id, runtime_id, session_key, session_id, action, policy, status,
           lease_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'PREPARED', ?, ?, ?)`,
        )
        .run(mutationId, runtimeId, sessionKey, sessionId, action, policy, expiresAt, timestamp, timestamp);
      for (const run of sessionRuns) this.applySessionMutationFence(run.id, mutationId, policy);
      const activeRuns = this.listSessionRunsForCurrentInstance({
        sessionKey,
        sessionId,
        activeOnly: true,
        limit: 100,
      })
        .map((run) => this.activeRunReference(run));
      response = this.writeResponse({
        accepted: true,
        replayed: false,
        commandId: envelope.commandId,
        mutationId,
        status: "PREPARED",
        expiresAt,
        activeRuns,
        coreRpcAllowed: policy === "STOP_AND_RETARGET_LATER" || activeRuns.length === 0,
      });
      this.insertSessionMutationCommand({
        commandId: envelope.commandId,
        mutationId,
        operation: "PREPARE",
        payloadHash: envelope.payloadHash,
        response,
      });
    });
    for (const run of sessionRuns) this.emitChanged(run.id);
    return response!;
  }

  completeSessionMutation(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    this.instanceIdentity.assertRuntimeId(params.runtimeId);
    const replay = this.replayedSessionMutationResponse(
      envelope.commandId,
      envelope.payloadHash,
      "SESSION_MUTATION:COMPLETE",
    );
    if (replay) {
      this.scheduleCommandDrain();
      return replay;
    }
    const mutationId = readString(params.mutationId, "mutationId");
    assertCondition(typeof params.success === "boolean", "INVALID_REQUEST", "success must be a boolean");
    const success = params.success;
    this.reconcileExpiredSessionMutations();
    const row = this.database.db.prepare("SELECT * FROM session_mutations WHERE id = ?").get(mutationId) as SessionMutationRow | undefined;
    if (!row) throw new CollaborationError("NOT_FOUND", `Session mutation ${mutationId} was not found`);
    this.instanceIdentity.assertRuntimeId(row.runtime_id, "sessionMutation.runtimeId");
    assertCondition(
      row.status === "PREPARED" || row.status === "EXPIRED",
      "INVALID_TRANSITION",
      "Session mutation is not awaiting a core RPC result",
    );
    const timestamp = nowMs();
    const status: SessionMutationStatus = success ? "COMPLETED" : "FAILED";
    let response: Record<string, unknown>;
    const affectedRunIds: string[] = [];
    this.database.transaction(() => {
      const current = this.database.db.prepare("SELECT * FROM session_mutations WHERE id = ?").get(mutationId) as SessionMutationRow;
      this.instanceIdentity.assertRuntimeId(current.runtime_id, "sessionMutation.runtimeId");
      assertCondition(
        current.status === "PREPARED" || current.status === "EXPIRED",
        "INVALID_TRANSITION",
        "Session mutation is not awaiting a core RPC result",
      );
      const previousResult = sanitizeStoredJsonForOutput(
        parseJson<Record<string, unknown>>(current.result_json, {}),
        "session mutation result",
        PERSISTENCE_LIMITS.commandResponseBytes,
      ) as Record<string, unknown>;
      const result = {
        ...previousResult,
        coreRpc: {
          success,
          error: params.error == null ? null : boundedDiagnostic(params.error),
          completedAt: timestamp,
          commandId: envelope.commandId,
        },
        recoveredFromExpiry: current.status === "EXPIRED",
      };
      assertBoundedJson(result, "session mutation result", PERSISTENCE_LIMITS.commandResponseBytes);
      const changed = this.database.db
        .prepare(
          `UPDATE session_mutations SET status = ?, result_json = ?, updated_at = ?
           WHERE id = ? AND status IN ('PREPARED', 'EXPIRED')`,
        )
        .run(status, stableStringify(result), timestamp, mutationId);
      assertCondition(Number(changed.changes) === 1, "INVALID_TRANSITION", "Session mutation completion lost its fence");
      const runs = this.listSessionRunsForCurrentInstance({
        sessionKey: current.session_key,
        sessionId: current.session_id,
        limit: 500,
      });
      for (const run of runs) {
        const latest = this.database.getRunSummary(run.id);
        const updated = this.database.updateRun(run.id, latest.revision, {});
        this.database.appendEvent(run.id, "SESSION_MUTATION_COMPLETED", "session_mutation", mutationId, updated.revision, {
          action: current.action,
          policy: current.policy,
          success,
          status,
          recoveredFromExpiry: current.status === "EXPIRED",
        });
        this.database.db
          .prepare(
            `UPDATE interventions SET resolved_at = ?, resolved_by = 'session-mutation-recovery', resolution_json = ?
             WHERE run_id = ? AND code = 'SESSION_MUTATION_EXPIRED' AND entity_id = ? AND resolved_at IS NULL`,
          )
          .run(timestamp, stableStringify({ success, status }), run.id, mutationId);
        affectedRunIds.push(run.id);
      }
      response = this.writeResponse({
        accepted: true,
        replayed: false,
        commandId: envelope.commandId,
        mutationId,
        success,
        status,
        recoveredFromExpiry: current.status === "EXPIRED",
      });
      this.insertSessionMutationCommand({
        commandId: envelope.commandId,
        mutationId,
        operation: "COMPLETE",
        payloadHash: envelope.payloadHash,
        response,
      });
    });
    for (const runId of affectedRunIds) this.emitChanged(runId);
    this.scheduleCommandDrain();
    return response!;
  }

  maintenanceStatus(referenceTime = nowMs()): Record<string, unknown> {
    const inspection = this.reconcileMaintenanceLease(referenceTime);
    return {
      ...this.maintenanceStatusProjection(inspection),
      ...this.maintenanceRunSnapshot(),
    };
  }

  private maintenanceStatusProjection(inspection: MaintenanceLeaseInspection): Record<string, unknown> {
    return {
      // `active` remains the compatibility alias consumed by existing clients.
      active: inspection.gateActive,
      gateActive: inspection.gateActive,
      status: inspection.status,
      recoveryRequired: inspection.recoveryRequired,
      lease: inspection.kind === "VALID" ? inspection.lease : null,
      ...(inspection.kind === "MALFORMED"
        ? { diagnostic: inspection.diagnostic, rawDigest: inspection.rawDigest }
        : {}),
    };
  }

  private reconcileMaintenanceLease(referenceTime = nowMs()): MaintenanceLeaseInspection {
    const changedRunIds = new Set<string>();
    const inspection = this.maintenanceLeases.recoverExpired(referenceTime, (lease) => {
      this.applyExpiredMaintenanceLease(lease, changedRunIds);
    });
    for (const runId of changedRunIds) this.emitChanged(runId);
    return inspection;
  }

  private applyExpiredMaintenanceLease(lease: MaintenanceLease, changedRunIds: Set<string>): void {
    for (const run of this.database.scanActiveRunsById()) {
      const row = this.database.getRunRow(run.id);
      const storedResumeStatus = typeof row.resume_status === "string" && VALID_RUN_STATUSES.has(row.resume_status)
        ? row.resume_status as RunStatus
        : run.status;
      const suspend = MAINTENANCE_RECOVERY_SUSPEND_STATUSES.has(run.status);
      if (suspend) assertRunTransition(run.status, "AWAITING_INTERVENTION");
      const updated = this.database.updateRun(run.id, run.revision, {
        dispatchState: run.dispatchState === "OPEN" ? "STOPPED" : run.dispatchState,
        reconcileState: "ATTENTION_REQUIRED",
        ...(suspend ? { status: "AWAITING_INTERVENTION", resumeStatus: run.status } : {}),
      });
      const diagnostics = {
        leaseId: lease.id,
        status: lease.status,
        expiresAt: lease.expiresAt,
        expiredAt: lease.expiredAt,
      };
      this.database.appendEvent(
        run.id,
        "MAINTENANCE_LEASE_EXPIRED",
        "maintenance_lease",
        lease.id,
        updated.revision,
        diagnostics,
      );
      this.insertIntervention(
        run.id,
        "MAINTENANCE_LEASE_EXPIRED",
        "maintenance_lease",
        lease.id,
        "Verify runtime health, release the exact maintenance lease, then explicitly reconcile this Run",
        diagnostics,
        suspend ? run.status : storedResumeStatus,
      );
      this.closeQueuedDispatches(run.id, `Expired maintenance lease ${lease.id} requires explicit recovery`);
      changedRunIds.add(run.id);
    }
  }

  private maintenanceRunSnapshot(): Record<string, unknown> {
    const activeRunCount = this.database.countActiveRuns();
    const activeRuns: Record<string, unknown>[] = [];
    for (const run of this.database.listRuns({
      activeOnly: true,
      includeArchived: true,
      limit: MAINTENANCE_ACTIVE_RUN_REFERENCE_LIMIT,
    })) {
      const reference = this.activeRunReference(run);
      if (byteLength(stableStringify([...activeRuns, reference])) > MAINTENANCE_ACTIVE_RUN_REFERENCE_BUDGET_BYTES) break;
      activeRuns.push(reference);
    }
    return {
      activeRuns,
      activeRunCount,
      activeRunsTruncated: activeRunCount > activeRuns.length,
    };
  }

  private activeRunReference(
    run: ReturnType<CollaborationDatabase["getRunSummary"]>,
  ): Record<string, unknown> {
    return {
      runId: run.id,
      status: run.status,
      dispatchState: run.dispatchState,
      archiveState: run.archiveState,
      reconcileState: run.reconcileState,
      completionOutcome: run.completionOutcome,
      revision: run.revision,
      origin: {
        runtimeId: run.origin.runtimeId,
        agentId: run.origin.agentId,
        sessionKey: run.origin.sessionKey,
        sessionId: run.origin.sessionId,
        nativeMessageId: run.origin.nativeMessageId,
      },
      currentPlanRevisionId: run.currentPlanRevisionId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }

  enterMaintenance(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, "junqi.collab.maintenance.enter");
    if (replay) return replay;
    const timestamp = nowMs();
    const existing = this.reconcileMaintenanceLease(timestamp);
    if (existing.gateActive) this.throwMaintenanceActive(existing);
    const reason = readBoundedRequiredString(params.reason, "reason", PERSISTENCE_LIMITS.maintenanceReasonBytes);
    const owner = readBoundedOptionalString(params.owner, "owner", PERSISTENCE_LIMITS.actorBytes) ?? "desktop";
    const lease = this.maintenanceLeaseSpecification.createActive({
      id: newId("maintenance"),
      reason,
      owner,
      enteredAt: timestamp,
      expiresAt: timestamp + MAINTENANCE_LEASE_MS,
    });
    const { databaseIntegrity } = this.databaseHealth.refresh();
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      const current = this.maintenanceLeases.inspect(timestamp);
      if (current.gateActive) this.throwMaintenanceActive(current);
      if (!this.maintenanceLeases.create(lease)) this.throwMaintenanceActive(this.maintenanceLeases.inspect(timestamp));
      for (const run of this.database.scanActiveRunsById()) {
        if (run.dispatchState === "OPEN") {
          const updated = this.database.updateRun(run.id, run.revision, {
            dispatchState: "STOPPED",
            ...(run.status === "RUNNING" ? { status: "AWAITING_INTERVENTION", resumeStatus: "RUNNING" } : {}),
          });
          this.database.appendEvent(run.id, "MAINTENANCE_GATE_CLOSED", "run", run.id, updated.revision, { leaseId: lease.id });
          this.closeQueuedDispatches(run.id, `Maintenance lease ${lease.id} stopped this queued dispatch`);
        }
      }
      response = this.writeResponse({
        accepted: true,
        replayed: false,
        commandId: envelope.commandId,
        maintenanceLeaseId: lease.id,
        databaseIntegrity,
        ...this.maintenanceRunSnapshot(),
      });
      this.database.reserveCommandReceipt({
        commandId: envelope.commandId,
        source: "junqi.collab.maintenance.enter",
        runId: null,
        payloadHash: envelope.payloadHash,
        response,
      });
    });
    this.database.checkpoint();
    return response!;
  }

  exitMaintenance(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, "junqi.collab.maintenance.exit");
    if (replay) {
      if (replay.releasedLeaseStatus !== "EXPIRED") this.scheduleCommandDrain();
      return replay;
    }
    const leaseId = readString(params.maintenanceLeaseId, "maintenanceLeaseId");
    const owner = readBoundedRequiredString(params.owner, "owner", PERSISTENCE_LIMITS.actorBytes);
    assertCondition(params.healthVerified === true, "INVALID_REQUEST", "Runtime health must be verified before maintenance exit");
    const referenceTime = nowMs();
    this.reconcileMaintenanceLease(referenceTime);
    let response: Record<string, unknown>;
    let releasedLease: MaintenanceLease;
    this.database.transaction(() => {
      const released = this.maintenanceLeases.releaseExact(leaseId, owner, referenceTime);
      if (released.kind === "ABSENT") {
        throw new CollaborationError("INVALID_TRANSITION", "Maintenance is not active");
      }
      if (released.kind === "MALFORMED") {
        throw new CollaborationError(
          "MAINTENANCE_ACTIVE",
          "Malformed maintenance state cannot be released without a verifiable lease id",
          this.maintenanceStatusProjection(released.inspection),
        );
      }
      if (released.kind === "MISMATCH") {
        throw new CollaborationError("REVISION_CONFLICT", "Maintenance lease owner changed", {
          actualMaintenanceLeaseId: released.lease.id,
          status: released.lease.status,
        });
      }
      releasedLease = released.lease;
      response = this.writeResponse({
        accepted: true,
        replayed: false,
        commandId: envelope.commandId,
        maintenanceLeaseId: leaseId,
        active: false,
        gateActive: false,
        status: "INACTIVE",
        recoveryRequired: false,
        releasedLeaseStatus: releasedLease.status,
      });
      this.database.reserveCommandReceipt({
        commandId: envelope.commandId,
        source: "junqi.collab.maintenance.exit",
        runId: null,
        payloadHash: envelope.payloadHash,
        response,
      });
    });
    if (releasedLease!.status === "ACTIVE") this.scheduleCommandDrain();
    return response!;
  }

  getPlan(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const runId = readString(params.runId, "runId");
    const revisionId = readOptionalString(params.planRevisionId, "planRevisionId")
      ?? this.database.getRunSummary(runId).currentPlanRevisionId;
    assertCondition(revisionId, "NOT_FOUND", "Run does not have a plan revision");
    const row = this.getPlanRow(revisionId);
    assertCondition(row.run_id === runId, "INVALID_REQUEST", "Plan revision belongs to another run");
    return planRevisionObject(row);
  }

  getRun(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const runId = readString(params.runId, "runId");
    const snapshot = this.runSnapshot(runId);
    const run = snapshot.run as { revision: number };
    return {
      ...snapshot,
      snapshotRevision: run.revision,
      snapshot,
    };
  }

  listRuns(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const includeArchived = params.includeArchived === true;
    const activeOnly = params.activeOnly === true;
    const requestedLimit = params.limit == null ? 100 : readInteger(params.limit, "limit");
    assertCondition(requestedLimit >= 1 && requestedLimit <= 500, "INVALID_REQUEST", "limit must be between 1 and 500");
    const cursor = parseRunListCursor(params.cursor, { activeOnly, includeArchived });
    const page = this.database.listRunsPage({
      includeArchived,
      activeOnly,
      limit: requestedLimit,
      ...(cursor ? { cursor } : {}),
    });
    return {
      collaborationInstanceId: this.database.instanceId,
      runs: page.runs.map((run) => ({
        ...this.decorateRunAllowedActions(run),
        lastEventSequence: this.database.getLastSequence(run.id),
      })),
      nextCursor: page.nextCursor
        ? encodeRunListCursor(page.nextCursor, { activeOnly, includeArchived })
        : null,
      snapshotRevision: Math.max(0, ...page.runs.map((run) => run.revision)),
      lastSequence: this.database.getLastSequence(),
    };
  }

  listRunsBySession(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const sessionKey = readString(params.sessionKey, "sessionKey");
    const sessionId = readString(params.sessionId, "sessionId");
    const runs = this.database.listRuns({ sessionKey, sessionId, includeArchived: true, limit: 500 });
    return {
      collaborationInstanceId: this.database.instanceId,
      sessionKey,
      sessionId,
      runs: runs.map((run) => ({
        ...this.decorateRunAllowedActions(run),
        lastEventSequence: this.database.getLastSequence(run.id),
      })),
      snapshotRevision: Math.max(0, ...runs.map((run) => run.revision)),
      lastSequence: this.database.getLastSequence(),
    };
  }

  listTombstones(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const requestedLimit = params.limit == null ? 100 : readInteger(params.limit, "limit");
    assertCondition(requestedLimit >= 1 && requestedLimit <= 500, "INVALID_REQUEST", "limit must be between 1 and 500");
    const rows = this.database.db
      .prepare(
        `SELECT t.*, d.id AS deletion_job_id, d.status AS deletion_job_status
         FROM tombstones t
         LEFT JOIN deletion_jobs d ON d.id = t.deletion_job_id
         ORDER BY t.deleted_at DESC, t.id DESC
         LIMIT ?`,
      )
      .all(requestedLimit) as SqlRow[];
    return {
      collaborationInstanceId: this.database.instanceId,
      tombstones: rows.map(tombstoneObject),
    };
  }

  listEvents(paramsInput: Record<string, unknown>): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const runId = readString(params.runId, "runId");
    const afterSequence = params.afterSequence ?? 0;
    const limit = params.limit ?? 200;
    assertCondition(
      typeof afterSequence === "number" && Number.isSafeInteger(afterSequence) && afterSequence >= 0,
      "INVALID_REQUEST",
      "afterSequence must be a non-negative integer",
    );
    assertCondition(
      typeof limit === "number"
        && Number.isSafeInteger(limit)
        && limit >= 1
        && limit <= PERSISTENCE_LIMITS.eventsPerPage,
      "INVALID_REQUEST",
      `limit must be between 1 and ${PERSISTENCE_LIMITS.eventsPerPage}`,
    );
    const fetched = this.database.listEvents(runId, afterSequence, limit + 1);
    const hasMore = fetched.length > limit;
    const events = hasMore ? fetched.slice(0, limit) : fetched;
    const nextSequence = events.at(-1)?.sequence ?? afterSequence;
    return {
      collaborationInstanceId: this.database.instanceId,
      runId,
      events,
      nextSequence,
      snapshotRevision: this.database.getRunSummary(runId).revision,
      cursorInvalid: false,
      lastSequence: this.database.getLastSequence(runId),
      hasMore,
    };
  }

  private drainCommands(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.lifecycle.runOnce("command-drain", "collaboration command drain", async () => {
      while (!this.stopped) {
        const commands = this.database.claimCommands(this.workerId, COMMAND_BATCH_SIZE, COMMAND_LEASE_MS);
        if (commands.length === 0) break;
        for (const command of commands) {
          if (this.stopped) break;
          await this.executeCommand(command);
        }
      }
      this.scheduleNextPendingCommandDrain();
    });
  }

  private async executeCommand(command: CommandRecord): Promise<void> {
    try {
      const skipSettle = await this.commandHandlers.execute(command);
      if (!skipSettle && !this.database.settleClaimedCommand(command, "SUCCEEDED")) {
        const current = this.database.getCommand(command.id);
        if (current.status !== "SUCCEEDED") {
          this.logger.warn(`collaboration command ${command.id} lost its lease before success settlement`);
          this.scheduleRunReconciliation(command.runId);
        }
      }
    } catch (error) {
      if (error instanceof LifecycleAbortedError || error instanceof LifecycleClosedError) return;
      const message = boundedDiagnostic(error);
      this.logger.error(`collaboration command ${command.id} (${command.kind}) failed: ${message}`);
      try {
        if (command.kind === "PROVISION") {
          const retry = this.scheduleClaimedFailureRetry(command, message, PROVISION_RETRY_POLICY);
          if (retry === "LEASE_LOST") {
            this.logger.warn(`provision command ${command.id} lost its lease before retry scheduling`);
          } else if (retry === "EXHAUSTED") {
            this.commitClaimedCommandResult(command, "FAILED", { error: message }, () => {
              this.failCommandEntity(command, message);
            });
          }
          return;
        }
        if (command.kind === "FLOW_SYNC") {
          const retry = this.scheduleClaimedFailureRetry(command, message, FLOW_SYNC_RETRY_POLICY);
          if (retry === "LEASE_LOST") {
            this.logger.warn(`flow sync command ${command.id} lost its lease before retry scheduling`);
          } else if (retry === "EXHAUSTED") {
            this.commitClaimedCommandResult(command, "FAILED", { error: message }, () => {
              const run = this.database.getRunSummary(command.runId);
              const updated = this.database.updateRun(run.id, run.revision, {
                reconcileState: "ATTENTION_REQUIRED",
              });
              this.database.appendEvent(
                run.id,
                "FLOW_MIRROR_FAILED",
                "command",
                command.id,
                updated.revision,
                {
                  failureCount: command.failureCount + 1,
                  leaseAttempts: command.attempts,
                  diagnostic: message,
                },
              );
            });
          }
          return;
        }
        if (this.preserveAgentCommandAfterFailure(command, message)) return;
        const uncertainDelivery = command.kind === "DELIVER" && command.entityId
          ? this.database.db
            .prepare("SELECT 1 FROM deliveries WHERE id = ? AND status = 'UNKNOWN' LIMIT 1")
            .get(command.entityId)
          : null;
        const settled = this.commitClaimedCommandResult(
          command,
          uncertainDelivery || this.hasDurableEffectEvidence(command) ? "UNKNOWN" : "FAILED",
          { error: message },
          () => this.failCommandEntity(command, message),
        );
        if (!settled) {
          this.logger.warn(`collaboration command ${command.id} lost its lease before failure settlement`);
          this.scheduleRunReconciliation(command.runId);
        }
      } catch (settleError) {
        this.logger.error(`failed to settle collaboration command ${command.id}: ${String(settleError)}`);
      }
    } finally {
      if (command.kind !== "DELETE") this.emitChanged(command.runId);
    }
  }

  private scheduleClaimedFailureRetry(
    command: CommandRecord,
    diagnostic: string,
    policy: FailureRetryPolicy,
  ): FailureRetrySchedulingResult {
    const nextFailureCount = command.failureCount + 1;
    if (nextFailureCount >= policy.maxFailures) return "EXHAUSTED";
    const delay = policy.backoffMs[Math.min(command.failureCount, policy.backoffMs.length - 1)]!;
    if (!this.database.rescheduleClaimedCommand(command, delay, diagnostic)) return "LEASE_LOST";
    this.scheduleCommandDrain(delay);
    return "SCHEDULED";
  }

  private deferClaimedCommandForInfrastructure(command: CommandRecord, reason: string): boolean {
    const deferred = this.database.deferClaimedCommand(command, INFRASTRUCTURE_DEFER_MS, reason);
    if (deferred) this.scheduleCommandDrain(INFRASTRUCTURE_DEFER_MS);
    return deferred;
  }

  private commitClaimedCommandResult(
    command: CommandRecord,
    status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CANCELLED",
    params: { error?: string },
    apply: () => void,
  ): boolean {
    let committed = false;
    this.database.transaction(() => {
      if (!this.database.settleClaimedCommand(command, status, params)) return;
      apply();
      committed = true;
    });
    return committed;
  }

  /**
   * Cancellation changes Attempt action availability even when no Run field
   * changes. Commit a monotonic Run/event watermark with the command result so
   * snapshot consumers cannot retain a stale authorization projection.
   */
  private commitCancellationCommandResult(
    command: CommandRecord,
    attemptId: string,
    status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CANCELLED",
    params: { error?: string },
    apply: () => void = () => undefined,
  ): boolean {
    return this.commitClaimedCommandResult(command, status, params, () => {
      apply();
      const attempt = this.getAttempt(attemptId);
      const run = this.database.getRunSummary(command.runId);
      const updated = this.database.updateRun(run.id, run.revision, {});
      this.database.appendEvent(
        run.id,
        "ATTEMPT_CANCELLATION_COMMAND_SETTLED",
        "command",
        command.id,
        updated.revision,
        {
          attemptId,
          attemptStatus: String(attempt.status),
          commandStatus: status,
          canAbandonWithResidualRisk: this.canAbandonUnknownAttemptWithResidualRisk(
            updated.status,
            attempt,
          ),
        },
      );
    });
  }

  private preserveAgentCommandAfterFailure(command: CommandRecord, diagnostic: string): boolean {
    if (!command.entityId || !["PLAN", "DISPATCH", "SYNTHESIZE"].includes(command.kind)) return false;
    let attempt: AttemptRow;
    try {
      attempt = this.getAttempt(command.entityId);
    } catch {
      return false;
    }
    if (attempt.status === "CREATED") return false;
    if (["DISPATCHING", "CANCELLING"].includes(String(attempt.status))) {
      try {
        this.recordDispatchOutcomeUnknown(command, String(attempt.id), diagnostic);
      } catch (error) {
        this.logger.error(
          `failed to persist uncertain dispatch ${command.id}; leaving its lease for recovery: ${boundedDiagnostic(error)}`,
        );
      }
      return true;
    }
    if (attempt.status === "UNKNOWN") {
      if (!this.database.settleClaimedCommand(command, "UNKNOWN", { error: diagnostic })) {
        this.scheduleRunReconciliation(command.runId);
      }
      return true;
    }
    const commandStatus = ["SUCCEEDED", "CANCELLED"].includes(String(attempt.status))
      ? "SUCCEEDED"
      : "FAILED";
    if (!this.database.settleClaimedCommand(command, commandStatus, { error: diagnostic })) {
      this.scheduleRunReconciliation(command.runId);
    }
    return true;
  }

  /**
   * A lease can be claimed repeatedly while infrastructure is fenced. Claim
   * count is therefore not evidence that an external side effect started.
   * UNKNOWN is reserved for a durable effect marker or an Agent Attempt that
   * crossed the pre-dispatch boundary.
   */
  private hasDurableEffectEvidence(command: CommandRecord): boolean {
    try {
      const current = this.database.getCommand(command.id);
      if (current.effectStartedAt != null) return true;
    } catch {
      return false;
    }
    if (!command.entityId || !["PLAN", "DISPATCH", "SYNTHESIZE"].includes(command.kind)) return false;
    try {
      const attempt = this.getAttempt(command.entityId);
      return Boolean(attempt.openclaw_run_id)
        || ["DISPATCHING", "CANCELLING", "UNKNOWN", "RUNNING", "SUCCEEDED"].includes(String(attempt.status));
    } catch {
      return false;
    }
  }

  private async executeAgentCommand(command: CommandRecord, expectedKind: AgentDispatchKind): Promise<boolean> {
    const attemptId = readString(command.payload.attemptId, "command.payload.attemptId");
    const initialAttempt = this.getAttempt(attemptId);
    assertCondition(initialAttempt.kind === expectedKind, "INVALID_REQUEST", "Attempt kind does not match command");
    if (initialAttempt.openclaw_run_id) {
      const run = this.database.getRunSummary(command.runId);
      if (run.cancelRequestedAt != null || run.status === "CANCELLING") {
        this.enqueueAttemptCancellation(initialAttempt, command.id, true);
        void this.drainCommands();
      } else {
        this.watchAttempt(initialAttempt);
      }
      return true;
    }
    if (["DISPATCHING", "CANCELLING"].includes(String(initialAttempt.status))) {
      this.recordDispatchOutcomeUnknown(
        command,
        attemptId,
        "A previously started dispatch command was reclaimed without a persisted OpenClaw run identity",
      );
      await this.reconcileUnknownDispatchAttempt(this.getAttempt(attemptId));
      return false;
    }
    if (initialAttempt.status === "UNKNOWN") {
      if (!this.database.settleClaimedCommand(command, "UNKNOWN", {
        error: "Dispatch Attempt was already uncertain when its command lease was reclaimed",
      })) {
        this.scheduleRunReconciliation(command.runId);
        return false;
      }
      await this.reconcileUnknownDispatchAttempt(initialAttempt);
      return false;
    }
    let run = this.database.getRunSummary(command.runId);
    if (run.cancelRequestedAt != null || run.status === "CANCELLING") {
      if (this.enqueueAttemptCancellation(initialAttempt, command.id, true)) void this.drainCommands();
      return true;
    }
    if (expectedKind === "WORKER") {
      const mutation = this.findUnresolvedSessionMutation(run.origin);
      if (mutation) {
        this.suspendDispatchCommandForFence(command, initialAttempt, mutation);
        return false;
      }
      if (run.status !== "RUNNING" || run.dispatchState !== "OPEN") {
        this.database.transaction(() => {
          assertCondition(
            this.cancelClaimedDispatchBeforeStart(command, initialAttempt, "Dispatch gate closed before OpenClaw invocation"),
            "REVISION_CONFLICT",
            "Queued dispatch changed before its closed gate could be committed",
          );
        });
        return false;
      }
      this.assertMaintenanceInactive();
    }
    let dispatchAttempt = initialAttempt;
    let transientOriginText: string | undefined;
    if (expectedKind === "PLANNER") {
      const currentOrigin = await this.awaitRuntime(
        "readOrigin",
        `read origin for planner ${attemptId}`,
        () => this.runtime.readOrigin(run.origin),
      );
      dispatchAttempt = this.getAttempt(attemptId);
      run = this.database.getRunSummary(command.runId);
      if (run.cancelRequestedAt != null || run.status === "CANCELLING") {
        if (this.enqueueAttemptCancellation(dispatchAttempt, command.id, true)) void this.drainCommands();
        return true;
      }
      assertCondition(dispatchAttempt.status === "CREATED" && run.status === "PLANNING", "INVALID_TRANSITION", "Planner dispatch is no longer valid");
      assertCondition(currentOrigin.found && currentOrigin.role === "user", "ORIGIN_NOT_DURABLE", "Origin message is no longer readable");
      transientOriginText = currentOrigin.text;
    }
    dispatchAttempt = this.getAttempt(attemptId);
    run = this.database.getRunSummary(command.runId);
    if (run.cancelRequestedAt != null || run.status === "CANCELLING") {
      if (this.enqueueAttemptCancellation(dispatchAttempt, command.id, true)) void this.drainCommands();
      return true;
    }
    const message = this.buildAttemptPrompt(dispatchAttempt, transientOriginText);
    const dispatching = this.database.transaction<
      "STARTED" | "CANCELLED" | "DEFERRED" | "LEASE_LOST" | "AUTHORIZATION_REVOKED"
    >(() => {
      const timestamp = nowMs();
      if (!this.database.renewClaimedCommandLease(command, COMMAND_LEASE_MS, timestamp)) return "LEASE_LOST";
      const currentRun = this.database.getRunSummary(command.runId);
      const mutation = this.findUnresolvedSessionMutation(currentRun.origin);
      const dispatchAllowed = expectedKind === "PLANNER"
        ? currentRun.status === "PLANNING"
        : expectedKind === "SYNTHESIZER"
          ? currentRun.status === "SYNTHESIZING"
          : currentRun.status === "RUNNING" && currentRun.dispatchState === "OPEN";
      const cancellationActive = currentRun.cancelRequestedAt != null || currentRun.status === "CANCELLING";
      const infrastructureFence = mutation != null || this.maintenanceActive();
      if (
        !dispatchAllowed
        || cancellationActive
        || infrastructureFence
      ) {
        if (expectedKind !== "WORKER" && infrastructureFence && !cancellationActive) {
          assertCondition(
            this.deferClaimedCommandForInfrastructure(
              command,
              mutation
                ? `Session mutation fence ${mutation.id} deferred dispatch before OpenClaw invocation`
                : "Maintenance deferred dispatch before OpenClaw invocation",
            ),
            "REVISION_CONFLICT",
            "Agent command lease changed before infrastructure deferral",
          );
          return "DEFERRED";
        }
        assertCondition(
          this.cancelClaimedDispatchBeforeStart(
            command,
            this.getAttempt(attemptId),
            mutation
              ? `Session mutation fence ${mutation.id} closed dispatch before OpenClaw invocation`
              : "Dispatch gate closed before OpenClaw invocation",
          ),
          "REVISION_CONFLICT",
          "Queued dispatch changed before its runtime gate could be committed",
        );
        return "CANCELLED";
      }
      const configuredAgents = this.configuredAgents();
      const currentCapabilities = this.buildCapabilitySnapshot({}, configuredAgents);
      const authorization = decideAgentDispatchAuthorization({
        agentId: String(dispatchAttempt.worker_agent_id),
        attemptKind: expectedKind,
        configuredAgents,
        persistedConfigHash: nullableString(this.database.getRunRow(command.runId).capability_config_hash),
        currentConfigHash: currentCapabilities.configHash,
      });
      if (authorization.kind === "DENIED") {
        assertCondition(
          this.rejectClaimedAgentDispatchForAuthorization(command, this.getAttempt(attemptId), authorization),
          "REVISION_CONFLICT",
          "Agent command changed before authorization revocation could be committed",
        );
        return "AUTHORIZATION_REVOKED";
      }
      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET status = 'DISPATCHING', started_at = COALESCE(started_at, ?),
           revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'CREATED' AND revision = ?`,
        )
        .run(timestamp, timestamp, attemptId, numberValue(dispatchAttempt.revision));
      assertCondition(Number(changed.changes) === 1, "REVISION_CONFLICT", "Attempt changed before dispatch");
      return "STARTED";
    });
    if (
      dispatching === "CANCELLED"
      || dispatching === "DEFERRED"
      || dispatching === "AUTHORIZATION_REVOKED"
    ) return false;
    if (dispatching === "LEASE_LOST") {
      const current = this.getAttempt(attemptId);
      if (["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED", "ABANDONED"].includes(String(current.status))) return true;
      throw new CollaborationError("REVISION_CONFLICT", "Dispatch command lease changed before OpenClaw invocation");
    }
    dispatchAttempt = this.getAttempt(attemptId);
    let externalRunId: string;
    let externalTaskId: string | null;
    try {
      const result = await this.awaitRuntime(
        "runAgent",
        `run agent ${expectedKind.toLowerCase()} ${attemptId}`,
        () => this.runtime.runAgent({
          ownerAgentId: String(dispatchAttempt.worker_agent_id),
          childSessionKey: String(dispatchAttempt.child_session_key),
          message,
          idempotencyKey: String(dispatchAttempt.idempotency_key),
          executionRuntime: attemptExecutionRuntime(dispatchAttempt),
        }),
      );
      externalRunId = assertPersistableText(result.runId, "OpenClaw run id", PERSISTENCE_LIMITS.externalReferenceBytes);
      externalTaskId = result.taskId == null
        ? null
        : assertPersistableText(result.taskId, "OpenClaw task id", PERSISTENCE_LIMITS.externalReferenceBytes);
      const externalChildSessionKey = result.childSessionKey == null
        ? null
        : assertPersistableText(result.childSessionKey, "OpenClaw child session key", PERSISTENCE_LIMITS.originSessionKeyBytes);
      const capture = this.captureExternalAttemptIdentity({
        runId: command.runId,
        command,
        attemptId,
        expectedKind,
        externalRunId,
        externalTaskId,
        externalChildSessionKey,
        recoveredFromTaskLookup: false,
      });
      if (!capture.captured) return true;
      const refreshed = this.getAttempt(attemptId);
      if (capture.cancelAfterCapture) {
        void this.drainCommands();
      } else {
        this.watchAttempt(refreshed);
      }
      return true;
    } catch (error) {
      if (error instanceof AgentDispatchNotStartedError) {
        const committed = this.recordDispatchNotStarted(command, attemptId, boundedDiagnostic(error));
        if (!committed) this.scheduleRunReconciliation(command.runId);
        this.rethrowLifecycleStop(error);
        return false;
      }
      this.recordDispatchOutcomeUnknown(command, attemptId, boundedDiagnostic(error));
      this.rethrowLifecycleStop(error);
      return false;
    }
  }

  /**
   * Settle a Gateway refusal that is known to have happened before the remote
   * Task was created. Keeping this separate from UNKNOWN is what prevents an
   * ACP policy denial from creating a false residual-execution intervention.
   */
  private recordDispatchNotStarted(command: CommandRecord, attemptId: string, message: string): boolean {
    let committed = false;
    let cancellationSettledRunId: string | null = null;
    this.database.transaction(() => {
      const attempt = this.getAttempt(attemptId);
      if (String(attempt.run_id) !== command.runId) return;
      if (!(["DISPATCHING", "CANCELLING", "UNKNOWN"] as string[]).includes(String(attempt.status))) return;
      const diagnostic = boundedDiagnostic(message);
      const timestamp = nowMs();
      const cancellation = attempt.status === "CANCELLING"
        || this.database.getRunSummary(command.runId).status === "CANCELLING";
      const nextAttemptStatus = cancellation ? "CANCELLED" : "FAILED";
      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET status = ?, last_error = ?, ended_at = ?,
           revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = ? AND revision = ? AND openclaw_run_id IS NULL`,
        )
        .run(
          nextAttemptStatus,
          diagnostic,
          timestamp,
          timestamp,
          attemptId,
          String(attempt.status),
          numberValue(attempt.revision),
        );
      if (Number(changed.changes) !== 1) return;
      assertCondition(
        this.database.settleClaimedCommand(command, "FAILED", { error: diagnostic }),
        "REVISION_CONFLICT",
        "Dispatch command lease changed before the known rejection could be committed",
      );
      if (attempt.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = ?, revision = revision + 1, updated_at = ?
             WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED')`,
          )
          .run(cancellation ? "CANCELLED" : "NEEDS_INTERVENTION", timestamp, attempt.work_item_id);
      }
      const run = this.database.getRunSummary(command.runId);
      this.resolveInterventions(run.id, "attempt", attemptId, "dispatch-definitively-rejected-before-start");
      if (cancellation || TERMINAL_RUN_STATUSES.includes(run.status)) {
        const updated = this.database.updateRun(run.id, run.revision, {
          dispatchState: run.status === "CANCELLING" ? "STOPPED" : run.dispatchState,
          reconcileState: run.reconcileState,
        });
        this.database.appendEvent(run.id, "AGENT_DISPATCH_REJECTED", "attempt", attemptId, updated.revision, {
          commandId: command.id,
          message: diagnostic,
          started: false,
          cancellation,
        });
        cancellationSettledRunId = cancellation ? run.id : null;
        committed = true;
        return;
      }
      const resumeStatus = this.attemptResumeStatus(attempt);
      const updated = run.status === "AWAITING_INTERVENTION"
        ? this.database.updateRun(run.id, run.revision, {
            dispatchState: "STOPPED",
            reconcileState: "ATTENTION_REQUIRED",
          })
        : this.transitionRun(run.id, run.revision, "AWAITING_INTERVENTION", {
            dispatchState: "STOPPED",
            resumeStatus,
            reconcileState: "ATTENTION_REQUIRED",
          }, "RUN_ATTENTION_REQUIRED", { reason: "AGENT_DISPATCH_REJECTED", attemptId });
      this.database.appendEvent(run.id, "AGENT_DISPATCH_REJECTED", "attempt", attemptId, updated.revision, {
        commandId: command.id,
        message: diagnostic,
        started: false,
      });
      this.insertIntervention(
        run.id,
        "AGENT_DISPATCH_REJECTED",
        "attempt",
        attemptId,
        "Fix the Agent or Gateway policy, then retry the Attempt or cancel the Run",
        { commandId: command.id, message: diagnostic, started: false },
        resumeStatus,
      );
      this.closeQueuedDispatches(run.id, "Agent dispatch was rejected before the remote Task started");
      committed = true;
    });
    if (cancellationSettledRunId) this.finishCancellationIfSettled(cancellationSettledRunId);
    return committed;
  }

  private rejectClaimedAgentDispatchForAuthorization(
    command: CommandRecord,
    attempt: AttemptRow,
    denial: Extract<AgentDispatchAuthorizationDecision, { kind: "DENIED" }>,
  ): boolean {
    return this.database.transaction(() => (
      this.commitClaimedAgentAuthorizationRejection(command, attempt, denial)
    ));
  }

  private commitClaimedAgentAuthorizationRejection(
    command: CommandRecord,
    attempt: AttemptRow,
    denial: Extract<AgentDispatchAuthorizationDecision, { kind: "DENIED" }>,
  ): boolean {
    const diagnostic = boundedDiagnostic(denial.diagnostic);
    if (!this.database.settleClaimedCommand(command, "FAILED", { error: diagnostic })) return false;
    const timestamp = nowMs();
    const attemptChanged = this.database.db
      .prepare(
        `UPDATE attempts SET status = 'FAILED', last_error = ?, ended_at = ?,
         revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'CREATED' AND revision = ? AND openclaw_run_id IS NULL`,
      )
      .run(diagnostic, timestamp, timestamp, attempt.id, numberValue(attempt.revision));
    assertCondition(
      Number(attemptChanged.changes) === 1,
      "REVISION_CONFLICT",
      "Attempt changed before authorization revocation could be committed",
    );
    if (attempt.work_item_id) {
      const workItemChanged = this.database.db
        .prepare(
          `UPDATE work_items SET status = 'NEEDS_INTERVENTION', revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'DISPATCHING'`,
        )
        .run(timestamp, attempt.work_item_id);
      assertCondition(
        Number(workItemChanged.changes) === 1,
        "REVISION_CONFLICT",
        "Work item changed before authorization revocation could be committed",
      );
    }
    const run = this.database.getRunSummary(command.runId);
    const resumeStatus = this.attemptResumeStatus(attempt);
    const updated = this.transitionRun(run.id, run.revision, "AWAITING_INTERVENTION", {
      dispatchState: "STOPPED",
      resumeStatus,
      reconcileState: "ATTENTION_REQUIRED",
    }, "AGENT_AUTHORIZATION_REVOKED", {
      attemptId: String(attempt.id),
      attemptKind: String(attempt.kind),
      agentId: String(attempt.worker_agent_id),
      reason: denial.reason,
    });
    this.closeQueuedDispatches(run.id, "Agent authorization was revoked before OpenClaw invocation");
    this.insertIntervention(
      run.id,
      "AGENT_AUTHORIZATION_REVOKED",
      "attempt",
      String(attempt.id),
      "Restore the approved Agent authorization and retry, or cancel the Run",
      {
        agentId: String(attempt.worker_agent_id),
        attemptKind: String(attempt.kind),
        reason: denial.reason,
      },
      resumeStatus,
    );
    void updated;
    return true;
  }

  private cancelClaimedDispatchBeforeStart(
    command: CommandRecord,
    attempt: AttemptRow,
    reason: string,
  ): boolean {
    if (attempt.status !== "CREATED" || attempt.openclaw_run_id != null) return false;
    if (!this.database.settleClaimedCommand(command, "CANCELLED", { error: reason })) return false;
    const timestamp = nowMs();
    const attemptChanged = this.database.db
      .prepare(
        `UPDATE attempts SET status = 'CANCELLED', last_error = ?, ended_at = ?,
         revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'CREATED' AND revision = ? AND openclaw_run_id IS NULL`,
      )
      .run(reason, timestamp, timestamp, attempt.id, numberValue(attempt.revision));
    assertCondition(
      Number(attemptChanged.changes) === 1,
      "REVISION_CONFLICT",
      "Attempt changed before pre-dispatch cancellation could be committed",
    );
    if (attempt.work_item_id) {
      this.database.db
        .prepare(
          `UPDATE work_items SET status = 'READY', revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'DISPATCHING'`,
        )
        .run(timestamp, attempt.work_item_id);
    }
    const run = this.database.getRunSummary(command.runId);
    this.database.appendEvent(
      run.id,
      "DISPATCH_CANCELLED_BEFORE_START",
      "attempt",
      String(attempt.id),
      run.revision,
      { workItemId: attempt.work_item_id, reason },
    );
    return true;
  }

  private captureExternalAttemptIdentity(params: {
    runId: string;
    command: CommandRecord;
    attemptId: string;
    expectedKind: string;
    externalRunId: string;
    externalTaskId: string | null;
    externalChildSessionKey: string | null;
    recoveredFromTaskLookup: boolean;
  }): { captured: boolean; cancelAfterCapture: boolean } {
    let captured = false;
    let cancelAfterCapture = false;
    this.database.transaction(() => {
      const currentAttempt = this.getAttempt(params.attemptId);
      const currentRun = this.database.getRunSummary(params.runId);
      if (["SUCCEEDED", "FAILED", "TIMED_OUT", "ABANDONED"].includes(String(currentAttempt.status))) return;
      if (["RUNNING", "CANCELLING"].includes(String(currentAttempt.status))) {
        const sameRun = currentAttempt.openclaw_run_id === params.externalRunId;
        const sameTask = params.externalTaskId == null
          || currentAttempt.openclaw_task_id == null
          || currentAttempt.openclaw_task_id === params.externalTaskId;
        const sameChild = params.externalChildSessionKey == null
          || currentAttempt.child_session_key === params.externalChildSessionKey;
        assertCondition(
          sameRun && sameTask && sameChild,
          "REVISION_CONFLICT",
          "Attempt is already bound to a different OpenClaw Task identity",
        );
        if (currentAttempt.openclaw_task_id == null && params.externalTaskId != null) {
          const enriched = this.database.db
            .prepare(
              `UPDATE attempts SET openclaw_task_id = ?, revision = revision + 1, updated_at = ?
               WHERE id = ? AND revision = ? AND status = ? AND openclaw_run_id = ?
                 AND openclaw_task_id IS NULL`,
            )
            .run(
              params.externalTaskId,
              nowMs(),
              params.attemptId,
              numberValue(currentAttempt.revision),
              String(currentAttempt.status),
              params.externalRunId,
            );
          assertCondition(
            Number(enriched.changes) === 1,
            "REVISION_CONFLICT",
            "Attempt changed before its OpenClaw Task id could be enriched",
          );
        }
        cancelAfterCapture = currentAttempt.status === "CANCELLING";
        if (cancelAfterCapture) {
          assertCondition(
            this.ensureAttemptCancellationCommand(this.getAttempt(params.attemptId), params.command.id),
            "REVISION_CONFLICT",
            "A durable Task cancellation command could not be ensured",
          );
        }
        return;
      }
      const currentWorkItem = currentAttempt.work_item_id
        ? this.getWorkItem(String(currentAttempt.work_item_id))
        : null;
      const cancellationWins = currentRun.cancelRequestedAt != null
        || currentRun.status === "CANCELLING"
        || TERMINAL_RUN_STATUSES.includes(currentRun.status)
        || ["CANCELLING", "CANCELLED"].includes(String(currentAttempt.status))
        || (currentWorkItem != null && ["CANCELLING", "CANCELLED"].includes(String(currentWorkItem.status)));
      const now = nowMs();
      const nextStatus = cancellationWins ? "CANCELLING" : "RUNNING";
      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET status = ?, child_session_key = COALESCE(?, child_session_key), openclaw_run_id = ?, openclaw_task_id = ?,
           started_at = COALESCE(started_at, ?), last_error = NULL, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status IN ('DISPATCHING', 'UNKNOWN', 'CANCELLING', 'CANCELLED')`,
        )
        .run(
          nextStatus,
          params.externalChildSessionKey,
          params.externalRunId,
          params.externalTaskId,
          now,
          now,
          params.attemptId,
          numberValue(currentAttempt.revision),
        );
      assertCondition(Number(changed.changes) === 1, "REVISION_CONFLICT", "Attempt changed before external identity could be persisted");
      if (currentAttempt.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = ?, revision = revision + 1, updated_at = ?
             WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED')`,
          )
          .run(cancellationWins ? "CANCELLING" : "RUNNING", now, currentAttempt.work_item_id);
      }
      this.resolveInterventions(
        params.runId,
        "attempt",
        params.attemptId,
        cancellationWins ? "external-id-captured-for-cancel" : "dispatch-recovered",
      );
      const updated = this.updateRunAfterAttemptRecovery(currentAttempt, cancellationWins);
      this.database.appendEvent(
        params.runId,
        cancellationWins
          ? "ATTEMPT_CAPTURED_FOR_CANCEL"
          : params.recoveredFromTaskLookup
            ? "ATTEMPT_RECOVERED_FROM_TASK"
            : "ATTEMPT_RUNNING",
        "attempt",
        params.attemptId,
        updated.revision,
        {
          runId: params.externalRunId,
          taskId: params.externalTaskId,
          ...(params.externalChildSessionKey ? { childSessionKey: params.externalChildSessionKey } : {}),
          kind: params.expectedKind,
          recoveredFromTaskLookup: params.recoveredFromTaskLookup,
        },
      );
      const commandSettled = params.recoveredFromTaskLookup
        ? this.database.settleUnleasedCommandSnapshot(params.command, "SUCCEEDED")
        : this.database.settleClaimedCommand(params.command, "SUCCEEDED");
      assertCondition(
        commandSettled,
        "REVISION_CONFLICT",
        "Dispatch command lease changed before external identity could be committed",
      );
      captured = true;
      cancelAfterCapture = cancellationWins;
      if (cancellationWins) {
        assertCondition(
          this.ensureAttemptCancellationCommand(this.getAttempt(params.attemptId), params.command.id),
          "REVISION_CONFLICT",
          "A durable Task cancellation command could not be ensured",
        );
      }
    });
    return { captured, cancelAfterCapture };
  }

  private attemptResumeStatus(attempt: AttemptRow): RunStatus {
    return attempt.kind === "PLANNER"
      ? "PLANNING"
      : attempt.kind === "SYNTHESIZER"
        ? "SYNTHESIZING"
        : "RUNNING";
  }

  private terminalAttemptCompletionDecision(
    attempt: AttemptRow,
    run: ReturnType<CollaborationDatabase["getRunSummary"]>,
  ): TerminalAttemptCompletionDecision {
    return decideTerminalAttemptCompletion({
      attemptKind: attempt.kind,
      runStatus: run.status,
      resumeStatus: this.database.getRunRow(run.id).resume_status,
    });
  }

  private restoreSuspendedAttemptPhase(
    attempt: AttemptRow,
    run: ReturnType<CollaborationDatabase["getRunSummary"]>,
    decision: Extract<TerminalAttemptCompletionDecision, { kind: "ACCEPT" }>,
  ): ReturnType<CollaborationDatabase["getRunSummary"]> {
    if (decision.mode === "ACTIVE") return run;
    return this.transitionRun(run.id, run.revision, decision.expectedRunStatus, {
      resumeStatus: null,
    }, "SUSPENDED_ATTEMPT_RESULT_ACCEPTED", {
      attemptId: String(attempt.id),
      attemptKind: String(attempt.kind),
      suspendedPhase: decision.expectedRunStatus,
    });
  }

  private workerPhaseRestorationDecision(
    run: ReturnType<CollaborationDatabase["getRunSummary"]>,
  ) {
    return decideWorkerPhaseRestoration({
      hasPendingPartialDecision: Boolean(this.pendingPartialDecision(run.id)),
      maintenanceGateActive: this.maintenanceActive(),
      hasUnresolvedIntervention: Boolean(this.database.db
        .prepare(
          `SELECT 1 FROM interventions
           WHERE run_id = ? AND resolved_at IS NULL
           LIMIT 1`,
        )
        .get(run.id)),
      hasActiveSessionMutation: Boolean(this.findUnresolvedSessionMutation(run.origin)),
    });
  }

  private recoveryBlockers(runId: string): string[] {
    const blockers: string[] = [];
    if (this.database.db.prepare("SELECT 1 FROM attempts WHERE run_id = ? AND status = 'UNKNOWN' LIMIT 1").get(runId)) {
      blockers.push("UNKNOWN_ATTEMPT");
    }
    if (this.database.db.prepare("SELECT 1 FROM interventions WHERE run_id = ? AND resolved_at IS NULL LIMIT 1").get(runId)) {
      blockers.push("OPEN_INTERVENTION");
    }
    if (this.database.db.prepare("SELECT 1 FROM deliveries WHERE run_id = ? AND status = 'UNKNOWN' LIMIT 1").get(runId)) {
      blockers.push("UNKNOWN_DELIVERY");
    }
    const run = this.database.getRunSummary(runId);
    if (this.findUnresolvedSessionMutation(run.origin)) blockers.push("SESSION_MUTATION");
    return blockers;
  }

  private resumableDispatchIntervention(runId: string): SqlRow | null {
    const run = this.database.getRunSummary(runId);
    const resumeStatus = nullableString(this.database.getRunRow(runId).resume_status);
    if (run.status !== "AWAITING_INTERVENTION" || resumeStatus !== "RUNNING") return null;
    const stop = this.database.db
      .prepare(
        `SELECT * FROM interventions
         WHERE run_id = ? AND resolved_at IS NULL AND (
           (code = 'DISPATCH_STOPPED' AND entity_type IS NULL AND entity_id IS NULL)
           OR (code = 'MAINTENANCE_LEASE_EXPIRED' AND entity_type = 'maintenance_lease' AND entity_id IS NOT NULL)
         )
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(runId) as SqlRow | undefined;
    if (!stop) return null;
    const otherIntervention = this.database.db
      .prepare("SELECT 1 FROM interventions WHERE run_id = ? AND resolved_at IS NULL AND id <> ? LIMIT 1")
      .get(runId, String(stop.id));
    const unknownAttempt = this.database.db
      .prepare("SELECT 1 FROM attempts WHERE run_id = ? AND status = 'UNKNOWN' LIMIT 1")
      .get(runId);
    const unknownDelivery = this.database.db
      .prepare("SELECT 1 FROM deliveries WHERE run_id = ? AND status = 'UNKNOWN' LIMIT 1")
      .get(runId);
    return otherIntervention
      || unknownAttempt
      || unknownDelivery
      || this.findUnresolvedSessionMutation(run.origin)
      || this.pendingPartialDecision(runId)
      ? null
      : stop;
  }

  private updateRunAfterAttemptRecovery(
    attempt: AttemptRow,
    cancellationWins: boolean,
  ): ReturnType<CollaborationDatabase["getRunSummary"]> {
    const runId = String(attempt.run_id);
    const run = this.database.getRunSummary(runId);
    const blockers = this.recoveryBlockers(runId);
    if (blockers.length > 0) {
      const updated = this.database.updateRun(runId, run.revision, {
        dispatchState: run.status === "RUNNING" ? "STOPPED" : run.dispatchState,
        reconcileState: "ATTENTION_REQUIRED",
      });
      this.database.appendEvent(runId, "ATTEMPT_RECOVERY_BLOCKED", "attempt", String(attempt.id), updated.revision, {
        blockers,
      });
      return updated;
    }
    if (!cancellationWins && run.status === "AWAITING_INTERVENTION") {
      const resumeStatus = this.attemptResumeStatus(attempt);
      return this.transitionRun(runId, run.revision, resumeStatus, {
        dispatchState: resumeStatus === "RUNNING" ? "OPEN" : run.dispatchState,
        resumeStatus: null,
        reconcileState: "IDLE",
      }, "ATTEMPT_RECOVERY_RESUMED", { attemptId: String(attempt.id) });
    }
    return this.database.updateRun(runId, run.revision, { reconcileState: "IDLE" });
  }

  private recordDispatchOutcomeUnknown(command: CommandRecord, attemptId: string, message: string): void {
    this.commitDispatchOutcomeUnknown(command, attemptId, message, "claimed");
  }

  private applyDispatchOutcomeUnknown(
    attempt: AttemptRow,
    message: string,
    commandId: string | null,
  ): boolean {
    if (!["DISPATCHING", "CANCELLING"].includes(String(attempt.status))) return false;
    const attemptId = String(attempt.id);
    const runId = String(attempt.run_id);
    const diagnostic = boundedDiagnostic(message);
    const changed = this.database.db
      .prepare(
        `UPDATE attempts SET status = 'UNKNOWN', last_error = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = ? AND revision = ?`,
      )
      .run(diagnostic, nowMs(), attemptId, String(attempt.status), numberValue(attempt.revision));
    if (Number(changed.changes) !== 1) return false;
    const run = this.database.getRunSummary(runId);
    if (attempt.work_item_id) {
      const workItem = this.getWorkItem(String(attempt.work_item_id));
      this.database.db
        .prepare(
          `UPDATE work_items SET status = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED')`,
        )
        .run(
          run.status === "CANCELLING" || workItem.status === "CANCELLING" ? "CANCELLING" : "NEEDS_INTERVENTION",
          nowMs(),
          attempt.work_item_id,
        );
    }
    const shouldAwaitIntervention = !TERMINAL_RUN_STATUSES.includes(run.status)
      && run.status !== "CANCELLING"
      && run.status !== "AWAITING_INTERVENTION";
    const updated = shouldAwaitIntervention
      ? this.transitionRun(runId, run.revision, "AWAITING_INTERVENTION", {
          dispatchState: "STOPPED",
          resumeStatus: run.status,
          reconcileState: "ATTENTION_REQUIRED",
        }, "RUN_ATTENTION_REQUIRED", { reason: "DISPATCH_OUTCOME_UNKNOWN", attemptId })
      : this.database.updateRun(runId, run.revision, {
          dispatchState: run.status === "RUNNING" ? "STOPPED" : run.dispatchState,
          reconcileState: "ATTENTION_REQUIRED",
        });
    const commandDetails = commandId ? { commandId } : {};
    this.database.appendEvent(runId, "DISPATCH_OUTCOME_UNKNOWN", "attempt", attemptId, updated.revision, {
      ...commandDetails,
      idempotencyKey: String(attempt.idempotency_key),
      message: diagnostic,
    });
    this.insertIntervention(
      runId,
      "DISPATCH_OUTCOME_UNKNOWN",
      "attempt",
      attemptId,
      "Reconcile the same idempotent dispatch; do not create a replacement attempt",
      { ...commandDetails, message: diagnostic },
      run.status,
    );
    return true;
  }

  private commitDispatchOutcomeUnknownWithoutCommand(
    attemptId: string,
    message: string,
    commandId: string | null = null,
  ): boolean {
    let committed = false;
    this.database.transaction(() => {
      committed = this.applyDispatchOutcomeUnknown(this.getAttempt(attemptId), message, commandId);
    });
    return committed;
  }

  private commitDispatchOutcomeUnknown(
    command: CommandRecord,
    attemptId: string,
    message: string,
    ownership: "claimed" | "orphaned",
    referenceTime = nowMs(),
  ): boolean {
    let committed = false;
    this.database.transaction(() => {
      const attempt = this.getAttempt(attemptId);
      if (!["DISPATCHING", "CANCELLING"].includes(String(attempt.status))) return;
      if (String(attempt.run_id) !== command.runId) return;
      const commandSettled = ownership === "claimed"
        ? this.database.settleClaimedCommand(command, "UNKNOWN", { error: message })
        : command.status === "SUCCEEDED"
          || this.database.settleOrphanedCommandUnknown(command, message, referenceTime);
      if (!commandSettled) return;
      committed = this.applyDispatchOutcomeUnknown(attempt, message, command.id);
    });
    return committed;
  }

  private recoverOrphanedDispatchingAttempt(attempt: AttemptRow): boolean {
    const commandKind = attempt.kind === "PLANNER" ? "PLAN" : attempt.kind === "SYNTHESIZER" ? "SYNTHESIZE" : "DISPATCH";
    const row = this.database.db
      .prepare(
        `SELECT id FROM commands
         WHERE entity_id = ? AND kind = ? AND effect_key = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(String(attempt.id), commandKind, String(attempt.idempotency_key)) as SqlRow | undefined;
    if (!row) {
      return this.commitDispatchOutcomeUnknownWithoutCommand(
        String(attempt.id),
        "The dispatch command is missing after Gateway restart; the external outcome cannot be inferred",
      );
    }
    const command = this.database.getCommand(String(row.id));
    if (command.status === "LEASED" && command.leaseOwner === this.workerId) return false;
    const recoveryTime = nowMs();
    if (command.status === "LEASED" && (command.leaseExpiresAt ?? Number.POSITIVE_INFINITY) >= recoveryTime) return false;
    if (command.status === "CANCELLED") {
      return this.commitDispatchOutcomeUnknownWithoutCommand(
        String(attempt.id),
        "The dispatch command was cancelled after execution entered an uncertain state",
        command.id,
      );
    }
    return this.commitDispatchOutcomeUnknown(
      command,
      String(attempt.id),
      "Gateway restart interrupted dispatch before its OpenClaw run identity was persisted",
      "orphaned",
      recoveryTime,
    );
  }

  private async executeProvision(command: CommandRecord): Promise<boolean> {
    this.reconcileExpiredSessionMutations();
    const preflight = this.database.transaction<"CREATE_OR_RECOVER" | "OBSERVE_ONLY" | "DEFERRED">(() => {
      assertCondition(
        this.database.renewClaimedCommandLease(command, 5 * 60_000),
        "REVISION_CONFLICT",
        "Provision command lease changed before Managed Flow creation",
      );
      const run = this.database.getRunSummary(command.runId);
      const mutation = this.findUnresolvedSessionMutation(run.origin);
      const decision = decideProvisionExecution({
        runStatus: run.status,
        infrastructureFenced: mutation != null || this.maintenanceActive(),
      });
      assertCondition(decision.kind !== "INVALID_STATE", "INVALID_TRANSITION", "Run is not provisioning or closing");
      if (decision.kind === "DEFER") {
        assertCondition(
          this.deferClaimedCommandForInfrastructure(
            command,
            mutation
              ? `Session mutation fence ${mutation.id} deferred Managed Flow provisioning`
              : "Maintenance deferred Managed Flow provisioning",
          ),
          "REVISION_CONFLICT",
          "Provision command lease changed before infrastructure deferral",
        );
        return "DEFERRED";
      }
      return decision.kind;
    });
    if (preflight === "DEFERRED") return true;

    let run = this.database.getRunSummary(command.runId);
    let row = this.database.getRunRow(command.runId);
    let storedFlowId = nullableString(row.openclaw_flow_id);
    const controllerId = `junqi-collab/${run.id}`;
    const payloadDomainRevision = command.payload.flowDomainRevision == null
      ? null
      : readInteger(command.payload.flowDomainRevision, "command.payload.flowDomainRevision");
    const lookup = await this.awaitRuntime(
      "findManagedFlowByController",
      `find managed flow for run ${run.id}`,
      () => this.runtime.findManagedFlowByController({
        sessionKey: run.origin.sessionKey,
        controllerId,
      }),
    );
    assertCondition(
      lookup.kind !== "AMBIGUOUS",
      "INVALID_RESPONSE",
      "Multiple managed Flows use the same JunQi controller identity",
      { controllerId, matchCount: lookup.kind === "AMBIGUOUS" ? lookup.matchCount : 0 },
    );
    if (lookup.kind === "ABSENT" && storedFlowId) {
      throw new CollaborationError(
        "INVALID_RESPONSE",
        "The persisted Managed Flow is no longer present in the owner registry",
        { controllerId, flowId: storedFlowId },
      );
    }

    let observedFlow = lookup.kind === "FOUND" ? lookup.flow : null;
    if (!observedFlow && preflight === "OBSERVE_ONLY") {
      const terminalSettlement = this.database.transaction<"CANCELLED" | "DEFERRED">(() => {
        assertCondition(
          this.database.renewClaimedCommandLease(command, 5 * 60_000),
          "REVISION_CONFLICT",
          "Provision command lease changed before terminal observation settlement",
        );
        const currentRun = this.database.getRunSummary(command.runId);
        const mutation = this.findUnresolvedSessionMutation(currentRun.origin);
        const decision = decideProvisionExecution({
          runStatus: currentRun.status,
          infrastructureFenced: mutation != null || this.maintenanceActive(),
        });
        assertCondition(decision.kind !== "INVALID_STATE", "INVALID_TRANSITION", "Run left the provisioning close path");
        if (decision.kind === "DEFER") {
          assertCondition(
            this.deferClaimedCommandForInfrastructure(
              command,
              mutation
                ? `Session mutation fence ${mutation.id} deferred terminal Flow observation`
                : "Maintenance deferred terminal Flow observation",
            ),
            "REVISION_CONFLICT",
            "Provision command lease changed before terminal observation deferral",
          );
          return "DEFERRED";
        }
        assertCondition(decision.kind === "OBSERVE_ONLY", "REVISION_CONFLICT", "Run reopened during terminal Flow observation");
        assertCondition(
          this.database.settleClaimedCommand(command, "CANCELLED", {
            error: "Run closed before any matching Managed Flow was created",
          }),
          "REVISION_CONFLICT",
          "Provision command lease changed before terminal no-op settlement",
        );
        return "CANCELLED";
      });
      void terminalSettlement;
      return true;
    }

    if (!observedFlow) {
      const startGate = this.database.transaction<"CREATE" | "DEFERRED" | "TERMINAL_NOOP">(() => {
        assertCondition(
          this.database.renewClaimedCommandLease(command, 5 * 60_000),
          "REVISION_CONFLICT",
          "Provision command lease changed before Managed Flow effect intent",
        );
        const currentRun = this.database.getRunSummary(command.runId);
        const currentRow = this.database.getRunRow(command.runId);
        assertCondition(
          currentRow.openclaw_flow_id == null,
          "REVISION_CONFLICT",
          "Managed Flow identity appeared after the controller lookup",
        );
        const mutation = this.findUnresolvedSessionMutation(currentRun.origin);
        const decision = decideProvisionExecution({
          runStatus: currentRun.status,
          infrastructureFenced: mutation != null || this.maintenanceActive(),
        });
        assertCondition(decision.kind !== "INVALID_STATE", "INVALID_TRANSITION", "Run left provisioning before Flow creation");
        if (decision.kind === "DEFER") {
          assertCondition(
            this.deferClaimedCommandForInfrastructure(
              command,
              mutation
                ? `Session mutation fence ${mutation.id} deferred Managed Flow creation`
                : "Maintenance deferred Managed Flow creation",
            ),
            "REVISION_CONFLICT",
            "Provision command lease changed before Flow creation deferral",
          );
          return "DEFERRED";
        }
        if (decision.kind === "OBSERVE_ONLY") {
          assertCondition(
            this.database.settleClaimedCommand(command, "CANCELLED", {
              error: "Run closed before Managed Flow creation",
            }),
            "REVISION_CONFLICT",
            "Provision command lease changed before closed-run settlement",
          );
          return "TERMINAL_NOOP";
        }
        assertCondition(
          this.database.markClaimedCommandEffectStarted(command),
          "REVISION_CONFLICT",
          "Provision command lease changed before durable Flow effect intent",
        );
        return "CREATE";
      });
      if (startGate !== "CREATE") return true;
      run = this.database.getRunSummary(command.runId);
      row = this.database.getRunRow(command.runId);
      storedFlowId = nullableString(row.openclaw_flow_id);
      assertCondition(storedFlowId == null, "REVISION_CONFLICT", "Managed Flow identity changed before creation");
      const createDomainRevision = payloadDomainRevision ?? run.revision;
      observedFlow = await this.awaitRuntime(
        "createManagedFlow",
        `create managed flow for run ${run.id}`,
        () => this.runtime.createManagedFlow({
          sessionKey: run.origin.sessionKey,
          controllerId,
          goal: run.goal,
          state: { runId: run.id, domainRevision: createDomainRevision },
        }),
      );
    }
    assertCondition(observedFlow, "INVALID_RESPONSE", "The persisted Managed Flow is no longer observable");
    const requestedDomainRevision = payloadDomainRevision
      ?? readInteger(observedFlow.state?.domainRevision, "managedFlow.state.domainRevision");
    assertCondition(
      requestedDomainRevision <= run.revision,
      "REVISION_CONFLICT",
      "Managed Flow state references a future collaboration revision",
    );
    const flowExpectation = {
      ...(storedFlowId ? { flowId: storedFlowId } : {}),
      controllerId,
      runId: run.id,
      domainRevision: requestedDomainRevision,
    };
    const closureAssessment = preflight === "OBSERVE_ONLY"
      ? assessManagedFlowClosure(observedFlow, {
          ...(storedFlowId ? { flowId: storedFlowId } : {}),
          controllerId,
          runId: run.id,
          runStatus: run.status as ClosingRunStatus,
          provisionRevision: requestedDomainRevision,
          currentRunRevision: run.revision,
        })
      : null;
    if (closureAssessment?.kind === "CONFLICT") {
      if (!this.commitManagedFlowRecoveryConflict(command, closureAssessment)) {
        this.scheduleRunReconciliation(command.runId);
      }
      return true;
    }
    const verifiedFlow = closureAssessment?.kind === "ACCEPTED"
      ? closureAssessment.flow
      : verifyManagedFlowProvisioning(observedFlow, flowExpectation);
    const flowId = verifiedFlow.flowId;
    const flowRevision = verifiedFlow.revision;

    let committed = false;
    this.database.transaction(() => {
      assertCondition(
        this.database.renewClaimedCommandLease(command, 5 * 60_000),
        "REVISION_CONFLICT",
        "Provision command lease changed before Managed Flow confirmation",
      );
      let currentRun = this.database.getRunSummary(command.runId);
      const currentRow = this.database.getRunRow(command.runId);
      const storedFlowId = nullableString(currentRow.openclaw_flow_id);
      assertCondition(
        storedFlowId == null || storedFlowId === flowId,
        "REVISION_CONFLICT",
        "Managed Flow identity changed before provisioning confirmation",
      );
      const mutation = this.findUnresolvedSessionMutation(currentRun.origin);
      if (currentRun.status === "PROVISIONING" && (mutation || this.maintenanceActive())) {
        const updated = this.database.updateRun(currentRun.id, currentRun.revision, {
          openclawFlowId: flowId,
          openclawFlowRevision: flowRevision,
        });
        assertCondition(
          this.deferClaimedCommandForInfrastructure(
            command,
            mutation
              ? `Session mutation fence ${mutation.id} deferred provision confirmation`
              : "Maintenance deferred provision confirmation",
          ),
          "REVISION_CONFLICT",
          "Provision command lease changed before deferred confirmation",
        );
        this.database.appendEvent(
          currentRun.id,
          "RUN_PROVISION_DEFERRED",
          "command",
          command.id,
          updated.revision,
          { flowId, mutationId: mutation?.id ?? null },
        );
        committed = true;
        return;
      }
      if (currentRun.status === "CANCELLING" || TERMINAL_RUN_STATUSES.includes(currentRun.status)) {
        assertCondition(
          this.database.settleClaimedCommand(command, "SUCCEEDED"),
          "REVISION_CONFLICT",
          "Provision command lease changed before terminal Flow recovery",
        );
        const updated = this.database.updateRun(currentRun.id, currentRun.revision, {
          openclawFlowId: flowId,
          openclawFlowRevision: flowRevision,
        });
        if (TERMINAL_RUN_STATUSES.includes(updated.status)) {
          this.enqueueTerminalFlowSync(updated, terminalFlowIntentForRunStatus(updated.status));
        }
        committed = true;
        return;
      }
      assertCondition(currentRun.status === "PROVISIONING", "INVALID_TRANSITION", "Run left provisioning before confirmation");
      assertCondition(
        this.database.settleClaimedCommand(command, "SUCCEEDED"),
        "REVISION_CONFLICT",
        "Provision command lease changed before domain confirmation",
      );
      const timestamp = nowMs();
      const items = this.listWorkItems(command.runId);
      for (const item of items) {
        const dependencies = parseJson<string[]>(item.dependencies_json, []);
        const assigned = nullableString(item.assigned_agent_id)
          ?? parseJson<string[]>(item.candidate_agent_ids_json, [])[0]
          ?? null;
        assertCondition(assigned, "CAPABILITY_CHANGED", `Work item ${String(item.logical_id)} has no assigned agent`);
        this.database.db
          .prepare(
            `UPDATE work_items SET assigned_agent_id = ?, status = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
          )
          .run(assigned, dependencies.length === 0 ? "READY" : "BLOCKED", timestamp, String(item.id));
      }
      currentRun = this.database.getRunSummary(command.runId);
      const updated = this.transitionRun(command.runId, currentRun.revision, "RUNNING", {
        dispatchState: "OPEN",
        resumeStatus: null,
        openclawFlowId: flowId,
        openclawFlowRevision: flowRevision,
      }, "RUN_PROVISIONED", { flowId });
      this.scheduleReadyWork(command.runId);
      this.database.setCommandResponse(command.id, this.acceptedResponse(command.runId, command.id, updated.revision, false));
      committed = true;
    });
    if (!committed) this.scheduleRunReconciliation(command.runId);
    return true;
  }

  private commitManagedFlowRecoveryConflict(
    command: CommandRecord,
    conflict: Extract<ManagedFlowClosureAssessment, { kind: "CONFLICT" }>,
  ): boolean {
    let committed = false;
    this.database.transaction(() => {
      assertCondition(
        this.database.renewClaimedCommandLease(command, 5 * 60_000),
        "REVISION_CONFLICT",
        "Provision command lease changed before Flow recovery conflict settlement",
      );
      const run = this.database.getRunSummary(command.runId);
      assertCondition(
        run.status === "CANCELLING" || TERMINAL_RUN_STATUSES.includes(run.status),
        "INVALID_TRANSITION",
        "Managed Flow recovery conflict requires a closing Run",
      );
      const row = this.database.getRunRow(command.runId);
      const storedFlowId = nullableString(row.openclaw_flow_id);
      assertCondition(
        storedFlowId == null || storedFlowId === conflict.flow.flowId,
        "REVISION_CONFLICT",
        "Managed Flow identity changed before recovery conflict settlement",
      );
      if (!this.database.settleClaimedCommand(command, "FAILED", {
        error: `Managed Flow recovery conflict: ${conflict.reason}`,
      })) return;
      const updated = this.database.updateRun(run.id, run.revision, {
        openclawFlowId: conflict.flow.flowId,
        openclawFlowRevision: conflict.flow.revision,
        reconcileState: "ATTENTION_REQUIRED",
      });
      const details = {
        reason: conflict.reason,
        flowId: conflict.flow.flowId,
        flowRevision: conflict.flow.revision,
        observedFlowStatus: conflict.flow.status,
        expectedFlowStatus: conflict.targetStatus,
      };
      this.database.appendEvent(
        run.id,
        "FLOW_RECOVERY_CONFLICT",
        "command",
        command.id,
        updated.revision,
        details,
      );
      this.insertIntervention(
        run.id,
        "FLOW_RECOVERY_CONFLICT",
        "command",
        command.id,
        "Resolve the conflicting OpenClaw Flow, then reconcile or explicitly abandon it during deletion",
        details,
        run.status,
      );
      committed = true;
    });
    return committed;
  }

  private async executeFlowSync(command: CommandRecord): Promise<boolean> {
    const terminal = readString(command.payload.terminal, "command.payload.terminal");
    assertCondition(
      terminal === "finished" || terminal === "failed" || terminal === "cancelled",
      "INVALID_REQUEST",
      "Flow sync terminal state is invalid",
    );
    const flowId = readString(command.payload.flowId, "command.payload.flowId");
    const expectedFlowRevision = readInteger(
      command.payload.expectedFlowRevision,
      "command.payload.expectedFlowRevision",
    );
    const domainRevision = readInteger(command.payload.domainRevision, "command.payload.domainRevision");
    const domainStatus = readString(command.payload.domainStatus, "command.payload.domainStatus") as RunStatus;
    const run = this.database.getRunSummary(command.runId);
    assertCondition(
      this.database.renewClaimedCommandLease(command, 5 * 60_000),
      "REVISION_CONFLICT",
      "Managed Flow command lease changed before synchronization",
    );
    const expectedRunStatus: RunStatus = terminal === "finished"
      ? "COMPLETED"
      : terminal === "cancelled"
        ? "CANCELLED"
        : "FAILED";
    assertCondition(
      run.status === expectedRunStatus && domainStatus === expectedRunStatus,
      "INVALID_TRANSITION",
      "Flow sync no longer matches the terminal collaboration state",
    );
    const row = this.database.getRunRow(run.id);
    assertCondition(
      row.openclaw_flow_id === flowId,
      "REVISION_CONFLICT",
      "Managed Flow identity changed before terminal synchronization",
    );
    const desiredState = { runId: run.id, domainRevision, status: domainStatus };
    const terminalFlowStatus = terminal === "finished" ? "succeeded" : terminal;
    let observation = await this.awaitRuntime(
      "getManagedFlow",
      `read managed flow for run ${run.id}`,
      () => this.runtime.getManagedFlow({ sessionKey: run.origin.sessionKey, flowId }),
    );
    if (flowObservationMatches(observation, {
      controllerId: `junqi-collab/${run.id}`,
      status: terminalFlowStatus,
      state: desiredState,
    })) {
      this.commitObservedFlowRevision(command, flowId, expectedFlowRevision, observation!.revision);
      return true;
    }
    const cancelRequested = terminal === "cancelled"
      && flowCancellationRequestMatches(observation, {
        controllerId: `junqi-collab/${run.id}`,
        expectedRevision: expectedFlowRevision,
      });
    assertCondition(
      observation == null
        || (observation.controllerId === `junqi-collab/${run.id}`
          && (observation.revision === expectedFlowRevision || cancelRequested)),
      "REVISION_CONFLICT",
      "Managed Flow revision advanced to a different state",
    );
    const result = await this.awaitRuntime(
      "updateManagedFlow",
      `update managed flow for run ${run.id}`,
      () => this.runtime.updateManagedFlow({
        sessionKey: run.origin.sessionKey,
        flowId,
        expectedRevision: expectedFlowRevision,
        state: desiredState,
        terminal,
      }),
    );
    if (result) {
      this.commitObservedFlowRevision(command, flowId, expectedFlowRevision, result.revision);
      return true;
    }
    observation = await this.awaitRuntime(
      "getManagedFlow",
      `reconcile managed flow for run ${run.id}`,
      () => this.runtime.getManagedFlow({ sessionKey: run.origin.sessionKey, flowId }),
    );
    assertCondition(
      flowObservationMatches(observation, {
        controllerId: `junqi-collab/${run.id}`,
        status: terminalFlowStatus,
        state: desiredState,
      }),
      "REVISION_CONFLICT",
      "Managed Flow terminal update was not applied and could not be reconciled",
    );
    this.commitObservedFlowRevision(command, flowId, expectedFlowRevision, observation!.revision);
    return true;
  }

  private commitObservedFlowRevision(
    command: CommandRecord,
    flowId: string,
    expectedRevision: number,
    observedRevision: number,
  ): void {
    const committed = this.commitClaimedCommandResult(command, "SUCCEEDED", {}, () => {
      const row = this.database.getRunRow(command.runId);
      const storedRevision = row.openclaw_flow_revision == null ? null : numberValue(row.openclaw_flow_revision);
      if (storedRevision !== observedRevision) {
        assertCondition(
          storedRevision === expectedRevision,
          "REVISION_CONFLICT",
          "Stored Managed Flow revision changed before confirmation",
        );
        const changed = this.database.db
          .prepare(
            `UPDATE collaboration_runs SET openclaw_flow_revision = ?, updated_at = ?
             WHERE id = ? AND openclaw_flow_id = ? AND openclaw_flow_revision = ?`,
          )
          .run(observedRevision, nowMs(), command.runId, flowId, expectedRevision);
        assertCondition(
          Number(changed.changes) === 1,
          "REVISION_CONFLICT",
          "Managed Flow confirmation lost its revision fence",
        );
      }
      const run = this.database.getRunSummary(command.runId);
      const nextReconcileState = this.recoveryBlockers(run.id).length > 0
        ? "ATTENTION_REQUIRED"
        : "IDLE";
      if (run.reconcileState !== nextReconcileState) {
        const updated = this.database.updateRun(run.id, run.revision, { reconcileState: nextReconcileState });
        this.database.appendEvent(
          run.id,
          "FLOW_MIRROR_RECONCILED",
          "command",
          command.id,
          updated.revision,
          {
            flowId,
            flowRevision: observedRevision,
            attentionPreserved: nextReconcileState === "ATTENTION_REQUIRED",
          },
        );
      }
    });
    if (!committed) this.scheduleRunReconciliation(command.runId);
  }

  private async executeDelivery(command: CommandRecord): Promise<boolean> {
    const deliveryId = readString(command.payload.deliveryId, "command.payload.deliveryId");
    const initialDelivery = this.getDelivery(deliveryId);
    if (initialDelivery.transcript_status === "CONFIRMED") {
      if (!this.database.settleClaimedCommand(command, "SUCCEEDED")) {
        this.scheduleRunReconciliation(command.runId);
      }
      return true;
    }
    const target = parseOrigin(parseJson(initialDelivery.target_json, {}));
    const artifact = this.database.db
      .prepare("SELECT * FROM final_artifacts WHERE id = ?")
      .get(String(initialDelivery.final_artifact_id)) as SqlRow | undefined;
    if (!artifact) throw new CollaborationError("NOT_FOUND", "Final artifact was not found");
    const deliverySpec = normalizeTranscriptDeliverySpec({
      runId: command.runId,
      deliveryId,
      targetRevision: numberValue(initialDelivery.target_revision),
      artifactId: String(artifact.id),
      artifactDigest: String(artifact.digest),
      requirement: String(initialDelivery.requirement),
      target,
    });
    const effectKey = command.effectKey;
    let sendingRevision = -1;
    let reconcilingUncertainAttempt = false;
    const submissionGate = this.database.transaction<"SUBMIT" | "DEFERRED">(() => {
      assertCondition(
        this.database.renewClaimedCommandLease(command, 5 * 60_000),
        "REVISION_CONFLICT",
        "Delivery command lease changed before transcript submission",
      );
      const run = this.database.getRunSummary(command.runId);
      assertCondition(run.status === "DELIVERY_PENDING", "INVALID_TRANSITION", "Run is not waiting for delivery");
      this.assertLatestDelivery(command.runId, deliveryId);
      if (this.maintenanceActive()) {
        assertCondition(
          this.deferClaimedCommandForInfrastructure(command, "Maintenance deferred transcript delivery"),
          "REVISION_CONFLICT",
          "Delivery command lease changed before maintenance deferral",
        );
        return "DEFERRED";
      }
      const delivery = this.getDelivery(deliveryId);
      const existingAttempt = this.database.db
        .prepare("SELECT * FROM delivery_attempts WHERE effect_key = ?")
        .get(effectKey) as SqlRow | undefined;
      if (existingAttempt) {
        assertCondition(
          delivery.status === "SENDING"
            && existingAttempt.status === "SUBMITTING"
            && existingAttempt.delivery_id === deliveryId,
          "INVALID_TRANSITION",
          "Delivery command no longer owns the submitting attempt",
        );
        assertCondition(
          effectKey === buildTranscriptDeliveryEffectKey(deliverySpec, numberValue(existingAttempt.attempt_no)),
          "IDEMPOTENCY_CONFLICT",
          "Submitting transcript effect does not match its immutable delivery specification",
        );
        sendingRevision = numberValue(delivery.revision);
        reconcilingUncertainAttempt = true;
        return "SUBMIT";
      }
      assertCondition(
        ["PREPARED", "RETRY_REQUIRED"].includes(String(delivery.status)),
        "INVALID_TRANSITION",
        "Delivery cannot start from its current state",
      );
      const status = String(delivery.status) as "PREPARED" | "RETRY_REQUIRED";
      const prior = status === "RETRY_REQUIRED"
        ? this.database.db
          .prepare(
            `SELECT attempt_no, effect_key FROM delivery_attempts
             WHERE delivery_id = ? ORDER BY attempt_no DESC LIMIT 1`,
          )
          .get(deliveryId) as SqlRow | undefined
        : undefined;
      assertCondition(
        status !== "RETRY_REQUIRED" || prior,
        "INVALID_TRANSITION",
        "Retryable transcript delivery is missing its prior effect",
      );
      const effect = decideTranscriptDeliveryEffect(
        deliverySpec,
        status === "PREPARED"
          ? { status }
          : {
              status,
              priorAttempt: {
                attemptNo: numberValue(prior!.attempt_no),
                effectKey: String(prior!.effect_key),
              },
            },
      );
      assertCondition(
        effect.effectKey === effectKey,
        "IDEMPOTENCY_CONFLICT",
        "Delivery command effect does not match its immutable transcript delivery specification",
      );
      const attemptNo = effect.attemptNo;
      const timestamp = nowMs();
      this.database.db
        .prepare(
          `INSERT INTO delivery_attempts(id, delivery_id, attempt_no, effect_key, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'SUBMITTING', ?, ?)`,
        )
        .run(newId("delivery_attempt"), deliveryId, attemptNo, effectKey, timestamp, timestamp);
      const claimed = this.database.db
        .prepare(
          `UPDATE deliveries SET status = 'SENDING', revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ? AND status IN ('PREPARED', 'RETRY_REQUIRED', 'UNKNOWN')`,
        )
        .run(timestamp, deliveryId, numberValue(delivery.revision));
      assertCondition(Number(claimed.changes) === 1, "REVISION_CONFLICT", "Delivery changed before submission");
      sendingRevision = numberValue(delivery.revision) + 1;
      return "SUBMIT";
    });
    if (submissionGate === "DEFERRED") return true;
    let result: Awaited<ReturnType<RuntimeAdapter["appendTranscript"]>>;
    try {
      result = await this.awaitRuntime(
        "appendTranscript",
        `append transcript delivery ${deliveryId}`,
        () => this.runtime.appendTranscript({
          origin: target,
          text: String(artifact.content),
          idempotencyKey: effectKey,
        }),
      );
    } catch (error) {
      this.recordDeliveryUnknown(command, deliveryId, effectKey, sendingRevision, error);
      this.rethrowLifecycleStop(error);
      return true;
    }
    if (result.ok) {
      const messageId = assertPersistableText(
        result.messageId,
        "delivery message id",
        PERSISTENCE_LIMITS.externalReferenceBytes,
      );
      let committed = false;
      try {
        committed = this.commitClaimedCommandResult(command, "SUCCEEDED", {}, () => {
          const timestamp = nowMs();
          const attemptChanged = this.database.db
            .prepare(
              `UPDATE delivery_attempts SET status = 'CONFIRMED', receipt_json = ?, last_error = NULL, updated_at = ?
               WHERE effect_key = ? AND status = 'SUBMITTING'`,
            )
            .run(stableStringify({ messageId }), timestamp, effectKey);
          const deliveryChanged = this.database.db
            .prepare(
              `UPDATE deliveries SET status = 'DELIVERED', transcript_status = 'CONFIRMED', message_id = ?,
               revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'SENDING' AND revision = ?`,
            )
            .run(messageId, timestamp, deliveryId, sendingRevision);
          assertCondition(
            Number(attemptChanged.changes) === 1 && Number(deliveryChanged.changes) === 1,
            "REVISION_CONFLICT",
            "Delivery changed before confirmation could be persisted",
          );
          this.resolveInterventions(command.runId, "delivery", deliveryId, "delivered");
          const currentRun = this.database.getRunSummary(command.runId);
          assertCondition(
            currentRun.status === "DELIVERY_PENDING",
            "INVALID_TRANSITION",
            "Run left delivery pending before confirmation",
          );
          const recoveryBlockers = this.recoveryBlockers(command.runId);
          const terminalRun = this.transitionRun(command.runId, currentRun.revision, "COMPLETED", {
            dispatchState: "CLOSED",
            completionOutcome: currentRun.completionOutcome ?? "FULL",
            reconcileState: recoveryBlockers.length > 0 ? "ATTENTION_REQUIRED" : "IDLE",
            endedAt: timestamp,
          }, "DELIVERY_CONFIRMED", { deliveryId, messageId, recoveryBlockers });
          this.enqueueTerminalFlowSync(terminalRun, "finished");
        });
      } catch (error) {
        this.recordDeliveryUnknown(command, deliveryId, effectKey, sendingRevision, error);
        return true;
      }
      if (!committed) this.scheduleRunReconciliation(command.runId);
      return true;
    }
    if (reconcilingUncertainAttempt) {
      this.recordDeliveryUnknown(command, deliveryId, effectKey, sendingRevision, result.reason);
      return true;
    }
    const rebound = result.code === "session-rebound";
    const reason = boundedDiagnostic(result.reason);
    let failureCommitted: boolean;
    try {
      failureCommitted = this.commitClaimedCommandResult(command, "FAILED", { error: reason }, () => {
        const timestamp = nowMs();
        const attemptChanged = this.database.db
          .prepare(
            "UPDATE delivery_attempts SET status = 'FAILED', last_error = ?, updated_at = ? WHERE effect_key = ? AND status = 'SUBMITTING'",
          )
          .run(reason, timestamp, effectKey);
        const deliveryChanged = this.database.db
          .prepare(
            `UPDATE deliveries SET status = 'RETRY_REQUIRED', transcript_status = ?,
             revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'SENDING' AND revision = ?`,
          )
          .run(rebound ? "SESSION_REBOUND" : "FAILED", timestamp, deliveryId, sendingRevision);
        assertCondition(
          Number(attemptChanged.changes) === 1 && Number(deliveryChanged.changes) === 1,
          "REVISION_CONFLICT",
          "Delivery changed before its known failure could be persisted",
        );
        const run = this.database.getRunSummary(command.runId);
        if (run.status !== "DELIVERY_PENDING") return;
        const updated = this.database.updateRun(command.runId, run.revision, {
          reconcileState: "ATTENTION_REQUIRED",
        });
        this.database.appendEvent(
          command.runId,
          rebound ? "SESSION_REBOUND" : "DELIVERY_FAILED",
          "delivery",
          deliveryId,
          updated.revision,
          { reason },
        );
        this.insertIntervention(
          command.runId,
          rebound ? "SESSION_REBOUND" : "DELIVERY_FAILED",
          "delivery",
          deliveryId,
          rebound ? "Retarget, export, or abandon delivery" : "Retry or retarget delivery",
          { reason },
          "DELIVERY_PENDING",
        );
      });
    } catch (error) {
      this.recordDeliveryUnknown(command, deliveryId, effectKey, sendingRevision, error);
      return true;
    }
    if (!failureCommitted) this.scheduleRunReconciliation(command.runId);
    return true;
  }

  private recordDeliveryUnknown(
    command: CommandRecord,
    deliveryId: string,
    effectKey: string,
    sendingRevision: number,
    error: unknown,
  ): boolean {
    let committed = false;
    try {
      committed = this.commitClaimedCommandResult(
        command,
        "UNKNOWN",
        { error: boundedDiagnostic(error) },
        () => {
          const timestamp = nowMs();
          const message = boundedDiagnostic(error);
          const attemptChanged = this.database.db
            .prepare(
              "UPDATE delivery_attempts SET status = 'UNKNOWN', last_error = ?, updated_at = ? WHERE effect_key = ? AND status = 'SUBMITTING'",
            )
            .run(message, timestamp, effectKey);
          const deliveryChanged = this.database.db
            .prepare(
              `UPDATE deliveries SET status = 'UNKNOWN', transcript_status = 'UNKNOWN', revision = revision + 1, updated_at = ?
               WHERE id = ? AND status = 'SENDING' AND revision = ?`,
            )
            .run(timestamp, deliveryId, sendingRevision);
          assertCondition(
            Number(attemptChanged.changes) === 1 && Number(deliveryChanged.changes) === 1,
            "REVISION_CONFLICT",
            "Delivery changed before its uncertain outcome could be persisted",
          );
          const run = this.database.getRunSummary(command.runId);
          if (run.status !== "DELIVERY_PENDING") return;
          const updated = this.database.updateRun(command.runId, run.revision, {
            reconcileState: "ATTENTION_REQUIRED",
          });
          this.database.appendEvent(command.runId, "DELIVERY_UNKNOWN", "delivery", deliveryId, updated.revision, {
            effectKey,
            message,
          });
          this.insertIntervention(
            command.runId,
            "DELIVERY_UNKNOWN",
            "delivery",
            deliveryId,
            "Reconcile the original transcript append with the same idempotency key, retarget, or abandon",
            { effectKey, message },
            "DELIVERY_PENDING",
          );
        },
      );
    } catch (persistError) {
      this.logger.error(
        `failed to persist uncertain delivery ${deliveryId}; leaving its lease for recovery: ${boundedDiagnostic(persistError)}`,
      );
    }
    if (!committed) this.scheduleRunReconciliation(command.runId);
    return committed;
  }

  private async executeCancellation(command: CommandRecord): Promise<boolean> {
    const attemptId = readString(command.payload.attemptId, "command.payload.attemptId");
    const terminalReason = command.payload.terminalReason === "TIMEOUT"
      || this.hasTimeoutCancellationIntent(attemptId)
      ? "TIMEOUT"
      : null;
    const initialAttempt = this.getAttempt(attemptId);
    const runId = String(initialAttempt.run_id);
    const cancellable = this.database.transaction<AttemptRow | null>(() => {
      assertCondition(
        this.database.renewClaimedCommandLease(command, 5 * 60_000),
        "REVISION_CONFLICT",
        "Cancellation command lease changed before Task cancellation",
      );
      const attempt = this.getAttempt(attemptId);
      if (["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED", "ABANDONED"].includes(String(attempt.status))) {
        assertCondition(
          this.commitCancellationCommandResult(command, attemptId, "SUCCEEDED", {}),
          "REVISION_CONFLICT",
          "Cancellation command lease changed before terminal reconciliation",
        );
        return null;
      }
      if (attempt.status === "UNKNOWN" && !attempt.openclaw_run_id) {
        this.insertIntervention(
          runId,
          "DISPATCH_OUTCOME_UNKNOWN",
          "attempt",
          attemptId,
          "Reconcile the same idempotent dispatch before cancellation can finish",
          {},
          "CANCELLING",
        );
        assertCondition(
          this.commitCancellationCommandResult(command, attemptId, "SUCCEEDED", {}),
          "REVISION_CONFLICT",
          "Cancellation command lease changed before uncertain dispatch reconciliation",
        );
        return null;
      }
      const previousStatus = String(attempt.status);
      if (attempt.status !== "CANCELLING") {
        if (attempt.status === "DISPATCHING" && !attempt.openclaw_run_id) {
          const uncertain = this.database.db
            .prepare(
              `UPDATE attempts SET status = 'UNKNOWN', last_error = ?, revision = revision + 1, updated_at = ?
               WHERE id = ? AND status = 'DISPATCHING' AND revision = ?`,
            )
            .run("Dispatch may still be starting while cancellation is pending", nowMs(), attemptId, numberValue(attempt.revision));
          if (Number(uncertain.changes) === 1) {
            this.insertIntervention(
              runId,
              "DISPATCH_OUTCOME_UNKNOWN",
              "attempt",
              attemptId,
              "Reconcile the same idempotent dispatch before cancellation can finish",
              {},
              "CANCELLING",
            );
          }
          assertCondition(
            this.commitCancellationCommandResult(command, attemptId, "SUCCEEDED", {}),
            "REVISION_CONFLICT",
            "Cancellation command lease changed before dispatch uncertainty was committed",
          );
          return null;
        }
        const claimed = this.database.db
          .prepare(
            `UPDATE attempts SET status = 'CANCELLING', revision = revision + 1, updated_at = ?
             WHERE id = ? AND status IN ('CREATED', 'RUNNING', 'UNKNOWN') AND revision = ?`,
          )
          .run(nowMs(), attemptId, numberValue(attempt.revision));
        if (Number(claimed.changes) !== 1) {
          const current = this.getAttempt(attemptId);
          if (["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED", "ABANDONED"].includes(String(current.status))) {
            assertCondition(
              this.commitCancellationCommandResult(command, attemptId, "SUCCEEDED", {}),
              "REVISION_CONFLICT",
              "Cancellation command lease changed before terminal reconciliation",
            );
            return null;
          }
          throw new CollaborationError(
            "REVISION_CONFLICT",
            "Attempt changed before cancellation could acquire it",
            { attemptId, status: current.status, revision: current.revision },
          );
        }
      }
      const claimedAttempt = this.getAttempt(attemptId);
      if (claimedAttempt.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = 'CANCELLING', revision = revision + 1, updated_at = ?
             WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED', 'CANCELLING')`,
          )
          .run(nowMs(), claimedAttempt.work_item_id);
      }
      if (!claimedAttempt.openclaw_run_id) {
        if (previousStatus === "CREATED" && terminalReason !== "TIMEOUT") {
          this.markAttemptCancelled(claimedAttempt);
        } else {
          const reason = terminalReason === "TIMEOUT"
            ? "Timed-out Task cancellation cannot be confirmed without its OpenClaw run identity"
            : "External dispatch identity is not yet known";
          this.database.db
            .prepare(
              `UPDATE attempts SET status = 'UNKNOWN', last_error = ?, revision = revision + 1, updated_at = ?
               WHERE id = ? AND status = 'CANCELLING' AND revision = ?`,
            )
            .run(reason, nowMs(), attemptId, numberValue(claimedAttempt.revision));
          this.insertIntervention(
            runId,
            terminalReason === "TIMEOUT" ? "TIMEOUT_CANCEL_UNCONFIRMED" : "DISPATCH_OUTCOME_UNKNOWN",
            "attempt",
            attemptId,
            terminalReason === "TIMEOUT"
              ? "Reconcile the exact OpenClaw Task before retrying"
              : "Reconcile the same idempotent dispatch before cancellation can finish",
            { reason },
            "CANCELLING",
          );
          if (terminalReason === "TIMEOUT") {
            const run = this.database.getRunSummary(runId);
            if (!TERMINAL_RUN_STATUSES.includes(run.status) && run.status !== "CANCELLING") {
              const updated = this.database.updateRun(run.id, run.revision, {
                status: "AWAITING_INTERVENTION",
                dispatchState: "STOPPED",
                reconcileState: "ATTENTION_REQUIRED",
              });
              this.database.appendEvent(
                run.id,
                "TIMEOUT_CANCEL_UNCONFIRMED",
                "attempt",
                attemptId,
                updated.revision,
                { reason },
              );
            }
          }
        }
        assertCondition(
          this.commitCancellationCommandResult(command, attemptId, "SUCCEEDED", {}),
          "REVISION_CONFLICT",
          "Cancellation command lease changed before local cancellation was committed",
        );
        return null;
      }
      assertCondition(
        this.database.markClaimedCommandEffectStarted(command),
        "REVISION_CONFLICT",
        "Cancellation command lease changed before durable Task cancellation intent",
      );
      return claimedAttempt;
    });
    if (cancellable?.openclaw_run_id) {
      let result: Awaited<ReturnType<RuntimeAdapter["cancelRun"]>>;
      let cancellationRuntimeError: unknown;
      try {
        result = await this.awaitRuntime(
          "cancelRun",
          `cancel agent attempt ${attemptId}`,
          () => this.runtime.cancelRun({
            ownerSessionKey: String(cancellable.worker_owner_session_key),
            childSessionKey: String(cancellable.child_session_key),
            runId: String(cancellable.openclaw_run_id),
            ...(cancellable.openclaw_task_id ? { taskId: String(cancellable.openclaw_task_id) } : {}),
            taskRuntime: attemptTaskRuntime(cancellable),
          }),
        );
      } catch (error) {
        cancellationRuntimeError = error;
        result = { found: false, cancelled: false, reason: boundedDiagnostic(error) };
      }
      let committed = false;
      try {
        committed = this.commitCancellationCommandResult(command, attemptId, "SUCCEEDED", {}, () => {
          const current = this.getAttempt(attemptId);
          if (current.status !== "CANCELLING") return;
          if (result.found && result.cancelled) {
            if (terminalReason === "TIMEOUT") this.markAttemptTimedOutAfterCancellation(current);
            else this.markAttemptCancelled(current);
            return;
          }
          const reason = boundedDiagnostic(result.reason ?? "Task cancellation was not confirmed");
          const changed = this.database.db
            .prepare(
              `UPDATE attempts SET status = 'UNKNOWN', last_error = ?, revision = revision + 1, updated_at = ?
               WHERE id = ? AND status = 'CANCELLING' AND revision = ?`,
            )
            .run(reason, nowMs(), attemptId, numberValue(current.revision));
          assertCondition(
            Number(changed.changes) === 1,
            "REVISION_CONFLICT",
            "Attempt changed before cancellation uncertainty could be committed",
          );
          if (terminalReason === "TIMEOUT") {
            const run = this.database.getRunSummary(runId);
            if (!TERMINAL_RUN_STATUSES.includes(run.status) && run.status !== "CANCELLING") {
              const updated = this.database.updateRun(run.id, run.revision, {
                status: "AWAITING_INTERVENTION",
                dispatchState: "STOPPED",
                reconcileState: "ATTENTION_REQUIRED",
              });
              this.database.appendEvent(
                run.id,
                "TIMEOUT_CANCEL_UNCONFIRMED",
                "attempt",
                attemptId,
                updated.revision,
                { found: result.found, cancelled: result.cancelled, reason },
              );
            }
            this.insertIntervention(
              runId,
              "TIMEOUT_CANCEL_UNCONFIRMED",
              "attempt",
              attemptId,
              "Reconcile or resolve the unknown attempt before retrying",
              { found: result.found, cancelled: result.cancelled, reason },
              this.attemptResumeStatus(current),
            );
          } else {
            this.insertIntervention(
              runId,
              "CANCEL_UNCONFIRMED",
              "attempt",
              attemptId,
              "Reconcile or resolve the unknown attempt",
              { found: result.found, cancelled: result.cancelled, reason },
              "CANCELLING",
            );
          }
        });
      } catch (error) {
        this.logger.error(`failed to persist Task cancellation ${command.id}: ${boundedDiagnostic(error)}`);
      }
      if (!committed) this.scheduleRunReconciliation(runId);
      if (cancellationRuntimeError !== undefined) {
        this.rethrowLifecycleStop(cancellationRuntimeError);
      }
    }
    this.applyPendingPartialIfSettled(runId);
    this.finishCancellationIfSettled(runId);
    return true;
  }

  private executeExport(command: CommandRecord): void {
    const jobId = readString(command.payload.jobId, "command.payload.jobId");
    const expectedRevision = typeof command.payload.runRevision === "number"
      ? readInteger(command.payload.runRevision, "command.payload.runRevision")
      : null;
    const expectedLastEventSequence = typeof command.payload.lastEventSequence === "number"
      ? readInteger(command.payload.lastEventSequence, "command.payload.lastEventSequence")
      : null;
    const artifactName = `${jobId}.json`;
    const artifactPath = this.resolveStoredExportPath(artifactName);
    const temporaryPath = path.join(
      this.dataDir,
      "exports",
      `.${jobId}.${this.workerId}.${command.attempts}.tmp`,
    );
    rmSync(temporaryPath, { force: true });
    this.extendExportCommandLease(command);
    this.cleanupStaleExportTemps(jobId, temporaryPath);

    if (existsSync(artifactPath)) {
      assertCondition(
        statSync(artifactPath).size <= PERSISTENCE_LIMITS.exportBytes,
        "CAPACITY_EXCEEDED",
        "Recovered export exceeds its size contract",
      );
      const existing = readFileSync(artifactPath, "utf8");
      const parsed = parseJsonObject(JSON.parse(existing), "stored export");
      const parsedRun = parseJsonObject(parsed.run, "stored export.run");
      assertCondition(
        parsed.format === "junqi-collaboration-export/v1"
          && parsedRun.id === command.runId
          && (expectedRevision == null || parsedRun.revision === expectedRevision)
          && (expectedLastEventSequence == null || parsed.lastEventSequence === expectedLastEventSequence),
        "INVALID_RESPONSE",
        "Existing export artifact does not match the requested run snapshot",
      );
      this.extendExportCommandLease(command);
      this.fsyncDirectory(path.resolve(this.dataDir, "exports"));
      this.completeExportJob(jobId, artifactName, sha256(existing));
      this.cleanupExportTemps(jobId, temporaryPath, true);
      return;
    }

    const descriptor = openSync(temporaryPath, "wx", 0o600);
    const digest = createHash("sha256");
    let bytesWritten = 0;
    let closed = false;
    const write = (chunk: string): void => {
      const bytes = Buffer.from(chunk, "utf8");
      assertCondition(
        bytesWritten + bytes.byteLength <= PERSISTENCE_LIMITS.exportBytes,
        "CAPACITY_EXCEEDED",
        `collaboration export exceeds the ${PERSISTENCE_LIMITS.exportBytes}-byte limit`,
      );
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
        assertCondition(written > 0, "INVALID_RESPONSE", "Export file write made no progress");
        offset += written;
      }
      digest.update(bytes);
      bytesWritten += bytes.byteLength;
    };
    try {
      this.database.readTransaction(() => {
        this.assertExportPreflight(command.runId);
        const snapshot = this.buildAuditExportSnapshot(command.runId);
        const snapshotRun = parseJsonObject(snapshot.run, "export snapshot.run");
        assertCondition(
          (expectedRevision == null || snapshotRun.revision === expectedRevision)
            && (expectedLastEventSequence == null || snapshot.lastEventSequence === expectedLastEventSequence),
          "REVISION_CONFLICT",
          "Run changed before the requested export snapshot was generated",
        );
        const header = JSON.stringify({
          format: "junqi-collaboration-export/v1",
          exportedAt: nowMs(),
          ...snapshot,
        });
        write(header.slice(0, -1));
        write(',"events":[');
        let afterSequence = 0;
        let first = true;
        while (true) {
          const events = this.database.listEvents(command.runId, afterSequence, 250);
          for (const event of events) {
            if (!first) write(",");
            write(JSON.stringify(event));
            first = false;
          }
          if (events.length < 250) break;
          afterSequence = events.at(-1)!.sequence;
        }
        write("]}");
      });
      fsyncSync(descriptor);
      closeSync(descriptor);
      closed = true;
      this.extendExportCommandLease(command);
      renameSync(temporaryPath, artifactPath);
      this.fsyncDirectory(path.resolve(this.dataDir, "exports"));
      const contentDigest = digest.digest("hex");
      try {
        this.completeExportJob(jobId, artifactName, contentDigest);
        this.cleanupExportTemps(jobId, temporaryPath, true);
      } catch (error) {
        rmSync(artifactPath, { force: true });
        this.fsyncDirectory(path.resolve(this.dataDir, "exports"));
        throw error;
      }
    } catch (error) {
      if (!closed) closeSync(descriptor);
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private cleanupStaleExportTemps(jobId: string, currentPath: string): void {
    this.cleanupExportTemps(jobId, currentPath, false);
  }

  private cleanupExportTemps(jobId: string, currentPath: string, force: boolean): void {
    const exportDirectory = path.resolve(this.dataDir, "exports");
    const prefix = `.${jobId}.`;
    const cutoff = nowMs() - EXPORT_TEMP_STALE_MS;
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = readdirSync(exportDirectory, { withFileTypes: true });
    } catch (error) {
      this.logger.warn(`export temp directory scan failed: ${boundedDiagnostic(error)}`);
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(".tmp")) continue;
      const candidate = path.join(exportDirectory, entry.name);
      if (candidate === currentPath) continue;
      try {
        if (!force && statSync(candidate).mtimeMs > cutoff) continue;
        rmSync(candidate, { force: true });
      } catch (error) {
        this.logger.warn(`stale export temp cleanup ${entry.name} failed: ${boundedDiagnostic(error)}`);
      }
    }
  }

  private cleanupOrphanedExportTemps(): void {
    const exportDirectory = path.resolve(this.dataDir, "exports");
    const cutoff = nowMs() - EXPORT_TEMP_STALE_MS;
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = readdirSync(exportDirectory, { withFileTypes: true });
    } catch (error) {
      this.logger.warn(`orphaned export temp directory scan failed: ${boundedDiagnostic(error)}`);
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/^\..+\.tmp$/.test(entry.name)) continue;
      const candidate = path.join(exportDirectory, entry.name);
      try {
        if (statSync(candidate).mtimeMs > cutoff) continue;
        rmSync(candidate, { force: true });
      } catch (error) {
        this.logger.warn(`orphaned export temp cleanup ${entry.name} failed: ${boundedDiagnostic(error)}`);
      }
    }
  }

  private completeExportJob(jobId: string, artifactName: string, digest: string): void {
    const result = this.database.db
      .prepare(
        "UPDATE export_jobs SET status = 'COMPLETED', artifact_path = ?, digest = ?, last_error = NULL, updated_at = ? WHERE id = ?",
      )
      .run(artifactName, digest, nowMs(), jobId);
    assertCondition(Number(result.changes) === 1, "NOT_FOUND", `Export job ${jobId} was not found`);
  }

  private extendLocalArtifactCommandLease(command: CommandRecord, operation: string): void {
    assertCondition(
      command.leaseOwner === this.workerId
        && this.database.renewClaimedCommandLease(command, LOCAL_ARTIFACT_COMMAND_LEASE_MS),
      "REVISION_CONFLICT",
      `${operation} command lease was lost before the artifact could be committed`,
    );
  }

  private extendExportCommandLease(command: CommandRecord): void {
    this.extendLocalArtifactCommandLease(command, "Export");
  }

  private extendDeleteCommandLease(command: CommandRecord): void {
    this.extendLocalArtifactCommandLease(command, "Delete");
  }

  private executeDelete(command: CommandRecord): void {
    const jobId = readString(command.payload.jobId, "command.payload.jobId");
    const actor = readString(command.payload.actor, "command.payload.actor");
    const digest = readString(command.payload.digest, "command.payload.digest");
    const flowReconciliationAbandonment = command.payload.flowReconciliationAbandonment == null
      ? null
      : parseFlowReconciliationAbandonment(command.payload.flowReconciliationAbandonment);
    const runId = command.runId;
    // The digest is computed outside the write transaction. Extend the lease
    // before that read phase; the transaction below performs a second owner /
    // attempt CAS immediately before the first file rename.
    this.extendDeleteCommandLease(command);
    const result = this.deleteRunWithStagedArtifacts({
      runId,
      actor,
      deletedAt: nowMs(),
      expectedDigest: digest,
      deletionJobId: jobId,
      currentDeleteCommandId: command.id,
      currentDeleteCommand: command,
      flowReconciliationAbandonment,
    });
    assertCondition(result.deleted, "NOT_FOUND", `Collaboration run ${runId} was not found`);
    const cleanup = this.finalizeStagedExportArtifacts(runId, result.staged);
    this.database.transaction(() => {
      this.updateTombstoneCleanup(runId, cleanup, jobId);
      this.database.db
        .prepare("UPDATE deletion_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
        .run(cleanup.complete ? "COMPLETED" : "PARTIAL", cleanup.error, nowMs(), jobId);
    });
  }

  private watchAttempt(attempt: AttemptRow): void {
    const attemptId = String(attempt.id);
    if (this.stopped || attempt.status !== "RUNNING" || !attempt.openclaw_run_id) return;
    void this.lifecycle.runOnce(
      `attempt-watcher:${attemptId}`,
      `attempt watcher ${attemptId}`,
      async () => this.runAttemptWatcher(attemptId),
    );
  }

  private async runAttemptWatcher(attemptId: string): Promise<void> {
    while (!this.stopped) {
      let attempt = this.getAttempt(attemptId);
      if (attempt.status !== "RUNNING" || !attempt.openclaw_run_id) return;
      let task: Awaited<ReturnType<RuntimeAdapter["findAgentTask"]>>;
      try {
        task = await this.awaitRuntime(
          "findAgentTask",
          `find agent task for watcher ${attemptId}`,
          () => this.runtime.findAgentTask({
            ownerSessionKey: String(attempt.worker_owner_session_key),
            childSessionKey: String(attempt.child_session_key),
            ...(attempt.openclaw_task_id ? { expectedTaskId: String(attempt.openclaw_task_id) } : {}),
            expectedRunId: String(attempt.openclaw_run_id),
            taskRuntime: attemptTaskRuntime(attempt),
          }),
        );
      } catch (error) {
        this.rethrowLifecycleStop(error);
        this.recordTaskObservationUnknown(
          attempt,
          "TASK_LOOKUP_FAILED",
          `OpenClaw Task lookup failed while observing the attempt: ${boundedDiagnostic(error)}`,
          {},
        );
        return;
      }
      if (this.stopped) return;
      attempt = this.getAttempt(attemptId);
      if (attempt.status !== "RUNNING" || !attempt.openclaw_run_id) return;
      if (task.kind === "ABSENT") {
        this.recordTaskObservationUnknown(
          attempt,
          "TASK_NOT_OBSERVED",
          "The exact persistent OpenClaw Task is no longer observable",
          {},
        );
        return;
      }
      if (task.kind === "AMBIGUOUS") {
        this.recordTaskObservationUnknown(attempt, "TASK_AMBIGUOUS", task.reason, { matchCount: task.matchCount });
        return;
      }
      if (task.kind === "MISMATCH") {
        this.recordTaskObservationUnknown(attempt, "TASK_IDENTITY_MISMATCH", task.reason, {});
        return;
      }
      if (
        task.runId !== String(attempt.openclaw_run_id)
        || (attempt.openclaw_task_id && task.taskId !== String(attempt.openclaw_task_id))
      ) {
        this.recordTaskObservationUnknown(
          attempt,
          "TASK_IDENTITY_MISMATCH",
          "The persistent OpenClaw Task identity no longer matches the recorded attempt",
          { observedTaskId: task.taskId, observedRunId: task.runId },
        );
        return;
      }
      if (!attempt.openclaw_task_id) {
        const attached = this.database.db
          .prepare(
            `UPDATE attempts SET openclaw_task_id = ?, revision = revision + 1, updated_at = ?
             WHERE id = ? AND status = 'RUNNING' AND openclaw_task_id IS NULL AND revision = ?`,
          )
          .run(task.taskId, nowMs(), attemptId, numberValue(attempt.revision));
        if (Number(attached.changes) !== 1) continue;
        attempt = this.getAttempt(attemptId);
      }
      const decision = decideTaskRecovery(task, false);
      if (decision.kind === "COMPLETE") {
        await this.completeAttempt(attemptId);
        return;
      }
      if (decision.kind === "FAIL") {
        this.failAttempt(attempt, boundedDiagnostic(decision.diagnostic), "FAILED", decision.code);
        return;
      }
      if (decision.kind === "TIME_OUT") {
        this.failAttempt(attempt, boundedDiagnostic(decision.diagnostic), "TIMED_OUT", "AGENT_TASK_TIMED_OUT");
        return;
      }
      if (decision.kind === "UNEXPECTED_CANCEL") {
        this.recordUnexpectedTaskCancellation(attempt);
        return;
      }
      if (decision.kind === "UNKNOWN_LOST") {
        this.recordTaskObservationUnknown(attempt, "AGENT_TASK_LOST", decision.diagnostic, {});
        return;
      }
      const startedAt = attempt.started_at == null ? numberValue(attempt.created_at) : numberValue(attempt.started_at);
      const remaining = startedAt + this.config.attemptTimeoutMs - nowMs();
      if (remaining <= 0) {
        await this.timeoutAttempt(attemptId);
        return;
      }
      try {
        const result = await this.awaitRuntime(
          "waitForRun",
          `wait for agent attempt ${attemptId}`,
          () => this.runtime.waitForRun(
            String(attempt.openclaw_run_id),
            Math.min(WATCH_SLICE_MS, remaining),
          ),
        );
        if (result.status === "error") {
          await this.lifecycle.sleep(250);
        } else {
          await this.lifecycle.sleep(50);
        }
      } catch (error) {
        this.rethrowLifecycleStop(error);
        await this.lifecycle.sleep(250);
      }
    }
  }

  private async completeAttempt(attemptId: string): Promise<void> {
    const beforeRead = this.getAttempt(attemptId);
    if (beforeRead.status !== "RUNNING") return;
    let messages: unknown[];
    try {
      messages = await this.awaitRuntime(
        "getSessionMessages",
        `read agent transcript for attempt ${attemptId}`,
        () => this.runtime.getSessionMessages(String(beforeRead.child_session_key), 100),
      );
    } catch (error) {
      this.rethrowLifecycleStop(error);
      this.recordTaskObservationUnknown(
        this.getAttempt(attemptId),
        "AGENT_RESULT_UNAVAILABLE",
        `The completed OpenClaw Task transcript could not be read: ${boundedDiagnostic(error)}`,
        {},
      );
      return;
    }
    try {
      const attempt = this.getAttempt(attemptId);
      const run = this.database.getRunSummary(String(attempt.run_id));
      if (attempt.status !== "RUNNING" || run.cancelRequestedAt != null || run.status === "CANCELLING") return;
      const text = latestAssistantText(messages);
      if (!text) {
        this.recordTaskObservationUnknown(
          attempt,
          "AGENT_RESULT_UNAVAILABLE",
          "The completed OpenClaw Task has no readable assistant result in its persistent transcript",
          {},
        );
        return;
      }
      if (attempt.kind === "PLANNER") this.completePlannerAttempt(attempt, text);
      else if (attempt.kind === "WORKER") this.completeWorkerAttempt(attempt, text);
      else if (attempt.kind === "SYNTHESIZER") this.completeSynthesizerAttempt(attempt, text);
    } catch (error) {
      this.failAttempt(this.getAttempt(attemptId), boundedDiagnostic(error), "FAILED", "AGENT_RESULT_INVALID");
    } finally {
      const attempt = this.getAttempt(attemptId);
      this.applyPendingPartialIfSettled(String(attempt.run_id));
      this.finishCancellationIfSettled(String(attempt.run_id));
      this.emitChanged(String(attempt.run_id));
    }
  }

  private recordTaskObservationUnknown(
    attempt: AttemptRow,
    code: string,
    diagnostic: string,
    details: Record<string, unknown>,
  ): void {
    const message = boundedDiagnostic(diagnostic);
    this.database.transaction(() => {
      const current = this.getAttempt(String(attempt.id));
      if (!["RUNNING", "CANCELLING", "UNKNOWN"].includes(String(current.status))) return;
      if (current.status === "UNKNOWN" && current.last_error === message) return;
      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET status = 'UNKNOWN', last_error = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = ? AND revision = ?`,
        )
        .run(message, nowMs(), String(current.id), String(current.status), numberValue(current.revision));
      if (Number(changed.changes) !== 1) return;
      const run = this.database.getRunSummary(String(current.run_id));
      if (current.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = ?, revision = revision + 1, updated_at = ?
             WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED')`,
          )
          .run(run.status === "CANCELLING" ? "CANCELLING" : "NEEDS_INTERVENTION", nowMs(), current.work_item_id);
      }
      const shouldAwaitIntervention = !TERMINAL_RUN_STATUSES.includes(run.status)
        && run.status !== "CANCELLING"
        && run.status !== "AWAITING_INTERVENTION";
      const resumeStatus: RunStatus = current.kind === "PLANNER"
        ? "PLANNING"
        : current.kind === "SYNTHESIZER"
          ? "SYNTHESIZING"
          : "RUNNING";
      const updated = shouldAwaitIntervention
        ? this.transitionRun(run.id, run.revision, "AWAITING_INTERVENTION", {
            dispatchState: "STOPPED",
            resumeStatus,
            reconcileState: "ATTENTION_REQUIRED",
          }, "RUN_ATTENTION_REQUIRED", { reason: code, attemptId: String(current.id) })
        : this.database.updateRun(run.id, run.revision, { reconcileState: "ATTENTION_REQUIRED" });
      this.database.appendEvent(run.id, code, "attempt", String(current.id), updated.revision, {
        diagnostic: message,
        ...details,
      });
      this.insertIntervention(
        run.id,
        code,
        "attempt",
        String(current.id),
        "Reconcile the exact OpenClaw Task or confirm a terminal outcome; do not create a replacement attempt",
        { diagnostic: message, ...details },
        resumeStatus,
      );
    });
    this.emitChanged(String(attempt.run_id));
  }

  private recordUnexpectedTaskCancellation(attempt: AttemptRow): void {
    this.database.transaction(() => {
      const current = this.getAttempt(String(attempt.id));
      if (current.status !== "RUNNING" || numberValue(current.revision) !== numberValue(attempt.revision)) return;
      const timestamp = nowMs();
      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET status = 'CANCELLED', last_error = ?, ended_at = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'RUNNING' AND revision = ?`,
        )
        .run(
          "The OpenClaw Task was cancelled outside the active JunQi cancellation path",
          timestamp,
          timestamp,
          String(current.id),
          numberValue(current.revision),
        );
      if (Number(changed.changes) !== 1) return;
      if (current.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = 'NEEDS_INTERVENTION', revision = revision + 1, updated_at = ?
             WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED')`,
          )
          .run(timestamp, current.work_item_id);
      }
      const run = this.database.getRunSummary(String(current.run_id));
      if (TERMINAL_RUN_STATUSES.includes(run.status) || run.status === "CANCELLING") return;
      const resumeStatus: RunStatus = current.kind === "PLANNER"
        ? "PLANNING"
        : current.kind === "SYNTHESIZER"
          ? "SYNTHESIZING"
          : "RUNNING";
      const updated = this.transitionRun(run.id, run.revision, "AWAITING_INTERVENTION", {
        dispatchState: "STOPPED",
        resumeStatus,
        reconcileState: "ATTENTION_REQUIRED",
      }, "AGENT_TASK_CANCELLED", { attemptId: String(current.id) });
      this.insertIntervention(
        run.id,
        "AGENT_TASK_CANCELLED",
        "attempt",
        String(current.id),
        "Retry, revise the plan, accept partial completion, or cancel the run",
        {},
        resumeStatus,
      );
      void updated;
    });
    this.emitChanged(String(attempt.run_id));
  }

  private restoreUnknownAttemptFromTask(
    attempt: AttemptRow,
    task: Extract<AgentTaskLookupResult, { kind: "FOUND" }>,
    cancellationWins: boolean,
  ): AttemptRow | null {
    let restored: AttemptRow | null = null;
    this.database.transaction(() => {
      const current = this.getAttempt(String(attempt.id));
      if (current.status !== "UNKNOWN" || numberValue(current.revision) !== numberValue(attempt.revision)) return;
      const timestamp = nowMs();
      const nextStatus = cancellationWins ? "CANCELLING" : "RUNNING";
      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET status = ?, child_session_key = COALESCE(?, child_session_key), openclaw_task_id = ?, last_error = NULL,
           started_at = COALESCE(started_at, ?), ended_at = NULL, revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'UNKNOWN' AND revision = ?`,
        )
        .run(nextStatus, task.childSessionKey ?? null, task.taskId, timestamp, timestamp, String(current.id), numberValue(current.revision));
      if (Number(changed.changes) !== 1) return;
      if (current.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = ?, revision = revision + 1, updated_at = ?
             WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED')`,
          )
          .run(cancellationWins ? "CANCELLING" : "RUNNING", timestamp, current.work_item_id);
      }
      const runId = String(current.run_id);
      this.resolveInterventions(runId, "attempt", String(current.id), "persistent-task-observed");
      const updated = this.updateRunAfterAttemptRecovery(current, cancellationWins);
      this.database.appendEvent(runId, "ATTEMPT_TASK_STATE_CONFIRMED", "attempt", String(current.id), updated.revision, {
        taskId: task.taskId,
        runId: task.runId,
        ...(task.childSessionKey ? { childSessionKey: task.childSessionKey } : {}),
        taskStatus: task.status,
        cancellationWins,
      });
      restored = this.getAttempt(String(current.id));
    });
    return restored;
  }

  private settleTerminalTaskDuringCancellation(attempt: AttemptRow, status: AgentTaskStatus): void {
    if (!["succeeded", "failed", "timed_out", "cancelled"].includes(status)) return;
    this.database.transaction(() => {
      const current = this.getAttempt(String(attempt.id));
      if (current.status !== "CANCELLING") return;
      if (this.hasTimeoutCancellationIntent(String(current.id))) {
        this.markAttemptTimedOutAfterCancellation(current);
        return;
      }
      const mapped = status === "succeeded"
        ? "SUCCEEDED"
        : status === "failed"
          ? "FAILED"
          : status === "timed_out"
            ? "TIMED_OUT"
            : "CANCELLED";
      const timestamp = nowMs();
      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET status = ?, outcome_json = ?, last_error = ?, ended_at = ?,
           revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'CANCELLING' AND revision = ?`,
        )
        .run(
          mapped,
          status === "succeeded" ? stableStringify({ taskStatus: status, resultIgnoredBecauseCancellation: true }) : null,
          status === "succeeded" ? null : `OpenClaw Task settled as ${status} while cancellation was pending`,
          timestamp,
          timestamp,
          String(current.id),
          numberValue(current.revision),
        );
      if (Number(changed.changes) !== 1) return;
      if (current.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
             WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED')`,
          )
          .run(timestamp, current.work_item_id);
      }
      const run = this.database.getRunSummary(String(current.run_id));
      this.resolveInterventions(
        run.id,
        "attempt",
        String(current.id),
        "task-terminal-during-cancellation",
      );
      const blockers = this.recoveryBlockers(run.id);
      const updated = this.database.updateRun(run.id, run.revision, {
        reconcileState: blockers.length > 0 ? "ATTENTION_REQUIRED" : "IDLE",
      });
      this.database.appendEvent(run.id, "ATTEMPT_SETTLED_DURING_CANCELLATION", "attempt", String(current.id), updated.revision, {
        taskStatus: status,
        attemptStatus: mapped,
        blockers,
      });
    });
    this.finishCancellationIfSettled(String(attempt.run_id));
    this.applyPendingPartialIfSettled(String(attempt.run_id));
    this.emitChanged(String(attempt.run_id));
  }

  private async reconcileKnownTaskAttempt(attempt: AttemptRow): Promise<void> {
    let lookup: TaskLookupObservation;
    try {
      lookup = await this.awaitRuntime(
        "findAgentTask",
        `find agent task during reconciliation ${String(attempt.id)}`,
        () => this.runtime.findAgentTask({
          ownerSessionKey: String(attempt.worker_owner_session_key),
          childSessionKey: String(attempt.child_session_key),
          ...(attempt.openclaw_task_id ? { expectedTaskId: String(attempt.openclaw_task_id) } : {}),
          expectedRunId: String(attempt.openclaw_run_id),
          taskRuntime: attemptTaskRuntime(attempt),
        }),
      );
    } catch (error) {
      this.rethrowLifecycleStop(error);
      lookup = {
        kind: "LOOKUP_FAILED",
        reason: `OpenClaw Task lookup failed during reconciliation: ${boundedDiagnostic(error)}`,
      };
    }
    this.markAttemptReconciled(String(attempt.id));
    const current = this.getAttempt(String(attempt.id));
    if (current.status !== "UNKNOWN" || !current.openclaw_run_id) return;
    const run = this.database.getRunSummary(String(current.run_id));
    const workItem = current.work_item_id ? this.getWorkItem(String(current.work_item_id)) : null;
    const cancellationWins = run.status === "CANCELLING"
      || run.cancelRequestedAt != null
      || (workItem != null && ["CANCELLING", "CANCELLED"].includes(String(workItem.status)))
      || this.hasTimeoutCancellationIntent(String(current.id));
    const cancellationCount = numberValue((this.database.db
      .prepare("SELECT COUNT(*) AS value FROM commands WHERE entity_id = ? AND kind = 'CANCEL_ATTEMPT'")
      .get(String(current.id)) as SqlRow).value);
    const recovery = decideAttemptRecovery({
      attemptStatus: "UNKNOWN",
      ...(current.openclaw_task_id ? { expectedTaskId: String(current.openclaw_task_id) } : {}),
      expectedRunId: String(current.openclaw_run_id),
      cancellationRequested: cancellationWins,
      cancellationAttemptCount: cancellationCount,
      maxCancellationAttempts: MAX_AUTOMATIC_CANCEL_COMMANDS,
      lookup,
    });
    if (recovery.kind === "NOOP") return;
    if (recovery.kind === "KEEP_UNKNOWN") {
      this.recordTaskObservationUnknown(
        current,
        recovery.code,
        recovery.diagnostic,
        recovery.details,
      );
      return;
    }
    const restored = this.restoreUnknownAttemptFromTask(current, recovery.task, cancellationWins);
    if (!restored) return;
    if (recovery.kind === "REQUEST_CANCEL") {
      if (this.ensureAttemptCancellationCommand(restored, `reconcile:${current.id}`)) {
        void this.drainCommands();
      } else {
        this.recordTaskObservationUnknown(
          restored,
          "CANCEL_RETRY_NOT_QUEUED",
          "The exact OpenClaw Task remains active but no new cancellation command could be queued",
          {},
        );
      }
      return;
    }
    if (recovery.kind === "SETTLE") {
      switch (recovery.decision.kind) {
        case "SETTLE_CANCELLATION":
          this.settleTerminalTaskDuringCancellation(restored, recovery.decision.status);
          return;
        case "COMPLETE":
          await this.completeAttempt(String(restored.id));
          return;
        case "FAIL":
          this.failAttempt(restored, recovery.decision.diagnostic, "FAILED", recovery.decision.code);
          return;
        case "TIME_OUT":
          this.failAttempt(restored, recovery.decision.diagnostic, "TIMED_OUT", "AGENT_TASK_TIMED_OUT");
          return;
        case "UNEXPECTED_CANCEL":
          this.recordUnexpectedTaskCancellation(restored);
          return;
      }
    }
    this.watchAttempt(restored);
  }

  private completePlannerAttempt(attempt: AttemptRow, text: string): void {
    try {
      const initialRun = this.database.getRunSummary(String(attempt.run_id));
      const plan = parseAndValidatePlan(text, {
        allowedAgentIds: this.allowedAgentIds(),
        maxWorkItems: this.config.maxWorkItems,
        goal: initialRun.goal,
      });
      this.database.transaction(() => {
        const currentAttempt = this.getAttempt(String(attempt.id));
        const run = this.database.getRunSummary(String(currentAttempt.run_id));
        const completion = this.terminalAttemptCompletionDecision(currentAttempt, run);
        if (currentAttempt.status !== "RUNNING" || completion.kind !== "ACCEPT" || run.cancelRequestedAt != null) return;
        if (!this.markAttemptSucceeded(currentAttempt, { planDigest: sha256(plan) })) return;
        const revisionNo = this.nextPlanRevisionNo(run.id);
        const planId = newId("plan");
        const now = nowMs();
        this.database.db
          .prepare(
            `INSERT INTO plan_revisions(id, run_id, revision_no, plan_json, digest, source_attempt_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(planId, run.id, revisionNo, stableStringify(plan), sha256(plan), attempt.id, now);
        for (const item of plan.workItems) this.insertWorkItem(run.id, planId, item, now);
        const current = this.restoreSuspendedAttemptPhase(currentAttempt, this.database.getRunSummary(run.id), completion);
        const updated = this.transitionRun(run.id, current.revision, "AWAITING_APPROVAL", {
          currentPlanRevisionId: planId,
          dispatchState: "CLOSED",
        }, "PLAN_READY", { planRevisionId: planId, revisionNo, digest: sha256(plan) });
        this.resolveInterventions(run.id, "attempt", String(attempt.id), "plan-ready");
        void updated;
      });
    } catch (error) {
      this.failAttempt(this.getAttempt(String(attempt.id)), boundedDiagnostic(error), "FAILED", "PLAN_INVALID");
    }
  }

  private completeWorkerAttempt(attempt: AttemptRow, text: string): void {
    const observedAttempt = this.getAttempt(String(attempt.id));
    if (observedAttempt.work_item_id) {
      const observedItem = this.getWorkItem(String(observedAttempt.work_item_id));
      if (!this.currentPlanScope.isWorkItemCurrent(
        String(observedAttempt.run_id),
        String(observedItem.id),
        String(observedItem.plan_revision_id),
      )) {
        this.abandonHistoricalAttempt(
          observedAttempt,
          "HISTORICAL_WORKER_COMPLETION_IGNORED",
          "Worker completion belongs to a historical plan revision and was not committed",
        );
        return;
      }
    }
    try {
      const result = parseWorkerResult(text);
      if (result.outcome !== "SUCCEEDED") {
        this.failAttempt(this.getAttempt(String(attempt.id)), result.summary, "FAILED", "WORKER_REPORTED_FAILURE");
        return;
      }
      this.database.transaction(() => {
        const currentAttempt = this.getAttempt(String(attempt.id));
        const run = this.database.getRunSummary(String(currentAttempt.run_id));
        const completion = this.terminalAttemptCompletionDecision(currentAttempt, run);
        if (
          currentAttempt.status !== "RUNNING"
          || completion.kind !== "ACCEPT"
          || run.cancelRequestedAt != null
          || !currentAttempt.work_item_id
        ) return;
        const phaseRestoration = completion.mode === "SUSPENDED"
          ? this.workerPhaseRestorationDecision(run)
          : null;
        const settlementRun = phaseRestoration?.kind === "DEFER"
          ? run
          : this.restoreSuspendedAttemptPhase(currentAttempt, run, completion);
        if (completion.mode === "SUSPENDED" && settlementRun.status === "AWAITING_INTERVENTION") {
          this.database.appendEvent(
            settlementRun.id,
            "SUSPENDED_ATTEMPT_RESULT_ACCEPTED",
            "attempt",
            String(currentAttempt.id),
            settlementRun.revision,
            {
              attemptKind: currentAttempt.kind,
              phaseDeferredUntilExplicitResume: true,
              suspensionFences: phaseRestoration?.kind === "DEFER" ? phaseRestoration.fences : [],
            },
          );
        }
        const item = this.getWorkItem(String(currentAttempt.work_item_id));
        if (!this.currentPlanScope.isWorkItemCurrent(
          settlementRun.id,
          String(item.id),
          String(item.plan_revision_id),
        )) {
          this.abandonHistoricalAttempt(
            currentAttempt,
            "HISTORICAL_WORKER_COMPLETION_IGNORED",
            "Worker completion belongs to a historical plan revision and was not committed",
          );
          return;
        }
        if (item.status !== "RUNNING") return;
        const now = nowMs();
        if (!this.markAttemptSucceeded(currentAttempt, result)) return;
        const workItemChanged = this.database.db
          .prepare("UPDATE work_items SET status = 'SUCCEEDED', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'RUNNING' AND revision = ?")
          .run(now, currentAttempt.work_item_id, numberValue(item.revision));
        assertCondition(Number(workItemChanged.changes) === 1, "REVISION_CONFLICT", "Work item changed before completion");
        for (const evidence of result.evidence) {
          this.database.db
            .prepare(
              `INSERT INTO evidence(id, run_id, work_item_id, attempt_id, type, title, reference,
               verification, warning, digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              newId("evidence"),
              currentAttempt.run_id,
              currentAttempt.work_item_id,
              currentAttempt.id,
              evidence.type,
              evidence.title,
              evidence.reference,
              evidence.verification,
              evidence.warning ?? null,
              sha256(evidence),
              now,
            );
        }
        const updated = this.database.updateRun(settlementRun.id, settlementRun.revision, {});
        this.database.appendEvent(settlementRun.id, "WORK_ITEM_SUCCEEDED", "work_item", String(currentAttempt.work_item_id), updated.revision, {
          attemptId: currentAttempt.id,
          evidenceCount: result.evidence.length,
        });
        this.unlockDependents(settlementRun.id);
        if (this.currentPlanScope.synthesisReadiness(settlementRun.id).ready) {
          const latest = this.database.getRunSummary(settlementRun.id);
          if (latest.status === "RUNNING") {
            this.transitionRun(settlementRun.id, latest.revision, "SYNTHESIZING", { dispatchState: "CLOSED" }, "WORK_GRAPH_SETTLED", {});
            this.enqueueSynthesis(settlementRun.id, `auto:${currentAttempt.id}`);
          }
        } else {
          this.scheduleReadyWork(settlementRun.id);
        }
      });
      this.applyPendingPartialIfSettled(String(attempt.run_id));
    } catch (error) {
      this.failAttempt(this.getAttempt(String(attempt.id)), boundedDiagnostic(error), "FAILED", "WORKER_RESULT_INVALID");
    }
  }

  private abandonHistoricalAttempt(attempt: AttemptRow, eventType: string, diagnostic: string): void {
    const timestamp = nowMs();
    const changed = this.database.db
      .prepare(
        `UPDATE attempts SET status = 'ABANDONED', last_error = ?, ended_at = ?,
         revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'RUNNING' AND revision = ?`,
      )
      .run(diagnostic, timestamp, timestamp, String(attempt.id), numberValue(attempt.revision));
    if (Number(changed.changes) !== 1) return;
    const run = this.database.getRunSummary(String(attempt.run_id));
    this.database.appendEvent(
      run.id,
      eventType,
      "attempt",
      String(attempt.id),
      run.revision,
      { workItemId: attempt.work_item_id, diagnostic },
    );
  }

  private completeSynthesizerAttempt(attempt: AttemptRow, text: string): void {
    const observedAttempt = this.getAttempt(String(attempt.id));
    const observedRun = this.database.getRunSummary(String(observedAttempt.run_id));
    const observedInput = parseJson<Record<string, unknown>>(observedAttempt.input_json, {});
    if (observedInput.planRevisionId !== observedRun.currentPlanRevisionId) {
      this.abandonHistoricalAttempt(
        observedAttempt,
        "HISTORICAL_SYNTHESIS_COMPLETION_IGNORED",
        "Synthesis completion belongs to a historical plan revision and was not committed",
      );
      return;
    }
    const content = text.trim();
    if (!content) {
      this.failAttempt(this.getAttempt(String(attempt.id)), "Synthesizer returned an empty result", "FAILED", "SYNTHESIS_INVALID");
      return;
    }
    try {
      assertPersistableText(content, "final artifact", PERSISTENCE_LIMITS.finalArtifactBytes);
    } catch (error) {
      this.failAttempt(this.getAttempt(String(attempt.id)), boundedDiagnostic(error), "FAILED", "SYNTHESIS_INVALID");
      return;
    }
    this.database.transaction(() => {
      const currentAttempt = this.getAttempt(String(attempt.id));
      const run = this.database.getRunSummary(String(currentAttempt.run_id));
      const completion = this.terminalAttemptCompletionDecision(currentAttempt, run);
      if (currentAttempt.status !== "RUNNING" || completion.kind !== "ACCEPT" || run.cancelRequestedAt != null) return;
      const input = parseJson<Record<string, unknown>>(currentAttempt.input_json, {});
      if (input.planRevisionId !== run.currentPlanRevisionId) {
        this.abandonHistoricalAttempt(
          currentAttempt,
          "HISTORICAL_SYNTHESIS_COMPLETION_IGNORED",
          "Synthesis completion belongs to a historical plan revision and was not committed",
        );
        return;
      }
      if (!this.markAttemptSucceeded(currentAttempt, { contentDigest: sha256(content) })) return;
      const artifactId = newId("artifact");
      const deliveryId = newId("delivery");
      const now = nowMs();
      this.database.db
        .prepare(
          "INSERT INTO final_artifacts(id, run_id, source_attempt_id, content, digest, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(artifactId, run.id, currentAttempt.id, content, sha256(content), now);
      const settlementRun = this.restoreSuspendedAttemptPhase(
        currentAttempt,
        this.database.getRunSummary(run.id),
        completion,
      );
      const finalizing = this.transitionRun(run.id, settlementRun.revision, "FINALIZING", { dispatchState: "CLOSED" }, "FINAL_ARTIFACT_FROZEN", {
        artifactId,
        digest: sha256(content),
      });
      this.database.db
        .prepare(
          `INSERT INTO deliveries(id, run_id, final_artifact_id, target_revision, requirement, status,
           transcript_status, channel_status, target_json, revision, created_at, updated_at)
           VALUES (?, ?, ?, 1, 'TRANSCRIPT', 'PREPARED', 'PENDING', 'NOT_REQUIRED', ?, 1, ?, ?)`,
        )
        .run(deliveryId, run.id, artifactId, stableStringify(run.origin), now, now);
      const pending = this.transitionRun(run.id, finalizing.revision, "DELIVERY_PENDING", {}, "DELIVERY_PREPARED", { deliveryId });
      this.enqueueDelivery(run.id, this.getDelivery(deliveryId), `auto:${currentAttempt.id}`);
      void pending;
    });
  }

  private async timeoutAttempt(attemptId: string): Promise<void> {
    let queued = false;
    this.database.transaction(() => {
      const attempt = this.getAttempt(attemptId);
      const run = this.database.getRunSummary(String(attempt.run_id));
      if (
        attempt.status !== "RUNNING"
        || TERMINAL_RUN_STATUSES.includes(run.status)
        || run.status === "CANCELLING"
        || run.cancelRequestedAt != null
      ) return;
      const timestamp = nowMs();
      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET status = 'CANCELLING', last_error = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'RUNNING' AND revision = ?`,
        )
        .run("Attempt exceeded the configured timeout", timestamp, attemptId, numberValue(attempt.revision));
      if (Number(changed.changes) !== 1) return;
      if (attempt.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = 'CANCELLING', revision = revision + 1, updated_at = ?
             WHERE id = ? AND status = 'RUNNING'`,
          )
          .run(timestamp, attempt.work_item_id);
      }
      const resumeStatus = this.attemptResumeStatus(attempt);
      const updated = this.transitionRun(run.id, run.revision, "AWAITING_INTERVENTION", {
        dispatchState: "STOPPED",
        resumeStatus,
        reconcileState: "RUNNING",
      }, "ATTEMPT_TIMEOUT_CANCEL_REQUESTED", { attemptId });
      this.closeQueuedDispatches(run.id, "A timed-out Attempt stopped this queued dispatch");
      queued = this.enqueueAttemptCancellation(
        this.getAttempt(attemptId),
        `timeout:${attemptId}`,
        false,
        "TIMEOUT",
      ) || this.hasTimeoutCancellationIntent(attemptId);
      assertCondition(queued, "REVISION_CONFLICT", "A durable timeout cancellation command could not be ensured");
      void updated;
    });
    if (queued) this.scheduleCommandDrain();
  }

  private failAttempt(
    attempt: AttemptRow,
    message: string,
    status: "FAILED" | "TIMED_OUT",
    code = "ATTEMPT_FAILED",
  ): boolean {
    const diagnostic = boundedDiagnostic(message);
    let committed = false;
    this.database.transaction(() => {
      const currentAttempt = this.getAttempt(String(attempt.id));
      const run = this.database.getRunSummary(String(currentAttempt.run_id));
      if (
        currentAttempt.status !== attempt.status
        || numberValue(currentAttempt.revision) !== numberValue(attempt.revision)
        || !["CREATED", "RUNNING"].includes(String(currentAttempt.status))
        || TERMINAL_RUN_STATUSES.includes(run.status)
        || run.status === "CANCELLING"
        || run.cancelRequestedAt != null
      ) return;
      const now = nowMs();
      const attemptChanged = this.database.db
        .prepare(
          `UPDATE attempts SET status = ?, last_error = ?, ended_at = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = ? AND revision = ?`,
        )
        .run(
          status,
          diagnostic,
          now,
          now,
          String(currentAttempt.id),
          String(currentAttempt.status),
          numberValue(currentAttempt.revision),
        );
      if (Number(attemptChanged.changes) !== 1) return;
      committed = true;
      if (currentAttempt.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = 'NEEDS_INTERVENTION', revision = revision + 1, updated_at = ?
             WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED', 'CANCELLING')`,
          )
          .run(now, currentAttempt.work_item_id);
      }
      if (!TERMINAL_RUN_STATUSES.includes(run.status)) {
        const resumeStatus: RunStatus = currentAttempt.kind === "PLANNER" ? "PLANNING" : currentAttempt.kind === "SYNTHESIZER" ? "SYNTHESIZING" : "RUNNING";
        const updated = this.database.updateRun(run.id, run.revision, {
          status: "AWAITING_INTERVENTION",
          dispatchState: "STOPPED",
          resumeStatus,
        });
        this.closeQueuedDispatches(run.id, "An Attempt failure stopped this queued dispatch");
        const failedRun = this.database.getRunSummary(updated.id);
        this.database.appendEvent(run.id, "ATTEMPT_FAILED", "attempt", String(currentAttempt.id), failedRun.revision, {
          code,
          message: diagnostic,
          status,
        });
        this.insertIntervention(
          run.id,
          code,
          "attempt",
          String(currentAttempt.id),
          "Retry, reassign, accept partial completion, or cancel",
          { message: diagnostic, status },
          resumeStatus,
        );
      }
    });
    this.emitChanged(String(attempt.run_id));
    this.applyPendingPartialIfSettled(String(attempt.run_id));
    this.finishCancellationIfSettled(String(attempt.run_id));
    return committed;
  }

  private failCommandEntity(command: CommandRecord, message: string): void {
    const diagnostic = boundedDiagnostic(message);
    if (command.kind === "DELETE" && command.entityId) {
      this.database.db
        .prepare("UPDATE deletion_jobs SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?")
        .run(diagnostic, nowMs(), command.entityId);
    }
    if (command.kind === "EXPORT" && command.payload.noop !== true && command.entityId) {
      this.database.db
        .prepare("UPDATE export_jobs SET status = 'FAILED', last_error = ?, updated_at = ? WHERE id = ?")
        .run(diagnostic, nowMs(), command.entityId);
      // Export is a sidecar job; its failure must never transition the orchestration Run.
      return;
    }
    if (command.kind === "DELIVER") {
      // executeDelivery records the exact UNKNOWN/FAILED delivery state and
      // intervention. A generic run transition here would make retry illegal.
      return;
    }
    if (command.entityId && ["PLAN", "DISPATCH", "SYNTHESIZE"].includes(command.kind)) {
      const attempt = this.getAttempt(command.entityId);
      if (attempt.status === "CREATED") {
        this.failAttempt(attempt, diagnostic, "FAILED", "DISPATCH_FAILED");
      }
      return;
    }
    const run = this.database.getRunSummary(command.runId);
    if (TERMINAL_RUN_STATUSES.includes(run.status) && command.kind === "PROVISION") {
      const updated = this.database.updateRun(run.id, run.revision, {
        reconcileState: "ATTENTION_REQUIRED",
      });
      const details = { kind: command.kind, message: diagnostic };
      this.database.appendEvent(
        run.id,
        "FLOW_PROVISION_RECOVERY_FAILED",
        "command",
        command.id,
        updated.revision,
        details,
      );
      this.insertIntervention(
        run.id,
        "FLOW_PROVISION_RECOVERY_FAILED",
        "command",
        command.id,
        "Resolve the OpenClaw Flow identity, then reconcile or explicitly abandon it during deletion",
        details,
        run.status,
      );
      return;
    }
    if (!TERMINAL_RUN_STATUSES.includes(run.status)) {
      const updated = this.database.updateRun(run.id, run.revision, {
        status: "AWAITING_INTERVENTION",
        dispatchState: "STOPPED",
        resumeStatus: run.status,
        reconcileState: "ATTENTION_REQUIRED",
      });
      this.database.appendEvent(run.id, "COMMAND_FAILED", "command", command.id, updated.revision, {
        kind: command.kind,
        message: diagnostic,
      });
      this.insertIntervention(
        run.id,
        "COMMAND_FAILED",
        "command",
        command.id,
        "Retry or reconcile the command",
        { message: diagnostic },
        run.status,
      );
    }
  }

  private async reconcileActiveRuns(): Promise<void> {
    this.reconcileMaintenanceLease();
    this.reconcileExpiredSessionMutations();
    for (const run of this.database.scanActiveRunsById()) {
      if (this.stopped) return;
      await this.lifecycle.runOnce(
        `run-reconciliation:${run.id}`,
        `run reconciliation ${run.id}`,
        async () => this.reconcileOneRun(run.id),
      );
    }
  }

  private async reconcileOneRun(runId: string): Promise<void> {
    try {
      let recoveryActionQueued = false;
      for (let attempt of this.listActiveAttempts(runId)) {
        const cancellationInvariant = this.reconcileCancellationInvariant(attempt);
        attempt = cancellationInvariant.attempt;
        recoveryActionQueued = cancellationInvariant.commandQueued || recoveryActionQueued;
        if (attempt.status === "RUNNING" && attempt.openclaw_run_id) this.watchAttempt(attempt);
        if (attempt.status === "CANCELLING" && attempt.openclaw_run_id) {
          recoveryActionQueued = this.ensureAttemptCancellationCommand(attempt, `reconcile:${attempt.id}`)
            || recoveryActionQueued;
        }
        if (["DISPATCHING", "CANCELLING"].includes(String(attempt.status)) && !attempt.openclaw_run_id) {
          if (this.recoverOrphanedDispatchingAttempt(attempt)) {
            await this.reconcileUnknownDispatchAttempt(this.getAttempt(String(attempt.id)));
          }
        }
        if (attempt.status === "UNKNOWN" && !attempt.openclaw_run_id) {
          await this.reconcileUnknownDispatchAttempt(attempt);
        }
        if (attempt.status === "UNKNOWN" && attempt.openclaw_run_id) {
          await this.reconcileKnownTaskAttempt(attempt);
        }
        if (attempt.status === "CREATED") void this.drainCommands();
      }
      const unknownDelivery = this.database.db
        .prepare(
          `SELECT id FROM deliveries
           WHERE run_id = ? AND status = 'UNKNOWN'
           ORDER BY target_revision DESC LIMIT 1`,
        )
        .get(runId) as SqlRow | undefined;
      if (unknownDelivery) {
        recoveryActionQueued = this.requeueUnknownDeliveryAttempt(runId, String(unknownDelivery.id));
      }
      if (recoveryActionQueued) void this.drainCommands();
      const run = this.database.getRunSummary(runId);
      const sessionMutation = this.findUnresolvedSessionMutation(run.origin);
      const unresolvedAttempt = this.database.db
        .prepare("SELECT 1 FROM attempts WHERE run_id = ? AND status = 'UNKNOWN' LIMIT 1")
        .get(runId);
      const unresolvedDelivery = this.database.db
        .prepare("SELECT 1 FROM deliveries WHERE run_id = ? AND status = 'UNKNOWN' LIMIT 1")
        .get(runId);
      const unresolvedIntervention = this.database.db
        .prepare("SELECT 1 FROM interventions WHERE run_id = ? AND resolved_at IS NULL LIMIT 1")
        .get(runId);
      const recoveryBlocked = Boolean(
        unresolvedAttempt || unresolvedDelivery || unresolvedIntervention || sessionMutation,
      );
      if (
        !recoveryActionQueued
        && recoveryBlocked
        && run.reconcileState !== "ATTENTION_REQUIRED"
      ) {
        const updated = this.database.updateRun(runId, run.revision, { reconcileState: "ATTENTION_REQUIRED" });
        this.database.appendEvent(runId, "RECONCILE_INCOMPLETE", "run", runId, updated.revision, {
          unknownAttempt: Boolean(unresolvedAttempt),
          unknownDelivery: Boolean(unresolvedDelivery),
          openIntervention: Boolean(unresolvedIntervention),
          sessionMutation: Boolean(sessionMutation),
        });
      } else if (
        !recoveryActionQueued
        && !recoveryBlocked
        && run.reconcileState !== "IDLE"
      ) {
        const updated = this.database.updateRun(runId, run.revision, { reconcileState: "IDLE" });
        this.database.appendEvent(runId, "RECONCILE_COMPLETED", "run", runId, updated.revision, {});
      }
      this.finishCancellationIfSettled(runId);
      this.applyPendingPartialIfSettled(runId);
      this.emitChanged(runId);
    } catch (error) {
      this.rethrowLifecycleStop(error);
      const diagnostic = boundedDiagnostic(error);
      this.logger.warn(`reconcile ${runId} failed: ${diagnostic}`);
      const run = this.database.getRunSummary(runId);
      if (!TERMINAL_RUN_STATUSES.includes(run.status)) {
        const updated = this.database.updateRun(runId, run.revision, { reconcileState: "ATTENTION_REQUIRED" });
        this.database.appendEvent(runId, "RECONCILE_FAILED", "run", runId, updated.revision, { error: diagnostic });
      }
    }
  }

  private reconcileCancellationInvariant(
    attempt: AttemptRow,
  ): { attempt: AttemptRow; commandQueued: boolean } {
    let current = attempt;
    let commandQueued = false;
    this.database.transaction(() => {
      current = this.getAttempt(String(attempt.id));
      const run = this.database.getRunSummary(String(current.run_id));
      if (run.status !== "CANCELLING" && run.cancelRequestedAt == null) return;
      if (current.status === "RUNNING") {
        const timestamp = nowMs();
        const changed = this.database.db
          .prepare(
            `UPDATE attempts SET status = 'CANCELLING', revision = revision + 1, updated_at = ?
             WHERE id = ? AND status = 'RUNNING' AND revision = ?`,
          )
          .run(timestamp, current.id, numberValue(current.revision));
        if (Number(changed.changes) !== 1) {
          current = this.getAttempt(String(current.id));
          return;
        }
        if (current.work_item_id) {
          this.database.db
            .prepare(
              `UPDATE work_items SET status = 'CANCELLING', revision = revision + 1, updated_at = ?
               WHERE id = ? AND status = 'RUNNING'`,
            )
            .run(timestamp, current.work_item_id);
        }
        current = this.getAttempt(String(current.id));
      }
      if (current.status === "CANCELLING" && current.openclaw_run_id) {
        commandQueued = this.ensureAttemptCancellationCommand(current, `reconcile:${current.id}`);
      }
    });
    return { attempt: current, commandQueued };
  }

  private async reconcileUnknownDispatchAttempt(attempt: AttemptRow): Promise<boolean> {
    let lookup: Awaited<ReturnType<RuntimeAdapter["findAgentTask"]>>;
    try {
      lookup = await this.awaitRuntime(
        "findAgentTask",
        `find uncertain dispatch task ${String(attempt.id)}`,
        () => this.runtime.findAgentTask({
          ownerSessionKey: String(attempt.worker_owner_session_key),
          childSessionKey: String(attempt.child_session_key),
          expectedIdempotencyKey: String(attempt.idempotency_key),
          taskRuntime: attemptTaskRuntime(attempt),
        }),
      );
    } catch (error) {
      this.rethrowLifecycleStop(error);
      this.markAttemptReconciled(String(attempt.id));
      this.recordUnknownTaskLookup(
        attempt,
        "DISPATCH_TASK_LOOKUP_FAILED",
        `OpenClaw Task lookup failed: ${boundedDiagnostic(error)}`,
        {},
      );
      return false;
    }
    this.markAttemptReconciled(String(attempt.id));
    if (lookup.kind === "ABSENT") {
      this.recordUnknownTaskLookup(
        attempt,
        "DISPATCH_TASK_NOT_OBSERVED",
        "No exact persistent OpenClaw Task is currently observable; automatic redispatch is forbidden",
        {},
      );
      return false;
    }
    if (lookup.kind === "AMBIGUOUS") {
      this.recordUnknownTaskLookup(
        attempt,
        "DISPATCH_TASK_AMBIGUOUS",
        lookup.reason,
        { matchCount: lookup.matchCount },
      );
      return false;
    }
    if (lookup.kind === "MISMATCH") {
      this.recordUnknownTaskLookup(attempt, "DISPATCH_TASK_IDENTITY_MISMATCH", lookup.reason, {});
      return false;
    }
    const commandKind = attempt.kind === "PLANNER" ? "PLAN" : attempt.kind === "SYNTHESIZER" ? "SYNTHESIZE" : "DISPATCH";
    const commandRow = this.database.db
      .prepare(
        `SELECT * FROM commands
         WHERE entity_id = ? AND kind = ? AND effect_key = ?
           AND status IN ('UNKNOWN', 'FAILED', 'SUCCEEDED', 'CANCELLED')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(String(attempt.id), commandKind, String(attempt.idempotency_key)) as SqlRow | undefined;
    if (!commandRow) {
      this.recordUnknownTaskLookup(
        attempt,
        "DISPATCH_COMMAND_MISSING",
        "The exact dispatch command for the recovered OpenClaw Task is missing",
        {},
      );
      return false;
    }
    const externalRunId = assertPersistableText(
      lookup.runId,
      "OpenClaw run id",
      PERSISTENCE_LIMITS.externalReferenceBytes,
    );
    const externalTaskId = assertPersistableText(
      lookup.taskId,
      "OpenClaw task id",
      PERSISTENCE_LIMITS.externalReferenceBytes,
    );
    const capture = this.captureExternalAttemptIdentity({
      runId: String(attempt.run_id),
      command: this.database.getCommand(String(commandRow.id)),
      attemptId: String(attempt.id),
      expectedKind: String(attempt.kind),
      externalRunId,
      externalTaskId,
      externalChildSessionKey: lookup.childSessionKey ?? null,
      recoveredFromTaskLookup: true,
    });
    if (!capture.captured) return this.getAttempt(String(attempt.id)).status !== "UNKNOWN";
    const refreshed = this.getAttempt(String(attempt.id));
    if (capture.cancelAfterCapture) {
      void this.drainCommands();
    } else {
      this.watchAttempt(refreshed);
    }
    return true;
  }

  private recordUnknownTaskLookup(
    attempt: AttemptRow,
    code: string,
    diagnostic: string,
    details: Record<string, unknown>,
  ): void {
    const message = boundedDiagnostic(diagnostic);
    this.database.transaction(() => {
      const current = this.getAttempt(String(attempt.id));
      if (current.status !== "UNKNOWN" || current.openclaw_run_id || current.last_error === message) return;
      const changed = this.database.db
        .prepare(
          `UPDATE attempts SET last_error = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'UNKNOWN' AND openclaw_run_id IS NULL AND revision = ?`,
        )
        .run(message, nowMs(), String(current.id), numberValue(current.revision));
      if (Number(changed.changes) !== 1) return;
      const run = this.database.getRunSummary(String(current.run_id));
      const updated = this.database.updateRun(run.id, run.revision, { reconcileState: "ATTENTION_REQUIRED" });
      this.database.appendEvent(run.id, code, "attempt", String(current.id), updated.revision, {
        diagnostic: message,
        ...details,
      });
      this.insertIntervention(
        run.id,
        code,
        "attempt",
        String(current.id),
        "Inspect the OpenClaw Task and resolve the uncertain Attempt; automatic redispatch is disabled",
        { diagnostic: message, ...details },
        current.kind === "PLANNER" ? "PLANNING" : current.kind === "SYNTHESIZER" ? "SYNTHESIZING" : "RUNNING",
      );
    });
  }

  private markAttemptReconciled(attemptId: string): void {
    const timestamp = nowMs();
    this.database.db
      .prepare(
        `UPDATE attempts SET last_reconciled_at = ?, updated_at = ?
         WHERE id = ? AND status = 'UNKNOWN'`,
      )
      .run(timestamp, timestamp, attemptId);
  }

  private requeueUnknownDeliveryAttempt(runId: string, deliveryId: string): boolean {
    return this.database.transaction(() => this.requeueUnknownDeliveryAttemptInTransaction(runId, deliveryId, false));
  }

  private requeueUnknownDeliveryAttemptInTransaction(
    runId: string,
    deliveryId: string,
    operatorRequested: boolean,
  ): boolean {
    this.assertLatestDelivery(runId, deliveryId);
    const delivery = this.getDelivery(deliveryId);
    if (delivery.status !== "UNKNOWN" || delivery.transcript_status !== "UNKNOWN") return false;
    const row = this.database.db
      .prepare(
        `SELECT da.effect_key, da.attempt_no, c.id AS command_id, c.attempts AS command_attempts
         FROM delivery_attempts da
         JOIN commands c ON c.effect_key = da.effect_key
         WHERE da.delivery_id = ? AND da.status = 'UNKNOWN'
           AND c.kind = 'DELIVER' AND c.entity_id = ? AND c.status IN ('UNKNOWN', 'FAILED')
         ORDER BY da.attempt_no DESC LIMIT 1`,
      )
      .get(deliveryId, deliveryId) as SqlRow | undefined;
    if (!row || (!operatorRequested && numberValue(row.command_attempts) >= 3)) return false;
    const artifact = this.database.db
      .prepare("SELECT id, digest FROM final_artifacts WHERE id = ?")
      .get(String(delivery.final_artifact_id)) as SqlRow | undefined;
    assertCondition(artifact?.id && artifact.digest, "NOT_FOUND", "Delivery final artifact digest was not found");
    const spec = normalizeTranscriptDeliverySpec({
      runId,
      deliveryId,
      targetRevision: numberValue(delivery.target_revision),
      artifactId: String(artifact.id),
      artifactDigest: String(artifact.digest),
      requirement: String(delivery.requirement),
      target: parseOrigin(parseJson(delivery.target_json, {})),
    });
    const reconciliation = decideTranscriptDeliveryEffect(spec, {
      status: "UNKNOWN",
      priorAttempt: {
        attemptNo: numberValue(row.attempt_no),
        effectKey: String(row.effect_key),
      },
    });
    const timestamp = nowMs();
    const effectKey = reconciliation.effectKey;
    const attemptChanged = this.database.db
      .prepare(
        `UPDATE delivery_attempts SET status = 'SUBMITTING', last_error = NULL, updated_at = ?
         WHERE delivery_id = ? AND effect_key = ? AND status = 'UNKNOWN'`,
      )
      .run(timestamp, deliveryId, effectKey);
    const deliveryChanged = this.database.db
      .prepare(
        `UPDATE deliveries SET status = 'SENDING', revision = revision + 1, updated_at = ?
         WHERE id = ? AND run_id = ? AND status = 'UNKNOWN' AND transcript_status = 'UNKNOWN' AND revision = ?`,
      )
      .run(timestamp, deliveryId, runId, numberValue(delivery.revision));
    const commandChanged = this.database.db
      .prepare(
        `UPDATE commands SET status = 'PENDING', available_at = ?, lease_owner = NULL, lease_expires_at = NULL,
         last_error = NULL, updated_at = ?
         WHERE id = ? AND effect_key = ? AND status IN ('UNKNOWN', 'FAILED')
           ${operatorRequested ? "" : "AND attempts < 3"}`,
      )
      .run(timestamp, timestamp, String(row.command_id), effectKey);
    assertCondition(
      Number(attemptChanged.changes) === 1
        && Number(deliveryChanged.changes) === 1
        && Number(commandChanged.changes) === 1,
      "REVISION_CONFLICT",
      "The uncertain Delivery changed before its original effect could be reconciled",
    );
    const run = this.database.getRunSummary(runId);
    assertCondition(run.status === "DELIVERY_PENDING", "INVALID_TRANSITION", "Run is not waiting for delivery");
    const updated = this.database.updateRun(runId, run.revision, { reconcileState: "RUNNING" });
    this.database.appendEvent(runId, "DELIVERY_RECONCILE_RETRY", "delivery", deliveryId, updated.revision, {
      commandId: String(row.command_id),
      attemptNo: numberValue(row.attempt_no),
      effectKey,
    });
    return true;
  }

  private buildAttemptPrompt(attempt: AttemptRow, transientOriginText?: string): string {
    const run = this.database.getRunSummary(String(attempt.run_id));
    const input = parseJson<Record<string, unknown>>(attempt.input_json, {});
    if (attempt.kind === "PLANNER") {
      const prompt = plannerPrompt({
        goal: run.goal,
        originText: transientOriginText ?? run.goal,
        agents: this
          .configuredAgents()
          .filter((agent) => agent.allowed)
          .map(({ id, name, description, runtimeType }) => ({
            id,
            ...(name ? { name } : {}),
            ...(description ? { description } : {}),
            runtimeType,
          })),
        maxWorkItems: this.config.maxWorkItems,
      });
      return typeof input.revisionInstruction === "string"
        ? `${prompt}\n\nREVISION_INSTRUCTION=${input.revisionInstruction}`
        : prompt;
    }
    if (attempt.kind === "WORKER") {
      const item = this.getWorkItem(String(attempt.work_item_id));
      this.currentPlanScope.assertWorkItemCurrent(run.id, item);
      const additionalInputIds = Array.isArray(input.additionalInputIds)
        ? input.additionalInputIds.filter((value): value is string => typeof value === "string")
        : [];
      const additionalInputById = new Map(
        (this.database.db
          .prepare("SELECT id, content FROM work_item_inputs WHERE work_item_id = ? ORDER BY created_at ASC, id ASC")
          .all(String(item.id)) as SqlRow[])
          .map((row) => [String(row.id), String(row.content)]),
      );
      return workerPrompt({
        runId: run.id,
        workItemId: String(item.logical_id),
        goal: run.goal,
        title: String(item.title),
        inputScope: parseJson(item.input_scope_json, []),
        acceptanceCriteria: parseJson(item.acceptance_criteria_json, []),
        upstreamEvidence: this.upstreamEvidence(run.id, item),
        additionalInputs: additionalInputIds
          .map((id) => additionalInputById.get(id))
          .filter((value): value is string => value != null),
      });
    }
    const plan = this.getCurrentPlan(run.id);
    const synthesisPlanRevisionId = readString(input.planRevisionId, "attempt.input.planRevisionId");
    assertCondition(
      synthesisPlanRevisionId === run.currentPlanRevisionId,
      "REVISION_CONFLICT",
      "Synthesis Attempt belongs to a historical plan revision",
    );
    return synthesizerPrompt({
      goal: run.goal,
      evidence: this.currentPlanScope.listSynthesisEvidence(run.id).map(evidenceReportObject),
      finalAnswerContract: plan.synthesis.finalAnswerContract,
      partial: run.completionOutcome === "PARTIAL",
    });
  }

  private scheduleReadyWork(runId: string): void {
    const run = this.database.getRunSummary(runId);
    if (run.status !== "RUNNING" || run.dispatchState !== "OPEN" || this.maintenanceActive()) return;
    if (this.findUnresolvedSessionMutation(run.origin)) return;
    const activeCount = this.currentPlanScope.listActiveWorkerAttempts(runId).length;
    const capacity = Math.max(0, this.config.maxConcurrency - activeCount);
    if (capacity === 0) return;
    const ready = this.currentPlanScope.listReadyWorkItems(runId, capacity);
    for (const item of ready) this.enqueueWorkerAttempt(runId, item, `auto:${newId("dispatch")}`);
  }

  private enqueueWorkerAttempt(runId: string, item: SqlRow, commandSeed: string): void {
    const run = this.database.getRunSummary(runId);
    this.currentPlanScope.assertWorkItemCurrent(runId, item);
    this.assertSessionMutationInactive(run.origin);
    if (this.hasActiveAttempt(String(item.id))) return;
    const agentId = nullableString(item.assigned_agent_id) ?? parseJson<string[]>(item.candidate_agent_ids_json, [])[0];
    assertCondition(agentId && this.allowedAgentIds().has(agentId), "CAPABILITY_CHANGED", "Assigned agent is not available");
    const assignedAgent = this.configuredAgents().find((agent) => agent.id === agentId);
    assertCondition(assignedAgent, "CAPABILITY_CHANGED", "Assigned agent runtime is no longer available");
    const attemptNo = this.nextAttemptNo(runId, String(item.id), "WORKER");
    const attemptId = newId("attempt");
    const effectKey = `collab:${runId}:plan:${String(item.plan_revision_id)}:work:${String(item.logical_id)}:attempt:${attemptNo}`;
    const commandId = `dispatch:${attemptId}:${sha256(commandSeed).slice(0, 12)}`;
    const additionalInputIds = this.pendingWorkItemInputIds(String(item.id));
    this.insertAttempt({
      id: attemptId,
      runId,
      workItemId: String(item.id),
      kind: "WORKER",
      attemptNo,
      effectKey,
      agentId,
      executionRuntime: assignedAgent.runtimeType,
      input: additionalInputIds.length > 0 ? { additionalInputIds } : {},
    });
    this.database.db
      .prepare("UPDATE work_items SET status = 'DISPATCHING', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'READY'")
      .run(nowMs(), String(item.id));
    this.database.insertCommand({
      id: commandId,
      runId,
      kind: "DISPATCH",
      entityId: attemptId,
      payloadHash: sha256({ attemptId }),
      payload: { attemptId },
      effectKey,
    });
  }

  private enqueueSynthesis(runId: string, commandSeed: string): void {
    const scope = this.currentPlanScope.require(runId);
    this.currentPlanScope.assertSynthesisReady(runId);
    const coordinator = this.requireCoordinator();
    const attemptNo = this.nextAttemptNo(runId, null, "SYNTHESIZER");
    const attemptId = newId("attempt");
    const effectKey = `collab:${runId}:plan:${scope.planRevisionId}:synthesis:attempt:${attemptNo}`;
    this.insertAttempt({
      id: attemptId,
      runId,
      kind: "SYNTHESIZER",
      attemptNo,
      effectKey,
      agentId: coordinator.id,
      executionRuntime: coordinator.runtimeType,
      input: { planRevisionId: scope.planRevisionId },
    });
    this.database.insertCommand({
      id: `synthesize:${attemptId}:${sha256(commandSeed).slice(0, 12)}`,
      runId,
      kind: "SYNTHESIZE",
      entityId: attemptId,
      payloadHash: sha256({ attemptId }),
      payload: { attemptId },
      effectKey,
    });
  }

  private enqueueDelivery(runId: string, delivery: SqlRow, commandSeed: string): void {
    const artifact = this.database.db
      .prepare("SELECT id, digest FROM final_artifacts WHERE id = ?")
      .get(String(delivery.final_artifact_id)) as SqlRow | undefined;
    assertCondition(artifact?.id && artifact.digest, "NOT_FOUND", "Delivery final artifact digest was not found");
    const spec = normalizeTranscriptDeliverySpec({
      runId,
      deliveryId: String(delivery.id),
      targetRevision: numberValue(delivery.target_revision),
      artifactId: String(artifact.id),
      artifactDigest: String(artifact.digest),
      requirement: String(delivery.requirement),
      target: parseOrigin(parseJson(delivery.target_json, {})),
    });
    const status = String(delivery.status);
    assertCondition(
      status === "PREPARED" || status === "RETRY_REQUIRED",
      "INVALID_TRANSITION",
      "A new transcript delivery effect requires PREPARED or RETRY_REQUIRED",
    );
    const prior = status === "RETRY_REQUIRED"
      ? this.database.db
        .prepare(
          `SELECT attempt_no, effect_key FROM delivery_attempts
           WHERE delivery_id = ? ORDER BY attempt_no DESC LIMIT 1`,
        )
        .get(String(delivery.id)) as SqlRow | undefined
      : undefined;
    assertCondition(
      status !== "RETRY_REQUIRED" || prior,
      "INVALID_TRANSITION",
      "A retryable transcript delivery is missing its prior effect",
    );
    const effect = decideTranscriptDeliveryEffect(
      spec,
      status === "PREPARED"
        ? { status }
        : {
            status,
            priorAttempt: {
              attemptNo: numberValue(prior!.attempt_no),
              effectKey: String(prior!.effect_key),
            },
          },
    );
    const attemptNo = effect.attemptNo;
    const effectKey = effect.effectKey;
    const commandId = `deliver:${String(delivery.id)}:${attemptNo}:${sha256(commandSeed).slice(0, 12)}`;
    this.database.insertCommand({
      id: commandId,
      runId,
      kind: "DELIVER",
      entityId: String(delivery.id),
      payloadHash: sha256({ deliveryId: delivery.id, attemptNo }),
      payload: { deliveryId: delivery.id },
      effectKey,
    });
  }

  private enqueueTerminalFlowSync(
    run: ReturnType<CollaborationDatabase["getRunSummary"]>,
    terminal: "finished" | "failed" | "cancelled",
  ): void {
    const row = this.database.getRunRow(run.id);
    const flowId = nullableString(row.openclaw_flow_id);
    const expectedFlowRevision = row.openclaw_flow_revision == null
      ? null
      : numberValue(row.openclaw_flow_revision);
    if (!flowId || expectedFlowRevision == null) return;
    const payload = {
      terminal,
      flowId,
      expectedFlowRevision,
      domainRevision: run.revision,
      domainStatus: run.status,
    };
    const effectKey = `collab:${run.id}:flow:${flowId}:terminal:${terminal}:domain:${run.revision}:flow:${expectedFlowRevision}`;
    this.database.insertCommand({
      id: `flow-sync:${run.id}:${run.revision}:${terminal}`,
      runId: run.id,
      kind: "FLOW_SYNC",
      entityId: flowId,
      payloadHash: sha256(payload),
      payload,
      effectKey,
    });
  }

  private enqueueActiveAttemptCancellations(runId: string, commandSeed: string): void {
    for (const attempt of this.listActiveAttempts(runId)) this.enqueueAttemptCancellation(attempt, commandSeed);
  }

  private closeQueuedDispatches(
    runId: string,
    reason: string,
    options: {
      cancelledWorkItemIds?: ReadonlySet<string> | "ALL";
      includeAlreadyCancelledCommands?: boolean;
    } = {},
  ): { safelyCancelled: number; uncertain: number } {
    const commandStatuses = options.includeAlreadyCancelledCommands
      ? "('PENDING', 'LEASED', 'CANCELLED')"
      : "('PENDING', 'LEASED')";
    const rows = this.database.db
      .prepare(
        `SELECT c.id AS command_id, a.id AS attempt_id
         FROM commands c
         JOIN attempts a ON a.id = c.entity_id
         WHERE c.run_id = ? AND c.kind = 'DISPATCH' AND c.status IN ${commandStatuses}
           AND a.status IN ('CREATED', 'DISPATCHING') AND a.openclaw_run_id IS NULL`,
      )
      .all(runId) as Array<SqlRow & { command_id: string; attempt_id: string }>;
    const timestamp = nowMs();
    let safelyCancelled = 0;
    let uncertain = 0;
    for (const row of rows) {
      let outcome: "SAFE" | "UNCERTAIN" | null = null;
      this.database.transaction(() => {
        const command = this.database.getCommand(String(row.command_id));
        const attempt = this.getAttempt(String(row.attempt_id));
        if (attempt.status === "DISPATCHING") {
          const commandReady = command.status === "CANCELLED"
            || this.database.settleOrphanedCommandUnknown(command, reason, timestamp);
          if (commandReady && this.applyDispatchOutcomeUnknown(attempt, reason, command.id)) {
            outcome = "UNCERTAIN";
          }
          return;
        }
        if (attempt.status !== "CREATED") return;
        const commandReady = command.status === "CANCELLED"
          || (command.status === "LEASED"
            ? this.database.settleClaimedCommand(command, "CANCELLED", { error: reason })
            : this.database.settleUnleasedCommandSnapshot(command, "CANCELLED", { error: reason }));
        if (!commandReady) return;
        const attemptChanged = this.database.db
          .prepare(
            `UPDATE attempts SET status = 'CANCELLED', last_error = ?, ended_at = ?,
             revision = revision + 1, updated_at = ?
             WHERE id = ? AND status = 'CREATED' AND revision = ? AND openclaw_run_id IS NULL`,
          )
          .run(reason, timestamp, timestamp, row.attempt_id, numberValue(attempt.revision));
        assertCondition(
          Number(attemptChanged.changes) === 1,
          "REVISION_CONFLICT",
          "Queued Attempt changed before dispatch cancellation could be committed",
        );
        outcome = "SAFE";
        if (attempt.work_item_id) {
          const workItemId = String(attempt.work_item_id);
          const cancelWorkItem = options.cancelledWorkItemIds === "ALL"
            || options.cancelledWorkItemIds?.has(workItemId) === true;
          this.database.db
            .prepare(
              cancelWorkItem
                ? `UPDATE work_items SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
                   WHERE id = ? AND status IN ('READY', 'DISPATCHING', 'CANCELLING')`
                : `UPDATE work_items SET status = 'READY', revision = revision + 1, updated_at = ?
                   WHERE id = ? AND status = 'DISPATCHING'`,
            )
            .run(timestamp, workItemId);
        }
        const run = this.database.getRunSummary(runId);
        this.database.appendEvent(runId, "DISPATCH_CANCELLED_BEFORE_START", "attempt", String(attempt.id), run.revision, {
          workItemId: attempt.work_item_id,
          reason,
        });
      });
      if (outcome === "SAFE") safelyCancelled += 1;
      if (outcome === "UNCERTAIN") uncertain += 1;
    }
    return { safelyCancelled, uncertain };
  }

  private enqueueCancellationsForLogicalIds(runId: string, logicalIds: string[], commandSeed: string): void {
    const attempts = this.currentPlanScope.listActiveAttemptsForLogicalIds(runId, logicalIds) as AttemptRow[];
    for (const attempt of attempts) this.enqueueAttemptCancellation(attempt, commandSeed);
  }

  private ensureAttemptCancellationCommand(attempt: AttemptRow, commandSeed: string): boolean {
    const attemptId = String(attempt.id);
    const actionable = () => Boolean(this.database.db
      .prepare(
        `SELECT 1 FROM commands
         WHERE entity_id = ? AND kind = 'CANCEL_ATTEMPT' AND status IN ('PENDING', 'LEASED')
         LIMIT 1`,
      )
      .get(attemptId));
    if (actionable()) return true;
    const terminalReason = this.hasTimeoutCancellationIntent(attemptId) ? "TIMEOUT" : undefined;
    return this.enqueueAttemptCancellation(attempt, commandSeed, true, terminalReason) || actionable();
  }

  private hasTimeoutCancellationIntent(attemptId: string): boolean {
    return Boolean(this.database.db
      .prepare(
        `SELECT 1 FROM commands
         WHERE entity_id = ? AND kind = 'CANCEL_ATTEMPT'
           AND json_extract(payload_json, '$.terminalReason') = 'TIMEOUT'
         LIMIT 1`,
      )
      .get(attemptId));
  }

  private enqueueAttemptCancellation(
    attempt: AttemptRow,
    commandSeed: string,
    retry = false,
    terminalReason?: "TIMEOUT",
  ): boolean {
    const attemptId = String(attempt.id);
    const retryKey = retry
      ? `${sha256(commandSeed).slice(0, 8)}:${numberValue(attempt.revision)}`
      : sha256(commandSeed).slice(0, 12);
    const intentSuffix = terminalReason === "TIMEOUT" ? ":timeout" : "";
    const effectKey = retry
      ? `collab:${String(attempt.run_id)}:cancel:${attemptId}${intentSuffix}:retry:${retryKey}`
      : `collab:${String(attempt.run_id)}:cancel:${attemptId}${intentSuffix}`;
    const payload = terminalReason === "TIMEOUT"
      ? { attemptId, terminalReason }
      : { attemptId };
    try {
      this.database.insertCommand({
        id: `cancel:${attemptId}${intentSuffix}:${retryKey}`,
        runId: String(attempt.run_id),
        kind: "CANCEL_ATTEMPT",
        entityId: attemptId,
        payloadHash: sha256(payload),
        payload,
        effectKey,
      });
      return true;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("UNIQUE constraint")) throw error;
      return false;
    }
  }

  private unlockDependents(runId: string): void {
    const items = this.listWorkItems(runId);
    const statusByLogicalId = new Map(items.map((item) => [String(item.logical_id), String(item.status)]));
    for (const item of items) {
      if (item.status !== "BLOCKED") continue;
      const dependencies = parseJson<string[]>(item.dependencies_json, []);
      if (dependencies.every((dependency) => statusByLogicalId.get(dependency) === "SUCCEEDED")) {
        this.database.db
          .prepare("UPDATE work_items SET status = 'READY', revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'BLOCKED'")
          .run(nowMs(), String(item.id));
      }
    }
  }

  private applyPendingPartialIfSettled(runId: string): void {
    const decision = this.pendingPartialDecision(runId);
    if (!decision) return;
    const initialRun = this.database.getRunSummary(runId);
    if (initialRun.status === "CANCELLING" || initialRun.status === "CANCELLED" || initialRun.cancelRequestedAt != null) {
      this.supersedePendingPartial(runId, initialRun.revision, "RUN_CANCELLATION");
      return;
    }
    if (initialRun.status !== "AWAITING_INTERVENTION") return;
    try {
      const durablePayload = this.decodePendingPartialPayload(decision);
      this.partialDecisionSpecification.assertDurableDecisionCurrent(
        { decisionId: String(decision.id), planRevisionId: durablePayload.planRevisionId },
        { currentPlanRevisionId: initialRun.currentPlanRevisionId },
      );
      this.assertPendingPartialClosureCurrent(runId, durablePayload);
    } catch (error) {
      if (error instanceof CollaborationError && error.code === "REVISION_CONFLICT") {
        this.supersedePendingPartial(runId, initialRun.revision, "CURRENT_PLAN_CHANGED");
        return;
      }
      if (error instanceof CollaborationError && error.code === "INVALID_RESPONSE") {
        this.quarantinePendingPartialDecision(runId, decision, error);
        return;
      }
      throw error;
    }
    const durablePayload = this.decodePendingPartialPayload(decision);
    const ids = [...durablePayload.closure.waiveIds, ...durablePayload.closure.blockedDescendantIds];
    if (this.partialApplicationDecision(initialRun, ids).kind === "DEFER") return;
    if (!this.currentPlanScope.synthesisReadiness(runId, ids).ready) return;
    this.database.transaction(() => {
      const run = this.database.getRunSummary(runId);
      if (run.status !== "AWAITING_INTERVENTION" || run.cancelRequestedAt != null) return;
      const currentDecision = this.pendingPartialDecision(runId);
      if (!currentDecision || String(currentDecision.id) !== String(decision.id)) return;
      let currentPayload: DurablePartialDecisionPayload;
      try {
        currentPayload = this.decodePendingPartialPayload(currentDecision);
        this.partialDecisionSpecification.assertDurableDecisionCurrent(
          { decisionId: String(currentDecision.id), planRevisionId: currentPayload.planRevisionId },
          { currentPlanRevisionId: run.currentPlanRevisionId },
        );
        this.assertPendingPartialClosureCurrent(runId, currentPayload);
      } catch (error) {
        if (error instanceof CollaborationError && error.code === "REVISION_CONFLICT") {
          this.supersedePendingPartial(runId, run.revision, "CURRENT_PLAN_CHANGED");
          return;
        }
        if (error instanceof CollaborationError && error.code === "INVALID_RESPONSE") {
          this.quarantinePendingPartialDecision(runId, currentDecision, error);
          return;
        }
        throw error;
      }
      const currentIds = [
        ...currentPayload.closure.waiveIds,
        ...currentPayload.closure.blockedDescendantIds,
      ];
      if (this.partialApplicationDecision(run, currentIds).kind === "DEFER") return;
      if (!this.currentPlanScope.synthesisReadiness(runId, currentIds).ready) return;
      const claimed = this.database.db
        .prepare("UPDATE decisions SET decision_type = 'PARTIAL_APPLIED' WHERE id = ? AND decision_type = 'PARTIAL_PENDING'")
        .run(String(currentDecision.id));
      if (Number(claimed.changes) !== 1) return;
      this.currentPlanScope.waiveItemsByLogicalIds(runId, currentIds, nowMs());
      this.resolvePartialClosureInterventions(runId, currentIds, String(currentDecision.id));
      this.currentPlanScope.assertSynthesisReady(runId);
      assertCondition(
        this.recoveryBlockers(runId).length === 0,
        "INVALID_TRANSITION",
        "Partial completion cannot enter synthesis while a recovery blocker remains",
      );
      this.transitionRun(runId, run.revision, "SYNTHESIZING", {
        dispatchState: "CLOSED",
        completionOutcome: "PARTIAL",
        resumeStatus: null,
        reconcileState: "IDLE",
      }, "PARTIAL_APPLIED", { workItemIds: currentIds });
      this.enqueueSynthesis(runId, `partial:${String(currentDecision.id)}`);
    });
  }

  private decodePendingPartialPayload(decision: SqlRow): DurablePartialDecisionPayload {
    let parsed: unknown;
    try {
      parsed = parseJson<unknown>(decision.payload_json, undefined);
    } catch (error) {
      throw new CollaborationError("INVALID_RESPONSE", "Persisted partial decision payload is not valid JSON", {
        decisionId: String(decision.id),
        diagnostic: boundedDiagnostic(error),
      });
    }
    return this.partialDecisionSpecification.decodeDurablePayload(parsed);
  }

  private assertPendingPartialClosureCurrent(
    runId: string,
    payload: DurablePartialDecisionPayload,
  ): void {
    let computed: ReturnType<CollaborationService["partialClosureForRun"]>;
    try {
      computed = this.partialClosureForRun(runId, [...payload.closure.waiveIds]);
    } catch (error) {
      throw new CollaborationError("INVALID_RESPONSE", "Persisted partial decision cannot be evaluated against the current plan", {
        runId,
        diagnostic: boundedDiagnostic(error),
      });
    }
    assertCondition(
      computed.planRevisionId === payload.planRevisionId,
      "INVALID_RESPONSE",
      "Persisted partial decision plan revision does not match its closure",
      { expectedPlanRevisionId: payload.planRevisionId, actualPlanRevisionId: computed.planRevisionId },
    );
    assertCondition(
      sameStringArray(computed.closure.waiveIds, payload.closure.waiveIds)
        && sameStringArray(computed.closure.blockedDescendantIds, payload.closure.blockedDescendantIds),
      "INVALID_RESPONSE",
      "Persisted partial decision closure does not match the current plan DAG",
      {
        expected: payload.closure,
        actual: computed.closure,
      },
    );
  }

  private quarantinePendingPartialDecision(
    runId: string,
    decision: SqlRow,
    error: CollaborationError,
  ): void {
    this.database.transaction(() => {
      const run = this.database.getRunSummary(runId);
      const changed = this.database.db
        .prepare("UPDATE decisions SET decision_type = 'PARTIAL_SUPERSEDED' WHERE id = ? AND decision_type = 'PARTIAL_PENDING'")
        .run(String(decision.id));
      if (Number(changed.changes) !== 1) return;
      const updated = this.database.updateRun(runId, run.revision, {
        reconcileState: "ATTENTION_REQUIRED",
      });
      this.database.appendEvent(runId, "PARTIAL_DECISION_CORRUPT", "decision", String(decision.id), updated.revision, {
        reason: "CORRUPT_DECISION_PAYLOAD",
        diagnostic: boundedDiagnostic(error),
      });
      this.insertIntervention(
        runId,
        "PARTIAL_DECISION_CORRUPT",
        "decision",
        String(decision.id),
        "Recreate the partial decision from a fresh plan snapshot or cancel the Run",
        { reason: "CORRUPT_DECISION_PAYLOAD", diagnostic: boundedDiagnostic(error) },
        "RUNNING",
      );
    });
  }

  private resolvePartialAcceptanceInterventions(
    runId: string,
    commandId: string,
    planRevisionId: string,
  ): void {
    const resolution = stableStringify({
      resolution: "fresh-partial-accepted",
      commandId,
      planRevisionId,
    });
    this.database.db
      .prepare(
        `UPDATE interventions
         SET resolved_at = ?, resolved_by = 'operator', resolution_json = ?
         WHERE run_id = ? AND resolved_at IS NULL
           AND (
             code = 'PARTIAL_DECISION_CORRUPT'
             OR (code = 'DISPATCH_STOPPED' AND entity_type IS NULL AND entity_id IS NULL)
           )`,
      )
      .run(nowMs(), resolution, runId);
  }

  private partialApplicationDecision(
    run: ReturnType<CollaborationDatabase["getRunSummary"]>,
    logicalIds: readonly string[],
  ) {
    return decidePartialApplication({
      maintenanceGateActive: this.maintenanceLeases.inspect().gateActive,
      hasUnresolvedInterventionOutsideClosure: Boolean(
        this.partialApplicationInterventionBlocker(run.id, logicalIds),
      ),
      hasActiveSessionMutation: Boolean(this.findUnresolvedSessionMutation(run.origin)),
    });
  }

  private partialApplicationInterventionBlocker(
    runId: string,
    logicalIds: readonly string[],
  ): SqlRow | undefined {
    assertCondition(logicalIds.length > 0, "INVALID_REQUEST", "Partial closure must not be empty");
    const placeholders = logicalIds.map(() => "?").join(",");
    return this.database.db
      .prepare(
        `SELECT i.id, i.code
         FROM interventions i
         WHERE i.run_id = ? AND i.resolved_at IS NULL
           AND NOT (
             (i.entity_type = 'work_item' AND EXISTS (
               SELECT 1
               FROM collaboration_runs r
               JOIN work_items w
                 ON w.run_id = r.id
                AND w.plan_revision_id = r.current_plan_revision_id
               WHERE r.id = i.run_id AND w.id = i.entity_id
                 AND w.logical_id IN (${placeholders})
             ))
             OR
             (i.entity_type = 'attempt' AND EXISTS (
               SELECT 1
               FROM collaboration_runs r
               JOIN work_items w
                 ON w.run_id = r.id
                AND w.plan_revision_id = r.current_plan_revision_id
               JOIN attempts a ON a.run_id = r.id AND a.work_item_id = w.id
               WHERE r.id = i.run_id AND a.id = i.entity_id
                 AND w.logical_id IN (${placeholders})
             ))
           )
         ORDER BY i.created_at, i.id
         LIMIT 1`,
      )
      .get(runId, ...logicalIds, ...logicalIds) as SqlRow | undefined;
  }

  private resolvePartialClosureInterventions(
    runId: string,
    logicalIds: readonly string[],
    decisionId: string,
  ): void {
    assertCondition(logicalIds.length > 0, "INVALID_REQUEST", "Partial closure must not be empty");
    const placeholders = logicalIds.map(() => "?").join(",");
    const resolution = stableStringify({
      resolution: "partial-waiver-applied",
      decisionId,
      logicalIds: [...logicalIds].sort(),
    });
    this.database.db
      .prepare(
        `UPDATE interventions
         SET resolved_at = ?, resolved_by = 'operator', resolution_json = ?
         WHERE run_id = ? AND resolved_at IS NULL
           AND (
             (entity_type = 'work_item' AND EXISTS (
               SELECT 1
               FROM collaboration_runs r
               JOIN work_items w
                 ON w.run_id = r.id
                AND w.plan_revision_id = r.current_plan_revision_id
               WHERE r.id = interventions.run_id AND w.id = interventions.entity_id
                 AND w.logical_id IN (${placeholders})
             ))
             OR
             (entity_type = 'attempt' AND EXISTS (
               SELECT 1
               FROM collaboration_runs r
               JOIN work_items w
                 ON w.run_id = r.id
                AND w.plan_revision_id = r.current_plan_revision_id
               JOIN attempts a ON a.run_id = r.id AND a.work_item_id = w.id
               WHERE r.id = interventions.run_id AND a.id = interventions.entity_id
                 AND w.logical_id IN (${placeholders})
             ))
           )`,
      )
      .run(nowMs(), resolution, runId, ...logicalIds, ...logicalIds);
  }

  private partialClosureForRun(
    runId: string,
    requestedIds: string[],
  ): {
    planRevisionId: string;
    closure: ReturnType<typeof computePartialClosure>;
  } {
    const scope = this.currentPlanScope.require(runId);
    const workItems = this.listWorkItems(runId);
    const logicalIds = workItems.map((item) => String(item.logical_id));
    const activeLogicalIds = new Set<string>();
    for (const attempt of this.currentPlanScope.listActiveAttemptsForLogicalIds(runId, logicalIds)) {
      if (attempt.work_item_id == null) continue;
      const item = this.getWorkItem(String(attempt.work_item_id));
      activeLogicalIds.add(String(item.logical_id));
    }
    const closure = computePartialClosure(
      workItems.map((item) => ({
        id: String(item.logical_id),
        dependencies: parseJson<string[]>(item.dependencies_json, []),
        status: String(item.status),
        activeAttempt: activeLogicalIds.has(String(item.logical_id)),
      })),
      requestedIds,
    );
    return { planRevisionId: scope.planRevisionId, closure };
  }

  private pendingPartialDecision(runId: string): SqlRow | undefined {
    return this.database.db
      .prepare("SELECT * FROM decisions WHERE run_id = ? AND decision_type = 'PARTIAL_PENDING' ORDER BY created_at DESC LIMIT 1")
      .get(runId) as SqlRow | undefined;
  }

  private supersedePendingPartial(runId: string, runRevision: number, reason: string): void {
    const pending = this.pendingPartialDecision(runId);
    if (!pending) return;
    const changed = this.database.db
      .prepare("UPDATE decisions SET decision_type = 'PARTIAL_SUPERSEDED' WHERE id = ? AND decision_type = 'PARTIAL_PENDING'")
      .run(String(pending.id));
    if (Number(changed.changes) === 1) {
      this.database.appendEvent(runId, "PARTIAL_SUPERSEDED", "decision", String(pending.id), runRevision, { reason });
    }
  }

  private finishCancellationIfSettled(runId: string): void {
    this.database.transaction(() => {
      const run = this.database.getRunSummary(runId);
      if (run.status !== "CANCELLING" || this.listActiveAttempts(runId).length > 0) return;
      this.supersedePendingPartial(runId, run.revision, "RUN_CANCELLED");
      this.resolveCancellationSupersededInterventions(runId);
      const recoveryBlockers = this.recoveryBlockers(runId);
      const residualRisk = Boolean(this.database.db
        .prepare(
          `SELECT 1 FROM interventions
           WHERE run_id = ? AND code = 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK'
             AND resolved_at IS NULL LIMIT 1`,
        )
        .get(runId));
      const updated = this.transitionRun(runId, run.revision, "CANCELLED", {
        endedAt: nowMs(),
        reconcileState: recoveryBlockers.length > 0 ? "ATTENTION_REQUIRED" : "IDLE",
      }, "RUN_CANCELLED", {
        recoveryBlockers,
        ...(residualRisk
          ? {
              acceptedResidualRisk: true,
              terminationSemantics: "LOCAL_ORCHESTRATION_STOPPED_REMOTE_TASK_TERMINATION_UNCONFIRMED",
            }
          : {}),
      });
      this.enqueueTerminalFlowSync(updated, "cancelled");
    });
  }

  private transitionRun(
    runId: string,
    expectedRevision: number,
    to: RunStatus,
    patch: Parameters<CollaborationDatabase["updateRun"]>[2],
    eventType: string,
    payload: Record<string, unknown>,
  ): ReturnType<CollaborationDatabase["getRunSummary"]> {
    const current = this.database.getRunSummary(runId);
    assertCondition(current.revision === expectedRevision, "REVISION_CONFLICT", "Run revision changed", {
      expectedRevision,
      actualRevision: current.revision,
    });
    if (current.status !== to) assertRunTransition(current.status, to);
    this.settlementSpecification.assertTerminalRunQuiescent(
      to,
      this.listActiveAttempts(runId).map((attempt) => String(attempt.id)),
    );
    const updated = this.database.updateRun(runId, expectedRevision, { ...patch, status: to });
    this.database.appendEvent(runId, eventType, "run", runId, updated.revision, payload);
    return updated;
  }

  private simpleRunCommand(
    paramsInput: Record<string, unknown>,
    eventType: string,
    apply: (
      runId: string,
      run: ReturnType<CollaborationDatabase["getRunSummary"]>,
      commandId: string,
      actor: string,
    ) => ReturnType<CollaborationDatabase["getRunSummary"]>,
  ): Record<string, unknown> {
    const params = parseJsonObject(paramsInput, "params");
    const envelope = this.validateWriteEnvelope(params);
    const operation = `RUN:${eventType}`;
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, operation);
    if (replay) return replay;
    const runId = readString(params.runId, "runId");
    const actor = "operator";
    const run = this.requireRunRevision(runId, envelope.expectedRunRevision);
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      const updated = apply(runId, run, envelope.commandId, actor);
      response = this.acceptedResponse(runId, envelope.commandId, updated.revision, false);
      this.database.insertCommand({
        id: envelope.commandId,
        runId,
        kind: "EXPORT",
        receiptSource: operation,
        payloadHash: envelope.payloadHash,
        payload: { noop: true, eventType },
        effectKey: `collab:${runId}:decision:${eventType}:${envelope.commandId}`,
        response,
      });
      assertCondition(
        this.database.settleUnleasedCommand(envelope.commandId, "PENDING", "SUCCEEDED", { response }),
        "REVISION_CONFLICT",
        "Run command receipt changed before it could be committed",
      );
    });
    this.emitChanged(runId);
    void this.drainCommands();
    return response!;
  }

  private workItemCommand(
    params: Record<string, unknown>,
    workItemId: string,
    eventType: string,
    apply: (runId: string, item: SqlRow, envelope: WorkItemWriteEnvelope) => Record<string, unknown>,
  ): Record<string, unknown> {
    const envelope = this.validateWriteEnvelope(params);
    const operation = `WORK_ITEM:${eventType}`;
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, operation);
    if (replay) return replay;
    const item = this.getWorkItem(workItemId);
    const runId = String(item.run_id);
    const run = this.requireRunRevision(runId, envelope.expectedRunRevision);
    this.partialDecisionSpecification.assertMutationAllowed(Boolean(this.pendingPartialDecision(runId)), "WORK_ITEM_MUTATION");
    this.currentPlanScope.assertWorkItemCurrent(runId, item);
    assertCondition(envelope.expectedEntityRevision != null, "INVALID_REQUEST", "expectedEntityRevision is required");
    assertCondition(numberValue(item.revision) === envelope.expectedEntityRevision, "REVISION_CONFLICT", "Work item revision changed", {
      expectedRevision: envelope.expectedEntityRevision,
      actualRevision: numberValue(item.revision),
    });
    const workItemEnvelope = envelope as WorkItemWriteEnvelope;
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      const currentItem = this.getWorkItem(workItemId);
      this.partialDecisionSpecification.assertMutationAllowed(Boolean(this.pendingPartialDecision(runId)), "WORK_ITEM_MUTATION");
      this.currentPlanScope.assertWorkItemCurrent(runId, currentItem);
      assertCondition(
        numberValue(currentItem.revision) === envelope.expectedEntityRevision,
        "REVISION_CONFLICT",
        "Work item revision changed",
        { expectedRevision: envelope.expectedEntityRevision, actualRevision: numberValue(currentItem.revision) },
      );
      const result = apply(runId, currentItem, workItemEnvelope);
      const current = this.database.getRunSummary(runId);
      const updated = current.revision === run.revision ? this.database.updateRun(runId, run.revision, {}) : current;
      this.database.appendEvent(runId, eventType, "work_item", workItemId, updated.revision, result);
      response = this.acceptedResponse(runId, envelope.commandId, updated.revision, false, result);
      this.database.insertCommand({
        id: envelope.commandId,
        runId,
        kind: "EXPORT",
        receiptSource: operation,
        entityId: workItemId,
        payloadHash: envelope.payloadHash,
        payload: { noop: true, eventType },
        effectKey: `collab:${runId}:work:${workItemId}:${eventType}:${envelope.commandId}`,
        response,
      });
      assertCondition(
        this.database.settleUnleasedCommand(envelope.commandId, "PENDING", "SUCCEEDED", { response }),
        "REVISION_CONFLICT",
        "Work item command receipt changed before it could be committed",
      );
    });
    this.emitChanged(runId);
    void this.drainCommands();
    return response!;
  }

  private deliveryCommand(
    params: Record<string, unknown>,
    deliveryId: string,
    eventType: string,
    apply: (runId: string, delivery: SqlRow, envelope: DeliveryWriteEnvelope) => Record<string, unknown>,
  ): Record<string, unknown> {
    const envelope = this.validateWriteEnvelope(params);
    const operation = `DELIVERY:${eventType}`;
    const replay = this.replayedResponse(envelope.commandId, envelope.payloadHash, operation);
    if (replay) return replay;
    const delivery = this.getDelivery(deliveryId);
    const runId = String(delivery.run_id);
    const run = this.requireRunRevision(runId, envelope.expectedRunRevision);
    assertCondition(run.status === "DELIVERY_PENDING", "INVALID_TRANSITION", "Run is not waiting for delivery");
    assertCondition(envelope.expectedEntityRevision != null, "INVALID_REQUEST", "expectedEntityRevision is required");
    assertCondition(
      Number(delivery.revision) === envelope.expectedEntityRevision,
      "REVISION_CONFLICT",
      "Delivery revision changed",
      { expectedRevision: envelope.expectedEntityRevision, actualRevision: Number(delivery.revision) },
    );
    this.assertLatestDelivery(runId, deliveryId);
    const deliveryEnvelope = envelope as DeliveryWriteEnvelope;
    let response: Record<string, unknown>;
    this.database.transaction(() => {
      const currentDelivery = this.getDelivery(deliveryId);
      assertCondition(
        Number(currentDelivery.revision) === deliveryEnvelope.expectedEntityRevision,
        "REVISION_CONFLICT",
        "Delivery revision changed",
      );
      this.assertLatestDelivery(runId, deliveryId);
      const result = apply(runId, currentDelivery, deliveryEnvelope);
      const current = this.database.getRunSummary(runId);
      const updated = current.revision === run.revision ? this.database.updateRun(runId, run.revision, {}) : current;
      this.database.appendEvent(runId, eventType, "delivery", deliveryId, updated.revision, result);
      response = this.acceptedResponse(runId, envelope.commandId, updated.revision, false, result);
      this.database.insertCommand({
        id: envelope.commandId,
        runId,
        kind: "EXPORT",
        receiptSource: operation,
        entityId: deliveryId,
        payloadHash: envelope.payloadHash,
        payload: { noop: true, eventType },
        effectKey: `collab:${runId}:delivery-decision:${deliveryId}:${eventType}:${envelope.commandId}`,
        response,
      });
      assertCondition(
        this.database.settleUnleasedCommand(envelope.commandId, "PENDING", "SUCCEEDED", { response }),
        "REVISION_CONFLICT",
        "Delivery command receipt changed before it could be committed",
      );
    });
    this.emitChanged(runId);
    void this.drainCommands();
    return response!;
  }

  private parseSessionMutationAction(value: unknown): SessionMutationAction {
    const action = readString(value, "action");
    assertCondition(action === "reset" || action === "delete", "INVALID_REQUEST", "action must be reset or delete");
    return action;
  }

  private parseSessionMutationPolicy(value: unknown): SessionMutationPolicy {
    const policy = readString(value, "policy");
    assertCondition(
      policy === "PROCEED" || policy === "CANCEL_AND_WAIT" || policy === "STOP_AND_RETARGET_LATER",
      "INVALID_REQUEST",
      "Unsupported session mutation policy",
    );
    return policy;
  }

  private findUnresolvedSessionMutation(identity: {
    runtimeId: string;
    sessionKey: string;
    sessionId: string;
  }): SessionMutationRow | null {
    const row = this.database.db
      .prepare(
        `SELECT * FROM session_mutations
         WHERE runtime_id = ? AND session_key = ? AND session_id = ?
           AND status IN ('PREPARED', 'EXPIRED')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(identity.runtimeId, identity.sessionKey, identity.sessionId) as SessionMutationRow | undefined;
    return row ?? null;
  }

  private sessionMutationObject(row: SessionMutationRow): Record<string, unknown> {
    return {
      mutationId: row.id,
      runtimeId: row.runtime_id,
      sessionKey: row.session_key,
      sessionId: row.session_id,
      action: row.action,
      policy: row.policy,
      status: row.status,
      expiresAt: numberValue(row.lease_expires_at),
      result: sanitizeStoredJsonForOutput(
        parseJson<Record<string, unknown> | null>(row.result_json, null),
        "session mutation result",
        PERSISTENCE_LIMITS.commandResponseBytes,
      ),
      createdAt: numberValue(row.created_at),
      updatedAt: numberValue(row.updated_at),
    };
  }

  private throwSessionMutationActive(row: SessionMutationRow): never {
    throw new CollaborationError(
      "SESSION_MUTATION_ACTIVE",
      row.status === "EXPIRED"
        ? "An expired session mutation requires explicit recovery"
        : "A session mutation is already in progress",
      {
        ...this.sessionMutationObject(row),
        recoveryRequired: row.status === "EXPIRED",
      },
    );
  }

  private assertSessionMutationInactive(identity: {
    runtimeId: string;
    sessionKey: string;
    sessionId: string;
  }): void {
    const mutation = this.findUnresolvedSessionMutation(identity);
    if (mutation) this.throwSessionMutationActive(mutation);
  }

  private applySessionMutationFence(runId: string, mutationId: string, policy: SessionMutationPolicy): void {
    const suspendedDispatches = this.suspendPendingDispatchesForFence(runId, mutationId);
    const run = this.database.getRunSummary(runId);
    const stopForRetarget = policy === "STOP_AND_RETARGET_LATER";
    const toStatus: RunStatus = stopForRetarget && run.status === "RUNNING" ? "AWAITING_INTERVENTION" : run.status;
    const updated = this.database.updateRun(run.id, run.revision, {
      status: toStatus,
      dispatchState: run.dispatchState === "OPEN" ? "STOPPED" : run.dispatchState,
      ...(toStatus === "AWAITING_INTERVENTION" ? { resumeStatus: "RUNNING" } : {}),
    });
    this.database.appendEvent(run.id, "SESSION_MUTATION_FENCE_ESTABLISHED", "session_mutation", mutationId, updated.revision, {
      policy,
      suspendedDispatches,
    });
    if (stopForRetarget) {
      this.insertIntervention(
        run.id,
        "SESSION_MUTATION_ACTIVE",
        "session_mutation",
        mutationId,
        "Retarget, export, cancel, or complete the session mutation before resuming dispatch",
        { mutationId, policy },
        run.status === "RUNNING" ? "RUNNING" : run.status,
      );
    }
  }

  private suspendPendingDispatchesForFence(runId: string, mutationId: string): number {
    const closed = this.closeQueuedDispatches(
      runId,
      `Session mutation fence ${mutationId} stopped this queued dispatch`,
      { includeAlreadyCancelledCommands: true },
    );
    return closed.safelyCancelled + closed.uncertain;
  }

  private suspendDispatchCommandForFence(
    command: CommandRecord,
    attempt: AttemptRow,
    mutation: SessionMutationRow,
  ): void {
    if (attempt.status === "DISPATCHING") {
      this.recordDispatchOutcomeUnknown(
        command,
        String(attempt.id),
        `Session mutation fence ${mutation.id} observed an in-flight dispatch`,
      );
      return;
    }
    this.database.transaction(() => {
      const timestamp = nowMs();
      assertCondition(
        this.database.settleClaimedCommand(command, "CANCELLED", {
          error: `Session mutation fence ${mutation.id}`,
        }),
        "REVISION_CONFLICT",
        "Dispatch command lease changed before the session mutation fence could stop it",
      );
      const attemptChanged = this.database.db
        .prepare(
          `UPDATE attempts SET status = 'CANCELLED', last_error = ?, ended_at = ?,
           revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'CREATED' AND revision = ? AND openclaw_run_id IS NULL`,
        )
        .run(
          `Session mutation fence ${mutation.id}`,
          timestamp,
          timestamp,
          attempt.id,
          numberValue(attempt.revision),
        );
      assertCondition(
        Number(attemptChanged.changes) === 1,
        "REVISION_CONFLICT",
        "Attempt changed before the session mutation fence could stop it",
      );
      if (attempt.work_item_id) {
        this.database.db
          .prepare(
            `UPDATE work_items SET status = 'READY', revision = revision + 1, updated_at = ?
             WHERE id = ? AND status = 'DISPATCHING'`,
          )
          .run(timestamp, attempt.work_item_id);
      }
      const run = this.database.getRunSummary(command.runId);
      const updated = this.database.updateRun(run.id, run.revision, {
        dispatchState: run.dispatchState === "OPEN" ? "STOPPED" : run.dispatchState,
      });
      this.database.appendEvent(run.id, "DISPATCH_SUSPENDED_BY_SESSION_MUTATION", "attempt", attempt.id, updated.revision, {
        mutationId: mutation.id,
        mutationStatus: mutation.status,
      });
    });
  }

  private reconcileExpiredSessionMutations(): void {
    const timestamp = nowMs();
    const expired = this.database.db
      .prepare("SELECT * FROM session_mutations WHERE status = 'PREPARED' AND lease_expires_at <= ? ORDER BY created_at ASC")
      .all(timestamp) as SessionMutationRow[];
    if (expired.length === 0) return;
    const changedRunIds = new Set<string>();
    this.database.transaction(() => {
      for (const mutation of expired) {
        this.instanceIdentity.assertRuntimeId(mutation.runtime_id, "sessionMutation.runtimeId");
        const previous = sanitizeStoredJsonForOutput(
          parseJson<Record<string, unknown>>(mutation.result_json, {}),
          "session mutation result",
          PERSISTENCE_LIMITS.commandResponseBytes,
        ) as Record<string, unknown>;
        const result = this.database.db
          .prepare(
            `UPDATE session_mutations SET status = 'EXPIRED', result_json = ?, updated_at = ?
             WHERE id = ? AND status = 'PREPARED'`,
          )
          .run(stableStringify({
            ...previous,
            expiredAt: timestamp,
            reason: "LEASE_EXPIRED",
            recoveryRequired: true,
          }), timestamp, mutation.id);
        if (Number(result.changes) !== 1) continue;
        const runs = this.listSessionRunsForCurrentInstance({
          sessionKey: mutation.session_key,
          sessionId: mutation.session_id,
          activeOnly: true,
          limit: 500,
        });
        for (const run of runs) {
          const latest = this.database.getRunSummary(run.id);
          const toStatus: RunStatus = latest.status === "RUNNING" ? "AWAITING_INTERVENTION" : latest.status;
          const updated = this.database.updateRun(run.id, latest.revision, {
            status: toStatus,
            dispatchState: latest.dispatchState === "OPEN" ? "STOPPED" : latest.dispatchState,
            reconcileState: "ATTENTION_REQUIRED",
            ...(toStatus === "AWAITING_INTERVENTION" ? { resumeStatus: "RUNNING" } : {}),
          });
          this.suspendPendingDispatchesForFence(run.id, mutation.id);
          this.database.appendEvent(run.id, "SESSION_MUTATION_EXPIRED", "session_mutation", mutation.id, updated.revision, {
            action: mutation.action,
            policy: mutation.policy,
            expiredAt: timestamp,
            recoveryRequired: true,
          });
          this.insertIntervention(
            run.id,
            "SESSION_MUTATION_EXPIRED",
            "session_mutation",
            mutation.id,
            "Record the core session RPC outcome before resuming collaboration",
            { mutationId: mutation.id, expiredAt: timestamp },
            latest.status === "RUNNING" ? "RUNNING" : latest.status,
          );
          changedRunIds.add(run.id);
        }
      }
    });
    for (const runId of changedRunIds) this.emitChanged(runId);
  }

  private replayedSessionMutationResponse(
    commandId: string,
    payloadHash: string,
    operation: "SESSION_MUTATION:PREPARE" | "SESSION_MUTATION:COMPLETE",
  ): Record<string, unknown> | null {
    const quarantined = this.database.getCommandReceiptConflict(commandId);
    if (quarantined) {
      throw new CollaborationError("IDEMPOTENCY_CONFLICT", "commandId is quarantined after a legacy namespace collision", {
        diagnostic: quarantined,
      });
    }
    const receipt = this.database.getCommandReceipt(commandId);
    if (receipt) {
      assertCondition(
        receipt.source === operation,
        "IDEMPOTENCY_CONFLICT",
        "commandId was already used by another collaboration operation",
      );
      assertCondition(receipt.payloadHash === payloadHash, "IDEMPOTENCY_CONFLICT", "commandId was already used with another payload");
      return this.writeResponse(receipt.response
        ? { ...receipt.response, replayed: true }
        : { accepted: true, replayed: true, commandId });
    }
    const row = this.database.db
      .prepare("SELECT operation, payload_hash, response_json FROM session_mutation_commands WHERE command_id = ?")
      .get(commandId) as SqlRow | undefined;
    if (row) {
      assertCondition(`SESSION_MUTATION:${String(row.operation)}` === operation, "IDEMPOTENCY_CONFLICT", "commandId was already used by another session mutation operation");
      assertCondition(row.payload_hash === payloadHash, "IDEMPOTENCY_CONFLICT", "commandId was already used with another payload");
      return this.writeResponse({
        ...parseJson<Record<string, unknown>>(row.response_json, {}),
        replayed: true,
      });
    }
    const deletionReceipt = this.database.db
      .prepare("SELECT command_id FROM deletion_command_receipts WHERE command_id = ?")
      .get(commandId) as SqlRow | undefined;
    assertCondition(!deletionReceipt, "IDEMPOTENCY_CONFLICT", "commandId was already used by a deletion command");
    const runCommand = this.database.db.prepare("SELECT id FROM commands WHERE id = ?").get(commandId) as SqlRow | undefined;
    assertCondition(!runCommand, "IDEMPOTENCY_CONFLICT", "commandId was already used by another collaboration command");
    return null;
  }

  private insertSessionMutationCommand(params: {
    commandId: string;
    mutationId: string;
    operation: "PREPARE" | "COMPLETE";
    payloadHash: string;
    response: Record<string, unknown>;
  }): void {
    assertBoundedJson(params.response, "session mutation command response", PERSISTENCE_LIMITS.commandResponseBytes);
    const deletionReceipt = this.database.db
      .prepare("SELECT 1 FROM deletion_command_receipts WHERE command_id = ?")
      .get(params.commandId);
    assertCondition(!deletionReceipt, "IDEMPOTENCY_CONFLICT", "commandId was already used by a deletion command");
    const runCommand = this.database.db.prepare("SELECT 1 FROM commands WHERE id = ?").get(params.commandId);
    assertCondition(!runCommand, "IDEMPOTENCY_CONFLICT", "commandId was already used by another collaboration command");
    this.database.reserveCommandReceipt({
      commandId: params.commandId,
      source: `SESSION_MUTATION:${params.operation}`,
      runId: null,
      payloadHash: params.payloadHash,
      response: params.response,
    });
    const timestamp = nowMs();
    this.database.db
      .prepare(
        `INSERT INTO session_mutation_commands(
          command_id, mutation_id, operation, payload_hash, response_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.commandId,
        params.mutationId,
        params.operation,
        params.payloadHash,
        stableStringify(params.response),
        timestamp,
        timestamp,
      );
  }

  private insertDeletionCommandReceipt(params: {
    commandId: string;
    source: "junqi.collab.run.delete" | "junqi.collab.run.delete.retry";
    runId: string;
    deletionJobId: string;
    payloadHash: string;
    response: Record<string, unknown>;
  }): void {
    assertBoundedJson(params.response, "deletion command response", PERSISTENCE_LIMITS.commandResponseBytes);
    const mutationCommand = this.database.db
      .prepare("SELECT 1 FROM session_mutation_commands WHERE command_id = ?")
      .get(params.commandId);
    assertCondition(!mutationCommand, "IDEMPOTENCY_CONFLICT", "commandId was already used by a session mutation command");
    this.database.reserveCommandReceipt({
      commandId: params.commandId,
      source: params.source,
      runId: params.runId,
      payloadHash: params.payloadHash,
      response: params.response,
    });
    const timestamp = nowMs();
    this.database.db
      .prepare(
        `INSERT INTO deletion_command_receipts(
          command_id, run_id, deletion_job_id, payload_hash, response_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.commandId,
        params.runId,
        params.deletionJobId,
        params.payloadHash,
        stableStringify(params.response),
        timestamp,
        timestamp,
      );
  }

  private acceptedResponse(
    runId: string,
    commandId: string,
    newRunRevision: number,
    replayed: boolean,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return this.writeResponse({
      accepted: true,
      replayed,
      commandId,
      runId,
      newRunRevision,
      lastEventSequence: this.database.getLastSequence(runId),
      ...extra,
    });
  }

  private validateWriteEnvelope(params: Record<string, unknown>): ReturnType<typeof validateWriteEnvelope> {
    return validateWriteEnvelope(params, this.instanceIdentity);
  }

  private writeResponse(response: Record<string, unknown>): Record<string, unknown> {
    return this.instanceIdentity.stampResponse(response);
  }

  private listSessionRunsForCurrentInstance(params: {
    sessionKey: string;
    sessionId: string;
    activeOnly?: boolean;
    limit: number;
  }): ReturnType<CollaborationDatabase["listRuns"]> {
    const runs = this.database.listRuns({ ...params, includeArchived: true });
    const mismatchedRun = runs.find(
      (run) => run.origin.runtimeId !== this.instanceIdentity.collaborationInstanceId,
    );
    assertCondition(
      !mismatchedRun,
      "SESSION_IDENTITY_MISMATCH",
      "A collaboration run is bound to a different database instance",
      {
        runId: mismatchedRun?.id,
        expectedCollaborationInstanceId: this.instanceIdentity.collaborationInstanceId,
        actualRuntimeId: mismatchedRun?.origin.runtimeId,
      },
    );
    return runs;
  }

  private replayedResponse(commandId: string, payloadHash: string, operation: string): Record<string, unknown> | null {
    const quarantined = this.database.getCommandReceiptConflict(commandId);
    if (quarantined) {
      throw new CollaborationError("IDEMPOTENCY_CONFLICT", "commandId is quarantined after a legacy namespace collision", {
        diagnostic: quarantined,
      });
    }
    const receipt = this.database.getCommandReceipt(commandId);
    if (receipt) {
      assertCondition(
        receipt.source === operation
          || (receipt.source === "LEGACY_DELETE" && operation.startsWith("junqi.collab.run.delete")),
        "IDEMPOTENCY_CONFLICT",
        "commandId was already used by another collaboration operation",
      );
      assertCondition(receipt.payloadHash === payloadHash, "IDEMPOTENCY_CONFLICT", "commandId was already used with another payload");
      return this.writeResponse(receipt.response
        ? { ...receipt.response, replayed: true }
        : { accepted: true, replayed: true, commandId });
    }
    const mutationCommand = this.database.db
      .prepare("SELECT command_id FROM session_mutation_commands WHERE command_id = ?")
      .get(commandId) as SqlRow | undefined;
    assertCondition(!mutationCommand, "IDEMPOTENCY_CONFLICT", "commandId was already used by a session mutation command");
    const deletionReceipt = this.database.db
      .prepare("SELECT payload_hash, response_json FROM deletion_command_receipts WHERE command_id = ?")
      .get(commandId) as SqlRow | undefined;
    if (deletionReceipt) {
      assertCondition(
        operation.startsWith("junqi.collab.run.delete"),
        "IDEMPOTENCY_CONFLICT",
        "commandId was already used by a deletion command",
      );
      assertCondition(
        deletionReceipt.payload_hash === payloadHash,
        "IDEMPOTENCY_CONFLICT",
        "commandId was already used with another deletion payload",
      );
      return this.writeResponse({
        ...parseJson<Record<string, unknown>>(deletionReceipt.response_json, {}),
        replayed: true,
      });
    }
    const row = this.database.db.prepare("SELECT payload_hash, response_json FROM commands WHERE id = ?").get(commandId) as SqlRow | undefined;
    if (!row) return null;
    throw new CollaborationError("IDEMPOTENCY_CONFLICT", "commandId is reserved by an internal or legacy collaboration command");
  }

  private requireRunRevision(runId: string, expected?: number): ReturnType<CollaborationDatabase["getRunSummary"]> {
    const run = this.database.getRunSummary(runId);
    assertCondition(expected != null, "INVALID_REQUEST", "expectedRunRevision is required");
    assertCondition(run.revision === expected, "REVISION_CONFLICT", "Run revision changed", {
      expectedRevision: expected,
      actualRevision: run.revision,
    });
    return run;
  }

  private requireCoordinator(): CapabilityAgent {
    const coordinator = this.configuredAgents().find((agent) => agent.coordinator && agent.allowed);
    if (!coordinator) {
      throw new CollaborationError("PLUGIN_NOT_CONFIGURED", "A configured and allowed coordinator agent is required");
    }
    return coordinator;
  }

  private assertConfigured(): void {
    this.requireCoordinator();
    assertCondition(this.allowedAgentIds().size > 0, "PLUGIN_NOT_CONFIGURED", "At least one allowed agent is required");
  }

  private allowedAgentIds(): Set<string> {
    return new Set(this.configuredAgents().filter((agent) => agent.allowed).map((agent) => agent.id));
  }

  private configuredAgents(): CapabilityAgent[] {
    return sanitizeConfiguredAgents(this.runtime.listConfiguredAgents());
  }

  private buildCapabilitySnapshot(
    capabilityInput: Record<string, unknown>,
    configuredAgents: readonly CapabilityAgent[] = this.configuredAgents(),
  ): Record<string, unknown> & { configHash: string } {
    const agents = sanitizeConfiguredAgents([...configuredAgents]);
    const desktopObservedFacts = sanitizeDesktopObservedFacts(capabilityInput.desktopObservedFacts);
    assertBoundedText(
      this.runtime.runtimeVersion,
      "runtimeVersion",
      PERSISTENCE_LIMITS.runtimeVersionBytes,
    );
    const configuredFacts = {
      agents,
      coordinatorAgentId: agents.find((agent) => agent.coordinator)?.id ?? null,
      allowedAgentIds: agents.filter((agent) => agent.allowed).map((agent) => agent.id),
      runtimeVersion: this.runtime.runtimeVersion,
    };
    const snapshot = {
      configuredFacts,
      desktopObservedFacts,
      runtimeProbeFacts: {},
      source: ["plugin-config", "desktop-observation"],
      capturedAt: nowMs(),
      configHash: sha256(configuredFacts),
    };
    assertBoundedJson(snapshot, "capabilitySnapshot", PERSISTENCE_LIMITS.capabilitySnapshotBytes);
    return snapshot;
  }

  private assertCapabilitiesUnchanged(runId: string): void {
    const row = this.database.getRunRow(runId);
    const current = this.buildCapabilitySnapshot({});
    assertCondition(row.capability_config_hash === current.configHash, "CAPABILITY_CHANGED", "Agent configuration changed after approval");
  }

  private maintenanceActive(): boolean {
    return this.reconcileMaintenanceLease().gateActive;
  }

  private throwMaintenanceActive(inspection: MaintenanceLeaseInspection): never {
    throw new CollaborationError(
      "MAINTENANCE_ACTIVE",
      "Collaboration dispatch is closed for maintenance",
      this.maintenanceStatusProjection(inspection),
    );
  }

  private assertMaintenanceInactive(): void {
    const inspection = this.reconcileMaintenanceLease();
    if (inspection.gateActive) this.throwMaintenanceActive(inspection);
  }

  private insertAttempt(params: {
    id: string;
    runId: string;
    workItemId?: string;
    kind: string;
    attemptNo: number;
    effectKey: string;
    agentId: string;
    executionRuntime: AgentExecutionRuntime;
    input: Record<string, unknown>;
  }): void {
    assertAttemptNumber(params.attemptNo);
    assertBoundedText(params.agentId, "attempt.agentId", PERSISTENCE_LIMITS.originAgentIdBytes);
    assertBoundedJson(params.input, "attempt input", PERSISTENCE_LIMITS.revisionInstructionBytes + 1024);
    const now = nowMs();
    const ownerSessionKey = `agent:${params.agentId}:main`;
    const childSessionKey = `agent:${params.agentId}:subagent:${params.id.replace(/^attempt_/, "")}`;
    this.database.db
      .prepare(
        `INSERT INTO attempts(
          id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
          execution_runtime, worker_owner_session_key, child_session_key, status, input_json,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, 1, ?, ?)`,
      )
      .run(
        params.id,
        params.runId,
        params.workItemId ?? null,
        params.kind,
        params.attemptNo,
        params.effectKey,
        params.agentId,
        params.executionRuntime,
        ownerSessionKey,
        childSessionKey,
        stableStringify(params.input),
        now,
        now,
      );
  }

  private insertWorkItem(runId: string, planId: string, item: CollaborationPlan["workItems"][number], now: number): void {
    this.database.db
      .prepare(
        `INSERT INTO work_items(
          id, run_id, plan_revision_id, logical_id, title, input_scope_json, dependencies_json,
          required_capabilities_json, candidate_agent_ids_json, acceptance_criteria_json,
          risk_level, side_effect_class, status, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', 1, ?, ?)`,
      )
      .run(
        newId("work"),
        runId,
        planId,
        item.id,
        item.title,
        stableStringify(item.inputScope),
        stableStringify(item.dependencies),
        stableStringify(item.requiredCapabilities),
        stableStringify(item.candidateAgentIds),
        stableStringify(item.acceptanceCriteria),
        item.riskLevel,
        item.sideEffectClass,
        now,
        now,
      );
  }

  private insertIntervention(
    runId: string,
    code: string,
    entityType: string | null,
    entityId: string | null,
    requiredAction: string,
    diagnostics: Record<string, unknown>,
    resumeStatus: RunStatus,
  ): void {
    assertBoundedText(requiredAction, "intervention.requiredAction", PERSISTENCE_LIMITS.handoffNoteBytes);
    assertBoundedJson(
      diagnostics,
      "intervention diagnostics",
      PERSISTENCE_LIMITS.interventionDiagnosticsBytes,
    );
    const existing = this.database.db
      .prepare(
        "SELECT id FROM interventions WHERE run_id = ? AND code = ? AND COALESCE(entity_id, '') = COALESCE(?, '') AND resolved_at IS NULL LIMIT 1",
      )
      .get(runId, code, entityId) as SqlRow | undefined;
    if (existing) return;
    this.database.db
      .prepare(
        `INSERT INTO interventions(id, run_id, code, entity_type, entity_id, required_action,
         diagnostics_json, resume_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newId("intervention"), runId, code, entityType, entityId, requiredAction, stableStringify(diagnostics), resumeStatus, nowMs());
  }

  private insertDecision(runId: string, commandId: string, actor: string, type: string, payload: Record<string, unknown>): void {
    assertBoundedText(actor, "decision.actor", PERSISTENCE_LIMITS.actorBytes);
    assertBoundedJson(payload, "decision payload", PERSISTENCE_LIMITS.eventPayloadBytes);
    this.database.db
      .prepare("INSERT INTO decisions(id, run_id, command_id, actor, decision_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(newId("decision"), runId, commandId, actor, type, stableStringify(payload), nowMs());
  }

  /**
   * Local domain mutations still use the durable command-receipt contract. This
   * keeps template creation and instantiation idempotent without pretending an
   * OpenClaw external effect was performed.
   */
  private recordImmediateCommandReceipt(params: {
    runId: string;
    envelope: ReturnType<typeof validateWriteEnvelope>;
    operation: string;
    payload: Record<string, unknown>;
    effectKey: string;
    response: Record<string, unknown>;
  }): void {
    this.database.insertCommand({
      id: params.envelope.commandId,
      runId: params.runId,
      kind: "EXPORT",
      receiptSource: params.operation,
      payloadHash: params.envelope.payloadHash,
      payload: { noop: true, ...params.payload },
      effectKey: params.effectKey,
      response: params.response,
    });
    assertCondition(
      this.database.settleUnleasedCommand(params.envelope.commandId, "PENDING", "SUCCEEDED", {
        response: params.response,
      }),
      "REVISION_CONFLICT",
      "Workflow template command receipt changed before it could be committed",
    );
  }

  private resolveInterventions(runId: string, entityType: string, entityId: string, resolution: string): void {
    this.database.db
      .prepare(
        `UPDATE interventions SET resolved_at = ?, resolved_by = 'operator', resolution_json = ?
         WHERE run_id = ? AND entity_type = ? AND entity_id = ? AND resolved_at IS NULL`,
      )
      .run(nowMs(), stableStringify({ resolution }), runId, entityType, entityId);
  }

  private resolveWorkItemRetryInterventions(
    runId: string,
    workItemId: string,
    commandId: string,
  ): void {
    const candidates = this.database.db
      .prepare(
        `SELECT i.id, i.code, i.entity_type, a.status AS attempt_status
         FROM interventions i
         LEFT JOIN attempts a
           ON i.entity_type = 'attempt' AND a.run_id = i.run_id AND a.id = i.entity_id
         WHERE i.run_id = ? AND i.resolved_at IS NULL
           AND (
             (i.entity_type = 'work_item' AND i.entity_id = ?)
             OR (i.entity_type = 'attempt' AND a.work_item_id = ?)
           )
         ORDER BY i.created_at, i.id`,
      )
      .all(runId, workItemId, workItemId) as SqlRow[];
    const resolution = stableStringify({
      resolution: "retry",
      commandId,
      workItemId,
    });
    const resolvedAt = nowMs();
    const resolve = this.database.db.prepare(
      `UPDATE interventions
       SET resolved_at = ?, resolved_by = 'operator', resolution_json = ?
       WHERE id = ? AND run_id = ? AND resolved_at IS NULL`,
    );
    for (const candidate of candidates) {
      const decision = decideWorkItemRetryInterventionResolution({
        code: String(candidate.code),
        entityType: nullableString(candidate.entity_type),
        attemptStatus: nullableString(candidate.attempt_status),
      });
      if (decision === "RESOLVE_AS_SUPERSEDED") {
        resolve.run(resolvedAt, resolution, String(candidate.id), runId);
      }
    }
  }

  private resolveCancellationSupersededInterventions(runId: string): void {
    const candidates = this.database.db
      .prepare(
        `SELECT i.id, i.code, i.entity_type, a.status AS attempt_status
         FROM interventions i
         LEFT JOIN attempts a
           ON i.entity_type = 'attempt' AND a.run_id = i.run_id AND a.id = i.entity_id
         WHERE i.run_id = ? AND i.resolved_at IS NULL
         ORDER BY i.created_at, i.id`,
      )
      .all(runId) as SqlRow[];
    const resolution = stableStringify({ resolution: "run-cancelled", runId });
    const resolvedAt = nowMs();
    const resolve = this.database.db.prepare(
      `UPDATE interventions
       SET resolved_at = ?, resolved_by = 'operator', resolution_json = ?
       WHERE id = ? AND run_id = ? AND resolved_at IS NULL`,
    );
    for (const candidate of candidates) {
      const decision = decideRunCancellationInterventionResolution({
        code: String(candidate.code),
        entityType: nullableString(candidate.entity_type),
        attemptStatus: nullableString(candidate.attempt_status),
      });
      if (decision === "RESOLVE_AS_SUPERSEDED") {
        resolve.run(resolvedAt, resolution, String(candidate.id), runId);
      }
    }
  }

  private validateAssignments(runId: string, planRevisionId: string, assignments: Record<string, string>): void {
    const items = this.database.db
      .prepare("SELECT logical_id, candidate_agent_ids_json FROM work_items WHERE run_id = ? AND plan_revision_id = ?")
      .all(runId, planRevisionId) as SqlRow[];
    const byId = new Map(items.map((item) => [String(item.logical_id), parseJson<string[]>(item.candidate_agent_ids_json, [])]));
    assertCondition(
      Object.keys(assignments).length === byId.size && [...byId.keys()].every((logicalId) => logicalId in assignments),
      "INVALID_REQUEST",
      "Every work item in the current plan requires an explicit agent assignment",
    );
    for (const [logicalId, agentId] of Object.entries(assignments)) {
      const candidates = byId.get(logicalId);
      assertCondition(candidates, "NOT_FOUND", `Work item ${logicalId} was not found in the plan`);
      assertCondition(candidates.includes(agentId), "CAPABILITY_CHANGED", `Agent ${agentId} was not approved for ${logicalId}`);
      assertCondition(this.allowedAgentIds().has(agentId), "CAPABILITY_CHANGED", `Agent ${agentId} is no longer allowed`);
    }
  }

  private markAttemptSucceeded(attempt: AttemptRow, outcome: unknown): boolean {
    assertBoundedJson(outcome, "attempt outcome", PERSISTENCE_LIMITS.workerResultBytes);
    const now = nowMs();
    const changed = this.database.db
      .prepare(
        `UPDATE attempts SET status = 'SUCCEEDED', outcome_json = ?, ended_at = ?,
         revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'RUNNING' AND revision = ?`,
      )
      .run(stableStringify(outcome), now, now, String(attempt.id), numberValue(attempt.revision));
    return Number(changed.changes) === 1;
  }

  private markAttemptCancelled(attempt: AttemptRow): boolean {
    const now = nowMs();
    const changed = this.database.db
      .prepare(
        `UPDATE attempts SET status = 'CANCELLED', ended_at = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'CANCELLING' AND revision = ?`,
      )
      .run(now, now, attempt.id, numberValue(attempt.revision));
    if (Number(changed.changes) !== 1) return false;
    if (attempt.work_item_id) {
      this.database.db
        .prepare(
          `UPDATE work_items SET status = 'CANCELLED', revision = revision + 1, updated_at = ?
           WHERE id = ? AND status = 'CANCELLING'`,
        )
        .run(now, attempt.work_item_id);
    }
    return true;
  }

  private markAttemptTimedOutAfterCancellation(attempt: AttemptRow): boolean {
    const timestamp = nowMs();
    const diagnostic = "Attempt exceeded the configured timeout";
    const changed = this.database.db
      .prepare(
        `UPDATE attempts SET status = 'TIMED_OUT', last_error = ?, ended_at = ?,
         revision = revision + 1, updated_at = ?
         WHERE id = ? AND status = 'CANCELLING' AND revision = ?`,
      )
      .run(diagnostic, timestamp, timestamp, attempt.id, numberValue(attempt.revision));
    if (Number(changed.changes) !== 1) return false;
    const run = this.database.getRunSummary(String(attempt.run_id));
    if (attempt.work_item_id) {
      this.database.db
        .prepare(
          `UPDATE work_items SET status = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND status NOT IN ('SUCCEEDED', 'WAIVED', 'CANCELLED')`,
        )
        .run(run.status === "CANCELLING" ? "CANCELLED" : "NEEDS_INTERVENTION", timestamp, attempt.work_item_id);
    }
    this.resolveInterventions(run.id, "attempt", String(attempt.id), "timeout-cancellation-confirmed");
    const updated = this.database.updateRun(run.id, run.revision, {
      reconcileState: run.status === "CANCELLING" ? run.reconcileState : "ATTENTION_REQUIRED",
    });
    this.database.appendEvent(run.id, "ATTEMPT_FAILED", "attempt", String(attempt.id), updated.revision, {
      code: "ATTEMPT_TIMED_OUT",
      message: diagnostic,
      status: "TIMED_OUT",
    });
    if (run.status !== "CANCELLING" && !TERMINAL_RUN_STATUSES.includes(run.status)) {
      this.insertIntervention(
        run.id,
        "ATTEMPT_TIMED_OUT",
        "attempt",
        String(attempt.id),
        "Retry, reassign, accept partial completion, or cancel",
        { message: diagnostic, status: "TIMED_OUT" },
        this.attemptResumeStatus(attempt),
      );
    }
    return true;
  }

  private hasActiveAttempt(workItemId: string): boolean {
    const row = this.database.db
      .prepare(`SELECT COUNT(*) AS value FROM attempts WHERE work_item_id = ? AND status IN (${ACTIVE_ATTEMPT_STATUSES.map(() => "?").join(",")})`)
      .get(workItemId, ...ACTIVE_ATTEMPT_STATUSES) as SqlRow;
    return numberValue(row.value) > 0;
  }

  private pendingWorkItemInputIds(workItemId: string): string[] {
    const consumed = new Set<string>();
    const attempts = this.database.db
      .prepare("SELECT input_json FROM attempts WHERE work_item_id = ? ORDER BY attempt_no ASC")
      .all(workItemId) as SqlRow[];
    for (const attempt of attempts) {
      const input = parseJson<{ additionalInputIds?: unknown }>(attempt.input_json, {});
      if (!Array.isArray(input.additionalInputIds)) continue;
      for (const id of input.additionalInputIds) {
        if (typeof id === "string") consumed.add(id);
      }
    }
    return (this.database.db
      .prepare("SELECT id FROM work_item_inputs WHERE work_item_id = ? ORDER BY created_at ASC, id ASC")
      .all(workItemId) as SqlRow[])
      .map((row) => String(row.id))
      .filter((id) => !consumed.has(id));
  }

  private nextAttemptNo(runId: string, workItemId: string | null, kind: string): number {
    const row = this.database.db
      .prepare(
        "SELECT COALESCE(MAX(attempt_no), 0) + 1 AS value FROM attempts WHERE run_id = ? AND work_item_id IS ? AND kind = ?",
      )
      .get(runId, workItemId, kind) as SqlRow;
    return numberValue(row.value);
  }

  private nextPlanRevisionNo(runId: string): number {
    const row = this.database.db
      .prepare("SELECT COALESCE(MAX(revision_no), 0) + 1 AS value FROM plan_revisions WHERE run_id = ?")
      .get(runId) as SqlRow;
    const revisionNo = numberValue(row.value);
    assertCondition(
      revisionNo <= PERSISTENCE_LIMITS.planRevisions,
      "CAPACITY_EXCEEDED",
      `plan revisions exceed the ${PERSISTENCE_LIMITS.planRevisions}-revision limit`,
    );
    return revisionNo;
  }

  private getAttempt(id: string): AttemptRow {
    const row = this.database.db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as AttemptRow | undefined;
    if (!row) throw new CollaborationError("NOT_FOUND", `Attempt ${id} was not found`);
    return row;
  }

  private getWorkItem(id: string): SqlRow {
    const row = this.database.db.prepare("SELECT * FROM work_items WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) throw new CollaborationError("NOT_FOUND", `Work item ${id} was not found`);
    return row;
  }

  private getDelivery(id: string): SqlRow {
    const row = this.database.db.prepare("SELECT * FROM deliveries WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) throw new CollaborationError("NOT_FOUND", `Delivery ${id} was not found`);
    return row;
  }

  private assertLatestDelivery(runId: string, deliveryId: string): void {
    const latest = this.database.db
      .prepare("SELECT id FROM deliveries WHERE run_id = ? ORDER BY target_revision DESC LIMIT 1")
      .get(runId) as SqlRow | undefined;
    assertCondition(latest && String(latest.id) === deliveryId, "INVALID_TRANSITION", "Delivery is not the current target revision");
  }

  private assertDeliveryIdle(deliveryId: string): void {
    const row = this.database.db
      .prepare(
        `SELECT
           EXISTS(SELECT 1 FROM commands WHERE kind = 'DELIVER' AND entity_id = ? AND status IN ('PENDING', 'LEASED')) AS active_command,
           EXISTS(SELECT 1 FROM delivery_attempts WHERE delivery_id = ? AND status = 'SUBMITTING') AS submitting_attempt`,
      )
      .get(deliveryId, deliveryId) as SqlRow;
    assertCondition(
      numberValue(row.active_command) === 0 && numberValue(row.submitting_attempt) === 0,
      "INVALID_TRANSITION",
      "Delivery is currently submitting",
    );
  }

  private getPlanRow(id: string): SqlRow {
    const row = this.database.db.prepare("SELECT * FROM plan_revisions WHERE id = ?").get(id) as SqlRow | undefined;
    if (!row) throw new CollaborationError("NOT_FOUND", `Plan revision ${id} was not found`);
    return row;
  }

  private getCurrentPlan(runId: string): CollaborationPlan {
    const run = this.database.getRunSummary(runId);
    assertCondition(run.currentPlanRevisionId, "NOT_FOUND", "Current plan was not found");
    return parseJson<CollaborationPlan>(this.getPlanRow(run.currentPlanRevisionId).plan_json, {
      goal: run.goal,
      workItems: [],
      synthesis: { requiredEvidence: [], finalAnswerContract: "Answer the user's goal" },
    });
  }

  private listWorkItems(runId: string): SqlRow[] {
    return this.currentPlanScope.listWorkItems(runId);
  }

  private listActiveAttempts(runId: string): AttemptRow[] {
    return this.database.db
      .prepare(`SELECT * FROM attempts WHERE run_id = ? AND status IN (${ACTIVE_ATTEMPT_STATUSES.map(() => "?").join(",")})`)
      .all(runId, ...ACTIVE_ATTEMPT_STATUSES) as AttemptRow[];
  }

  private assertPlanRevisionQuiescent(runId: string): void {
    assertCondition(
      this.listActiveAttempts(runId).length === 0,
      "ACTIVE_ATTEMPT_EXISTS",
      "Cancel active Attempts or resolve UNKNOWN Attempts before revising the plan",
    );
  }

  private upstreamEvidence(runId: string, item: SqlRow): Record<string, unknown>[] {
    const dependencies = parseJson<string[]>(item.dependencies_json, []);
    return this.currentPlanScope.listUpstreamEvidence(runId, item, dependencies).map(evidenceReportObject);
  }

  private runSnapshot(runId: string): Record<string, unknown> {
    const run = this.database.getRunSummary(runId);
    const runRow = this.database.getRunRow(runId);
    const planRevisions = (this.database.db
      .prepare("SELECT * FROM plan_revisions WHERE run_id = ? ORDER BY revision_no, id")
      .all(runId) as SqlRow[]).map(planRevisionObject);
    const attemptRows = this.database.db
      .prepare("SELECT * FROM attempts WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as AttemptRow[];
    const snapshotRun = this.decorateRunAllowedActions(
      run,
      attemptRows.some((attempt) => attempt.status === "UNKNOWN"),
    );
    const finalArtifact = this.database.db
      .prepare("SELECT * FROM final_artifacts WHERE run_id = ?")
      .get(runId) as SqlRow | undefined;
    return {
      collaborationInstanceId: this.database.instanceId,
      run: snapshotRun,
      capabilitySnapshot: sanitizeStoredJsonForOutput(
        parseJson(runRow.capability_snapshot_json, {}),
        "capability snapshot",
        PERSISTENCE_LIMITS.capabilitySnapshotBytes,
      ),
      capabilityConfigHash: nullableString(runRow.capability_config_hash),
      plan: run.currentPlanRevisionId ? this.getPlan({ runId, planRevisionId: run.currentPlanRevisionId }) : null,
      planRevisions,
      workItems: this.listWorkItems(runId).map(workItemObject),
      attempts: attemptRows.map((attempt) => ({
        ...safeAttemptObject(attempt),
        canAbandonWithResidualRisk: this.canAbandonUnknownAttemptWithResidualRisk(run.status, attempt),
      })),
      evidence: (this.database.db.prepare("SELECT * FROM evidence WHERE run_id = ? ORDER BY created_at ASC").all(runId) as SqlRow[]).map(evidenceObject),
      interventions: (this.database.db.prepare("SELECT * FROM interventions WHERE run_id = ? ORDER BY created_at ASC").all(runId) as SqlRow[]).map(interventionObject),
      deliveries: (this.database.db.prepare("SELECT * FROM deliveries WHERE run_id = ? ORDER BY target_revision ASC").all(runId) as SqlRow[]).map(deliveryObject),
      decisions: (this.database.db.prepare("SELECT * FROM decisions WHERE run_id = ? ORDER BY created_at ASC").all(runId) as SqlRow[]).map(decisionObject),
      workflowTemplate: this.workflowTemplates.getRunProjection(runId),
      finalArtifact: finalArtifact ? finalArtifactObject(finalArtifact) : null,
      lastEventSequence: this.database.getLastSequence(runId),
    };
  }

  private decorateRunAllowedActions(
    run: ReturnType<CollaborationDatabase["getRunSummary"]>,
    hasUnknownAttempt = Boolean(this.database.db
      .prepare("SELECT 1 FROM attempts WHERE run_id = ? AND status = 'UNKNOWN' LIMIT 1")
      .get(run.id)),
  ): ReturnType<CollaborationDatabase["getRunSummary"]> {
    const hasOpenResidualRisk = Boolean(this.database.db
      .prepare(
        `SELECT 1 FROM interventions
         WHERE run_id = ? AND code = 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK'
           AND resolved_at IS NULL LIMIT 1`,
      )
      .get(run.id));
    if (hasOpenResidualRisk) {
      return {
        ...run,
        allowedActions: run.allowedActions.filter((action) => (
          action === "EXPORT" || action === "ARCHIVE" || action === "UNARCHIVE"
        )),
      };
    }
    const allowedActions = run.allowedActions.filter(
      (action) => action !== "DISPATCH_RESUME" && action !== "ATTEMPT_RESOLVE_UNKNOWN",
    );
    if (this.resumableDispatchIntervention(run.id)) allowedActions.push("DISPATCH_RESUME");
    if (hasUnknownAttempt) allowedActions.push("ATTEMPT_RESOLVE_UNKNOWN");
    const failedFlowSync = TERMINAL_RUN_STATUSES.includes(run.status) && Boolean(this.database.db
      .prepare("SELECT 1 FROM commands WHERE run_id = ? AND kind = 'FLOW_SYNC' AND status = 'FAILED' LIMIT 1")
      .get(run.id));
    if (failedFlowSync && !allowedActions.includes("RECONCILE")) allowedActions.push("RECONCILE");
    const failedProvision = (run.status === "AWAITING_INTERVENTION" || TERMINAL_RUN_STATUSES.includes(run.status)) && Boolean(this.database.db
      .prepare("SELECT 1 FROM commands WHERE run_id = ? AND kind = 'PROVISION' AND status = 'FAILED' LIMIT 1")
      .get(run.id));
    if (failedProvision && !allowedActions.includes("RECONCILE")) allowedActions.push("RECONCILE");
    return { ...run, allowedActions };
  }

  private buildAuditExportSnapshot(runId: string): Record<string, unknown> {
    const snapshot = this.runSnapshot(runId);
    return {
      ...snapshot,
      workItems: (this.database.db
        .prepare("SELECT * FROM work_items WHERE run_id = ? ORDER BY plan_revision_id, created_at, id")
        .all(runId) as SqlRow[]).map(workItemObject),
      commands: (this.database.db
        .prepare("SELECT * FROM commands WHERE run_id = ? ORDER BY created_at, id")
        .all(runId) as SqlRow[]).map(commandAuditObject),
      deliveryAttempts: (this.database.db
        .prepare(
          `SELECT da.* FROM delivery_attempts da
           JOIN deliveries d ON d.id = da.delivery_id
           WHERE d.run_id = ? ORDER BY d.target_revision, da.attempt_no, da.id`,
        )
        .all(runId) as SqlRow[]).map(deliveryAttemptAuditObject),
    };
  }

  private assertExportPreflight(runId: string): void {
    const eventCount = numberValue(
      (this.database.db.prepare("SELECT COUNT(*) AS value FROM collaboration_events WHERE run_id = ?").get(runId) as SqlRow).value,
    );
    assertCondition(
      eventCount <= PERSISTENCE_LIMITS.eventsPerExport,
      "CAPACITY_EXCEEDED",
      `run event timeline exceeds the ${PERSISTENCE_LIMITS.eventsPerExport}-event export limit`,
    );
    const measurements = [
      `SELECT COUNT(*) AS row_count,
              COALESCE(SUM(length(CAST(goal AS BLOB)) + length(CAST(capability_snapshot_json AS BLOB))
                + length(CAST(COALESCE(failure_message, '') AS BLOB))), 0) AS byte_count
       FROM collaboration_runs WHERE id = ?`,
      `SELECT COUNT(*) AS row_count, COALESCE(SUM(length(CAST(plan_json AS BLOB))), 0) AS byte_count
       FROM plan_revisions WHERE run_id = ?`,
      `SELECT COUNT(*) AS row_count,
              COALESCE(SUM(length(CAST(title AS BLOB)) + length(CAST(input_scope_json AS BLOB))
                + length(CAST(dependencies_json AS BLOB)) + length(CAST(required_capabilities_json AS BLOB))
                + length(CAST(candidate_agent_ids_json AS BLOB)) + length(CAST(acceptance_criteria_json AS BLOB))), 0) AS byte_count
       FROM work_items WHERE run_id = ?`,
      `SELECT COUNT(*) AS row_count,
              COALESCE(SUM(length(CAST(COALESCE(outcome_json, '') AS BLOB))
                + length(CAST(COALESCE(last_error, '') AS BLOB))), 0) AS byte_count
       FROM attempts WHERE run_id = ?`,
      `SELECT COUNT(*) AS row_count,
              COALESCE(SUM(length(CAST(type AS BLOB)) + length(CAST(title AS BLOB))
                + length(CAST(reference AS BLOB)) + length(CAST(verification AS BLOB))
                + length(CAST(COALESCE(warning, '') AS BLOB))), 0) AS byte_count
       FROM evidence WHERE run_id = ?`,
      `SELECT COUNT(*) AS row_count,
              COALESCE(SUM(length(CAST(required_action AS BLOB)) + length(CAST(diagnostics_json AS BLOB))
                + length(CAST(COALESCE(resolution_json, '') AS BLOB))), 0) AS byte_count
       FROM interventions WHERE run_id = ?`,
      `SELECT COUNT(*) AS row_count, COALESCE(SUM(length(CAST(content AS BLOB))), 0) AS byte_count
       FROM final_artifacts WHERE run_id = ?`,
      `SELECT COUNT(*) AS row_count, COALESCE(SUM(length(CAST(target_json AS BLOB))), 0) AS byte_count
       FROM deliveries WHERE run_id = ?`,
      `SELECT COUNT(*) AS row_count,
              COALESCE(SUM(length(CAST(COALESCE(da.receipt_json, '') AS BLOB))
                + length(CAST(COALESCE(da.last_error, '') AS BLOB))), 0) AS byte_count
       FROM delivery_attempts da JOIN deliveries d ON d.id = da.delivery_id WHERE d.run_id = ?`,
      `SELECT COUNT(*) AS row_count,
              COALESCE(SUM(length(CAST(effect_key AS BLOB)) + length(CAST(COALESCE(response_json, '') AS BLOB))
                + length(CAST(COALESCE(last_error, '') AS BLOB))), 0) AS byte_count
       FROM commands WHERE run_id = ?`,
      `SELECT COUNT(*) AS row_count, COALESCE(SUM(length(CAST(payload_json AS BLOB))), 0) AS byte_count
       FROM collaboration_events WHERE run_id = ?`,
      `SELECT COUNT(*) AS row_count, COALESCE(SUM(length(CAST(payload_json AS BLOB))), 0) AS byte_count
       FROM decisions WHERE run_id = ?`,
    ];
    let rawBytes = 0;
    let rowCount = 0;
    for (const sql of measurements) {
      const row = this.database.db.prepare(sql).get(runId) as SqlRow;
      rawBytes += numberValue(row.byte_count);
      rowCount += numberValue(row.row_count);
    }
    const conservativeBytes = rawBytes * 2 + rowCount * 768 + 128 * 1024;
    assertCondition(
      conservativeBytes <= EXPORT_MATERIALIZATION_BUDGET_BYTES,
      "CAPACITY_EXCEEDED",
      `collaboration export exceeds the ${EXPORT_MATERIALIZATION_BUDGET_BYTES}-byte materialization budget`,
      { rawBytes, rowCount, conservativeBytes, maxBytes: EXPORT_MATERIALIZATION_BUDGET_BYTES },
    );
  }

  private runContentDigest(runId: string): string {
    return this.computeRunContentDigest(runId).digest;
  }

  private computeRunContentDigest(runId: string): RunContentDigest {
    return this.database.readTransaction(() => {
      const run = this.database.getRunSummary(runId);
      const lastEventSequence = this.database.getLastSequence(runId);
      const digest = createHash("sha256");
      const append = (value: unknown): void => {
        const serialized = stableStringify(value);
        digest.update(String(Buffer.byteLength(serialized, "utf8")));
        digest.update(":");
        digest.update(serialized);
      };
      append({ format: "junqi-collaboration-content/v3" });
      const sources = [
        ["collaboration_runs", "SELECT * FROM collaboration_runs WHERE id = ? ORDER BY id"],
        ["plan_revisions", "SELECT * FROM plan_revisions WHERE run_id = ? ORDER BY revision_no, id"],
        ["work_items", "SELECT * FROM work_items WHERE run_id = ? ORDER BY plan_revision_id, logical_id, id"],
        [
          "attempts",
          `SELECT id, run_id, work_item_id, kind, attempt_no, idempotency_key, worker_agent_id,
                  execution_runtime, worker_owner_session_key, child_session_key, openclaw_run_id, openclaw_task_id,
                  status, input_json, outcome_json, last_error, revision, started_at, ended_at,
                  last_reconciled_at, created_at, updated_at
           FROM attempts WHERE run_id = ? ORDER BY created_at, id`,
        ],
        ["evidence", "SELECT * FROM evidence WHERE run_id = ? ORDER BY created_at, id"],
        ["interventions", "SELECT * FROM interventions WHERE run_id = ? ORDER BY created_at, id"],
        ["final_artifacts", "SELECT * FROM final_artifacts WHERE run_id = ? ORDER BY id"],
        ["deliveries", "SELECT * FROM deliveries WHERE run_id = ? ORDER BY target_revision, id"],
        [
          "delivery_attempts",
          `SELECT da.* FROM delivery_attempts da
           JOIN deliveries d ON d.id = da.delivery_id
           WHERE d.run_id = ? ORDER BY d.target_revision, da.attempt_no, da.id`,
        ],
        ["collaboration_events", "SELECT * FROM collaboration_events WHERE run_id = ? ORDER BY sequence"],
        ["decisions", "SELECT * FROM decisions WHERE run_id = ? ORDER BY created_at, id"],
        [
          "work_item_inputs",
          `SELECT i.* FROM work_item_inputs i
           JOIN work_items w ON w.id = i.work_item_id
           WHERE w.run_id = ? ORDER BY i.created_at, i.id`,
        ],
      ] as const;
      for (const [source, sql] of sources) {
        append({ source });
        for (const row of this.database.db.prepare(sql).iterate(runId)) append(normalizeDigestRow(row));
      }
      return {
        digest: digest.digest("hex"),
        revision: run.revision,
        lastEventSequence,
      };
    });
  }

  private confirmationToken(kind: string, runId: string, revision: number, payload: Record<string, unknown>): string {
    return sha256({
      collaborationInstanceId: this.database.instanceId,
      kind,
      runId,
      revision,
      payload,
    });
  }

  private emitChanged(runId: string): void {
    try {
      const run = this.database.getRunSummary(runId);
      this.runtime.emitChanged({
        instanceId: this.database.instanceId,
        runId,
        runRevision: run.revision,
        lastSequence: this.database.getLastSequence(runId),
      });
    } catch {
      // Deleted runs no longer have a snapshot to publish.
    }
  }
}

function flowObservationMatches(
  observation: ReturnType<RuntimeAdapter["getManagedFlow"]>,
  expected: {
    controllerId: string;
    status: "succeeded" | "failed" | "cancelled";
    state: { runId: string; domainRevision: number; status: RunStatus };
  },
): boolean {
  if (observation?.controllerId !== expected.controllerId || observation.status !== expected.status) return false;
  if (expected.status === "cancelled") return true;
  return observation.state?.runId === expected.state.runId
    && observation.state?.domainRevision === expected.state.domainRevision
    && observation.state?.status === expected.state.status;
}

function terminalFlowIntentForRunStatus(
  status: RunStatus,
): "finished" | "failed" | "cancelled" {
  if (status === "COMPLETED") return "finished";
  if (status === "CANCELLED") return "cancelled";
  assertCondition(status === "FAILED", "INVALID_TRANSITION", "Run is not terminal for Managed Flow synchronization");
  return "failed";
}

function assertRunDeletionAssessmentSatisfied(
  assessment: RunDeletionAssessment,
): asserts assessment is Extract<RunDeletionAssessment, { kind: "SATISFIED" }> {
  if (assessment.kind === "SATISFIED") return;
  const messages: Record<typeof assessment.reason, string> = {
    RUN_NOT_TERMINAL: "Run must be terminal before deletion",
    RETENTION_NOT_EXPIRED: "Run has not reached its retention cutoff",
    RECONCILIATION_NOT_IDLE: "Run reconciliation must settle before retention deletion",
    ACTIVE_OR_UNCERTAIN_WORK: "Run deletion is waiting for active or uncertain work to settle",
    PENDING_EXPORT: "Run deletion is waiting for its pending export to settle",
    INCOMPLETE_DELETION_JOB: "Run deletion is waiting for an existing deletion job to settle",
    OPEN_RESIDUAL_EXECUTION_RISK:
      "Run deletion is blocked while accepted residual execution risk remains open for audit",
    FLOW_RECONCILIATION_REQUIRED: "Managed Flow reconciliation must succeed or be explicitly abandoned before deletion",
    AMBIGUOUS_FLOW_RECONCILIATION:
      "Multiple failed Managed Flow reconciliations must be resolved individually before deletion",
    STALE_FLOW_RECONCILIATION: "Managed Flow reconciliation changed after deletion confirmation",
  };
  throw new CollaborationError(assessment.errorCode, messages[assessment.reason], {
    reason: assessment.reason,
    blockerCountLowerBound: assessment.blockers.length,
    blockerWitnessCommandIds: assessment.blockers.map((blocker) => blocker.commandId),
  });
}

function parseFlowReconciliationAbandonment(value: unknown): FlowReconciliationAbandonment {
  const object = parseJsonObject(value, "command.payload.flowReconciliationAbandonment");
  assertCondition(
    object.commandStatus === "FAILED",
    "INVALID_REQUEST",
    "Flow reconciliation abandonment requires a failed command",
  );
  const flowRevision = object.flowRevision == null
    ? null
    : readInteger(object.flowRevision, "command.payload.flowReconciliationAbandonment.flowRevision");
  assertCondition(
    flowRevision == null || flowRevision >= 0,
    "INVALID_REQUEST",
    "Flow reconciliation abandonment revision is invalid",
  );
  return {
    commandId: readString(
      object.commandId,
      "command.payload.flowReconciliationAbandonment.commandId",
    ),
    commandStatus: "FAILED",
    flowId: object.flowId == null
      ? null
      : readString(object.flowId, "command.payload.flowReconciliationAbandonment.flowId"),
    flowRevision,
    diagnostic: object.diagnostic == null ? null : boundedDiagnostic(object.diagnostic),
    reason: readBoundedRequiredString(
      object.reason,
      "command.payload.flowReconciliationAbandonment.reason",
      PERSISTENCE_LIMITS.flowAbandonReasonBytes,
    ),
  };
}

function flowCancellationRequestMatches(
  observation: ReturnType<RuntimeAdapter["getManagedFlow"]>,
  expected: { controllerId: string; expectedRevision: number },
): boolean {
  return observation?.controllerId === expected.controllerId
    && observation.cancelRequestedAt != null
    && (
      observation.revision === expected.expectedRevision
      || observation.revision === expected.expectedRevision + 1
    )
    && !["succeeded", "failed", "cancelled", "lost"].includes(observation.status);
}

function parseOrigin(value: unknown): OriginRef {
  const object = parseJsonObject(value, "origin");
  const origin: OriginRef = {
    runtimeId: readBoundedRequiredString(object.runtimeId, "origin.runtimeId", PERSISTENCE_LIMITS.originRuntimeIdBytes),
    agentId: readBoundedRequiredString(object.agentId, "origin.agentId", PERSISTENCE_LIMITS.originAgentIdBytes),
    sessionKey: readBoundedRequiredString(object.sessionKey, "origin.sessionKey", PERSISTENCE_LIMITS.originSessionKeyBytes),
    sessionId: readBoundedRequiredString(object.sessionId, "origin.sessionId", PERSISTENCE_LIMITS.originSessionIdBytes),
    nativeMessageId: readBoundedRequiredString(
      object.nativeMessageId,
      "origin.nativeMessageId",
      PERSISTENCE_LIMITS.originMessageIdBytes,
    ),
  };
  const clientMessageId = readBoundedOptionalString(
    object.clientMessageId,
    "origin.clientMessageId",
    PERSISTENCE_LIMITS.originMessageIdBytes,
  );
  const channel = readBoundedOptionalString(object.channel, "origin.channel", PERSISTENCE_LIMITS.originChannelBytes);
  const accountId = readBoundedOptionalString(object.accountId, "origin.accountId", PERSISTENCE_LIMITS.originAccountIdBytes);
  const target = readBoundedOptionalString(object.target, "origin.target", PERSISTENCE_LIMITS.originTargetBytes);
  if (clientMessageId) origin.clientMessageId = clientMessageId;
  if (channel) origin.channel = channel;
  if (accountId) origin.accountId = accountId;
  if (target) origin.target = target;
  if (typeof object.threadId === "string" || typeof object.threadId === "number") {
    const threadId = typeof object.threadId === "string" ? object.threadId.trim() : object.threadId;
    assertCondition(String(threadId).length > 0, "INVALID_REQUEST", "origin.threadId must not be empty");
    assertPersistableText(String(threadId), "origin.threadId", PERSISTENCE_LIMITS.originThreadIdBytes);
    origin.threadId = threadId;
  }
  return assertOriginBounded(origin);
}

function parseAssignments(value: unknown): Record<string, string> {
  if (value == null) return {};
  const object = parseJsonObject(value, "assignments");
  assertCondition(
    Object.keys(object).length <= PERSISTENCE_LIMITS.workItemArrayItems,
    "CAPACITY_EXCEEDED",
    `assignments exceeds the ${PERSISTENCE_LIMITS.workItemArrayItems}-item limit`,
  );
  return Object.fromEntries(Object.entries(object).map(([key, agentId]) => {
    assertCondition(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key), "INVALID_REQUEST", `Invalid work item id: ${key}`);
    return [
      key,
      readBoundedRequiredString(agentId, `assignments.${key}`, PERSISTENCE_LIMITS.originAgentIdBytes),
    ];
  }));
}

function readStringArray(value: unknown, field: string): string[] {
  assertCondition(Array.isArray(value), "INVALID_REQUEST", `${field} must be an array`);
  const result = value.map((entry, index) => readString(entry, `${field}[${index}]`));
  assertBoundedStringArray(result, field, {
    maxItems: PERSISTENCE_LIMITS.workItemArrayItems,
    maxItemBytes: 64,
  });
  return result;
}

function readBoundedRequiredString(value: unknown, field: string, maxBytes: number): string {
  return assertPersistableText(readString(value, field), field, maxBytes);
}

function readBoundedOptionalString(value: unknown, field: string, maxBytes: number): string | undefined {
  const result = readOptionalString(value, field);
  return result == null ? undefined : assertPersistableText(result, field, maxBytes);
}

function parseJson<T>(value: SQLOutputValue | undefined, fallback: T): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : fallback;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nullableString(value: SQLOutputValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: SQLOutputValue | undefined): number {
  return typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : 0;
}

function normalizeDigestRow(row: Record<string, SQLOutputValue>): Record<string, string | number | null> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    typeof value === "bigint" ? Number(value) : value == null ? null : value,
  ])) as Record<string, string | number | null>;
}

function commandAuditObject(row: SqlRow): Record<string, unknown> {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    kind: String(row.kind),
    entityId: nullableString(row.entity_id),
    payloadHash: String(row.payload_hash),
    effectKey: String(row.effect_key),
    status: String(row.status),
    attempts: numberValue(row.attempts),
    failureCount: numberValue(row.failure_count),
    effectStartedAt: row.effect_started_at == null ? null : numberValue(row.effect_started_at),
    response: sanitizeStoredJsonForOutput(
      parseJson(row.response_json, null),
      "command response",
      PERSISTENCE_LIMITS.commandResponseBytes,
    ),
    lastError: typeof row.last_error === "string" ? boundedDiagnostic(row.last_error) : null,
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function deliveryAttemptAuditObject(row: SqlRow): Record<string, unknown> {
  return {
    id: String(row.id),
    deliveryId: String(row.delivery_id),
    attemptNo: numberValue(row.attempt_no),
    effectKey: String(row.effect_key),
    status: String(row.status),
    receipt: sanitizeStoredJsonForOutput(
      parseJson(row.receipt_json, null),
      "delivery receipt",
      PERSISTENCE_LIMITS.commandResponseBytes,
    ),
    lastError: typeof row.last_error === "string" ? boundedDiagnostic(row.last_error) : null,
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function exportJobObject(row: SqlRow): Record<string, unknown> {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    status: String(row.status),
    format: String(row.format),
    artifact_path: nullableString(row.artifact_path),
    digest: nullableString(row.digest),
    last_error: typeof row.last_error === "string" ? boundedDiagnostic(row.last_error) : null,
    created_at: numberValue(row.created_at),
    updated_at: numberValue(row.updated_at),
  };
}

function deletionJobObject(row: SqlRow): Record<string, unknown> {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    status: String(row.status),
    confirmation_digest: String(row.confirmation_digest),
    last_error: typeof row.last_error === "string" ? boundedDiagnostic(row.last_error) : null,
    created_at: numberValue(row.created_at),
    updated_at: numberValue(row.updated_at),
  };
}

function tombstoneObject(row: SqlRow): Record<string, unknown> {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    actor: String(row.actor),
    contentDigest: String(row.content_digest),
    deletedAt: numberValue(row.deleted_at),
    cleanupStatus: String(row.cleanup_status),
    cleanupError: typeof row.cleanup_error === "string" ? boundedDiagnostic(row.cleanup_error) : null,
    cleanupUpdatedAt: numberValue(row.cleanup_updated_at),
    deletionJobId: typeof row.deletion_job_id === "string" ? row.deletion_job_id : null,
    deletionJobStatus: typeof row.deletion_job_status === "string" ? row.deletion_job_status : null,
    flowReconciliationCommandId: nullableString(row.flow_reconciliation_command_id),
    openclawFlowId: nullableString(row.openclaw_flow_id),
    openclawFlowRevision: row.openclaw_flow_revision == null ? null : numberValue(row.openclaw_flow_revision),
    flowReconciliationDiagnostic: typeof row.flow_reconciliation_diagnostic === "string"
      ? boundedDiagnostic(row.flow_reconciliation_diagnostic)
      : null,
    flowReconciliationAbandonedAt: row.flow_reconciliation_abandoned_at == null
      ? null
      : numberValue(row.flow_reconciliation_abandoned_at),
    flowReconciliationAbandonReason: typeof row.flow_reconciliation_abandon_reason === "string"
      ? assertPersistableText(
          row.flow_reconciliation_abandon_reason,
          "Flow reconciliation abandonment reason",
          PERSISTENCE_LIMITS.flowAbandonReasonBytes,
        )
      : null,
  };
}

function planRevisionObject(row: SqlRow): Record<string, unknown> {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    revisionNo: numberValue(row.revision_no),
    digest: String(row.digest),
    sourceAttemptId: nullableString(row.source_attempt_id),
    approvedAt: row.approved_at == null ? null : numberValue(row.approved_at),
    approvedBy: typeof row.approved_by === "string"
      ? assertPersistableText(row.approved_by, "plan approval actor", PERSISTENCE_LIMITS.actorBytes)
      : null,
    createdAt: numberValue(row.created_at),
    plan: sanitizeStoredJsonForOutput(
      parseJson(row.plan_json, {}),
      "plan snapshot",
      PERSISTENCE_LIMITS.planBytes,
    ),
  };
}

function workItemObject(row: SqlRow): Record<string, unknown> {
  const title = assertPersistableText(
    String(row.title),
    "work item title",
    PERSISTENCE_LIMITS.workItemTitleBytes,
  );
  return {
    id: String(row.id),
    runId: String(row.run_id),
    planRevisionId: String(row.plan_revision_id),
    logicalId: String(row.logical_id),
    title,
    inputScope: storedStringArray(
      row.input_scope_json,
      "work item input scope",
      PERSISTENCE_LIMITS.inputScopeItemBytes,
    ),
    dependencies: storedStringArray(row.dependencies_json, "work item dependencies", 64),
    requiredCapabilities: storedStringArray(
      row.required_capabilities_json,
      "work item required capabilities",
      PERSISTENCE_LIMITS.capabilityItemBytes,
    ),
    candidateAgentIds: storedStringArray(
      row.candidate_agent_ids_json,
      "work item candidate agents",
      PERSISTENCE_LIMITS.originAgentIdBytes,
    ),
    acceptanceCriteria: storedStringArray(
      row.acceptance_criteria_json,
      "work item acceptance criteria",
      PERSISTENCE_LIMITS.acceptanceCriterionBytes,
    ),
    riskLevel: String(row.risk_level),
    sideEffectClass: String(row.side_effect_class),
    assignedAgentId: nullableString(row.assigned_agent_id),
    status: String(row.status),
    revision: numberValue(row.revision),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function attemptExecutionRuntime(row: SqlRow): AgentExecutionRuntime {
  assertCondition(
    row.execution_runtime === "native" || row.execution_runtime === "acp",
    "INVALID_RESPONSE",
    "Persisted Attempt execution runtime is invalid",
    { attemptId: typeof row.id === "string" ? row.id : null },
  );
  return row.execution_runtime;
}

function attemptTaskRuntime(row: SqlRow): "subagent" | "acp" {
  return attemptExecutionRuntime(row) === "acp" ? "acp" : "subagent";
}

function safeAttemptObject(row: SqlRow): Record<string, unknown> {
  const rawOutcome = parseJson<Record<string, unknown> | null>(row.outcome_json, null);
  let outcome: Record<string, unknown> | null = null;
  if (rawOutcome) {
    if (row.kind === "WORKER") {
      outcome = parseWorkerResult(rawOutcome) as unknown as Record<string, unknown>;
    } else if (row.kind === "PLANNER" && typeof rawOutcome.planDigest === "string") {
      outcome = { planDigest: rawOutcome.planDigest };
    } else if (row.kind === "SYNTHESIZER" && typeof rawOutcome.contentDigest === "string") {
      outcome = { contentDigest: rawOutcome.contentDigest };
    }
  }
  return {
    id: String(row.id),
    runId: String(row.run_id),
    workItemId: nullableString(row.work_item_id),
    kind: String(row.kind),
    attemptNo: numberValue(row.attempt_no),
    idempotencyKey: assertPersistableText(
      String(row.idempotency_key),
      "attempt idempotency key",
      PERSISTENCE_LIMITS.originSessionKeyBytes,
    ),
    workerAgentId: assertPersistableText(
      String(row.worker_agent_id),
      "attempt worker agent id",
      PERSISTENCE_LIMITS.originAgentIdBytes,
    ),
    executionRuntime: attemptExecutionRuntime(row),
    workerOwnerSessionKey: assertPersistableText(
      String(row.worker_owner_session_key),
      "attempt owner session key",
      PERSISTENCE_LIMITS.originSessionKeyBytes,
    ),
    workerSessionKey: assertPersistableText(
      String(row.child_session_key),
      "attempt child session key",
      PERSISTENCE_LIMITS.originSessionKeyBytes,
    ),
    agentRunId: typeof row.openclaw_run_id === "string"
      ? assertPersistableText(row.openclaw_run_id, "attempt agent run id", PERSISTENCE_LIMITS.externalReferenceBytes)
      : null,
    executionTaskId: typeof row.openclaw_task_id === "string"
      ? assertPersistableText(row.openclaw_task_id, "attempt task id", PERSISTENCE_LIMITS.externalReferenceBytes)
      : null,
    status: String(row.status),
    outcome,
    lastError: typeof row.last_error === "string" ? boundedDiagnostic(row.last_error) : null,
    revision: numberValue(row.revision),
    startedAt: row.started_at == null ? null : numberValue(row.started_at),
    endedAt: row.ended_at == null ? null : numberValue(row.ended_at),
    lastReconciledAt: row.last_reconciled_at == null ? null : numberValue(row.last_reconciled_at),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function evidenceObject(row: SqlRow): Record<string, unknown> {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    workItemId: nullableString(row.work_item_id),
    attemptId: String(row.attempt_id),
    type: assertPersistableText(String(row.type), "evidence type", PERSISTENCE_LIMITS.evidenceTypeBytes),
    title: assertPersistableText(String(row.title), "evidence title", PERSISTENCE_LIMITS.evidenceTitleBytes),
    reference: assertPersistableText(
      String(row.reference),
      "evidence reference",
      PERSISTENCE_LIMITS.evidenceReferenceBytes,
    ),
    verification: assertPersistableText(
      String(row.verification),
      "evidence verification",
      PERSISTENCE_LIMITS.evidenceVerificationBytes,
    ),
    warning: typeof row.warning === "string"
      ? assertPersistableText(row.warning, "evidence warning", PERSISTENCE_LIMITS.evidenceWarningBytes)
      : null,
    digest: String(row.digest),
    createdAt: numberValue(row.created_at),
  };
}

function evidenceReportObject(row: SqlRow): Record<string, unknown> {
  return {
    type: assertPersistableText(String(row.type), "evidence type", PERSISTENCE_LIMITS.evidenceTypeBytes),
    title: assertPersistableText(String(row.title), "evidence title", PERSISTENCE_LIMITS.evidenceTitleBytes),
    reference: assertPersistableText(
      String(row.reference),
      "evidence reference",
      PERSISTENCE_LIMITS.evidenceReferenceBytes,
    ),
    verification: assertPersistableText(
      String(row.verification),
      "evidence verification",
      PERSISTENCE_LIMITS.evidenceVerificationBytes,
    ),
    ...(typeof row.warning === "string"
      ? { warning: assertPersistableText(row.warning, "evidence warning", PERSISTENCE_LIMITS.evidenceWarningBytes) }
      : {}),
  };
}

function interventionObject(row: SqlRow): Record<string, unknown> {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    code: String(row.code),
    entityType: nullableString(row.entity_type),
    entityId: nullableString(row.entity_id),
    requiredAction: assertPersistableText(
      String(row.required_action),
      "intervention required action",
      PERSISTENCE_LIMITS.handoffNoteBytes,
    ),
    diagnostics: sanitizeStoredJsonForOutput(
      parseJson(row.diagnostics_json, {}),
      "intervention diagnostics",
      PERSISTENCE_LIMITS.interventionDiagnosticsBytes,
    ),
    resumeStatus: String(row.resume_status),
    createdAt: numberValue(row.created_at),
    resolvedAt: row.resolved_at == null ? null : numberValue(row.resolved_at),
    resolvedBy: typeof row.resolved_by === "string"
      ? assertPersistableText(row.resolved_by, "intervention resolver", PERSISTENCE_LIMITS.actorBytes)
      : null,
    resolution: sanitizeStoredJsonForOutput(
      parseJson(row.resolution_json, null),
      "intervention resolution",
      PERSISTENCE_LIMITS.interventionDiagnosticsBytes,
    ),
  };
}

function deliveryObject(row: SqlRow): Record<string, unknown> {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    finalArtifactId: String(row.final_artifact_id),
    targetRevision: numberValue(row.target_revision),
    requirement: String(row.requirement),
    status: String(row.status),
    transcriptStatus: String(row.transcript_status),
    channelStatus: String(row.channel_status),
    target: parseOrigin(parseJson(row.target_json, {})),
    messageId: typeof row.message_id === "string"
      ? assertPersistableText(row.message_id, "delivery message id", PERSISTENCE_LIMITS.externalReferenceBytes)
      : null,
    revision: numberValue(row.revision),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  };
}

function decisionObject(row: SqlRow): Record<string, unknown> {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    commandId: String(row.command_id),
    actor: assertPersistableText(String(row.actor), "decision actor", PERSISTENCE_LIMITS.actorBytes),
    decisionType: String(row.decision_type),
    payload: sanitizeStoredJsonForOutput(
      parseJson(row.payload_json, {}),
      "decision payload",
      PERSISTENCE_LIMITS.eventPayloadBytes,
    ),
    createdAt: numberValue(row.created_at),
  };
}

function finalArtifactObject(row: SqlRow): Record<string, unknown> {
  const content = assertPersistableText(String(row.content), "final artifact", PERSISTENCE_LIMITS.finalArtifactBytes);
  return {
    id: String(row.id),
    runId: String(row.run_id),
    sourceAttemptId: String(row.source_attempt_id),
    content,
    digest: String(row.digest),
    createdAt: numberValue(row.created_at),
  };
}

function parseRunListCursor(
  value: unknown,
  filters: { activeOnly: boolean; includeArchived: boolean },
): RunListCursor | undefined {
  if (value === undefined) return undefined;
  assertCondition(typeof value === "string", "INVALID_REQUEST", "cursor must be an opaque string");
  assertCondition(
    value.length > 0 && Buffer.byteLength(value, "utf8") <= RUN_LIST_CURSOR_MAX_BYTES,
    "INVALID_REQUEST",
    "cursor is invalid",
  );
  assertCondition(/^[A-Za-z0-9_-]+$/.test(value), "INVALID_REQUEST", "cursor is invalid");

  let decoded: Buffer;
  let parsed: unknown;
  try {
    decoded = Buffer.from(value, "base64url");
    assertCondition(decoded.length > 0 && decoded.length <= RUN_LIST_CURSOR_MAX_BYTES, "INVALID_REQUEST", "cursor is invalid");
    assertCondition(decoded.toString("base64url") === value, "INVALID_REQUEST", "cursor is invalid");
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch (error) {
    if (error instanceof CollaborationError) throw error;
    throw new CollaborationError("INVALID_REQUEST", "cursor is invalid");
  }

  assertCondition(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), "INVALID_REQUEST", "cursor is invalid");
  const record = parsed as Record<string, unknown>;
  assertCondition(
    stableStringify(Object.keys(record).sort())
      === stableStringify([
        "activeOnly",
        "createdAt",
        "id",
        "includeArchived",
        "snapshotCreatedAt",
        "snapshotId",
        "version",
      ]),
    "INVALID_REQUEST",
    "cursor is invalid",
  );
  assertCondition(record.version === RUN_LIST_CURSOR_VERSION, "INVALID_REQUEST", "cursor version is unsupported");
  assertCondition(
    typeof record.createdAt === "number" && Number.isSafeInteger(record.createdAt) && record.createdAt >= 0,
    "INVALID_REQUEST",
    "cursor is invalid",
  );
  assertCondition(
    typeof record.snapshotCreatedAt === "number"
      && Number.isSafeInteger(record.snapshotCreatedAt)
      && record.snapshotCreatedAt >= 0,
    "INVALID_REQUEST",
    "cursor is invalid",
  );
  assertCondition(
    typeof record.id === "string"
      && record.id.length > 0
      && record.id.trim() === record.id
      && record.id.length <= RUN_LIST_CURSOR_ID_MAX_LENGTH,
    "INVALID_REQUEST",
    "cursor is invalid",
  );
  assertCondition(
    typeof record.snapshotId === "string"
      && record.snapshotId.length > 0
      && record.snapshotId.trim() === record.snapshotId
      && record.snapshotId.length <= RUN_LIST_CURSOR_ID_MAX_LENGTH,
    "INVALID_REQUEST",
    "cursor is invalid",
  );
  assertCondition(
    typeof record.activeOnly === "boolean" && typeof record.includeArchived === "boolean",
    "INVALID_REQUEST",
    "cursor is invalid",
  );
  assertCondition(
    record.activeOnly === filters.activeOnly && record.includeArchived === filters.includeArchived,
    "INVALID_REQUEST",
    "cursor does not match the requested filters",
  );
  assertCondition(
    record.createdAt < record.snapshotCreatedAt
      || (record.createdAt === record.snapshotCreatedAt && record.id <= record.snapshotId),
    "INVALID_REQUEST",
    "cursor is outside its snapshot boundary",
  );
  const cursor = {
    createdAt: record.createdAt,
    id: record.id,
    snapshotCreatedAt: record.snapshotCreatedAt,
    snapshotId: record.snapshotId,
  };
  assertCondition(encodeRunListCursor(cursor, filters) === value, "INVALID_REQUEST", "cursor is invalid");
  return cursor;
}

function encodeRunListCursor(
  cursor: RunListCursor,
  filters: { activeOnly: boolean; includeArchived: boolean },
): string {
  return Buffer.from(stableStringify({
    version: RUN_LIST_CURSOR_VERSION,
    createdAt: cursor.createdAt,
    id: cursor.id,
    snapshotCreatedAt: cursor.snapshotCreatedAt,
    snapshotId: cursor.snapshotId,
    activeOnly: filters.activeOnly,
    includeArchived: filters.includeArchived,
  }), "utf8").toString("base64url");
}

function storedStringArray(value: SQLOutputValue | undefined, field: string, maxItemBytes: number): string[] {
  const parsed = parseJson<unknown>(value, []);
  assertCondition(Array.isArray(parsed), "INVALID_REQUEST", `${field} must be an array`);
  const strings = parsed.map((entry, index) => {
    assertCondition(typeof entry === "string", "INVALID_REQUEST", `${field}[${index}] must be a string`);
    return entry;
  });
  assertBoundedStringArray(strings, field, {
    maxItems: PERSISTENCE_LIMITS.workItemArrayItems,
    maxItemBytes,
  });
  assertBoundedJson(strings, field, PERSISTENCE_LIMITS.planBytes);
  return strings;
}
