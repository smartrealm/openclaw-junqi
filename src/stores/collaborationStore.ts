import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  CollaborationClient,
  CollaborationClientError,
  collaborationClient,
} from '@/services/collaboration/client';
import {
  collaborationSessionIdentityKey,
  isTerminalCollaborationRun,
  parseCollaborationChangedHint,
  type CollaborationCapabilities,
  type CollaborationChangedHint,
  type CollaborationEvent,
  type CollaborationEventCursor,
  type CollaborationRunSnapshot,
  type CollaborationRunSummary,
  type CollaborationSessionRef,
  type CollaborationTombstone,
  type CollaborationWriteMethod,
  type CollaborationWriteRequest,
  type CollaborationWriteResponse,
} from '@/services/collaboration/types';
import { subscribeCollaborationChangedHints } from '@/services/gateway/collaborationEventBridge';

export interface CollaborationCommandState {
  commandId: string;
  method: CollaborationWriteMethod;
  status: 'submitting' | 'accepted' | 'failed';
  runId?: string;
  response?: CollaborationWriteResponse;
  error?: string;
  errorCode?: string;
}

export interface CollaborationSessionSyncState {
  loading: boolean;
  lastSyncedAt?: number;
  error?: string;
}

export interface CollaborationPollingOptions {
  activeIntervalMs?: number;
  idleIntervalMs?: number;
  eventPageSize?: number;
}

export interface CollaborationState {
  collaborationInstanceId: string | null;
  capabilities: CollaborationCapabilities | null;
  runsById: Record<string, CollaborationRunSummary>;
  snapshotsByRunId: Record<string, CollaborationRunSnapshot>;
  runIdsBySession: Record<string, string[]>;
  eventsByRunId: Record<string, CollaborationEvent[]>;
  cursorsByRunId: Record<string, CollaborationEventCursor>;
  tombstones: CollaborationTombstone[];
  sessionSync: Record<string, CollaborationSessionSyncState>;
  commandsById: Record<string, CollaborationCommandState>;
  globalError: string | null;

  bootstrap: (force?: boolean) => Promise<CollaborationCapabilities>;
  syncSession: (session: CollaborationSessionRef) => Promise<CollaborationRunSummary[]>;
  syncGlobalRuns: (options?: { activeOnly?: boolean; includeArchived?: boolean }) => Promise<CollaborationRunSummary[]>;
  syncTombstones: () => Promise<CollaborationTombstone[]>;
  refreshRun: (runId: string) => Promise<CollaborationRunSnapshot>;
  syncRunEvents: (runId: string, options?: { limit?: number; maxPages?: number }) => Promise<void>;
  handleChangedHint: (hint: CollaborationChangedHint) => Promise<void>;
  startChangedHintSubscription: () => () => void;
  executeCommand: <T extends Record<string, unknown>>(
    method: CollaborationWriteMethod,
    request: CollaborationWriteRequest<T>,
  ) => Promise<CollaborationWriteResponse>;
  startSessionPolling: (
    session: CollaborationSessionRef,
    options?: CollaborationPollingOptions,
  ) => () => void;
  stopAllPolling: () => void;
  clearSessionProjection: (session: CollaborationSessionRef) => void;
  reset: () => void;
}

