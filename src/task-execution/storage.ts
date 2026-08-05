import { invoke } from '@tauri-apps/api/core';
import { emptyTaskExecutionSnapshot } from './stateMachine';
import type { TaskExecutionSnapshot } from './types';

const PARTITION_ID = 'task-execution-v1';

interface NativeLoadResult {
  found: boolean;
  generation: number;
  payload: unknown | null;
}

interface NativeSaveResult {
  generation: number;
}

const RUN_STATUSES = new Set(['pending', 'running', 'cancel_requested', 'succeeded', 'cancelled', 'failed', 'verification_required']);
const NODE_STATUSES = new Set(['pending', 'running', 'succeeded', 'cancel_requested', 'cancelled', 'rolled_back', 'verification_required', 'failed', 'blocked']);
const NODE_KINDS = new Set(['user_turn', 'model_turn', 'tool_invocation', 'tool_reconciliation']);
const SOURCES = new Set(['chat', 'quick_chat']);
const TERMINAL_REASONS = new Set(['final', 'aborted', 'error']);
const EDGE_KINDS = new Set(['observed_after', 'supersedes']);
const EDGE_EVIDENCE = new Set(['junqi_intent', 'openclaw_event']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** 将旧语音发送来源迁移为普通聊天来源，迁移后不再保留独立 Jarvis 任务语义。 */
export function migrateLegacyTaskExecutionSnapshot(value: unknown): unknown {
  const root = record(value);
  if (!root || root.version !== 1 || !Array.isArray(root.tasks)) return value;
  let changed = false;
  const tasks = root.tasks.map((candidate) => {
    const task = record(candidate);
    if (!task || !Array.isArray(task.runs)) return candidate;
    const taskRuns = task.runs;
    const runs = taskRuns.map((runCandidate) => {
      const run = record(runCandidate);
      if (!run || run.source !== 'jarvis') return runCandidate;
      changed = true;
      return { ...run, source: 'chat' };
    });
    return runs.some((run, index) => run !== taskRuns[index])
      ? { ...task, runs }
      : candidate;
  });
  return changed ? { ...root, tasks } : value;
}

function boundedText(value: unknown, max = 512): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function internalIdentifier(value: unknown, max = 1_024): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && !/[\u0001-\u001f\u007f]/.test(value);
}

