/**
 * Shared session deletion flow.
 *
 * Gateway session deletion can lag behind sessions.list polling. Once the
 * user confirms deletion, keep a local tombstone so a stale sessions.list
 * response cannot resurrect the row in the sidebar or tab picker.
 */
import { gateway } from '@/services/gateway';
import { markSessionDeletedLocally, useChatStore } from '@/stores/chatStore';
import { useNotificationStore } from '@/stores/notificationStore';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function deleteSessionEverywhere(sessionKey: string): Promise<boolean> {
  if (!sessionKey || sessionKey === 'agent:main:main') return false;

  try {
    const result = await gateway.deleteSession(sessionKey);
    if (result?.success === false) {
      throw new Error(result?.error || result?.message || 'Gateway rejected session deletion');
    }
  } catch (error) {
    console.warn('[sessionDelete] gateway.deleteSession failed:', error);
    useNotificationStore.getState().addToast(
      'error',
      '删除会话失败',
      errorMessage(error),
    );
    return false;
  }

  markSessionDeletedLocally(sessionKey);
  useChatStore.getState().removeSession(sessionKey);
  return true;
}
