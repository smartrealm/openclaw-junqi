import type { SQLOutputValue } from "node:sqlite";
import type { CollaborationDatabase } from "./database.js";
import { CollaborationError } from "./errors.js";
import {
  SettlementSpecification,
  type SynthesisReadiness,
} from "./settlement-specification.js";

export type CurrentPlanSqlRow = Record<string, SQLOutputValue>;

export interface CurrentPlanScope {
  readonly runId: string;
  readonly planRevisionId: string;
}

export const CURRENT_PLAN_ACTIVE_ATTEMPT_STATUSES = [
  "CREATED",
  "DISPATCHING",
  "RUNNING",
  "CANCELLING",
  "UNKNOWN",
] as const;

const ACTIVE_ATTEMPT_PLACEHOLDERS = CURRENT_PLAN_ACTIVE_ATTEMPT_STATUSES.map(() => "?").join(",");

/**
 * Aggregate repository for mutable runtime state owned by a Run's current PlanRevision.
 *
 * Audit and export paths intentionally remain outside this repository because they must
 * retain every revision. Runtime orchestration must enter through this boundary so a
 * historical WorkItem can never be selected by a logical id shared with a newer plan.
 */
export class CurrentPlanScopeRepository {
  constructor(
    private readonly database: CollaborationDatabase,
    private readonly settlementSpecification = new SettlementSpecification(),
  ) {}

  resolve(runId: string): CurrentPlanScope | null {
    const row = this.database.db
      .prepare(
        `SELECT id AS run_id, current_plan_revision_id AS plan_revision_id
         FROM collaboration_runs
         WHERE id = ? AND current_plan_revision_id IS NOT NULL`,
      )
      .get(runId) as CurrentPlanSqlRow | undefined;
    return row
      ? { runId: String(row.run_id), planRevisionId: String(row.plan_revision_id) }
      : null;
  }

  require(runId: string): CurrentPlanScope {
    const scope = this.resolve(runId);
    if (!scope) throw new CollaborationError("NOT_FOUND", "Current plan was not found", { runId });
    return scope;
  }

  assertWorkItemCurrent(runId: string, workItem: CurrentPlanSqlRow): void {
    const workItemId = String(workItem.id);
    const planRevisionId = String(workItem.plan_revision_id);
    const current = this.database.db
      .prepare(
        `SELECT 1
         FROM collaboration_runs r
         JOIN work_items w
           ON w.run_id = r.id
          AND w.plan_revision_id = r.current_plan_revision_id
         WHERE r.id = ? AND w.id = ? AND w.plan_revision_id = ?`,
      )
      .get(runId, workItemId, planRevisionId);
    if (!current) {
      throw new CollaborationError(
        "REVISION_CONFLICT",
        "Work item belongs to a historical plan revision",
        { runId, workItemId, planRevisionId },
      );
    }
  }

  isWorkItemCurrent(runId: string, workItemId: string, planRevisionId: string): boolean {
    return Boolean(this.database.db
      .prepare(
        `SELECT 1
         FROM collaboration_runs r
         JOIN work_items w
           ON w.run_id = r.id
          AND w.plan_revision_id = r.current_plan_revision_id
         WHERE r.id = ? AND w.id = ? AND w.plan_revision_id = ?`,
      )
      .get(runId, workItemId, planRevisionId));
  }

  listWorkItems(runId: string): CurrentPlanSqlRow[] {
    return this.database.db
      .prepare(
        `SELECT w.*
         FROM collaboration_runs r
         JOIN work_items w
           ON w.run_id = r.id
          AND w.plan_revision_id = r.current_plan_revision_id
         WHERE r.id = ?
         ORDER BY w.created_at ASC, w.id ASC`,
      )
      .all(runId) as CurrentPlanSqlRow[];
  }

  listReadyWorkItems(runId: string, limit: number): CurrentPlanSqlRow[] {
    return this.database.db
      .prepare(
        `SELECT w.*
         FROM collaboration_runs r
         JOIN work_items w
           ON w.run_id = r.id
          AND w.plan_revision_id = r.current_plan_revision_id
         WHERE r.id = ? AND w.status = 'READY'
         ORDER BY w.created_at ASC, w.id ASC
         LIMIT ?`,
      )
      .all(runId, limit) as CurrentPlanSqlRow[];
  }

  listActiveWorkerAttempts(runId: string): CurrentPlanSqlRow[] {
    return this.database.db
      .prepare(
        `SELECT a.*
         FROM collaboration_runs r
         JOIN work_items w
           ON w.run_id = r.id
          AND w.plan_revision_id = r.current_plan_revision_id
         JOIN attempts a ON a.work_item_id = w.id AND a.run_id = r.id
         WHERE r.id = ? AND a.kind = 'WORKER'
           AND a.status IN (${ACTIVE_ATTEMPT_PLACEHOLDERS})
         ORDER BY a.created_at ASC, a.id ASC`,
      )
      .all(runId, ...CURRENT_PLAN_ACTIVE_ATTEMPT_STATUSES) as CurrentPlanSqlRow[];
  }

