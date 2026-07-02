/**
 * sessionRename — shared helper for renaming sessions from any UI
 * surface (sidebar row, chat tab, new-session picker, etc).
 *
 * Two surfaces (NavSidebar session list + ChatTabs tab strip) currently
 * display the same session.label. They read from the same
 * `useChatStore` Session record, so any rename action that mutates the
 * store auto-syncs both displays. Centralizing the gateway + store
 * write here keeps that contract in one place.
 *
 * Persistence: the openclaw gateway may not honor the `label` field in
 * sessions.patch on every build, so we mirror every rename to a Tauri-
 * managed JSON file (default location `~/.openclaw/session-labels.json`).
 * The chatStore reads this file at startup so renames survive a restart
 * and a webview cache wipe.
 */
import { invoke } from '@tauri-apps/api/core';
import { gateway } from '@/services/gateway';
import { useChatStore, applyLocalSessionLabelCache } from '@/stores/chatStore';

/** Persist a single label override via the Tauri backend. Fire-and-forget
 *  from the caller's perspective — the local store is already updated by
 *  the time this returns to the UI, so a slow disk write never blocks a
 *  rename. We still `await` so a single rename truly finishes its write
 *  before a second rename starts (preserves order in the file). */
async function writeSessionLabelPref(sessionKey: string, label: string): Promise<void> {
  try {
    await invoke('upsert_session_label', { key: sessionKey, label: label.trim() });
  } catch (err) {
    console.warn('[sessionRename] Tauri persist failed (label still in live store):', err);
  }
}

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
 *
 * The localStorage mirror is the canonical source of truth across
 * restarts: the openclaw gateway may strip `label` from sessions.patch
 * in some builds, so we keep a per-key override that the chatStore
 * merge logic (in setSessions) reads back at startup.
 */
export async function applySessionRename(key: string, next: string): Promise<boolean> {
  const trimmed = next.trim();
  if (!trimmed) return false;
  // 1. Persist the override to disk FIRST so a crash mid-rename still
  //    leaves a recoverable override. Tauri write is best-effort — the
  //    in-memory store is always the source of truth for the running UI.
  await writeSessionLabelPref(key, trimmed);
  // 1b. Mirror the new label into the chatStore's in-memory cache so the
  //     very next setSessions merge (e.g. the next sessions.list poll)
  //     sees the override without round-tripping back to Tauri.
  applyLocalSessionLabelCache(key, trimmed);
  // 2. Local store update — always, even if gateway fails.
  useChatStore.getState().setSessionLabel(key, trimmed);
  // 3. Backend notification — best effort. Log and continue on failure.
  try {
    await gateway.setSessionLabel(trimmed, key);
  } catch (err) {
    console.warn('[sessionRename] gateway.setSessionLabel failed (local label still applied):', err);
  }
  return true;
}