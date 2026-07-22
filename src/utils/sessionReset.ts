import { executeSessionLifecycleMutation } from '@/services/collaboration/sessionLifecycle';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { useCollaborationStore } from '@/stores/collaborationStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { debugWarn } from '@/utils/debugLog';
import { sessionTranscriptFence } from '@/services/chat/sessionTranscriptFence';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import {
  gatewayMutationFailure,
  isSessionDeleted,
  isUnmaterializedLocalSession,
  normalizeSessionKey,
} from '@/utils/sessionLifecycle';

type SessionResetDeps = {
  resetRemote: (sessionKey: string) => Promise<unknown>;
  warn: (...args: unknown[]) => void;
  notifyFailure: (detail: string) => void;
  invalidateChatRun: (sessionKey: string) => void;
  dispatchReset: (sessionKey: string) => void;
};

const defaultSessionResetDeps: SessionResetDeps = {
  resetRemote: (sessionKey) => executeSessionLifecycleMutation(sessionKey, 'reset'),
  warn: (...args) => debugWarn('app', ...args),
  notifyFailure: (detail) => {
    useNotificationStore.getState().addToast('error', '重置会话失败', detail);
  },
  invalidateChatRun: (sessionKey) => gateway.invalidateChatSession(sessionKey),
  dispatchReset: (sessionKey) => {
    try {
      window.dispatchEvent(new CustomEvent('aegis:session-reset', { detail: { sessionKey } }));
    } catch {
      // Non-browser tests and a closing renderer may not expose an event target.
    }
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

export function setSessionResetDependenciesForTests(
  overrides?: Partial<SessionResetDeps>,
): void {
  __setSessionResetDepsForTest(overrides);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Gateway rejected session reset';
}

function resumeQueuedMessages(sessionKey: string): void {
  queueMicrotask(() => {
    const chat = useChatStore.getState();
    if (
      chat.connected
      && !chat.typingBySession[sessionKey]
      && (chat.messageQueue[sessionKey]?.length ?? 0) > 0
    ) {
      void chat.drainQueue(sessionKey);
    }
  });
}

async function performSessionReset(sessionKey: string): Promise<boolean> {
  const localState = useChatStore.getState();
  const localSession = localState.sessions.find((session) => session.key === sessionKey);
  if (isUnmaterializedLocalSession(localSession, localState.messagesPerSession[sessionKey])) {
    localState.clearQueue(sessionKey);
    localState.clearSessionMessages(sessionKey);
    localState.clearSessionTokens(sessionKey);
    return true;
  }
  try {
    const result = await sessionResetDeps.resetRemote(sessionKey);
    const outcome = result && typeof result === 'object'
      ? result as Record<string, unknown>
      : null;
    if (outcome?.cancelled === true) {
      resumeQueuedMessages(sessionKey);
      return false;
    }
    const failure = gatewayMutationFailure(result, 'Gateway rejected session reset');
    if (failure) throw new Error(failure);
    if (isSessionDeleted(sessionKey)) return false;

    const chat = useChatStore.getState();
    const previousSessionId = typeof outcome?.previousSessionId === 'string' && outcome.previousSessionId.trim()
      ? outcome.previousSessionId.trim()
      : chat.sessions.find((session) => session.key === sessionKey)?.sessionId ?? null;
    const nextSessionId = typeof outcome?.sessionId === 'string' && outcome.sessionId.trim()
      ? outcome.sessionId.trim()
      : null;
    sessionTranscriptFence.invalidate(sessionKey);
    sessionResetDeps.invalidateChatRun(sessionKey);
    chat.clearQueue(sessionKey);
    chat.clearSessionMessages(sessionKey);
    chat.clearSessionTokens(sessionKey);
    chat.settleSessionRunUi(sessionKey);
    if (previousSessionId) {
      useCollaborationStore.getState().clearSessionProjection({ sessionKey, sessionId: previousSessionId });
    }
    if (nextSessionId) {
      chat.setSessionIdentity(sessionKey, nextSessionId);
      const gatewayState = useGatewayDataStore.getState();
      gatewayState.setSessions(gatewayState.sessions.map((session) => (
        session.key === sessionKey ? { ...session, sessionId: nextSessionId } : session
      )));
    }
    sessionResetDeps.dispatchReset(sessionKey);
    return true;
  } catch (error) {
    const message = errorMessage(error);
    sessionResetDeps.warn('[sessionReset] gateway.resetSession failed:', error);
    sessionResetDeps.notifyFailure(message);
    resumeQueuedMessages(sessionKey);
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
