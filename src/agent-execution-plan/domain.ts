export const OPENCLAW_UPDATE_PLAN_TOOL = 'update_plan';
export const EXECUTION_PLAN_MAX_STEPS = 100;
export const EXECUTION_PLAN_STEP_TITLE_MAX_LENGTH = 240;
export const EXECUTION_PLAN_EXPLANATION_MAX_LENGTH = 600;

export type OpenClawPlanStepStatus = 'pending' | 'in_progress' | 'completed';
export type ExecutionPlanStepState = 'pending' | 'running' | 'completed';
export type ExecutionPlanState = 'pending' | 'running' | 'completed';

export interface ExecutionPlanSnapshotStep {
  title: string;
  status: OpenClawPlanStepStatus;
}

export interface ExecutionPlanSnapshot {
  sourceId: string;
  sessionKey: string;
  runId: string | null;
  sourceSequence?: number;
  timestamp: string;
  explanation?: string;
  steps: ExecutionPlanSnapshotStep[];
}

export interface ExecutionPlanStep {
  id: string;
  title: string;
  state: ExecutionPlanStepState;
  order: number;
}

export interface AgentExecutionPlan {
  id: string;
  sessionKey: string;
  runId: string | null;
  revision: number;
  state: ExecutionPlanState;
  steps: ExecutionPlanStep[];
  currentStepIndex: number;
  explanation?: string;
  previousStepCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface SnapshotContext {
  sourceId: string;
  sessionKey: string;
  runId?: string | null;
  sourceSequence?: number;
  timestamp: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function isOpenClawPlanStatus(value: unknown): value is OpenClawPlanStepStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed';
}

export function parseOpenClawUpdatePlan(
  toolName: unknown,
  input: unknown,
  context: SnapshotContext,
): ExecutionPlanSnapshot | null {
  if (toolName !== OPENCLAW_UPDATE_PLAN_TOOL || !isRecord(input)) return null;
  if (!Array.isArray(input.plan) || input.plan.length === 0 || input.plan.length > EXECUTION_PLAN_MAX_STEPS) {
    return null;
  }

  const steps: ExecutionPlanSnapshotStep[] = [];
  let runningCount = 0;
  for (const rawStep of input.plan) {
    if (!isRecord(rawStep)) return null;
    const title = normalizeText(rawStep.step, EXECUTION_PLAN_STEP_TITLE_MAX_LENGTH);
    if (!title || !isOpenClawPlanStatus(rawStep.status)) return null;
    if (rawStep.status === 'in_progress') runningCount += 1;
    steps.push({ title, status: rawStep.status });
  }
  if (runningCount > 1) return null;

  const explanation = normalizeText(input.explanation, EXECUTION_PLAN_EXPLANATION_MAX_LENGTH);
  return {
    sourceId: context.sourceId,
    sessionKey: context.sessionKey,
    runId: context.runId?.trim() || null,
    ...(Number.isSafeInteger(context.sourceSequence) && Number(context.sourceSequence) >= 0
      ? { sourceSequence: Number(context.sourceSequence) }
      : {}),
    timestamp: context.timestamp,
    ...(explanation ? { explanation } : {}),
    steps,
  };
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function stepState(status: OpenClawPlanStepStatus): ExecutionPlanStepState {
  return status === 'in_progress' ? 'running' : status;
}

function snapshotFingerprint(snapshot: ExecutionPlanSnapshot): string {
  return JSON.stringify({
    explanation: snapshot.explanation ?? '',
    steps: snapshot.steps,
  });
}

function projectSteps(snapshot: ExecutionPlanSnapshot): ExecutionPlanStep[] {
  const titleOccurrences = new Map<string, number>();
  return snapshot.steps.map((step, order) => {
    const identityTitle = step.title.toLowerCase();
    const occurrence = titleOccurrences.get(identityTitle) ?? 0;
    titleOccurrences.set(identityTitle, occurrence + 1);
    return {
      id: `step-${stableHash(`${identityTitle}\u0000${occurrence}`)}`,
      title: step.title,
      state: stepState(step.status),
      order,
    };
  });
}

function currentStepIndex(steps: readonly ExecutionPlanStep[]): number {
  const running = steps.findIndex((step) => step.state === 'running');
  if (running >= 0) return running;
  const pending = steps.findIndex((step) => step.state === 'pending');
  if (pending >= 0) return pending;
  return Math.max(steps.length - 1, 0);
}

function planState(steps: readonly ExecutionPlanStep[]): ExecutionPlanState {
  if (steps.every((step) => step.state === 'completed')) return 'completed';
  if (steps.some((step) => step.state === 'running')) return 'running';
  return 'pending';
}

export function reconcileExecutionPlanSnapshots(
  snapshots: readonly ExecutionPlanSnapshot[],
): AgentExecutionPlan | null {
  if (snapshots.length === 0) return null;
  const accepted: ExecutionPlanSnapshot[] = [];
  const seenSources = new Set<string>();
  let lastFingerprint = '';

  for (const snapshot of snapshots) {
    if (seenSources.has(snapshot.sourceId)) continue;
    seenSources.add(snapshot.sourceId);
    const fingerprint = snapshotFingerprint(snapshot);
    if (fingerprint === lastFingerprint) continue;
    accepted.push(snapshot);
    lastFingerprint = fingerprint;
  }
  if (accepted.length === 0) return null;

  const latest = accepted[accepted.length - 1];
  const previous = accepted[accepted.length - 2];
  const steps = projectSteps(latest);
  const authorityId = latest.runId || accepted[0].sourceId;
  return {
    id: `plan-${stableHash(`${latest.sessionKey}\u0000${authorityId}`)}`,
    sessionKey: latest.sessionKey,
    runId: latest.runId,
    revision: accepted.length,
    state: planState(steps),
    steps,
    currentStepIndex: currentStepIndex(steps),
    ...(latest.explanation ? { explanation: latest.explanation } : {}),
    ...(previous && previous.steps.length !== latest.steps.length
      ? { previousStepCount: previous.steps.length }
      : {}),
    createdAt: accepted[0].timestamp,
    updatedAt: latest.timestamp,
  };
}
