export const OPENCLAW_SESSIONS_VIEWERS_SET_METHOD = 'sessions.viewers.set' as const;
export const OPENCLAW_SESSION_VIEWER_PRESENCE_MAX_KEYS = 32;

export interface OpenClawSessionViewerPresenceDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (
    method: string,
    params: Record<string, unknown>,
    connectionId: string,
  ) => Promise<unknown>;
}

export type OpenClawSessionViewerPresenceResult = 'applied' | 'unavailable';

export class OpenClawSessionViewerPresenceResponseError extends Error {
  readonly code = 'OPENCLAW_SESSION_VIEWER_PRESENCE_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid sessions.viewers.set response');
    this.name = 'OpenClawSessionViewerPresenceResponseError';
  }
}

function normalizeSessionKeys(value: readonly string[]): string[] {
  const keys = [...new Set(value.map((key) => key.trim()).filter(Boolean))].sort();
  if (keys.length > OPENCLAW_SESSION_VIEWER_PRESENCE_MAX_KEYS) {
    throw new Error('OpenClaw sessions.viewers.set session keys exceed the official limit');
  }
  return keys;
}

function parseResult(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenClawSessionViewerPresenceResponseError();
  }
  const sessionKeys = (value as Record<string, unknown>).sessionKeys;
  if (!Array.isArray(sessionKeys) || !sessionKeys.every((key) => typeof key === 'string' && key.trim())) {
    throw new OpenClawSessionViewerPresenceResponseError();
  }
  try {
    return normalizeSessionKeys(sessionKeys);
  } catch {
    throw new OpenClawSessionViewerPresenceResponseError();
  }
}

/** 串行维护当前 Gateway 连接的会话查看声明，不拥有任何会话状态。 */
export class OpenClawSessionViewerPresenceClient {
  private desired: string[] = [];
  private applied: { connectionId: string; signature: string } | null = null;
  private draining: Promise<OpenClawSessionViewerPresenceResult> | null = null;
  private transportGeneration = 0;

  constructor(private readonly dependencies: OpenClawSessionViewerPresenceDependencies) {}

  setVisibleSessions(sessionKeys: readonly string[]): Promise<OpenClawSessionViewerPresenceResult> {
    this.desired = normalizeSessionKeys(sessionKeys);
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  resetTransport(): void {
    this.transportGeneration += 1;
    this.desired = [];
    this.applied = null;
  }

  private async drain(): Promise<OpenClawSessionViewerPresenceResult> {
    for (;;) {
      const sessionKeys = this.desired;
      const signature = JSON.stringify(sessionKeys);
      const connectionId = this.dependencies.captureConnectionId();
      const transportGeneration = this.transportGeneration;
      if (!connectionId) {
        this.applied = null;
        return sessionKeys.length > 0 ? 'unavailable' : 'applied';
      }
      if (this.applied?.connectionId !== connectionId) this.applied = null;
      if (this.applied?.signature === signature) return 'applied';

      try {
        parseResult(await this.dependencies.requestFenced(
          OPENCLAW_SESSIONS_VIEWERS_SET_METHOD,
          { sessionKeys },
          connectionId,
        ));
      } catch {
        this.applied = null;
        return 'unavailable';
      }
      if (
        transportGeneration !== this.transportGeneration
        || !this.dependencies.isConnectionCurrent(connectionId)
      ) {
        this.applied = null;
        return 'unavailable';
      }
      this.applied = { connectionId, signature };
      if (this.desired === sessionKeys || JSON.stringify(this.desired) === signature) return 'applied';
    }
  }
}