function nullableText(value: unknown, max = 512): boolean {
  return value === undefined || value === null || boundedText(value, max);
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isTaskExecutionSnapshot(value: unknown): value is TaskExecutionSnapshot {
  const root = record(value);
  if (!root || root.version !== 1 || !Array.isArray(root.tasks) || root.tasks.length > 200) return false;
  return root.tasks.every((candidate) => {
    const task = record(candidate);
    if (!task || task.version !== 1 || !internalIdentifier(task.taskId) || !timestamp(task.revision) || !timestamp(task.updatedAt)) return false;
    const binding = record(task.binding);
    if (
      !binding
      || !boundedText(binding.targetFingerprint)
      || !nullableText(binding.runtimeId)
      || !boundedText(binding.sessionKey)
      || !nullableText(binding.sessionId)
      || !Array.isArray(task.runs)
      || task.runs.length > 200
      || !Array.isArray(task.nodes)
      || task.nodes.length > 1_000
      || !(task.edges === undefined || Array.isArray(task.edges))
      || (Array.isArray(task.edges) && task.edges.length > 2_000)
    ) return false;
    const legacyTaskId = `${binding.targetFingerprint}\u0000${binding.sessionKey}`;
    const sessionTaskId = binding.sessionId ? `${legacyTaskId}\u0000${binding.sessionId}` : legacyTaskId;
    if (task.taskId !== legacyTaskId && task.taskId !== sessionTaskId) return false;
    const runIds = new Set<string>();
    if (!task.runs.every((candidate) => {
      const run = record(candidate);
      if (
        !run
        || !boundedText(run.runId)
        || runIds.has(run.runId)
        || !SOURCES.has(run.source as string)
        || !RUN_STATUSES.has(run.status as string)
        || !nullableText(run.supersedesRunId)
        || !nullableText(run.model)
        || !timestamp(run.startedAt)
        || !timestamp(run.updatedAt)
        || !(run.historyVerifiedAt === undefined || run.historyVerifiedAt === null || timestamp(run.historyVerifiedAt))
        || !(run.historyActive === undefined || run.historyActive === null || typeof run.historyActive === 'boolean')
        || !(run.terminalReason === undefined || run.terminalReason === null || TERMINAL_REASONS.has(run.terminalReason as string))
        || !(run.stopRequestedAt === undefined || run.stopRequestedAt === null || timestamp(run.stopRequestedAt))
      ) return false;
      runIds.add(run.runId);
      return true;
    })) return false;
    if (
      !(task.lastHistoryVerifiedAt === undefined || task.lastHistoryVerifiedAt === null || timestamp(task.lastHistoryVerifiedAt))
      || !(task.lastHistorySessionId === undefined || nullableText(task.lastHistorySessionId))
    ) return false;
    const nodeIds = new Set<string>();
    if (!task.nodes.every((candidate) => {
      const node = record(candidate);
      return Boolean(
        node
        && internalIdentifier(node.id)
        && !nodeIds.has(node.id)
        && NODE_KINDS.has(node.kind as string)
        && NODE_STATUSES.has(node.status as string)
        && boundedText(node.runId)
        && runIds.has(node.runId)
        && nullableText(node.toolCallId)
        && nullableText(node.toolName)
        && nullableText(node.effectKey, 2_048)
        && (node.recoveryMode === undefined || ['manual', 'reconcile', 'retry_with_same_effect_key'].includes(node.recoveryMode as string))
        && ['unknown', 'read_only', 'idempotent', 'verification_required'].includes(node.sideEffect as string)
        && timestamp(node.createdAt)
        && timestamp(node.updatedAt)
        && (nodeIds.add(node.id) || true)
      );
    })) return false;
    const edgeIds = new Set<string>();
    return (task.edges ?? []).every((candidate) => {
      const edge = record(candidate);
      return Boolean(
        edge
        && internalIdentifier(edge.id)
        && !edgeIds.has(edge.id)
        && internalIdentifier(edge.fromNodeId)
        && internalIdentifier(edge.toNodeId)
        && nodeIds.has(edge.fromNodeId)
        && nodeIds.has(edge.toNodeId)
        && EDGE_KINDS.has(edge.kind as string)
        && EDGE_EVIDENCE.has(edge.evidence as string)
        && timestamp(edge.createdAt)
        && timestamp(edge.updatedAt)
        && (edgeIds.add(edge.id) || true)
      );
    });
  });
}

export function normalizeTaskExecutionSnapshot(snapshot: TaskExecutionSnapshot): TaskExecutionSnapshot {
  return {
    version: 1,
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      binding: {
        ...task.binding,
        runtimeId: task.binding.runtimeId ?? null,
        sessionId: task.binding.sessionId ?? null,
      },
      lastHistoryVerifiedAt: task.lastHistoryVerifiedAt ?? null,
      lastHistorySessionId: task.lastHistorySessionId ?? null,
      runs: task.runs.map((run) => ({
        ...run,
        supersedesRunId: run.supersedesRunId ?? null,
        model: run.model ?? null,
        terminalReason: run.terminalReason ?? null,
        stopRequestedAt: run.stopRequestedAt ?? null,
        historyVerifiedAt: run.historyVerifiedAt ?? null,
        historyActive: run.historyActive ?? null,
      })),
      nodes: task.nodes.map((node) => ({
        ...node,
        toolCallId: node.toolCallId ?? undefined,
        toolName: node.toolName ?? undefined,
        effectKey: node.effectKey ?? undefined,
        recoveryMode: node.recoveryMode ?? 'manual',
      })),
      edges: (task.edges ?? []).map((edge) => ({ ...edge })),
    })),
  };
}

export async function loadTaskExecutionSnapshot(): Promise<{ generation: number; snapshot: TaskExecutionSnapshot }> {
  const result = await invoke<NativeLoadResult>('load_workbench_session', { partitionId: PARTITION_ID });
  if (!result.found) return { generation: result.generation, snapshot: emptyTaskExecutionSnapshot() };
  const migrated = migrateLegacyTaskExecutionSnapshot(result.payload);
  if (!isTaskExecutionSnapshot(migrated)) throw new Error('Task execution checkpoint failed schema validation');
  return { generation: result.generation, snapshot: normalizeTaskExecutionSnapshot(migrated) };
}

export async function saveTaskExecutionSnapshot(
  expectedGeneration: number,
  snapshot: TaskExecutionSnapshot,
): Promise<number> {
  const result = await invoke<NativeSaveResult>('save_workbench_session', {
    partitionId: PARTITION_ID,
    expectedGeneration,
    payload: snapshot,
  });
  return result.generation;
}