interface Poller {
  stopped: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const EMPTY_DATA = {
  runsById: {} as Record<string, CollaborationRunSummary>,
  snapshotsByRunId: {} as Record<string, CollaborationRunSnapshot>,
  runIdsBySession: {} as Record<string, string[]>,
  eventsByRunId: {} as Record<string, CollaborationEvent[]>,
  cursorsByRunId: {} as Record<string, CollaborationEventCursor>,
  tombstones: [] as CollaborationTombstone[],
  sessionSync: {} as Record<string, CollaborationSessionSyncState>,
  commandsById: {} as Record<string, CollaborationCommandState>,
};

const GLOBAL_RUN_PAGE_SIZE = 500;
const GLOBAL_RUN_MAX_RESULTS = 10_000;
const GLOBAL_RUN_MAX_PAGES = Math.ceil(GLOBAL_RUN_MAX_RESULTS / GLOBAL_RUN_PAGE_SIZE) + 1;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeRunSummary(
  current: Record<string, CollaborationRunSummary>,
  incoming: CollaborationRunSummary,
): Record<string, CollaborationRunSummary> {
  const existing = current[incoming.runId];
  if (existing && existing.revision > incoming.revision) return current;
  return { ...current, [incoming.runId]: incoming };
}

function mergeEvents(existing: CollaborationEvent[], incoming: CollaborationEvent[]): CollaborationEvent[] {
  if (incoming.length === 0) return existing;
  const bySequence = new Map(existing.map((event) => [event.sequence, event]));
  for (const event of incoming) {
    const previous = bySequence.get(event.sequence);
    if (!previous || event.runRevision >= previous.runRevision) bySequence.set(event.sequence, event);
  }
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

function withoutRunIds<T>(record: Record<string, T>, deletedRunIds: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([runId]) => !deletedRunIds.has(runId)),
  );
}

function localPollerKey(session: CollaborationSessionRef): string {
  return JSON.stringify([session.sessionKey, session.sessionId]);
}

