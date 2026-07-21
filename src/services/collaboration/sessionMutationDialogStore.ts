import { create } from 'zustand';
import type {
  SessionMutationExecutionResult,
  SessionMutationRequest,
} from './SessionMutationCoordinator';

export interface SessionMutationDialogEntry {
  id: string;
  request: SessionMutationRequest;
  requestedAt: number;
}

interface SessionMutationDialogState {
  current: SessionMutationDialogEntry | null;
}

interface PendingEntry extends SessionMutationDialogEntry {
  resolve: (result: SessionMutationExecutionResult | null) => void;
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

function publishNext(): void {
  if (active || queue.length === 0) return;
  active = queue.shift() ?? null;
  useSessionMutationDialogStore.setState({
    current: active
      ? { id: active.id, request: active.request, requestedAt: active.requestedAt }
      : null,
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
  const result = pending.finally(() => {
    if (requestsByIdentity.get(key) === result) requestsByIdentity.delete(key);
  });
  requestsByIdentity.set(key, result);
  queue.push({
    id: globalThis.crypto.randomUUID(),
    request,
    requestedAt: Date.now(),
    resolve: settle,
  });
  publishNext();
  return result;
}

export function settleSessionMutationDialog(
  entryId: string,
  result: SessionMutationExecutionResult | null,
): boolean {
  if (!active || active.id !== entryId) return false;
  const completed = active;
  active = null;
  useSessionMutationDialogStore.setState({ current: null });
  completed.resolve(result);
  queueMicrotask(publishNext);
  return true;
}

export function resetSessionMutationDialogStoreForTests(): void {
  active?.resolve(null);
  for (const entry of queue.splice(0)) entry.resolve(null);
  active = null;
  requestsByIdentity.clear();
  useSessionMutationDialogStore.setState({ current: null });
}
