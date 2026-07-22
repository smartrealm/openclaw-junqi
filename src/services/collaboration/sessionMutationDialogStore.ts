import { create } from 'zustand';
import type {
  SessionMutationExecutionResult,
  SessionMutationRequest,
} from './SessionMutationCoordinator';
import { sessionMutationGate } from '@/services/chat/sessionMutationGate';

export interface SessionMutationDialogEntry {
  id: string;
  operationId: string;
  request: SessionMutationRequest;
  requestedAt: number;
  committedResult: SessionMutationExecutionResult | null;
}

interface SessionMutationDialogState {
  current: SessionMutationDialogEntry | null;
}

interface PendingEntry extends SessionMutationDialogEntry {
  identity: string;
  promise: Promise<SessionMutationExecutionResult | null>;
  resolve: (result: SessionMutationExecutionResult | null) => void;
  reported: boolean;
  releaseRetainedGate?: () => void;
}

const queue: PendingEntry[] = [];
const requestsByIdentity = new Map<string, Promise<SessionMutationExecutionResult | null>>();
let active: PendingEntry | null = null;

export const useSessionMutationDialogStore = create<SessionMutationDialogState>(() => ({
  current: null,
}));

function identityKey(request: SessionMutationRequest): string {
  return JSON.stringify([
    request.collaborationInstanceId,
    request.runtimeId,
    request.sessionKey,
    request.sessionId,
    request.action,
  ]);
}

function dialogEntry(entry: PendingEntry): SessionMutationDialogEntry {
  return {
    id: entry.id,
    operationId: entry.operationId,
    request: entry.request,
    requestedAt: entry.requestedAt,
    committedResult: entry.committedResult,
  };
}

function publishNext(): void {
  if (active || queue.length === 0) return;
  active = queue.shift() ?? null;
  useSessionMutationDialogStore.setState({
    current: active ? dialogEntry(active) : null,
  });
}

export function requestSessionMutationDialog(
  request: SessionMutationRequest,
): Promise<SessionMutationExecutionResult | null> {
  const key = identityKey(request);
  const existing = requestsByIdentity.get(key);
  if (existing) return existing;

  let settle!: (result: SessionMutationExecutionResult | null) => void;
  const pending = new Promise<SessionMutationExecutionResult | null>((resolve) => {
    settle = resolve;
  });
  requestsByIdentity.set(key, pending);
  queue.push({
    id: globalThis.crypto.randomUUID(),
    operationId: `operation-${globalThis.crypto.randomUUID()}`,
    request,
    requestedAt: Date.now(),
    committedResult: null,
    identity: key,
    promise: pending,
    resolve: settle,
    reported: false,
  });
  publishNext();
  return pending;
}

/** Resolve a verified core mutation while keeping its collaboration recovery UI active. */
export function reportSessionCoreCommit(
  entryId: string,
  result: SessionMutationExecutionResult,
): boolean {
  if (
    !active
    || active.id !== entryId
    || active.reported
    || active.operationId !== result.operationId
    || active.request.action !== result.action
    || result.status !== 'COMPLETION_PENDING'
    || !result.coreMutationCommitted
    || !result.collaborationRecoveryRequired
    || result.impact.runtimeId !== active.request.runtimeId
    || result.impact.sessionKey !== active.request.sessionKey
    || result.impact.sessionId !== active.request.sessionId
    || result.impact.collaborationInstanceId !== active.request.collaborationInstanceId
  ) {
    return false;
  }
  active.reported = true;
  active.committedResult = result;
  active.releaseRetainedGate = sessionMutationGate.retain(active.request.sessionKey);
  active.resolve(result);
  useSessionMutationDialogStore.setState({ current: dialogEntry(active) });
  return true;
}

export function settleSessionMutationDialog(
  entryId: string,
  result: SessionMutationExecutionResult | null,
): boolean {
  if (!active || active.id !== entryId) return false;
  if (
    active.committedResult
    && (
      !result
      || result.operationId !== active.operationId
      || result.mutationId !== active.committedResult.mutationId
      || result.status !== 'COMPLETED'
      || !result.success
      || !result.coreMutationCommitted
      || result.collaborationRecoveryRequired
      || !result.completion
    )
  ) {
    return false;
  }
  const completed = active;
  active = null;
  useSessionMutationDialogStore.setState({ current: null });
  if (!completed.reported) completed.resolve(result);
  completed.releaseRetainedGate?.();
  if (requestsByIdentity.get(completed.identity) === completed.promise) {
    requestsByIdentity.delete(completed.identity);
  }
  queueMicrotask(publishNext);
  return true;
}

export function resetSessionMutationDialogStoreForTests(): void {
  active?.releaseRetainedGate?.();
  if (active && !active.reported) active.resolve(null);
  for (const entry of queue.splice(0)) {
    if (!entry.reported) entry.resolve(null);
  }
  active = null;
  requestsByIdentity.clear();
  useSessionMutationDialogStore.setState({ current: null });
}
