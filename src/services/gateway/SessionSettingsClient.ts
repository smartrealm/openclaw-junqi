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

export class SessionSettingsTargetError extends Error {
  readonly code = 'SESSION_SETTINGS_TARGET_REQUIRED';

  constructor() {
    super('SESSION_SETTINGS_TARGET_REQUIRED');
    this.name = 'SessionSettingsTargetError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSessionSettingsTarget(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) throw new SessionSettingsTargetError();
  return key;
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
 * `sessions.patch` 是 OpenClaw 控制平面变更。用户级会话组织字段走日常
 * operator.write 连接；只有官方动态权限规则要求管理员权限的运行参数才走短生命周期
 * operator.admin 连接。
 */
export class SessionSettingsClient {
  constructor(private readonly deps: SessionSettingsClientDeps) {}

  private async patch(
    sessionKey: string,
    patch: Record<string, unknown>,
    privileged: boolean,
  ): Promise<SessionPatchResult> {
    const key = requireSessionSettingsTarget(sessionKey);
    return this.deps.runMutation(key, async () => {
      const request = privileged ? this.deps.requestPrivileged : this.deps.request;
      const result = await request<unknown>('sessions.patch', {
        key,
        ...patch,
      });
      return confirmedPatchResult(result, key);
    });
  }

  setModel(sessionKey: string, model: string | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { model }, false);
  }

  setThinking(sessionKey: string, thinkingLevel: string | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { thinkingLevel }, true);
  }

  setFastMode(sessionKey: string, fastMode: boolean | 'auto' | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { fastMode }, true);
  }

  setVerbose(sessionKey: string, verboseLevel: 'on' | 'full' | 'off' | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { verboseLevel }, true);
  }

  setTrace(sessionKey: string, traceLevel: 'on' | 'off' | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { traceLevel }, true);
  }

  setResponseUsage(sessionKey: string, responseUsage: 'off' | 'tokens' | 'full' | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { responseUsage }, true);
  }

  setReasoning(sessionKey: string, reasoningLevel: 'on' | 'off' | 'stream' | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { reasoningLevel }, true);
  }

  setLabel(sessionKey: string, label: string | null): Promise<SessionPatchResult> {
    return this.patch(sessionKey, { label }, false);
  }
}
