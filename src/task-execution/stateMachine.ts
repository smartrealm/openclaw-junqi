import type {
  TaskExecutionCheckpoint,
  TaskExecutionEdgeEvidence,
  TaskExecutionEdgeKind,
  TaskExecutionNode,
  TaskExecutionRuntimeBinding,
  TaskExecutionRun,
  TaskExecutionSource,
  TaskExecutionSnapshot,
  TaskToolRecoveryMode,
  TaskNodeStatus,
  TaskRunStatus,
} from './types';

const MAX_TASKS = 200;
const MAX_RUNS_PER_TASK = 200;
const MAX_NODES_PER_TASK = 1_000;
const MAX_EDGES_PER_TASK = 2_000;

export function taskExecutionId(binding: TaskExecutionRuntimeBinding): string {
  return `${binding.targetFingerprint}\u0000${binding.sessionKey}${binding.sessionId ? `\u0000${binding.sessionId}` : ''}`;
}

function taskNodeId(runId: string, kind: TaskExecutionNode['kind'], suffix = ''): string {
  return `${runId}\u0000${kind}${suffix ? `\u0000${suffix}` : ''}`;
}

function taskEdgeId(kind: TaskExecutionEdgeKind, fromNodeId: string, toNodeId: string): string {
  return `${kind}\u0000${fromNodeId}\u0000${toNodeId}`;
}

/** JunQi-local correlation only; this is never sent as an OpenClaw idempotency key. */
function taskToolEffectKey(
  binding: TaskExecutionRuntimeBinding,
  runId: string,
  toolCallId: string,
): string {
  return `junqi-tool\u0000${binding.targetFingerprint}\u0000${binding.sessionKey}\u0000${runId}\u0000${toolCallId}`;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`Invalid task execution ${field}`);
  }
  return normalized;
}

function cloneCheckpoint(checkpoint: TaskExecutionCheckpoint): TaskExecutionCheckpoint {
  return {
    ...checkpoint,
    binding: { ...checkpoint.binding },
    runs: checkpoint.runs.map((run) => ({ ...run })),
    nodes: checkpoint.nodes.map((node) => ({ ...node })),
    edges: (checkpoint.edges ?? []).map((edge) => ({ ...edge })),
  };
}

export function cloneTaskExecutionCheckpoint(
  checkpoint: TaskExecutionCheckpoint,
): TaskExecutionCheckpoint {
  return cloneCheckpoint(checkpoint);
}

function appendTaskEdge(
  checkpoint: TaskExecutionCheckpoint,
  params: {
    fromNodeId: string;
    toNodeId: string;
    kind: TaskExecutionEdgeKind;
    evidence: TaskExecutionEdgeEvidence;
    now: number;
  },
): void {
  const id = taskEdgeId(params.kind, params.fromNodeId, params.toNodeId);
  if (checkpoint.edges.some((edge) => edge.id === id)) return;
  checkpoint.edges.push({
    id,
    fromNodeId: params.fromNodeId,
    toNodeId: params.toNodeId,
    kind: params.kind,
    evidence: params.evidence,
    createdAt: params.now,
    updatedAt: params.now,
  });
}

function preferByTimeAndStatus<T extends { updatedAt: number; status: string }>(
  current: T,
  candidate: T,
  rank: (status: string) => number,
): T {
  if (candidate.updatedAt > current.updatedAt) return candidate;
  if (candidate.updatedAt < current.updatedAt) return current;
  return rank(candidate.status) > rank(current.status) ? candidate : current;
}

function runStatusRank(status: string): number {
  return ({
    pending: 1,
    running: 2,
    cancel_requested: 3,
    succeeded: 4,
    cancelled: 4,
    failed: 5,
    verification_required: 6,
  } as Record<string, number>)[status] ?? 0;
}

function nodeStatusRank(status: string): number {
  return ({
    pending: 1,
    running: 2,
    cancel_requested: 3,
    succeeded: 4,
    cancelled: 4,
    rolled_back: 5,
    failed: 6,
    blocked: 7,
    verification_required: 8,
  } as Record<string, number>)[status] ?? 0;
}