export function createCollaborationStore(
  client: CollaborationClient = collaborationClient,
): UseBoundStore<StoreApi<CollaborationState>> {
  let bootstrapInFlight: Promise<CollaborationCapabilities> | null = null;
  let bootstrapGeneration = 0;
  let projectionEpoch = 0;
  let tombstoneRequestGeneration = 0;
  const eventSyncInFlight = new Map<string, Promise<void>>();
  const sessionRequestGeneration = new Map<string, number>();
  const pollers = new Map<string, Poller>();
  let recoverInstanceMismatch: (error: unknown) => Promise<void> = async () => undefined;

  const assertInstance = (expected: string | null, actual: string | null): void => {
    if (expected !== actual) {
      throw new CollaborationClientError(
        'INSTANCE_MISMATCH',
        `Collaboration instance changed from ${expected} to ${actual}`,
        'junqi.collab.instance',
        { expected, actual },
      );
    }
  };

  const store = create<CollaborationState>((set, get) => ({
    collaborationInstanceId: null,
    capabilities: null,
    ...EMPTY_DATA,
    globalError: null,

    bootstrap: async (force = false) => {
      if (!force && get().capabilities) return get().capabilities!;
      if (!force && bootstrapInFlight) return bootstrapInFlight;

      const generation = ++bootstrapGeneration;
      const task = client.capabilities().then((capabilities) => {
        if (generation !== bootstrapGeneration) return get().capabilities ?? capabilities;
        const previousInstance = get().collaborationInstanceId;
        const changed = previousInstance !== null && previousInstance !== capabilities.collaborationInstanceId;
        if (changed) {
          get().stopAllPolling();
          projectionEpoch += 1;
          eventSyncInFlight.clear();
          sessionRequestGeneration.clear();
          tombstoneRequestGeneration += 1;
        }
        set({
          ...(changed ? EMPTY_DATA : {}),
          collaborationInstanceId: capabilities.collaborationInstanceId,
          capabilities,
          globalError: null,
        });
        return capabilities;
      }).catch((error) => {
        if (generation === bootstrapGeneration) set({ globalError: errorMessage(error) });
        throw error;
      }).finally(() => {
        if (bootstrapInFlight === task) bootstrapInFlight = null;
      });

      bootstrapInFlight = task;
      return task;
    },

    syncSession: async (session) => {
      const capabilities = await get().bootstrap();
      const requestProjectionEpoch = projectionEpoch;
      const identityKey = collaborationSessionIdentityKey(capabilities.collaborationInstanceId, session);
      const generation = (sessionRequestGeneration.get(identityKey) ?? 0) + 1;
      sessionRequestGeneration.set(identityKey, generation);
      set((state) => ({
        sessionSync: {
          ...state.sessionSync,
          [identityKey]: { ...state.sessionSync[identityKey], loading: true, error: undefined },
        },
      }));

      try {
        const response = await client.listRunsBySession(session, { includeArchived: true });
        if (requestProjectionEpoch !== projectionEpoch) {
          throw new CollaborationClientError(
            'INSTANCE_MISMATCH',
            'Collaboration projection changed while the session was loading',
            'junqi.collab.run.listBySession',
            { requestProjectionEpoch, currentProjectionEpoch: projectionEpoch },
          );
        }
        assertInstance(capabilities.collaborationInstanceId, response.collaborationInstanceId);
        assertInstance(get().collaborationInstanceId, response.collaborationInstanceId);
        if (sessionRequestGeneration.get(identityKey) !== generation) return response.runs;

        set((state) => {
          const deletedRunIds = new Set(state.tombstones.map((tombstone) => tombstone.runId));
          const visibleRuns = response.runs.filter((run) => !deletedRunIds.has(run.runId));
          let runsById = state.runsById;
          for (const run of visibleRuns) runsById = mergeRunSummary(runsById, run);
          return {
            runsById,
            runIdsBySession: {
              ...state.runIdsBySession,
              [identityKey]: visibleRuns.map((run) => run.runId),
            },
            sessionSync: {
              ...state.sessionSync,
              [identityKey]: { loading: false, lastSyncedAt: Date.now() },
            },
            globalError: null,
          };
        });
        return response.runs;
      } catch (error) {
        if (requestProjectionEpoch !== projectionEpoch) throw error;
        await recoverInstanceMismatch(error);
        if (
          get().collaborationInstanceId === capabilities.collaborationInstanceId &&
          sessionRequestGeneration.get(identityKey) === generation
        ) {
          set((state) => ({
            sessionSync: {
              ...state.sessionSync,
              [identityKey]: { loading: false, error: errorMessage(error) },
            },
          }));
        }
        throw error;
      }
    },

    syncGlobalRuns: async (options = {}) => {
      const capabilities = await get().bootstrap();
      const requestProjectionEpoch = projectionEpoch;
      try {
        const runsById = new Map<string, CollaborationRunSummary>();
        const seenCursors = new Set<string>();
        let cursor: string | undefined;
        let resultCount = 0;
        let pageCount = 0;

        while (true) {
          pageCount += 1;
          if (pageCount > GLOBAL_RUN_MAX_PAGES) {
            throw new CollaborationClientError(
              'CAPACITY_EXCEEDED',
              `Collaboration history exceeded ${GLOBAL_RUN_MAX_RESULTS} runs`,
              'junqi.collab.run.list',
            );
          }
          const response = await client.listRuns({
            ...options,
            limit: GLOBAL_RUN_PAGE_SIZE,
            ...(cursor ? { cursor } : {}),
          });
          if (requestProjectionEpoch !== projectionEpoch) return [...runsById.values()];
          assertInstance(capabilities.collaborationInstanceId, response.collaborationInstanceId);
          assertInstance(get().collaborationInstanceId, response.collaborationInstanceId);
          resultCount += response.runs.length;
          if (resultCount > GLOBAL_RUN_MAX_RESULTS) {
            throw new CollaborationClientError(
              'CAPACITY_EXCEEDED',
              `Collaboration history exceeded ${GLOBAL_RUN_MAX_RESULTS} runs`,
              'junqi.collab.run.list',
            );
          }
          for (const run of response.runs) {
            const current = runsById.get(run.runId);
            if (!current || current.revision <= run.revision) runsById.set(run.runId, run);
          }

          const nextCursor = response.nextCursor;
          if (!nextCursor) break;
          if (nextCursor === cursor || seenCursors.has(nextCursor)) {
            throw new CollaborationClientError(
              'INVALID_RESPONSE',
              'junqi.collab.run.list returned a repeated or non-advancing cursor',
              'junqi.collab.run.list',
            );
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }

        const runs = [...runsById.values()].sort((left, right) => {
          if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
          if (left.runId === right.runId) return 0;
          return left.runId < right.runId ? 1 : -1;
        });
        if (requestProjectionEpoch !== projectionEpoch) return runs;
        set((state) => {
          const deletedRunIds = new Set(state.tombstones.map((tombstone) => tombstone.runId));
          let mergedRunsById = state.runsById;
          for (const run of runs) {
            if (!deletedRunIds.has(run.runId)) mergedRunsById = mergeRunSummary(mergedRunsById, run);
          }
          return { runsById: mergedRunsById, globalError: null };
        });
        return runs;
      } catch (error) {
        if (requestProjectionEpoch !== projectionEpoch) return [];
        await recoverInstanceMismatch(error);
        throw error;
      }
    },

    syncTombstones: async () => {
      const capabilities = await get().bootstrap();
      const requestInstanceId = capabilities.collaborationInstanceId;
      const generation = ++tombstoneRequestGeneration;
      try {
        const response = await client.listTombstones({ limit: 500 });
        assertInstance(requestInstanceId, response.collaborationInstanceId);
        assertInstance(get().collaborationInstanceId, response.collaborationInstanceId);
        if (generation !== tombstoneRequestGeneration) return response.tombstones;

        set((state) => {
          const deletedRunIds = new Set(response.tombstones.map((tombstone) => tombstone.runId));
          return {
            tombstones: response.tombstones,
            runsById: withoutRunIds(state.runsById, deletedRunIds),
            snapshotsByRunId: withoutRunIds(state.snapshotsByRunId, deletedRunIds),
            eventsByRunId: withoutRunIds(state.eventsByRunId, deletedRunIds),
            cursorsByRunId: withoutRunIds(state.cursorsByRunId, deletedRunIds),
            commandsById: Object.fromEntries(
              Object.entries(state.commandsById).filter(([, command]) => !command.runId || !deletedRunIds.has(command.runId)),
            ),
            runIdsBySession: Object.fromEntries(
              Object.entries(state.runIdsBySession).map(([key, runIds]) => [
                key,
                runIds.filter((runId) => !deletedRunIds.has(runId)),
              ]),
            ),
            globalError: null,
          };
        });
        return response.tombstones;
      } catch (error) {
        await recoverInstanceMismatch(error);
        throw error;
      }
    },

    refreshRun: async (runId) => {
      const capabilities = await get().bootstrap();
      const projectionGeneration = tombstoneRequestGeneration;
      if (get().tombstones.some((tombstone) => tombstone.runId === runId)) {
        throw new CollaborationClientError(
          'NOT_FOUND',
          `Collaboration run ${runId} was deleted`,
          'junqi.collab.run.get',
          { runId },
        );
      }
      try {
        const response = await client.getRun(runId);
        assertInstance(capabilities.collaborationInstanceId, response.collaborationInstanceId);
        assertInstance(get().collaborationInstanceId, response.collaborationInstanceId);
        if (response.snapshot.runId !== runId) {
          throw new CollaborationClientError(
            'INVALID_RESPONSE',
            `run.get returned snapshot ${response.snapshot.runId} for ${runId}`,
            'junqi.collab.run.get',
          );
        }
        if (
          projectionGeneration !== tombstoneRequestGeneration
          || get().tombstones.some((tombstone) => tombstone.runId === runId)
        ) {
          throw new CollaborationClientError(
            'NOT_FOUND',
            `Collaboration run ${runId} was deleted while its snapshot was loading`,
            'junqi.collab.run.get',
            { runId },
          );
        }

        set((state) => {
          if (state.tombstones.some((tombstone) => tombstone.runId === runId)) return state;
          const existing = state.runsById[runId];
          if (existing && existing.revision > response.snapshot.revision) return state;
          return {
            runsById: { ...state.runsById, [runId]: response.snapshot },
            snapshotsByRunId: { ...state.snapshotsByRunId, [runId]: response.snapshot },
            globalError: null,
          };
        });
        return response.snapshot;
      } catch (error) {
        await recoverInstanceMismatch(error);
        throw error;
      }
    },

    syncRunEvents: async (runId, options = {}) => {
      const existingTask = eventSyncInFlight.get(runId);
      if (existingTask) return existingTask;

      const task = (async () => {
        const capabilities = await get().bootstrap();
        const requestInstanceId = capabilities.collaborationInstanceId;
        const projectionGeneration = tombstoneRequestGeneration;
        const projectionWasDeleted = () => (
          projectionGeneration !== tombstoneRequestGeneration
          || get().tombstones.some((tombstone) => tombstone.runId === runId)
        );
        if (projectionWasDeleted()) return;
        const initialCursor = get().cursorsByRunId[runId] ?? {
          afterSequence: 0,
          snapshotRevision: 0,
          complete: true,
          syncing: false,
        };
        set((state) => ({
          cursorsByRunId: {
            ...state.cursorsByRunId,
            [runId]: { ...initialCursor, syncing: true, error: undefined },
          },
        }));

        let afterSequence = initialCursor.afterSequence;
        let snapshotRevision = initialCursor.snapshotRevision;
        let complete = initialCursor.complete;
        let incompleteReason = initialCursor.incompleteReason;
        let accumulated: CollaborationEvent[] = [];
        const knownRun = get().runsById[runId];
        const knownSnapshot = get().snapshotsByRunId[runId];
        let shouldRefreshSnapshot = !knownSnapshot || (knownRun?.revision ?? 0) > knownSnapshot.revision;
        const requestedMaxPages = options.maxPages ?? 20;
        const maxPages = Number.isFinite(requestedMaxPages)
          ? Math.max(1, Math.floor(requestedMaxPages))
          : 20;

        try {
          for (let pageNo = 0; pageNo < maxPages; pageNo += 1) {
            const page = await client.listEvents({
              runId,
              afterSequence,
              limit: options.limit ?? 200,
            });
            assertInstance(requestInstanceId, page.collaborationInstanceId);
            assertInstance(get().collaborationInstanceId, page.collaborationInstanceId);
            if (projectionWasDeleted()) return;
            if (page.runId !== runId) {
              throw new CollaborationClientError(
                'INVALID_RESPONSE',
                `events.list returned events for ${page.runId} while syncing ${runId}`,
                'junqi.collab.events.list',
              );
            }

            accumulated = mergeEvents(accumulated, page.events.filter((event) => event.runId === runId));
            snapshotRevision = Math.max(snapshotRevision, page.snapshotRevision);
            shouldRefreshSnapshot ||= page.snapshotRevision > (get().runsById[runId]?.revision ?? 0);

            if (page.cursorInvalid) {
              complete = false;
              incompleteReason = page.cursorInvalidReason || 'cursor_invalid';
              afterSequence = Math.max(afterSequence, page.nextSequence);
              shouldRefreshSnapshot = true;
              break;
            }
            if (page.nextSequence < afterSequence || (page.hasMore && page.nextSequence === afterSequence)) {
              throw new CollaborationClientError(
                'INVALID_RESPONSE',
                'events.list returned a non-advancing cursor',
                'junqi.collab.events.list',
                { runId, afterSequence, nextSequence: page.nextSequence },
              );
            }
            afterSequence = page.nextSequence;
            if (!page.hasMore) {
              if (incompleteReason === 'page_limit') {
                complete = true;
                incompleteReason = undefined;
              }
              break;
            }
            if (pageNo === maxPages - 1) {
              complete = false;
              incompleteReason = 'page_limit';
            }
          }

          if (projectionWasDeleted()) return;
          set((state) => {
            if (state.tombstones.some((tombstone) => tombstone.runId === runId)) return state;
            return {
              eventsByRunId: {
                ...state.eventsByRunId,
                [runId]: mergeEvents(state.eventsByRunId[runId] ?? [], accumulated),
              },
              cursorsByRunId: {
                ...state.cursorsByRunId,
                [runId]: {
                  afterSequence,
                  snapshotRevision,
                  complete,
                  ...(incompleteReason ? { incompleteReason } : {}),
                  syncing: false,
                  lastSyncedAt: Date.now(),
                },
              },
            };
          });

          if (shouldRefreshSnapshot && !projectionWasDeleted()) await get().refreshRun(runId);
        } catch (error) {
          await recoverInstanceMismatch(error);
          if (get().collaborationInstanceId === requestInstanceId && !projectionWasDeleted()) {
            set((state) => ({
              cursorsByRunId: {
                ...state.cursorsByRunId,
                [runId]: {
                  ...(state.cursorsByRunId[runId] ?? initialCursor),
                  syncing: false,
                  error: errorMessage(error),
                },
              },
            }));
          }
          throw error;
        }
      })().finally(() => {
        if (eventSyncInFlight.get(runId) === task) eventSyncInFlight.delete(runId);
      });

      eventSyncInFlight.set(runId, task);
      return task;
    },

    handleChangedHint: async (rawHint) => {
      const hint = parseCollaborationChangedHint(rawHint);
      if (!hint) return;

      const capabilities = await get().bootstrap();
      // Push is never authoritative. A hint from a replaced/foreign plugin
      // instance is ignored; normal bootstrap/polling discovers instance swaps.
      if (hint.collaborationInstanceId !== capabilities.collaborationInstanceId) return;
      if (hint.collaborationInstanceId !== get().collaborationInstanceId) return;

      const run = get().runsById[hint.runId];
      const snapshot = get().snapshotsByRunId[hint.runId];
      const cursor = get().cursorsByRunId[hint.runId]?.afterSequence ?? 0;
      const snapshotRevision = snapshot?.revision ?? 0;
      if (
        run
        && snapshot
        && hint.runRevision <= Math.min(run.revision, snapshotRevision)
        && hint.lastSequence <= cursor
      ) {
        return;
      }
      const needsSnapshot = !run
        || !snapshot
        || hint.runRevision > run.revision
        || hint.runRevision > snapshotRevision;
      if (hint.lastSequence > cursor) {
        // Event sync compares the authoritative page snapshotRevision and
        // refreshes run.get when needed, avoiding duplicate concurrent reads.
        await get().syncRunEvents(hint.runId);
      } else if (needsSnapshot) {
        await get().refreshRun(hint.runId);
      }

      // A hint can be the first observation of a run created outside this
      // Desktop process. Its authoritative OriginRef links it to the session.
      if (get().collaborationInstanceId !== capabilities.collaborationInstanceId) return;
      const refreshedRun = get().runsById[hint.runId];
      if (!refreshedRun || get().tombstones.some((tombstone) => tombstone.runId === hint.runId)) return;
      const sessionKey = collaborationSessionIdentityKey(
        capabilities.collaborationInstanceId,
        refreshedRun.origin,
      );
      set((state) => {
        const runIds = state.runIdsBySession[sessionKey] ?? [];
        if (runIds.includes(hint.runId)) return state;
        return {
          runIdsBySession: {
            ...state.runIdsBySession,
            [sessionKey]: [...runIds, hint.runId],
          },
        };
      });
    },

    startChangedHintSubscription: () => {
      let active = true;
      const unsubscribe = subscribeCollaborationChangedHints((hint) => {
        if (!active) return;
        void get().handleChangedHint(hint).catch(() => {
          // Polling remains the correctness path when a best-effort hint fails.
        });
      });
      return () => {
        active = false;
        unsubscribe();
      };
    },

    executeCommand: async (method, request) => {
      const capabilities = await get().bootstrap();
      const requestInstanceId = request.expectedCollaborationInstanceId;
      assertInstance(requestInstanceId, capabilities.collaborationInstanceId);
      set((state) => ({
        commandsById: {
          ...state.commandsById,
          [request.commandId]: { commandId: request.commandId, method, status: 'submitting' },
        },
      }));
      try {
        const response = await client.write(method, request);
        assertInstance(requestInstanceId, get().collaborationInstanceId);
        set((state) => ({
          commandsById: {
            ...state.commandsById,
            [request.commandId]: {
              commandId: request.commandId,
              method,
              status: 'accepted',
              ...(response.runId ? { runId: response.runId } : {}),
              response,
            },
          },
        }));
        if (response.runId) {
          await Promise.allSettled([
            get().refreshRun(response.runId),
            get().syncRunEvents(response.runId),
          ]);
        }
        return response;
      } catch (error) {
        await recoverInstanceMismatch(error);
        const clientError = error instanceof CollaborationClientError ? error : null;
        const instanceIsCurrent = get().collaborationInstanceId === requestInstanceId;
        if (instanceIsCurrent) {
          set((state) => ({
            commandsById: {
              ...state.commandsById,
              [request.commandId]: {
                commandId: request.commandId,
                method,
                status: 'failed',
                error: errorMessage(error),
                errorCode: clientError?.code,
              },
            },
          }));
        }
        const runId = typeof request.runId === 'string' ? request.runId : undefined;
        if (instanceIsCurrent && clientError?.code === 'REVISION_CONFLICT' && runId) {
          await get().refreshRun(runId).catch(() => undefined);
        }
        throw error;
      }
    },

    startSessionPolling: (session, options = {}) => {
      const key = localPollerKey(session);
      const previous = pollers.get(key);
      if (previous) {
        previous.stopped = true;
        if (previous.timer) clearTimeout(previous.timer);
      }

      const poller: Poller = { stopped: false };
      pollers.set(key, poller);
      const tick = async () => {
        if (poller.stopped) return;
        let hasActiveRuns = false;
        try {
          const runs = await get().syncSession(session);
          if (poller.stopped) return;
          hasActiveRuns = runs.some((run) => !isTerminalCollaborationRun(run.status));
          await Promise.allSettled(runs.map((run) => get().syncRunEvents(run.runId, {
            limit: options.eventPageSize,
          })));
        } catch {
          hasActiveRuns = true;
        }
        if (poller.stopped) return;
        const delay = hasActiveRuns ? (options.activeIntervalMs ?? 2_000) : (options.idleIntervalMs ?? 15_000);
        poller.timer = setTimeout(() => void tick(), delay);
      };
      void tick();

      return () => {
        poller.stopped = true;
        if (poller.timer) clearTimeout(poller.timer);
        if (pollers.get(key) === poller) pollers.delete(key);
      };
    },

    stopAllPolling: () => {
      for (const poller of pollers.values()) {
        poller.stopped = true;
        if (poller.timer) clearTimeout(poller.timer);
      }
      pollers.clear();
    },

    clearSessionProjection: (session) => {
      const instanceId = get().collaborationInstanceId;
      if (!instanceId) return;
      const pollerKey = localPollerKey(session);
      const poller = pollers.get(pollerKey);
      if (poller) {
        poller.stopped = true;
        if (poller.timer) clearTimeout(poller.timer);
        pollers.delete(pollerKey);
      }
      const identityKey = collaborationSessionIdentityKey(instanceId, session);
      sessionRequestGeneration.set(
        identityKey,
        (sessionRequestGeneration.get(identityKey) ?? 0) + 1,
      );
      set((state) => {
        const { [identityKey]: _runIds, ...runIdsBySession } = state.runIdsBySession;
        const { [identityKey]: _sync, ...sessionSync } = state.sessionSync;
        return { runIdsBySession, sessionSync };
      });
    },

    reset: () => {
      get().stopAllPolling();
      bootstrapGeneration += 1;
      projectionEpoch += 1;
      bootstrapInFlight = null;
      eventSyncInFlight.clear();
      sessionRequestGeneration.clear();
      tombstoneRequestGeneration += 1;
      set({
        collaborationInstanceId: null,
        capabilities: null,
        ...EMPTY_DATA,
        globalError: null,
      });
    },
  }));

  recoverInstanceMismatch = async (error) => {
    if (!(error instanceof CollaborationClientError) || error.code !== 'INSTANCE_MISMATCH') return;
    if (store.getState().collaborationInstanceId === null) return;
    await store.getState().bootstrap(true).catch(() => undefined);
  };

  return store;
}

export const useCollaborationStore = createCollaborationStore();

export function selectCollaborationRunsForSession(
  state: CollaborationState,
  session: CollaborationSessionRef,
): CollaborationRunSummary[] {
  if (!state.collaborationInstanceId) return [];
  const key = collaborationSessionIdentityKey(state.collaborationInstanceId, session);
  return (state.runIdsBySession[key] ?? [])
    .map((runId) => state.runsById[runId])
    .filter((run): run is CollaborationRunSummary => Boolean(run));
}
