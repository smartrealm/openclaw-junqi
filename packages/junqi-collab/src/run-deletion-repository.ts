import type { SQLOutputValue } from "node:sqlite";
import { CollaborationDatabase } from "./database.js";
import { CollaborationError } from "./errors.js";
import { boundedDiagnostic } from "./persistence-policy.js";
import type {
  FlowReconciliationBlocker,
  RunDeletionSnapshot,
} from "./run-deletion-policy.js";
import { RUN_STATUSES, type ReconcileState, type RunStatus } from "./types.js";

type SqlRow = Record<string, SQLOutputValue>;

const RUN_STATUS_SET = new Set<string>(RUN_STATUSES);
const RECONCILE_STATE_SET = new Set<string>(["IDLE", "RUNNING", "ATTENTION_REQUIRED"]);

export interface RetentionCandidate {
  readonly runId: string;
  readonly endedAt: number;
}

export interface RetentionCandidateQuery {
  readonly cutoff: number;
  readonly cursorEndedAt: number;
  readonly cursorRunId: string;
  readonly limit: number;
}

/**
 * Query boundary for deletion and retention. Candidate selection is only a
 * bounded scan optimization; RunDeletionPolicy is re-evaluated from a fresh
 * snapshot inside the authoritative deletion transaction.
 */
export class RunDeletionRepository {
  constructor(private readonly database: CollaborationDatabase) {}

  listRetentionCandidates(query: RetentionCandidateQuery): RetentionCandidate[] {
    const rows = this.database.db
      .prepare(
        `SELECT r.id, r.ended_at
         FROM collaboration_runs r INDEXED BY collaboration_runs_retention
         WHERE r.status IN ('COMPLETED', 'CANCELLED', 'FAILED')
           AND r.ended_at IS NOT NULL AND r.ended_at < ?
           AND (r.ended_at > ? OR (r.ended_at = ? AND r.id > ?))
         ORDER BY r.ended_at ASC, r.id ASC
         LIMIT ?`,
      )
      .all(
        query.cutoff,
        query.cursorEndedAt,
        query.cursorEndedAt,
        query.cursorRunId,
        query.limit,
      ) as SqlRow[];
    return rows.map((row) => ({
      runId: requiredString(row.id, "collaboration_runs.id"),
      endedAt: requiredInteger(row.ended_at, "collaboration_runs.ended_at", 0),
    }));
  }

  readSnapshot(runId: string, currentDeleteCommandId: string | null = null): RunDeletionSnapshot {
    return this.database.readTransaction(() => {
      const row = this.database.db
        .prepare(
          `SELECT r.status, r.reconcile_state, r.ended_at,
                  EXISTS (
                    SELECT 1 FROM attempts a
                    WHERE a.run_id = r.id
                      AND a.status IN ('CREATED', 'DISPATCHING', 'RUNNING', 'CANCELLING', 'UNKNOWN')
                  ) AS has_active_attempt,
                  EXISTS (
                    SELECT 1 FROM commands c
                    WHERE c.run_id = r.id
                      AND (? IS NULL OR c.id <> ? OR c.kind <> 'DELETE')
                      AND c.status IN ('PENDING', 'LEASED', 'UNKNOWN')
                  ) AS has_other_active_or_uncertain_command,
                  EXISTS (
                    SELECT 1 FROM export_jobs e
                    WHERE e.run_id = r.id AND e.status = 'PENDING'
                  ) AS has_pending_export,
                  EXISTS (
                    SELECT 1 FROM deletion_jobs d
                    WHERE d.run_id = r.id AND d.status <> 'COMPLETED'
                  ) AS has_incomplete_deletion_job,
                  EXISTS (
                    SELECT 1 FROM interventions i
                    WHERE i.run_id = r.id
                      AND i.code = 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK'
                      AND i.resolved_at IS NULL
                  ) AS has_open_residual_execution_risk
           FROM collaboration_runs r
           WHERE r.id = ?`,
        )
        .get(currentDeleteCommandId, currentDeleteCommandId, runId) as SqlRow | undefined;
      if (!row) throw new CollaborationError("NOT_FOUND", `Collaboration run ${runId} was not found`);

      // Two rows are sufficient and intentionally bounded: the policy needs
      // to distinguish zero, one, and more than one unresolved command.
      const flowRows = this.database.db
        .prepare(
          `SELECT c.id AS command_id, c.last_error,
                  r.openclaw_flow_id, r.openclaw_flow_revision
           FROM commands c
           JOIN collaboration_runs r ON r.id = c.run_id
           WHERE c.run_id = ? AND c.status = 'FAILED'
             AND c.kind IN ('PROVISION', 'FLOW_SYNC')
           ORDER BY CASE c.kind WHEN 'FLOW_SYNC' THEN 0 ELSE 1 END,
                    c.created_at DESC, c.id DESC
           LIMIT 2`,
        )
        .all(runId) as SqlRow[];
      const failedFlowReconciliations = flowRows.map(flowBlockerFromRow);
      return Object.freeze({
        runId,
        status: runStatus(row.status),
        reconcileState: reconcileState(row.reconcile_state),
        endedAt: nullableInteger(row.ended_at, "collaboration_runs.ended_at", 0),
        hasActiveAttempt: booleanValue(row.has_active_attempt, "has_active_attempt"),
        hasOtherActiveOrUncertainCommand: booleanValue(
          row.has_other_active_or_uncertain_command,
          "has_other_active_or_uncertain_command",
        ),
        hasPendingExport: booleanValue(row.has_pending_export, "has_pending_export"),
        hasIncompleteDeletionJob: booleanValue(
          row.has_incomplete_deletion_job,
          "has_incomplete_deletion_job",
        ),
        hasOpenResidualExecutionRisk: booleanValue(
          row.has_open_residual_execution_risk,
          "has_open_residual_execution_risk",
        ),
        failedFlowReconciliations: Object.freeze(failedFlowReconciliations),
      });
    });
  }
}

