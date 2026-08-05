import { getCurrentRuntimeIdentity } from '@/services/gateway/runtimeIdentity';
import { debugWarn } from '@/utils/debugLog';
import {
  cloneTaskExecutionCheckpoint,
  emptyTaskExecutionSnapshot,
  mergeTaskExecutionSnapshots,
  prepareTaskRunSend,
  prepareTaskRunSteer,
  requestTaskRunStop,
  recordTaskToolEvent,
  reconcileTaskHistory,
  settleTaskRun,
  taskExecutionId,
} from './stateMachine';
import { loadTaskExecutionSnapshot, saveTaskExecutionSnapshot } from './storage';
import type { TaskExecutionRuntimeBinding, TaskExecutionSource, TaskExecutionSnapshot } from './types';

function verifiedBinding(
  sessionKey: string,
  sessionId?: string,
  identity: ReturnType<typeof getCurrentRuntimeIdentity> = getCurrentRuntimeIdentity(),
): TaskExecutionRuntimeBinding | null {
  if (!identity?.verified || !identity.targetFingerprint.trim() || !sessionKey.trim()) return null;
  return {
    targetFingerprint: identity.targetFingerprint,
    runtimeId: identity.runtimeId,
    sessionKey,
    sessionId: sessionId?.trim() || null,
  };
}

function sameSession(task: TaskExecutionSnapshot['tasks'][number], sessionKey: string, sessionId?: string): boolean {
  return task.binding.sessionKey === sessionKey.trim()
    && (sessionId === undefined || task.binding.sessionId === (sessionId.trim() || null));
}

function sameRuntime(
  task: TaskExecutionSnapshot['tasks'][number],
  identity: ReturnType<typeof getCurrentRuntimeIdentity>,
): boolean {
  if (!identity?.verified || task.binding.targetFingerprint !== identity.targetFingerprint) return false;
  // A legacy checkpoint may have been created before the collaboration
  // runtime id was available. It remains usable only for the same attested
  // target; a checkpoint already bound to another runtime instance is not.
  return task.binding.runtimeId === identity.runtimeId
    || (task.binding.runtimeId === null && identity.runtimeId !== null);
}

export function resolveTaskExecutionBinding(
  tasks: TaskExecutionSnapshot['tasks'],
  sessionKey: string,
  sessionId: string | undefined,
  identity: ReturnType<typeof getCurrentRuntimeIdentity>,
  allowStored: boolean,
): TaskExecutionRuntimeBinding | null {
  const current = verifiedBinding(sessionKey, sessionId, identity);
  if (sessionId !== undefined) {
    if (current) return current;
    if (!allowStored) return null;
    const candidates = tasks.filter((task) => sameSession(task, sessionKey, sessionId));
    return candidates.length === 1 ? { ...candidates[0].binding } : null;
  }
  const candidates = allowStored
    ? tasks.filter((task) => sameSession(task, sessionKey) && (!identity || sameRuntime(task, identity)))
    : [];
  if (candidates.length === 1) return { ...candidates[0].binding };
  if (candidates.length > 1) return null;
  if (allowStored && identity?.verified && tasks.some((task) => (
    sameSession(task, sessionKey) && sameRuntime(task, identity)
  ))) return null;
  return current;
}

/** Resolve a tool event only when its OpenClaw runId identifies one stored Task. */
export function resolveTaskExecutionToolEventBinding(
  tasks: TaskExecutionSnapshot['tasks'],
  sessionKey: string,
  runId: string,
  identity: ReturnType<typeof getCurrentRuntimeIdentity>,
): TaskExecutionRuntimeBinding | null {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId || !identity?.verified) return null;
  const candidates = tasks.filter((task) => (
    sameSession(task, sessionKey)
    && sameRuntime(task, identity)
    && task.runs.some((run) => run.runId === normalizedRunId)
  ));
  return candidates.length === 1 ? { ...candidates[0].binding } : null;
}

export function isTaskRunStopRequested(
  tasks: TaskExecutionSnapshot['tasks'],
  binding: TaskExecutionRuntimeBinding,
  runId: string,
): boolean {
  const task = tasks.find((candidate) => candidate.taskId === taskExecutionId(binding));
  const status = task?.runs.find((candidate) => candidate.runId === runId)?.status;
  return status === 'cancel_requested' || status === 'cancelled';
}

