/**
 * One-way migration for labels written by older JunQi Desktop builds.
 *
 * OpenClaw now persists session labels itself.  We only copy a legacy label
 * when the corresponding live Gateway session has no native label; an
 * existing Gateway label always wins.  Entries are removed from the legacy
 * file only after that decision is confirmed, so an offline Gateway never
 * loses user data.
 */
import { invoke } from '@tauri-apps/api/core';
import { gateway } from '@/services/gateway';
import { debugWarn } from '@/utils/debugLog';

type LabelMap = Record<string, string>;

const RETRY_DELAY_MS = 30_000;
let activeMigration: Promise<void> | null = null;
let nextAttemptAt = 0;

function normalizeLabels(value: unknown): LabelMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, label]) => {
      const normalizedKey = key.trim();
      const normalizedLabel = typeof label === 'string' ? label.trim() : '';
      return normalizedKey && normalizedLabel ? [[normalizedKey, normalizedLabel]] : [];
    }),
  );
}

async function migrateLegacySessionLabels(): Promise<void> {
  let labels: LabelMap;
  try {
    labels = normalizeLabels(await invoke('load_legacy_session_labels'));
  } catch (error) {
    debugWarn('app', '[sessionLabelMigration] Failed to read legacy labels:', error);
    return;
  }

  const entries = Object.entries(labels);
  if (entries.length === 0) return;

  let sessions: unknown[];
  try {
    const response = await gateway.getSessions();
    sessions = Array.isArray(response?.sessions) ? response.sessions : [];
  } catch (error) {
    nextAttemptAt = Date.now() + RETRY_DELAY_MS;
    debugWarn('app', '[sessionLabelMigration] Gateway unavailable; migration will retry:', error);
    return;
  }

  const nativeLabels = new Map(
    sessions.flatMap((session: any) => {
      const key = typeof session?.key === 'string'
        ? session.key
        : typeof session?.sessionKey === 'string'
          ? session.sessionKey
          : '';
      return key ? [[key, typeof session.label === 'string' ? session.label.trim() : '']] : [];
    }),
  );

  const removableKeys: string[] = [];
  for (const [key, label] of entries) {
    const nativeLabel = nativeLabels.get(key);
    if (nativeLabel === undefined) continue;
    if (nativeLabel) {
      // A native label was already saved. It is newer and authoritative.
      removableKeys.push(key);
      continue;
    }

    try {
      await gateway.setSessionLabel(label, key);
      removableKeys.push(key);
    } catch (error) {
      debugWarn('app', `[sessionLabelMigration] Failed to migrate ${key}:`, error);
    }
  }

  if (removableKeys.length === 0) {
    nextAttemptAt = Date.now() + RETRY_DELAY_MS;
    return;
  }

  try {
    await invoke('remove_legacy_session_labels', { keys: removableKeys });
    nextAttemptAt = 0;
  } catch (error) {
    // Keep the file intact: a repeated native patch is harmless, data loss is not.
    nextAttemptAt = Date.now() + RETRY_DELAY_MS;
    debugWarn('app', '[sessionLabelMigration] Failed to clear migrated legacy labels:', error);
  }
}

/** Run at most once concurrently and retry only after a short backoff. */
export function migrateLegacySessionLabelsOnce(): Promise<void> {
  if (activeMigration) return activeMigration;
  if (Date.now() < nextAttemptAt) return Promise.resolve();

  activeMigration = migrateLegacySessionLabels().finally(() => {
    activeMigration = null;
  });
  return activeMigration;
}
