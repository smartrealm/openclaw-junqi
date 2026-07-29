export type SessionPatchResult = {
  ok: true;
  key: string;
  entry: Record<string, unknown>;
  resolved: {
    modelProvider: string;
    model: string;
    [key: string]: unknown;
  };
};

type SessionMutationRunner = <T>(sessionKey: string, operation: () => Promise<T>) => Promise<T>;
type GatewayRequester = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

export interface SessionSettingsClientDeps {
  runMutation: SessionMutationRunner;
  request: GatewayRequester;
  requestPrivileged: GatewayRequester;
}

export class SessionSettingsResponseError extends Error {
  readonly code = 'SESSION_SETTINGS_RESPONSE_INVALID';

  constructor(readonly reason: 'invalid-payload' | 'not-confirmed' | 'missing-entry' | 'missing-resolved-model') {
    super('SESSION_SETTINGS_RESPONSE_INVALID');
    this.name = 'SessionSettingsResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function confirmedPatchResult(result: unknown, sessionKey: string): SessionPatchResult {
  if (!isRecord(result)) {
    throw new SessionSettingsResponseError('invalid-payload');
  }

  if (result.ok !== true || result.key !== sessionKey) {
    throw new SessionSettingsResponseError('not-confirmed');
  }
  if (!isRecord(result.entry)) {
    throw new SessionSettingsResponseError('missing-entry');
  }
  if (!isRecord(result.resolved)) {
    throw new SessionSettingsResponseError('missing-resolved-model');
  }
  const resolved = result.resolved;
  if (
    typeof resolved.modelProvider !== 'string'
    || !resolved.modelProvider.trim()
    || typeof resolved.model !== 'string'
    || !resolved.model.trim()
  ) {
    throw new SessionSettingsResponseError('missing-resolved-model');
  }

  return {
    ok: true,
    key: sessionKey,
    entry: result.entry,
    resolved: {
      ...resolved,
      modelProvider: resolved.modelProvider,
      model: resolved.model,
    },
  };
}

/**
 * Routes each sessions.patch field through the least privileged connection
 * accepted by OpenClaw 2026.7.1. Runtime overrides require operator.admin;
 * user-facing organization fields such as label remain operator.write.
 */
export class SessionSettingsClient {
  constructor(private readonly deps: SessionSettingsClientDeps) {}

  private patch(
    sessionKey: string,
    patch: Record<string, unknown>,
    privileged: boolean,
  ): Promise<SessionPatchResult> {
    return this.deps.runMutation(sessionKey, async () => {
      const request = privileged ? this.deps.requestPrivileged : this.deps.request;
      const result = await request<unknown>('sessions.patch', { key: sessionKey, ...patch });
      return confirmedPatchResult(result, sessionKey);
    });
  }

  setModel(sessionKey: string, model: string | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { model }, true);
  }

  setThinking(sessionKey: string, thinkingLevel: string | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { thinkingLevel }, true);
  }

  setLabel(sessionKey: string, label: string | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { label }, false);
  }
}