function closeConflictingRunIntents(
  runs: TaskExecutionRun[],
  nodes: TaskExecutionNode[],
  now: number,
): void {
  const candidates = runs.filter((run) => run.status === 'pending' || run.status === 'running');
  if (candidates.length <= 1) return;
  const winner = [...candidates].sort((left, right) => (
    right.updatedAt - left.updatedAt || right.startedAt - left.startedAt
  ))[0];
  for (const run of candidates) {
    if (run === winner) continue;
    run.status = 'verification_required';
    run.updatedAt = Math.max(run.updatedAt, now);
    for (const node of nodes.filter((candidate) => (
      candidate.runId === run.runId
      && !['succeeded', 'cancelled', 'rolled_back', 'failed'].includes(candidate.status)
    ))) {
      updateNodeStatus(node, 'verification_required', now);
    }
  }
}

function mergeCheckpoint(left: TaskExecutionCheckpoint, right: TaskExecutionCheckpoint): TaskExecutionCheckpoint {
  if (
    left.binding.runtimeId !== right.binding.runtimeId
    || left.binding.sessionId !== right.binding.sessionId
  ) {
    return left.updatedAt >= right.updatedAt ? cloneCheckpoint(left) : cloneCheckpoint(right);
  }
  const runs = new Map(left.runs.map((run) => [run.runId, { ...run }]));
  for (const run of right.runs) {
    const existing = runs.get(run.runId);
    runs.set(run.runId, existing ? preferByTimeAndStatus(existing, run, runStatusRank) : { ...run });
  }
  const nodes = new Map(left.nodes.map((node) => [node.id, { ...node }]));
  for (const node of right.nodes) {
    const existing = nodes.get(node.id);
    nodes.set(node.id, existing ? preferByTimeAndStatus(existing, node, nodeStatusRank) : { ...node });
  }
  const edges = new Map((left.edges ?? []).map((edge) => [edge.id, { ...edge }]));
  for (const edge of right.edges ?? []) {
    const existing = edges.get(edge.id);
    edges.set(edge.id, existing
      ? edge.updatedAt >= existing.updatedAt ? { ...edge } : existing
      : { ...edge });
  }
  const updatedAt = Math.max(left.updatedAt, right.updatedAt);
  const mergedRuns = [...runs.values()]
    .sort((first, second) => first.startedAt - second.startedAt)
    .slice(-MAX_RUNS_PER_TASK);
  const mergedNodes = [...nodes.values()]
    .sort((first, second) => first.createdAt - second.createdAt)
    .slice(-MAX_NODES_PER_TASK);
  const mergedEdges = [...edges.values()]
    .sort((first, second) => first.createdAt - second.createdAt)
    .slice(-MAX_EDGES_PER_TASK);
  closeConflictingRunIntents(mergedRuns, mergedNodes, updatedAt);
  return {
    version: 1,
    taskId: left.taskId,
    binding: { ...left.binding },
    revision: Math.max(left.revision, right.revision) + 1,
    updatedAt,
    lastHistoryVerifiedAt: Math.max(left.lastHistoryVerifiedAt ?? 0, right.lastHistoryVerifiedAt ?? 0) || null,
    lastHistorySessionId: (left.lastHistoryVerifiedAt ?? 0) >= (right.lastHistoryVerifiedAt ?? 0)
      ? left.lastHistorySessionId
      : right.lastHistorySessionId,
    runs: mergedRuns,
    nodes: mergedNodes,
    edges: mergedEdges,
  };
}

function ensureActiveRun(checkpoint: TaskExecutionCheckpoint, runId: string) {
  const run = checkpoint.runs.find((candidate) => candidate.runId === runId);
  if (!run) throw new Error('Task execution Run is not known');
  return run;
}

function isTerminalRun(status: TaskRunStatus): boolean {
  return status === 'succeeded' || status === 'cancelled' || status === 'failed' || status === 'verification_required';
}

function updateNodeStatus(node: TaskExecutionNode, status: TaskNodeStatus, updatedAt: number): void {
  if (node.status === status) return;
  if (node.status === 'succeeded' || node.status === 'rolled_back' || node.status === 'cancelled') {
    throw new Error('A terminal task node cannot be reopened');
  }
  node.status = status;
  node.updatedAt = updatedAt;
}

