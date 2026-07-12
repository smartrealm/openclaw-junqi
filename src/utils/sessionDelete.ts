/** Shared native OpenClaw session deletion flow. */
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { clearSessionModelPref } from '@/utils/sessionModelPrefs';
import { debugWarn } from '@/utils/debugLog';

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

export function __setSessionDeleteDepsForTest(overrides?: Partial<SessionDeleteDeps>): void {
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

export async function deleteSessionEverywhere(sessionKey: string): Promise<boolean> {
  if (!sessionKey || /^agent:[^:]+:main$/.test(sessionKey)) return false;

  try {
    const result = await sessionDeleteDeps.deleteRemote(sessionKey);
    if (result?.success === false) {
      throw new Error(result?.error || result?.message || 'Gateway rejected session deletion');
    }
    clearDeletedSessionLocalPrefs(sessionKey);
    useChatStore.getState().removeSession(sessionKey);
    const gatewayStore = useGatewayDataStore.getState();
    gatewayStore.setSessions(gatewayStore.sessions.filter((session) => session.key !== sessionKey));
  } catch (error) {
    sessionDeleteDeps.warn('[sessionDelete] gateway.deleteSession failed:', error);
    sessionDeleteDeps.notifyFailure(errorMessage(error));
    return false;
  }

  return true;
}
