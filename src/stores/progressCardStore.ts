import { create } from 'zustand';
import type { OpenClawProgressCard } from '@/progress-card/domain';
import {
  gateway,
  openClawProgressCardClient,
  subscribeOpenClawProgressCardEvents,
} from '@/services/gateway';
import {
  OpenClawProgressCardUnavailableError,
} from '@/services/gateway/OpenClawProgressCardClient';
import { OpenClawProgressCardResponseError } from '@/progress-card/domain';
import { ProgressCardRefreshGate } from './progressCardRefreshGate';

export type ProgressCardReadError =
  | 'method_unavailable'
  | 'invalid_response'
  | 'request_failed';

export interface ProgressCardEntry {
  readonly card: OpenClawProgressCard | null;
  readonly loading: boolean;
  readonly error: ProgressCardReadError | null;
}

interface StoredProgressCardEntry extends ProgressCardEntry {
  readonly connectionId: string | null;
}

interface ProgressCardStoreState {
  entries: Readonly<Record<string, StoredProgressCardEntry>>;
}

const EMPTY_ENTRY: ProgressCardEntry = Object.freeze({
  card: null,
  loading: false,
  error: null,
});

export const useProgressCardStore = create<ProgressCardStoreState>(() => ({ entries: {} }));

const watchedSessions = new Map<string, number>();
const requestRevisions = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();
const refreshGate = new ProgressCardRefreshGate();
let stopProgressEvents: (() => void) | null = null;
let stopHelloEvents: (() => void) | null = null;

export function progressCardEntry(sessionKey: string): ProgressCardEntry {
  return projectProgressCardEntry(
    useProgressCardStore.getState().entries[sessionKey],
    gateway.captureConnectionId(),
  );
}

export function projectProgressCardEntry(
  entry: StoredProgressCardEntry | undefined,
  connectionId: string | null,
): ProgressCardEntry {
  if (!entry || entry.connectionId !== connectionId) return EMPTY_ENTRY;
  return { card: entry.card, loading: entry.loading, error: entry.error };
}

function writeEntry(
  sessionKey: string,
  connectionId: string | null,
  entry: ProgressCardEntry,
): void {
  useProgressCardStore.setState((state) => ({
    entries: { ...state.entries, [sessionKey]: { ...entry, connectionId } },
  }));
}

function forgetAllEntries(): void {
  for (const sessionKey of watchedSessions.keys()) {
    requestRevisions.set(sessionKey, (requestRevisions.get(sessionKey) ?? 0) + 1);
  }
  inFlight.clear();
  refreshGate.clear();
  useProgressCardStore.setState({ entries: {} });
}

function classifyError(error: unknown): ProgressCardReadError | null {
  if (error instanceof OpenClawProgressCardUnavailableError) {
    if (error.reason === 'connection_unavailable' || error.reason === 'connection_changed') return null;
    return 'method_unavailable';
  }
  if (error instanceof OpenClawProgressCardResponseError) return 'invalid_response';
  return 'request_failed';
}

export function refreshOpenClawProgressCard(sessionKey: string): Promise<void> {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) return Promise.resolve();
  const connectionId = gateway.captureConnectionId();
  if (!connectionId) {
    writeEntry(normalizedSessionKey, null, EMPTY_ENTRY);
    return Promise.resolve();
  }
  const requestKey = `${connectionId}\u0000${normalizedSessionKey}`;
  const existing = inFlight.get(requestKey);
  if (existing) {
    refreshGate.request(requestKey);
    return existing;
  }
  refreshGate.request(requestKey);

  const revision = (requestRevisions.get(normalizedSessionKey) ?? 0) + 1;
  requestRevisions.set(normalizedSessionKey, revision);
  const previous = progressCardEntry(normalizedSessionKey);
  writeEntry(normalizedSessionKey, connectionId, {
    card: previous.card,
    loading: previous.card === null,
    error: null,
  });

  const request = openClawProgressCardClient.get(normalizedSessionKey)
    .then((card) => {
      if (
        !refreshGate.shouldPublish(requestKey)
        ||
        requestRevisions.get(normalizedSessionKey) !== revision
        || gateway.captureConnectionId() !== connectionId
      ) return;
      writeEntry(normalizedSessionKey, connectionId, { card, loading: false, error: null });
    })
    .catch((error: unknown) => {
      if (
        !refreshGate.shouldPublish(requestKey)
        ||
        requestRevisions.get(normalizedSessionKey) !== revision
        || gateway.captureConnectionId() !== connectionId
      ) return;
      const classified = classifyError(error);
      writeEntry(normalizedSessionKey, connectionId, {
        card: classified ? previous.card : null,
        loading: false,
        error: classified,
      });
    })
    .finally(() => {
      if (inFlight.get(requestKey) === request) inFlight.delete(requestKey);
      const repeat = refreshGate.finish(requestKey);
      if (
        repeat
        && watchedSessions.has(normalizedSessionKey)
        && gateway.captureConnectionId() === connectionId
      ) void refreshOpenClawProgressCard(normalizedSessionKey);
    });
  inFlight.set(requestKey, request);
  return request;
}

function ensureRuntimeSubscriptions(): void {
  if (stopProgressEvents || stopHelloEvents) return;
  stopProgressEvents = subscribeOpenClawProgressCardEvents((event) => {
    if (watchedSessions.has(event.sessionKey)) void refreshOpenClawProgressCard(event.sessionKey);
  });
  stopHelloEvents = gateway.subscribeHello((observation) => {
    if (!observation) {
      forgetAllEntries();
      return;
    }
    for (const sessionKey of watchedSessions.keys()) void refreshOpenClawProgressCard(sessionKey);
  });
}

function releaseRuntimeSubscriptions(): void {
  if (watchedSessions.size > 0) return;
  stopProgressEvents?.();
  stopHelloEvents?.();
  stopProgressEvents = null;
  stopHelloEvents = null;
}

export function watchOpenClawProgressCard(sessionKey: string): () => void {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) return () => undefined;
  watchedSessions.set(normalizedSessionKey, (watchedSessions.get(normalizedSessionKey) ?? 0) + 1);
  ensureRuntimeSubscriptions();
  void refreshOpenClawProgressCard(normalizedSessionKey);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const remaining = (watchedSessions.get(normalizedSessionKey) ?? 1) - 1;
    if (remaining > 0) watchedSessions.set(normalizedSessionKey, remaining);
    else watchedSessions.delete(normalizedSessionKey);
    releaseRuntimeSubscriptions();
  };
}