  listActiveAttempts(runId: string): CurrentPlanSqlRow[] {
    this.require(runId);
    return this.database.db
      .prepare(
        `SELECT DISTINCT a.*
         FROM collaboration_runs r
         JOIN attempts a ON a.run_id = r.id
         LEFT JOIN work_items w ON w.id = a.work_item_id AND w.run_id = r.id
         WHERE r.id = ?
           AND r.current_plan_revision_id IS NOT NULL
           AND a.status IN (${ACTIVE_ATTEMPT_PLACEHOLDERS})
           AND (
             w.plan_revision_id = r.current_plan_revision_id
             OR (
               a.kind = 'SYNTHESIZER'
               AND json_extract(a.input_json, '$.planRevisionId') = r.current_plan_revision_id
             )
           )
         ORDER BY a.created_at ASC, a.id ASC`,
      )
      .all(runId, ...CURRENT_PLAN_ACTIVE_ATTEMPT_STATUSES) as CurrentPlanSqlRow[];
  }

  synthesisReadiness(
    runId: string,
    projectedWaiverLogicalIds: readonly string[] = [],
  ): SynthesisReadiness {
    this.require(runId);
    return this.settlementSpecification.evaluateSynthesisReadiness({
      workItems: this.listWorkItems(runId).map((item) => ({
        id: String(item.id),
        logicalId: String(item.logical_id),
        status: String(item.status),
      })),
      activeAttempts: this.listActiveAttempts(runId).map((attempt) => ({
        id: String(attempt.id),
        status: String(attempt.status),
      })),
      projectedWaiverLogicalIds,
    });
  }

  assertSynthesisReady(runId: string): void {
    this.settlementSpecification.assertSynthesisReady(this.synthesisReadiness(runId));
  }

  allRequiredItemsSettled(runId: string): boolean {
    this.require(runId);
    const row = this.database.db
      .prepare(
        `SELECT COUNT(*) AS value
         FROM collaboration_runs r
         JOIN work_items w
           ON w.run_id = r.id
          AND w.plan_revision_id = r.current_plan_revision_id
         WHERE r.id = ? AND w.status NOT IN ('SUCCEEDED', 'WAIVED')`,
      )
      .get(runId) as CurrentPlanSqlRow;
    return Number(row.value) === 0;
  }

  listSynthesisEvidence(runId: string): CurrentPlanSqlRow[] {
    return this.database.db
      .prepare(
        `SELECT e.type, e.title, e.reference, e.verification, e.warning
         FROM collaboration_runs r
         JOIN work_items w
           ON w.run_id = r.id
          AND w.plan_revision_id = r.current_plan_revision_id
         JOIN evidence e ON e.work_item_id = w.id AND e.run_id = r.id
         WHERE r.id = ?
         ORDER BY e.created_at ASC, e.id ASC`,
      )
      .all(runId) as CurrentPlanSqlRow[];
  }

  listUpstreamEvidence(runId: string, item: CurrentPlanSqlRow, logicalIds: readonly string[]): CurrentPlanSqlRow[] {
    if (logicalIds.length === 0) return [];
    this.assertWorkItemCurrent(runId, item);
    const placeholders = logicalIds.map(() => "?").join(",");
    return this.database.db
      .prepare(
        `SELECT e.type, e.title, e.reference, e.verification, e.warning
         FROM collaboration_runs r
         JOIN work_items w
           ON w.run_id = r.id
          AND w.plan_revision_id = r.current_plan_revision_id
         JOIN evidence e ON e.work_item_id = w.id AND e.run_id = r.id
         WHERE r.id = ? AND w.logical_id IN (${placeholders})
         ORDER BY e.created_at ASC, e.id ASC`,
      )
      .all(runId, ...logicalIds) as CurrentPlanSqlRow[];
  }

  listActiveAttemptsForLogicalIds(runId: string, logicalIds: readonly string[]): CurrentPlanSqlRow[] {
    if (logicalIds.length === 0) return [];
    const placeholders = logicalIds.map(() => "?").join(",");
    return this.database.db
      .prepare(
        `SELECT a.*
         FROM collaboration_runs r
         JOIN work_items w
           ON w.run_id = r.id
          AND w.plan_revision_id = r.current_plan_revision_id
         JOIN attempts a ON a.work_item_id = w.id AND a.run_id = r.id
         WHERE r.id = ? AND w.logical_id IN (${placeholders})
           AND a.status IN (${ACTIVE_ATTEMPT_PLACEHOLDERS})
         ORDER BY a.created_at ASC, a.id ASC`,
      )
      .all(runId, ...logicalIds, ...CURRENT_PLAN_ACTIVE_ATTEMPT_STATUSES) as CurrentPlanSqlRow[];
  }

  hasActiveAttemptsForLogicalIds(runId: string, logicalIds: readonly string[]): boolean {
    return this.listActiveAttemptsForLogicalIds(runId, logicalIds).length > 0;
  }

  waiveItemsByLogicalIds(runId: string, logicalIds: readonly string[], timestamp: number): number {
    if (logicalIds.length === 0) return 0;
    const placeholders = logicalIds.map(() => "?").join(",");
    const changed = this.database.db
      .prepare(
        `UPDATE work_items
         SET status = 'WAIVED', revision = revision + 1, updated_at = ?
         WHERE run_id = ?
           AND plan_revision_id = (
             SELECT current_plan_revision_id FROM collaboration_runs WHERE id = ?
           )
           AND logical_id IN (${placeholders})
           AND status NOT IN ('SUCCEEDED', 'WAIVED')`,
      )
      .run(timestamp, runId, runId, ...logicalIds);
    return Number(changed.changes);
  }
}