function flowBlockerFromRow(row: SqlRow): FlowReconciliationBlocker {
  return Object.freeze({
    commandId: requiredString(row.command_id, "commands.id"),
    commandStatus: "FAILED",
    flowId: nullableString(row.openclaw_flow_id, "collaboration_runs.openclaw_flow_id"),
    flowRevision: nullableInteger(
      row.openclaw_flow_revision,
      "collaboration_runs.openclaw_flow_revision",
      0,
    ),
    diagnostic: nullableDiagnostic(row.last_error),
  });
}

function runStatus(value: SQLOutputValue | undefined): RunStatus {
  const status = requiredString(value, "collaboration_runs.status");
  if (!RUN_STATUS_SET.has(status)) throw invalidPersistedFact("collaboration_runs.status");
  return status as RunStatus;
}

function reconcileState(value: SQLOutputValue | undefined): ReconcileState {
  const state = requiredString(value, "collaboration_runs.reconcile_state");
  if (!RECONCILE_STATE_SET.has(state)) throw invalidPersistedFact("collaboration_runs.reconcile_state");
  return state as ReconcileState;
}

function requiredString(value: SQLOutputValue | undefined, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw invalidPersistedFact(field);
  return value;
}

function nullableString(value: SQLOutputValue | undefined, field: string): string | null {
  return value == null ? null : requiredString(value, field);
}

function nullableDiagnostic(value: SQLOutputValue | undefined): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw invalidPersistedFact("commands.last_error");
  return boundedDiagnostic(value);
}

function nullableInteger(
  value: SQLOutputValue | undefined,
  field: string,
  minimum: number,
): number | null {
  return value == null ? null : requiredInteger(value, field, minimum);
}

function requiredInteger(
  value: SQLOutputValue | undefined,
  field: string,
  minimum: number,
): number {
  const result = typeof value === "bigint"
    ? Number(value)
    : typeof value === "number"
      ? value
      : Number.NaN;
  if (!Number.isSafeInteger(result) || result < minimum) throw invalidPersistedFact(field);
  return result;
}

function booleanValue(value: SQLOutputValue | undefined, field: string): boolean {
  const result = requiredInteger(value, field, 0);
  if (result !== 0 && result !== 1) throw invalidPersistedFact(field);
  return result === 1;
}

function invalidPersistedFact(field: string): CollaborationError {
  return new CollaborationError("INVALID_RESPONSE", `Persisted deletion fact ${field} is invalid`, { field });
}