function ensureToolReconciliationNode(
  checkpoint: TaskExecutionCheckpoint,
  tool: TaskExecutionNode,
  now: number,
): TaskExecutionNode {
  const id = taskNodeId(tool.runId, 'tool_reconciliation', tool.toolCallId ?? tool.id);
  const existing = checkpoint.nodes.find((node) => node.id === id);
  if (existing) return existing;
  const node: TaskExecutionNode = {
    id,
    kind: 'tool_reconciliation',
    status: 'verification_required',
    runId: tool.runId,
    ...(tool.toolCallId ? { toolCallId: tool.toolCallId } : {}),
    ...(tool.toolName ? { toolName: tool.toolName } : {}),
    ...(tool.effectKey ? { effectKey: tool.effectKey } : {}),
    recoveryMode: 'manual',
    sideEffect: 'verification_required',
    createdAt: now,
    updatedAt: now,
  };
  checkpoint.nodes.push(node);
  appendTaskEdge(checkpoint, {
    fromNodeId: tool.id,
    toNodeId: node.id,
    kind: 'observed_after',
    evidence: 'junqi_intent',
    now,
  });
  return node;
}

export function emptyTaskExecutionSnapshot(): TaskExecutionSnapshot {
  return { version: 1, tasks: [] };
}

/** Resolve cross-WebView persistence conflicts at Run and Node granularity. */
export function mergeTaskExecutionSnapshots(
  left: TaskExecutionSnapshot,
  right: TaskExecutionSnapshot,
): TaskExecutionSnapshot {
  const byId = new Map<string, TaskExecutionCheckpoint>();
  for (const task of [...left.tasks, ...right.tasks]) {
    const existing = byId.get(task.taskId);
    byId.set(task.taskId, existing ? mergeCheckpoint(existing, task) : cloneCheckpoint(task));
  }
  return {
    version: 1,
    tasks: [...byId.values()]
      .sort((first, second) => first.updatedAt - second.updatedAt)
      .slice(-MAX_TASKS),
  };
}

export function beginTaskRun(
  snapshot: TaskExecutionSnapshot,
  params: {
    binding: TaskExecutionRuntimeBinding;
    runId: string;
    source: TaskExecutionSource;
    model?: string | null;
    supersedesRunId?: string | null;
    now?: number;
  },
): TaskExecutionSnapshot {
  const now = params.now ?? Date.now();
  const runId = requireText(params.runId, 'run id');
  const binding: TaskExecutionRuntimeBinding = {
    targetFingerprint: requireText(params.binding.targetFingerprint, 'target fingerprint'),
    runtimeId: params.binding.runtimeId?.trim() || null,
    sessionKey: requireText(params.binding.sessionKey, 'session key'),
    sessionId: params.binding.sessionId?.trim() || null,
  };
  const taskId = taskExecutionId(binding);
  const existing = snapshot.tasks.find((task) => task.taskId === taskId);
  const checkpoint = existing ? cloneCheckpoint(existing) : {
    version: 1 as const,
    taskId,
    binding,
    revision: 0,
    updatedAt: now,
    lastHistoryVerifiedAt: null,
    lastHistorySessionId: null,
    runs: [],
    nodes: [],
    edges: [],
  };
  if (
    existing
    && checkpoint.binding.sessionId
    && binding.sessionId
    && checkpoint.binding.sessionId !== binding.sessionId
  ) {
    throw new Error('Task execution session identity changed');
  }
  const alreadyKnown = checkpoint.runs.some((run) => run.runId === runId);
  const active = checkpoint.runs.find((run) => !isTerminalRun(run.status));
  if (
    !alreadyKnown
    && active
    && !(active.status === 'cancel_requested' && active.runId === params.supersedesRunId)
  ) {
    throw new Error('A Task session already has an active Run');
  }
  if (!alreadyKnown) {
    checkpoint.runs.push({
      runId,
      supersedesRunId: params.supersedesRunId?.trim() || null,
      source: params.source,
      status: 'running',
      model: params.model?.trim() || null,
      startedAt: now,
      updatedAt: now,
      stopRequestedAt: null,
      terminalReason: null,
      historyVerifiedAt: null,
      historyActive: null,
    });
    checkpoint.nodes.push({
      id: taskNodeId(runId, 'user_turn'),
      kind: 'user_turn',
      status: 'succeeded',
      runId,
      sideEffect: 'read_only',
      createdAt: now,
      updatedAt: now,
    }, {
      id: taskNodeId(runId, 'model_turn'),
      kind: 'model_turn',
      status: 'running',
      runId,
      sideEffect: 'unknown',
      createdAt: now,
      updatedAt: now,
    });
    appendTaskEdge(checkpoint, {
      fromNodeId: taskNodeId(runId, 'user_turn'),
      toNodeId: taskNodeId(runId, 'model_turn'),
      kind: 'observed_after',
      evidence: 'junqi_intent',
      now,
    });
    if (params.supersedesRunId?.trim()) {
      appendTaskEdge(checkpoint, {
        fromNodeId: taskNodeId(params.supersedesRunId, 'model_turn'),
        toNodeId: taskNodeId(runId, 'user_turn'),
        kind: 'supersedes',
        evidence: 'junqi_intent',
        now,
      });
    }
  }
  checkpoint.runs = checkpoint.runs.slice(-MAX_RUNS_PER_TASK);
  checkpoint.nodes = checkpoint.nodes.slice(-MAX_NODES_PER_TASK);
  checkpoint.edges = checkpoint.edges.slice(-MAX_EDGES_PER_TASK);
  checkpoint.revision += 1;
  checkpoint.updatedAt = now;
  const tasks = existing
    ? snapshot.tasks.map((task) => task.taskId === taskId ? checkpoint : task)
    : [...snapshot.tasks, checkpoint];
  return { version: 1, tasks: tasks.slice(-MAX_TASKS) };
}

