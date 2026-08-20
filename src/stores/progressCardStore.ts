import { create } from 'zustand';
import type { OpenClawProgressCard } from '@/progress-card/domain';
import {
  gateway,
  openClawProgressCardClient,
  subscribeOpenClawLegacyProgressPlanEvents,
  subscribeOpenClawProgressCardEvents,
} from '@/services/gateway';
import {
  OPENCLAW_PROGRESS_CARD_GET_METHOD,
  OpenClawProgressCardUnavailableError,
} from '@/services/gateway/OpenClawProgressCardClient';
import {
  ProgressCardCompatibilityGate,
  type LegacyProgressCardProjection,
} from './progressCardCompatibilityGate';
import { ProgressCardRefreshGate } from './progressCardRefreshGate';

export interface ProgressCardEntry {
  readonly card: OpenClawProgressCard | null;
  readonly loading: boolean;
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
});

export const useProgressCardStore = create<ProgressCardStoreState>(() => ({ entries: {} }));

const watchedSessions = new Map<string, number>();
const requestRevisions = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();
const refreshGate = new ProgressCardRefreshGate();
const compatibilityGate = new ProgressCardCompatibilityGate();
let stopProgressEvents: (() => void) | null = null;
let stopLegacyPlanEvents: (() => void) | null = null;
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
  return { card: entry.card, loading: entry.loading };
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
  compatibilityGate.clear();
  useProgressCardStore.setState({ entries: {} });
}

function publishLegacyProjection(
  connectionId: string,
  projection: LegacyProgressCardProjection,
): void {
  if (
    gateway.captureConnectionId() !== connectionId
    || !watchedSessions.has(projection.sessionKey)
  ) return;
  writeEntry(projection.sessionKey, connectionId, {
    card: projection.card,
    loading: false,
  });
}

export function refreshOpenClawProgressCard(sessionKey: string): Promise<void> {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) return Promise.resolve();
  const connectionId = gateway.captureConnectionId();
  if (!connectionId) {
    writeEntry(normalizedSessionKey, null, EMPTY_ENTRY);
    return Promise.resolve();
  }
  compatibilityGate.observeConnection(connectionId);
  const capability = gateway.getCapabilityEvidence(OPENCLAW_PROGRESS_CARD_GET_METHOD);
  if (
    capability?.state === 'unsupported'
    && capability.connectionId === connectionId
  ) {
    const projections = compatibilityGate.recordLegacyStream(connectionId);
    if (projections.length === 0) {
      const current = progressCardEntry(normalizedSessionKey);
      writeEntry(normalizedSessionKey, connectionId, {
        card: current.card,
        loading: false,
      });
    }
    for (const projection of projections) publishLegacyProjection(connectionId, projection);
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
  });

  const request = openClawProgressCardClient.get(normalizedSessionKey)
    .then((card) => {
      if (gateway.captureConnectionId() === connectionId) {
        compatibilityGate.recordDurable(connectionId);
      }
      if (
        !refreshGate.shouldPublish(requestKey)
        ||
        requestRevisions.get(normalizedSessionKey) !== revision
        || gateway.captureConnectionId() !== connectionId
      ) return;
      writeEntry(normalizedSessionKey, connectionId, { card, loading: false });
    })
    .catch((error: unknown) => {
      const methodUnavailable = error instanceof OpenClawProgressCardUnavailableError
        && error.reason === 'method_unavailable';
      const legacyProjections = methodUnavailable
        && gateway.captureConnectionId() === connectionId
        ? compatibilityGate.recordLegacyStream(connectionId)
        : [];
      if (
        !refreshGate.shouldPublish(requestKey)
        ||
        requestRevisions.get(normalizedSessionKey) !== revision
        || gateway.captureConnectionId() !== connectionId
      ) return;
      if (methodUnavailable) {
        writeEntry(normalizedSessionKey, connectionId, {
          card: previous.card,
          loading: false,
        });
        for (const projection of legacyProjections) {
          publishLegacyProjection(connectionId, projection);
        }
        return;
      }
      writeEntry(normalizedSessionKey, connectionId, {
        card: previous.card,
        loading: false,
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
  if (stopProgressEvents || stopLegacyPlanEvents || stopHelloEvents) return;
  stopProgressEvents = subscribeOpenClawProgressCardEvents((event) => {
    if (!watchedSessions.has(event.sessionKey)) return;
    const connectionId = gateway.captureConnectionId();
    if (!connectionId) return;
    compatibilityGate.recordDurable(connectionId);
    if (event.revision === null) {
      requestRevisions.set(
        event.sessionKey,
        (requestRevisions.get(event.sessionKey) ?? 0) + 1,
      );
      refreshGate.discardPending(`${connectionId}\u0000${event.sessionKey}`);
      writeEntry(event.sessionKey, connectionId, {
        card: null,
        loading: false,
      });
      return;
    }
    const current = progressCardEntry(event.sessionKey).card;
    if (current?.revision === event.revision) return;
    void refreshOpenClawProgressCard(event.sessionKey);
  });
  stopLegacyPlanEvents = subscribeOpenClawLegacyProgressPlanEvents((event) => {
    const connectionId = gateway.captureConnectionId();
    if (!connectionId || !watchedSessions.has(event.sessionKey)) return;
    const projection = compatibilityGate.receive(connectionId, event);
    if (projection) publishLegacyProjection(connectionId, projection);
  });
  stopHelloEvents = gateway.subscribeHello((observation) => {
    if (!observation) {
      forgetAllEntries();
      return;
    }
    compatibilityGate.observeConnection(observation.connectionId);
    for (const sessionKey of watchedSessions.keys()) void refreshOpenClawProgressCard(sessionKey);
  });
}

function releaseRuntimeSubscriptions(): void {
  if (watchedSessions.size > 0) return;
  stopProgressEvents?.();
  stopLegacyPlanEvents?.();
  stopHelloEvents?.();
  stopProgressEvents = null;
  stopLegacyPlanEvents = null;
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
