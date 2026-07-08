/**
 * Shared session deletion flow.
 *
 * Gateway session deletion can lag behind sessions.list polling. Once the
 * user confirms deletion, keep a local tombstone so a stale sessions.list
 * response cannot resurrect the row in the sidebar or tab picker.
 */
import { gateway } from '@/services/gateway';
import { applyLocalSessionLabelCache, markSessionDeletedLocally, useChatStore } from '@/stores/chatStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { invoke } from '@tauri-apps/api/core';
import { clearSessionModelPref } from '@/utils/sessionModelPrefs';
import { debugWarn } from '@/utils/debugLog';

const SESSION_TOPIC_PREFS_KEY = 'aegis:session-topic-prefs';

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
  applyLocalSessionLabelCache(sessionKey, '');
  clearSessionModelPref(sessionKey);
  removeLocalStorageMapEntry(SESSION_TOPIC_PREFS_KEY, sessionKey);
  void invoke('upsert_session_label', { key: sessionKey, label: null }).catch((error) => {
    debugWarn('app', '[sessionDelete] failed to clear persisted label:', error);
  });
}

function emitSessionsChanged(sessionKey: string): void {
  try {
    window.dispatchEvent(new CustomEvent('aegis:sessions-changed', {
      detail: { reason: 'delete', sessionKey },
    }));
  } catch {
    // ignore non-browser tests
  }
}

export async function deleteSessionEverywhere(sessionKey: string): Promise<boolean> {
  if (!sessionKey || sessionKey === 'agent:main:main') return false;

  markSessionDeletedLocally(sessionKey);
  clearDeletedSessionLocalPrefs(sessionKey);
  useChatStore.getState().removeSession(sessionKey);
  emitSessionsChanged(sessionKey);

  try {
    const result = await gateway.deleteSession(sessionKey);
    if (result?.success === false) {
      throw new Error(result?.error || result?.message || 'Gateway rejected session deletion');
    }
    emitSessionsChanged(sessionKey);
  } catch (error) {
    debugWarn('app', '[sessionDelete] gateway.deleteSession failed:', error);
    useNotificationStore.getState().addToast(
      'error',
      '会话已从本地移除',
      `远端历史清理失败：${errorMessage(error)}`,
    );
  }

  return true;
}