/**
 * Prepare a normal OpenClaw chat.send intent without inventing a second Run
 * while the bound Task is already active. OpenClaw owns the queue mode for
 * that case; the local ledger only creates a Run when no active Run exists.
 */
export function prepareTaskRunSend(
  snapshot: TaskExecutionSnapshot,
  params: {
    binding: TaskExecutionRuntimeBinding;
    runId: string;
    source: TaskExecutionSource;
    model?: string | null;
    allowCreate?: boolean;
    now?: number;
  },
): { snapshot: TaskExecutionSnapshot; taskRunId: string | null; created: boolean } {
  const taskId = taskExecutionId(params.binding);
  const existing = snapshot.tasks.find((task) => task.taskId === taskId);
  const active = existing
    ? [...existing.runs].reverse().find((run) => !isTerminalRun(run.status))
    : undefined;
  if (active) {
    return { snapshot, taskRunId: active.runId, created: false };
  }
  if (params.allowCreate === false) {
    return { snapshot, taskRunId: null, created: false };
  }
  return {
    snapshot: beginTaskRun(snapshot, params),
    taskRunId: params.runId.trim(),
    created: true,
  };
}

/**
 * Persist the two sides of an OpenClaw sessions.steer operation together.
 * The previous Run remains cancel_requested until the Gateway confirms that
 * its active work was interrupted; the replacement Run is only a local send
 * intent until the RPC acknowledgement arrives.
 */
export function prepareTaskRunSteer(
  snapshot: TaskExecutionSnapshot,
  params: {
    binding: TaskExecutionRuntimeBinding;
    runId: string;
    source: TaskExecutionSource;
    model?: string | null;
    now?: number;
  },
): { snapshot: TaskExecutionSnapshot; supersededRunId: string | null } {
  const taskId = taskExecutionId(params.binding);
  const existing = snapshot.tasks.find((task) => task.taskId === taskId);
  const active = existing
    ? [...existing.runs].reverse().find((run) => !isTerminalRun(run.status))
    : undefined;
  const stopped = active
    ? requestTaskRunStop(snapshot, params.binding, params.now ?? Date.now())
    : snapshot;
  return {
    snapshot: beginTaskRun(stopped, {
      ...params,
      supersedesRunId: active?.runId ?? null,
    }),
    supersededRunId: active?.runId ?? null,
  };
}

