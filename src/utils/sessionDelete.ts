/** Shared native OpenClaw session deletion flow. */
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { clearSessionModelPref } from '@/utils/sessionModelPrefs';
import { debugWarn } from '@/utils/debugLog';
import {
  gatewayMutationFailure,
  isAgentMainSession,
  isSessionDeleted,
  markSessionDeleted,
  normalizeSessionKey,
} from '@/utils/sessionLifecycle';

const SESSION_TOPIC_PREFS_KEY = 'aegis:session-topic-prefs';

type SessionDeleteDeps = {
  deleteRemote: (sessionKey: string) => Promise<any>;
  warn: (...args: unknown[]) => void;
  notifyFailure: (detail: string) => void;
};

const defaultSessionDeleteDeps: SessionDeleteDeps = {
  deleteRemote: (sessionKey) => gateway.deleteSession(sessionKey),
  warn: (...args) => debugWarn('app', ...args),
  notifyFailure: (detail) => {
    useNotificationStore.getState().addToast('error', '删除会话失败', detail);
  },
};

let sessionDeleteDeps: SessionDeleteDeps = defaultSessionDeleteDeps;
const deletionInFlight = new Map<string, Promise<boolean>>();

export function __setSessionDeleteDepsForTest(overrides?: Partial<SessionDeleteDeps>): void {
  deletionInFlight.clear();
  sessionDeleteDeps = overrides
    ? { ...defaultSessionDeleteDeps, ...overrides }
    : defaultSessionDeleteDeps;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function removeLocalStorageMapEntry(storageKey: string, sessionKey: string): void {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    if (!Object.prototype.hasOwnProperty.call(parsed, sessionKey)) return;
    delete parsed[sessionKey];
    localStorage.setItem(storageKey, JSON.stringify(parsed));
  } catch {
    // ignore corrupt local cache
  }
}

function clearDeletedSessionLocalPrefs(sessionKey: string): void {
  clearSessionModelPref(sessionKey);
  removeLocalStorageMapEntry(SESSION_TOPIC_PREFS_KEY, sessionKey);
}

export function applyConfirmedSessionDeletion(rawSessionKey: string): boolean {
  const sessionKey = normalizeSessionKey(rawSessionKey);
  if (!sessionKey || isAgentMainSession(sessionKey)) return false;

  markSessionDeleted(sessionKey);
  clearDeletedSessionLocalPrefs(sessionKey);
  useChatStore.getState().removeSession(sessionKey);
  const gatewayStore = useGatewayDataStore.getState();
  gatewayStore.setSessions(gatewayStore.sessions.filter((session) => session.key !== sessionKey));
  return true;
}

async function performSessionDeletion(sessionKey: string): Promise<boolean> {
  if (isSessionDeleted(sessionKey)) return applyConfirmedSessionDeletion(sessionKey);

  try {
    const result = await sessionDeleteDeps.deleteRemote(sessionKey);
    const failure = gatewayMutationFailure(result, 'Gateway rejected session deletion');
    if (failure) throw new Error(failure);
    applyConfirmedSessionDeletion(sessionKey);
  } catch (error) {
    sessionDeleteDeps.warn('[sessionDelete] gateway.deleteSession failed:', error);
    sessionDeleteDeps.notifyFailure(errorMessage(error));
    return false;
  }

  return true;
}

export function deleteSessionEverywhere(rawSessionKey: string): Promise<boolean> {
  const sessionKey = normalizeSessionKey(rawSessionKey);
  if (!sessionKey || isAgentMainSession(sessionKey)) return Promise.resolve(false);

  const existing = deletionInFlight.get(sessionKey);
  if (existing) return existing;

  const task = performSessionDeletion(sessionKey).finally(() => {
    if (deletionInFlight.get(sessionKey) === task) deletionInFlight.delete(sessionKey);
  });
  deletionInFlight.set(sessionKey, task);
  return task;
}
