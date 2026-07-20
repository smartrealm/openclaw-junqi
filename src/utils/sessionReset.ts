import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { debugWarn } from '@/utils/debugLog';
import {
  gatewayMutationFailure,
  isSessionDeleted,
  normalizeSessionKey,
} from '@/utils/sessionLifecycle';

type SessionResetDeps = {
  resetRemote: (sessionKey: string) => Promise<unknown>;
  warn: (...args: unknown[]) => void;
  notifyFailure: (detail: string) => void;
};

const defaultSessionResetDeps: SessionResetDeps = {
  resetRemote: (sessionKey) => gateway.resetSession(sessionKey),
  warn: (...args) => debugWarn('app', ...args),
  notifyFailure: (detail) => {
    useNotificationStore.getState().addToast('error', '重置会话失败', detail);
  },
};

let sessionResetDeps = defaultSessionResetDeps;
const resetInFlight = new Map<string, Promise<boolean>>();

export function __setSessionResetDepsForTest(overrides?: Partial<SessionResetDeps>): void {
  resetInFlight.clear();
  sessionResetDeps = overrides
    ? { ...defaultSessionResetDeps, ...overrides }
    : defaultSessionResetDeps;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Gateway rejected session reset';
}

async function performSessionReset(sessionKey: string): Promise<boolean> {
  try {
    const result = await sessionResetDeps.resetRemote(sessionKey);
    const failure = gatewayMutationFailure(result, 'Gateway rejected session reset');
    if (failure) throw new Error(failure);
    if (isSessionDeleted(sessionKey)) return false;

    const chat = useChatStore.getState();
    chat.clearQueue(sessionKey);
    chat.clearSessionMessages(sessionKey);
    chat.clearSessionTokens(sessionKey);
    try {
      window.dispatchEvent(new CustomEvent('aegis:session-reset', { detail: { sessionKey } }));
    } catch {
      // Non-browser tests and a closing renderer may not expose an event target.
    }
    return true;
  } catch (error) {
    const message = errorMessage(error);
    sessionResetDeps.warn('[sessionReset] gateway.resetSession failed:', error);
    sessionResetDeps.notifyFailure(message);
    return false;
  }
}

export function resetSessionEverywhere(rawSessionKey: string): Promise<boolean> {
  const sessionKey = normalizeSessionKey(rawSessionKey);
  if (!sessionKey || isSessionDeleted(sessionKey)) return Promise.resolve(false);

  const existing = resetInFlight.get(sessionKey);
  if (existing) return existing;

  const task = performSessionReset(sessionKey).finally(() => {
    if (resetInFlight.get(sessionKey) === task) resetInFlight.delete(sessionKey);
  });
  resetInFlight.set(sessionKey, task);
  return task;
}