export function requestTaskRunStop(
  snapshot: TaskExecutionSnapshot,
  binding: TaskExecutionRuntimeBinding,
  now = Date.now(),
): TaskExecutionSnapshot {
  const taskId = taskExecutionId(binding);
  const existing = snapshot.tasks.find((task) => task.taskId === taskId);
  if (!existing) return snapshot;
  const checkpoint = cloneCheckpoint(existing);
  const run = [...checkpoint.runs].reverse().find((candidate) => !isTerminalRun(candidate.status));
  if (!run || run.status === 'cancel_requested') return snapshot;
  run.status = 'cancel_requested';
  run.stopRequestedAt = now;
  run.updatedAt = now;
  for (const node of checkpoint.nodes.filter((candidate) => candidate.runId === run.runId && candidate.status === 'running')) {
    updateNodeStatus(node, 'cancel_requested', now);
  }
  checkpoint.revision += 1;
  checkpoint.updatedAt = now;
  return { version: 1, tasks: snapshot.tasks.map((task) => task.taskId === taskId ? checkpoint : task) };
}

export function settleTaskRun(
  snapshot: TaskExecutionSnapshot,
  binding: TaskExecutionRuntimeBinding,
  runId: string,
  terminalReason: 'final' | 'aborted' | 'error',
  now = Date.now(),
): TaskExecutionSnapshot {
  const taskId = taskExecutionId(binding);
  const existing = snapshot.tasks.find((task) => task.taskId === taskId);
  if (!existing) return snapshot;
  const checkpoint = cloneCheckpoint(existing);
  const run = ensureActiveRun(checkpoint, requireText(runId, 'run id'));
  if (isTerminalRun(run.status) && run.status !== 'verification_required') return snapshot;
  const unresolvedTools = checkpoint.nodes.filter((node) => (
    node.runId === run.runId
    && node.kind === 'tool_invocation'
    && !['succeeded', 'cancelled', 'rolled_back', 'failed'].includes(node.status)
  ));
  run.status = unresolvedTools.length > 0
    ? 'verification_required'
    : terminalReason === 'final'
      ? 'succeeded'
      : terminalReason === 'aborted'
        ? 'cancelled'
        : 'failed';
  run.terminalReason = terminalReason;
  run.updatedAt = now;
  unresolvedTools.forEach((tool) => ensureToolReconciliationNode(checkpoint, tool, now));
  for (const node of checkpoint.nodes.filter((candidate) => candidate.runId === run.runId && !['succeeded', 'cancelled', 'rolled_back', 'failed'].includes(candidate.status))) {
    const unresolvedTool = unresolvedTools.find((tool) => tool.id === node.id || (
      node.kind === 'tool_reconciliation'
      && tool.toolCallId !== undefined
      && node.toolCallId === tool.toolCallId
    ));
    const status: TaskNodeStatus = unresolvedTool
      ? 'verification_required'
      : terminalReason === 'final'
        ? 'succeeded'
        : 'cancelled';
    updateNodeStatus(node, status, now);
  }
  checkpoint.revision += 1;
  checkpoint.updatedAt = now;
  return { version: 1, tasks: snapshot.tasks.map((task) => task.taskId === taskId ? checkpoint : task) };
}

