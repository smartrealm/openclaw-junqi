/**
 * Native OpenClaw session-label mutations.
 *
 * `sessions.patch({ key, label })` is the persistent source of truth.  The
 * renderer only updates its stores after the Gateway confirms the mutation;
 * this prevents a disconnected client from showing a name that was never
 * saved.
 */
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { debugWarn } from '@/utils/debugLog';
import {
  gatewayMutationFailure,
  isSessionDeleted,
  normalizeSessionKey,
} from '@/utils/sessionLifecycle';

export type SessionRenameResult =
  | { ok: true; label: string; superseded?: boolean }
  | { ok: false; error: string };

type SessionRenameDeps = {
  patchLabel: (sessionKey: string, label: string | null) => Promise<unknown>;
  warn: (...args: unknown[]) => void;
  notifyFailure: (detail: string) => void;
};

const defaultSessionRenameDeps: SessionRenameDeps = {
  patchLabel: (sessionKey, label) => gateway.setSessionLabel(label, sessionKey),
  warn: (...args) => debugWarn('app', ...args),
  notifyFailure: (detail) => {
    useNotificationStore.getState().addToast('error', '重命名会话失败', detail);
  },
};

let sessionRenameDeps: SessionRenameDeps = defaultSessionRenameDeps;
let renameOperationSequence = 0;
const latestRenameBySession = new Map<string, number>();
const renameQueueBySession = new Map<string, Promise<void>>();

export function __setSessionRenameDepsForTest(overrides?: Partial<SessionRenameDeps>): void {
  renameOperationSequence = 0;
  latestRenameBySession.clear();
  renameQueueBySession.clear();
  sessionRenameDeps = overrides
    ? { ...defaultSessionRenameDeps, ...overrides }
    : defaultSessionRenameDeps;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function confirmedLabel(response: unknown, requestedLabel: string): string {
  const entry = (response as { entry?: { label?: unknown } } | null)?.entry;
  return typeof entry?.label === 'string' ? entry.label.trim() : requestedLabel;
}

function applyConfirmedLabel(sessionKey: string, label: string): void {
  useChatStore.getState().setSessionLabel(sessionKey, label);

  const gatewayStore = useGatewayDataStore.getState();
  if (gatewayStore.sessions.some((session) => session.key === sessionKey)) {
    gatewayStore.setSessions(gatewayStore.sessions.map((session) => (
      session.key === sessionKey ? { ...session, label } : session
    )));
  }
}

/**
 * Rename a session through the Gateway. Passing an empty value clears the
 * custom label (`label: null`), allowing OpenClaw to return to its own
 * display-name fallback.
 */
async function performSessionRename(
  sessionKey: string,
  requestedLabel: string,
  operationId: number,
): Promise<SessionRenameResult> {
  if (isSessionDeleted(sessionKey)) return { ok: false, error: 'Session has been deleted' };

  try {
    const response = await sessionRenameDeps.patchLabel(sessionKey, requestedLabel || null);
    const failure = gatewayMutationFailure(response, 'Gateway rejected session label mutation');
    if (failure) throw new Error(failure);
    const label = confirmedLabel(response, requestedLabel);
    if (latestRenameBySession.get(sessionKey) !== operationId || isSessionDeleted(sessionKey)) {
      const currentLabel = useChatStore.getState().sessions.find((session) => session.key === sessionKey)?.label;
      return { ok: true, label: currentLabel ?? label, superseded: true };
    }
    applyConfirmedLabel(sessionKey, label);
    return { ok: true, label };
  } catch (error) {
    if (latestRenameBySession.get(sessionKey) !== operationId || isSessionDeleted(sessionKey)) {
      const currentLabel = useChatStore.getState().sessions.find((session) => session.key === sessionKey)?.label ?? '';
      return { ok: true, label: currentLabel, superseded: true };
    }
    const message = errorMessage(error);
    sessionRenameDeps.warn('[sessionRename] Gateway rejected session label mutation:', error);
    sessionRenameDeps.notifyFailure(message);
    return { ok: false, error: message };
  }
}

export function applySessionRename(key: string, next: string): Promise<SessionRenameResult> {
  const sessionKey = normalizeSessionKey(key);
  const requestedLabel = next.trim();
  if (!sessionKey) return Promise.resolve({ ok: false, error: 'Missing session key' });

  const operationId = ++renameOperationSequence;
  latestRenameBySession.set(sessionKey, operationId);
  const previous = renameQueueBySession.get(sessionKey) ?? Promise.resolve();
  const task = previous.then(() => performSessionRename(sessionKey, requestedLabel, operationId));
  const tail = task.then(() => undefined, () => undefined);
  renameQueueBySession.set(sessionKey, tail);
  void tail.finally(() => {
    if (renameQueueBySession.get(sessionKey) === tail) {
      renameQueueBySession.delete(sessionKey);
      if (latestRenameBySession.get(sessionKey) === operationId) latestRenameBySession.delete(sessionKey);
    }
  });
  return task;
}
