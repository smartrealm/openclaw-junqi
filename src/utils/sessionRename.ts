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
 * Returns true on success, false on no-op (empty or unchanged) or
 * gateway error. Errors are logged but never thrown — rename is a
 * best-effort UX enhancement, not a critical write.
 */
export async function applySessionRename(key: string, next: string): Promise<boolean> {
  const trimmed = next.trim();
  if (!trimmed) return false;
  try {
    await gateway.setSessionLabel(trimmed, key);
    useChatStore.getState().setSessionLabel(key, trimmed);
    return true;
  } catch (err) {
    console.warn('[sessionRename] setSessionLabel failed:', err);
    return false;
  }
}