export function recordTaskToolEvent(
  snapshot: TaskExecutionSnapshot,
  binding: TaskExecutionRuntimeBinding,
  params: {
    runId: string;
    toolCallId: string;
    toolName: string;
    phase: 'start' | 'update' | 'result';
    resultStatus?: 'done' | 'error' | 'cancelled';
    recoveryMode?: TaskToolRecoveryMode;
    now?: number;
  },
): TaskExecutionSnapshot {
  const taskId = taskExecutionId(binding);
  const existing = snapshot.tasks.find((task) => task.taskId === taskId);
  if (!existing) return snapshot;
  const checkpoint = cloneCheckpoint(existing);
  const runId = requireText(params.runId, 'run id');
  const run = ensureActiveRun(checkpoint, runId);
  const toolCallId = requireText(params.toolCallId, 'tool call id');
  const now = params.now ?? Date.now();
  const nodeId = taskNodeId(runId, 'tool_invocation', toolCallId);
  let node = checkpoint.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    if (isTerminalRun(run.status) || params.phase === 'result') return snapshot;
    node = {
      id: nodeId,
      kind: 'tool_invocation',
      status: 'running',
      runId,
      toolCallId,
      toolName: requireText(params.toolName, 'tool name'),
      effectKey: taskToolEffectKey(binding, runId, toolCallId),
      recoveryMode: params.recoveryMode ?? 'manual',
      sideEffect: 'verification_required',
      createdAt: now,
      updatedAt: now,
    };
    checkpoint.nodes.push(node);
  }
  appendTaskEdge(checkpoint, {
    fromNodeId: taskNodeId(runId, 'model_turn'),
    toNodeId: node.id,
    kind: 'observed_after',
    evidence: 'openclaw_event',
    now,
  });
  if (params.phase === 'result') {
    if (!['succeeded', 'failed', 'cancelled', 'rolled_back'].includes(node.status)) {
      updateNodeStatus(
        node,
        params.resultStatus === 'error'
          ? 'failed'
          : params.resultStatus === 'cancelled'
            ? 'cancelled'
            : 'succeeded',
        now,
      );
      const recovery = checkpoint.nodes.find((candidate) => (
        candidate.kind === 'tool_reconciliation'
        && candidate.runId === node.runId
        && candidate.toolCallId === node.toolCallId
      ));
      if (recovery && recovery.status === 'verification_required') {
        updateNodeStatus(recovery, 'cancelled', now);
      }
    } else {
      return snapshot;
    }
  } else if (node.status === 'pending') {
    updateNodeStatus(node, 'running', now);
  }
  if (run.status === 'verification_required') {
    const toolNodes = checkpoint.nodes.filter((candidate) => candidate.runId === run.runId && candidate.kind === 'tool_invocation');
    const unresolved = toolNodes.some((candidate) => !['succeeded', 'failed', 'cancelled', 'rolled_back'].includes(candidate.status));
    if (!unresolved) {
      const hasFailedTool = toolNodes.some((candidate) => candidate.status === 'failed');
      run.status = hasFailedTool
        ? 'failed'
        : run.terminalReason === 'final'
          ? 'succeeded'
          : run.terminalReason === 'aborted'
            ? 'cancelled'
            : run.terminalReason === 'error'
              ? 'failed'
              : 'verification_required';
      run.updatedAt = now;
    }
  }
  checkpoint.nodes = checkpoint.nodes.slice(-MAX_NODES_PER_TASK);
  checkpoint.edges = checkpoint.edges.slice(-MAX_EDGES_PER_TASK);
  checkpoint.revision += 1;
  checkpoint.updatedAt = now;
  return { version: 1, tasks: snapshot.tasks.map((task) => task.taskId === taskId ? checkpoint : task) };
}

export function reconcileTaskHistory(
  snapshot: TaskExecutionSnapshot,
  binding: TaskExecutionRuntimeBinding,
  params: {
    sessionId: string | null;
    hasActiveRun: boolean;
    activeRunIds: readonly string[];
    now?: number;
  },
): TaskExecutionSnapshot {
  const taskId = taskExecutionId(binding);
  const existing = snapshot.tasks.find((task) => task.taskId === taskId);
  if (!existing) return snapshot;
  if (existing.binding.sessionId && params.sessionId && existing.binding.sessionId !== params.sessionId) {
    throw new Error('Task execution history session identity changed');
  }
  const now = params.now ?? Date.now();
  const checkpoint = cloneCheckpoint(existing);
  const activeRunIds = new Set(params.activeRunIds);
  for (const run of checkpoint.runs) {
    if (!isTerminalRun(run.status)) {
      run.historyVerifiedAt = now;
      run.historyActive = params.hasActiveRun && activeRunIds.has(run.runId);
      if (!params.hasActiveRun && run.historyActive === false) {
        run.status = 'verification_required';
        run.updatedAt = now;
        for (const node of checkpoint.nodes.filter((candidate) => (
          candidate.runId === run.runId
          && !['succeeded', 'cancelled', 'rolled_back', 'failed'].includes(candidate.status)
        ))) {
          updateNodeStatus(node, 'verification_required', now);
          if (node.kind === 'tool_invocation') ensureToolReconciliationNode(checkpoint, node, now);
        }
      }
    }
  }
  checkpoint.lastHistoryVerifiedAt = now;
  checkpoint.lastHistorySessionId = params.sessionId;
  checkpoint.revision += 1;
  checkpoint.updatedAt = now;
  return { version: 1, tasks: snapshot.tasks.map((task) => task.taskId === taskId ? checkpoint : task) };
}