export class TaskExecutionCoordinator {
  private snapshot: TaskExecutionSnapshot = emptyTaskExecutionSnapshot();
  private generation = 0;
  private hydrated = false;
  private hydrationPromise: Promise<void> | null = null;
  private writeTail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    if (!this.hydrationPromise) {
      this.hydrationPromise = loadTaskExecutionSnapshot()
        .then((loaded) => {
          this.snapshot = loaded.snapshot;
          this.generation = loaded.generation;
          this.hydrated = true;
          this.notify();
        })
        .finally(() => {
          this.hydrationPromise = null;
        });
    }
    await this.hydrationPromise;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.reportPersistenceFailure('task execution listener', error);
      }
    }
  }

  private async operationBinding(
    sessionKey: string,
    sessionId?: string,
    allowStored = false,
  ): Promise<TaskExecutionRuntimeBinding | null> {
    await this.hydrate();
    const identity = getCurrentRuntimeIdentity();
    return resolveTaskExecutionBinding(this.snapshot.tasks, sessionKey, sessionId, identity, allowStored);
  }

  private async toolEventBinding(
    sessionKey: string,
    runId: string,
  ): Promise<TaskExecutionRuntimeBinding | null> {
    await this.hydrate();
    return resolveTaskExecutionToolEventBinding(
      this.snapshot.tasks,
      sessionKey,
      runId,
      getCurrentRuntimeIdentity(),
    );
  }

  private async commit(next: TaskExecutionSnapshot): Promise<void> {
    await this.hydrate();
    let candidate = mergeTaskExecutionSnapshots(this.snapshot, next);
    this.snapshot = candidate;
    const write = async () => {
      try {
        this.generation = await saveTaskExecutionSnapshot(this.generation, candidate);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('generation conflict')) throw error;
        const loaded = await loadTaskExecutionSnapshot();
        candidate = mergeTaskExecutionSnapshots(loaded.snapshot, candidate);
        this.snapshot = candidate;
        this.generation = await saveTaskExecutionSnapshot(loaded.generation, candidate);
      }
      this.snapshot = candidate;
      this.notify();
    };
    this.writeTail = this.writeTail.then(write, write);
    await this.writeTail;
  }

  async prepareSend(params: {
    sessionKey: string;
    sessionId?: string;
    runId: string;
    source: TaskExecutionSource;
    model?: string | null;
    allowCreate?: boolean;
  }): Promise<{ runId: string | null; created: boolean }> {
    const binding = verifiedBinding(params.sessionKey, params.sessionId);
    if (!binding) return { runId: null, created: false };
    await this.hydrate();
    const prepared = prepareTaskRunSend(this.snapshot, { ...params, binding });
    if (prepared.created) await this.commit(prepared.snapshot);
    return { runId: prepared.taskRunId, created: prepared.created };
  }

  async prepareSteer(params: {
    sessionKey: string;
    sessionId?: string;
    runId: string;
    source: TaskExecutionSource;
    model?: string | null;
  }): Promise<{ supersededRunId: string | null; created: boolean }> {
    const binding = verifiedBinding(params.sessionKey, params.sessionId);
    if (!binding) return { supersededRunId: null, created: false };
    await this.hydrate();
    const prepared = prepareTaskRunSteer(this.snapshot, { ...params, binding });
    await this.commit(prepared.snapshot);
    return { supersededRunId: prepared.supersededRunId, created: true };
  }

  async requestStop(sessionKey: string, sessionId?: string): Promise<void> {
    const binding = await this.operationBinding(sessionKey, sessionId, true);
    if (!binding) return;
    await this.commit(requestTaskRunStop(this.snapshot, binding));
  }

  /**
   * The local cancellation checkpoint closes the gap before chat.send has
   * reached the Gateway pending-run registry. It never infers a native Run.
   */
  async isRunStopRequested(params: {
    sessionKey: string;
    sessionId?: string;
    runId: string | null | undefined;
  }): Promise<boolean> {
    const runId = params.runId?.trim();
    if (!runId) return false;
    await this.hydrate();
    // requestStop serializes its durable update on this tail. Wait for a Stop
    // already in flight before allowing the same Run to cross the handoff.
    await this.writeTail;
    const binding = resolveTaskExecutionBinding(
      this.snapshot.tasks,
      params.sessionKey,
      params.sessionId,
      getCurrentRuntimeIdentity(),
      true,
    );
    if (!binding) return false;
    return isTaskRunStopRequested(this.snapshot.tasks, binding, runId);
  }

  async settleRun(params: {
    sessionKey: string;
    sessionId?: string;
    runId: string | null | undefined;
    terminalReason: 'final' | 'aborted' | 'error';
  }): Promise<void> {
    const binding = await this.operationBinding(params.sessionKey, params.sessionId, true);
    if (!binding || !params.runId?.trim()) return;
    await this.commit(settleTaskRun(this.snapshot, binding, params.runId, params.terminalReason));
  }

  async recordToolEvent(params: {
    sessionKey: string;
    runId: string;
    toolCallId: string;
    toolName: string;
    phase: 'start' | 'update' | 'result';
    resultStatus?: 'done' | 'error' | 'cancelled';
  }): Promise<void> {
    const binding = await this.toolEventBinding(params.sessionKey, params.runId);
    if (!binding) return;
    await this.commit(recordTaskToolEvent(this.snapshot, binding, params));
  }

  async reconcileHistory(params: {
    sessionKey: string;
    sessionId: string | null;
    hasActiveRun: boolean;
    activeRunIds: readonly string[];
  }): Promise<void> {
    const binding = verifiedBinding(params.sessionKey, params.sessionId ?? undefined);
    if (!binding) return;
    await this.hydrate();
    await this.commit(reconcileTaskHistory(this.snapshot, binding, params));
  }

  async checkpointForSession(
    sessionKey: string,
    sessionId?: string,
  ): Promise<import('./types').TaskExecutionCheckpoint | null> {
    const binding = await this.operationBinding(sessionKey, sessionId, true);
    if (!binding) return null;
    const task = this.snapshot.tasks.find((candidate) => candidate.taskId === taskExecutionId(binding));
    return task ? cloneTaskExecutionCheckpoint(task) : null;
  }

  reportPersistenceFailure(context: string, error: unknown): void {
    debugWarn('app', `[TaskExecution] ${context}:`, error);
  }
}

export const taskExecutionCoordinator = new TaskExecutionCoordinator();
