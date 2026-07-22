export type OpenClawSessionRunLookup =
  | { state: 'missing' }
  | { state: 'history'; response: Record<string, unknown> }
  | { state: 'unknown' };

export type OpenClawSessionRunRequest = (
  method: 'sessions.describe' | 'chat.history',
  params: Record<string, unknown>,
) => Promise<unknown>;

const SESSION_RUN_RECONCILIATION_HISTORY_LIMIT = 50;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Resolve one session outside a paginated sessions.list page using official RPCs. */
export async function resolveOpenClawSessionRun(
  request: OpenClawSessionRunRequest,
  sessionKey: string,
): Promise<OpenClawSessionRunLookup> {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) return { state: 'unknown' };

  const description = record(await request('sessions.describe', { key: normalizedSessionKey }));
  if (!description || !Object.prototype.hasOwnProperty.call(description, 'session')) {
    return { state: 'unknown' };
  }
  if (description.session === null) return { state: 'missing' };
  if (!record(description.session)) return { state: 'unknown' };

  const history = record(await request('chat.history', {
    sessionKey: normalizedSessionKey,
    limit: SESSION_RUN_RECONCILIATION_HISTORY_LIMIT,
  }));
  if (!history) return { state: 'unknown' };
  const sessionInfo = record(history?.sessionInfo);
  if (!sessionInfo || typeof sessionInfo.hasActiveRun !== 'boolean') {
    return { state: 'unknown' };
  }
  return {
    state: 'history',
    response: history,
  };
}

export interface OpenClawSessionRunReconcilerDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (
    method: Parameters<OpenClawSessionRunRequest>[0],
    params: Parameters<OpenClawSessionRunRequest>[1],
    connectionId: string,
  ) => Promise<unknown>;
  captureObservation: (sessionKey: string) => unknown;
  isObservationCurrent: (observation: unknown) => boolean;
  applyMissing: (sessionKey: string) => void;
  applyHistory: (sessionKey: string, response: Record<string, unknown>, observation: unknown) => void;
  onError?: (sessionKey: string, error: unknown) => void;
}

/**
 * Keyed single-flight coordinator for pagination fallbacks.
 * Results are applied only while both the attested socket and local run
 * observation still match the lookup starting point.
 */
export class OpenClawSessionRunReconciler {
  private readonly inFlightBySession = new Map<string, {
    promise: Promise<void>;
    rerunRequested: boolean;
  }>();

  constructor(private readonly dependencies: OpenClawSessionRunReconcilerDependencies) {}

  reconcile(sessionKey: string): Promise<void> {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return Promise.resolve();
    const existing = this.inFlightBySession.get(normalizedSessionKey);
    if (existing) {
      existing.rerunRequested = true;
      return existing.promise;
    }

    const entry = {
      promise: Promise.resolve(),
      rerunRequested: false,
    };
    entry.promise = (async () => {
      do {
        entry.rerunRequested = false;
        await this.perform(normalizedSessionKey)
          .catch((error) => this.dependencies.onError?.(normalizedSessionKey, error));
      } while (entry.rerunRequested);
    })()
      .finally(() => {
        if (this.inFlightBySession.get(normalizedSessionKey) === entry) {
          this.inFlightBySession.delete(normalizedSessionKey);
        }
      });
    this.inFlightBySession.set(normalizedSessionKey, entry);
    return entry.promise;
  }

  private async perform(sessionKey: string): Promise<void> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) return;
    const observation = this.dependencies.captureObservation(sessionKey);
    const lookup = await resolveOpenClawSessionRun(
      (method, params) => this.dependencies.requestFenced(method, params, connectionId),
      sessionKey,
    );
    if (
      !this.dependencies.isConnectionCurrent(connectionId)
      || !this.dependencies.isObservationCurrent(observation)
    ) return;

    if (lookup.state === 'missing') {
      this.dependencies.applyMissing(sessionKey);
    } else if (lookup.state === 'history') {
      this.dependencies.applyHistory(sessionKey, lookup.response, observation);
    }
  }
}
