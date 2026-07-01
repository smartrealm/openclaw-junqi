/**
 * sessionRename — shared helper for renaming sessions from any UI
 * surface (sidebar row, chat tab, new-session picker, etc).
 *
 * Two surfaces (NavSidebar session list + ChatTabs tab strip) currently
 * display the same session.label. They read from the same
 * `useChatStore` Session record, so any rename action that mutates the
 * store auto-syncs both displays. Centralizing the gateway + store
 * write here keeps that contract in one place.
 */
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';

/**
 * Apply a rename via gateway.setSessionLabel + chatStore.setSessionLabel.
 * Returns true on success, false on no-op (empty or unchanged).
 *
 * The local store update is OUTSIDE the gateway try/catch — if the
 * backend write fails (gateway offline, sessions.patch rejects the
 * payload, etc.) we still want the UI to reflect the user's choice
 * immediately. The gateway sync is a best-effort secondary write; a
 * failed sync just means the server-side label is out of date until
 * the next sessions.list refresh, but the user sees their rename
 * instantly. Pre-fix: setSessionLabel was inside the try, so any
 * gateway error silently blocked the rename from ever showing up.
 */
export async function applySessionRename(key: string, next: string): Promise<boolean> {
  const trimmed = next.trim();
  if (!trimmed) return false;
  // 1. Local store update FIRST — always, even if gateway fails.
  useChatStore.getState().setSessionLabel(key, trimmed);
  // 2. Backend notification — best effort. Log and continue on failure.
  try {
    await gateway.setSessionLabel(trimmed, key);
  } catch (err) {
    console.warn('[sessionRename] gateway.setSessionLabel failed (local label still applied):', err);
  }
  return true;
}