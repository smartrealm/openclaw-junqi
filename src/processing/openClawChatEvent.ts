export const OPENCLAW_CHAT_RUN_STARTUP_PHASES = [
  'preparing_workspace',
  'provisioning_environment',
  'preparing_context',
  'starting_model',
] as const;

export type OpenClawChatRunStartupPhase = typeof OPENCLAW_CHAT_RUN_STARTUP_PHASES[number];

export interface OpenClawChatRunStartup {
  runId: string;
  phase: OpenClawChatRunStartupPhase;
}

export interface OpenClawChatDeltaProjectionInput {
  deltaText?: unknown;
  replace?: unknown;
  snapshotText: string | null;
}

export interface OpenClawChatSendDeliveryUncertain {
  deliveryUncertain: true;
  runId: string;
}

export type OpenClawLiveChatState = 'status' | 'delta' | 'final' | 'aborted' | 'error';

interface OpenClawLiveEventBase {
  readonly runId: string;
  readonly sessionKey: string;
  readonly seq: number;
  readonly agentId?: string;
  readonly spawnedBy?: string;
}

export interface OpenClawLiveAgentEventPayload {
  readonly runId: string;
  readonly seq: number;
  readonly stream: string;
  readonly ts: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly sessionKey?: string;
  readonly sessionId?: string;
  readonly agentId?: string;
}

interface OpenClawLiveChatTerminalBase extends OpenClawLiveEventBase {
  readonly message?: unknown;
  readonly usage?: unknown;
  readonly stopReason?: string;
}

export type OpenClawLiveChatEventPayload =
  | (OpenClawLiveEventBase & {
      readonly state: 'status';
      readonly phase: OpenClawChatRunStartupPhase;
    })
  | (OpenClawLiveEventBase & {
      readonly state: 'delta';
      readonly deltaText: string;
      readonly replace?: boolean;
      readonly message?: unknown;
      readonly usage?: unknown;
    })
  | (OpenClawLiveChatTerminalBase & {
      readonly state: 'final';
      readonly yielded?: true;
    })
  | (OpenClawLiveChatTerminalBase & {
      readonly state: 'aborted';
      readonly errorMessage?: string;
    })
  | (OpenClawLiveChatTerminalBase & {
      readonly state: 'error';
      readonly errorMessage?: string;
      readonly errorKind?: 'refusal' | 'timeout' | 'rate_limit' | 'context_length' | 'unknown';
    });

export interface OpenClawLiveSessionToolEventPayload extends OpenClawLiveAgentEventPayload {
  readonly sessionKey: string;
}

export type OpenClawLiveGatewayEvent =
  | { readonly kind: 'agent'; readonly payload: OpenClawLiveAgentEventPayload }
  | { readonly kind: 'chat'; readonly payload: OpenClawLiveChatEventPayload }
  | { readonly kind: 'session-tool'; readonly payload: OpenClawLiveSessionToolEventPayload };

const CHAT_ERROR_KINDS = [
  'refusal',
  'timeout',
  'rate_limit',
  'context_length',
  'unknown',
] as const;

type OpenClawLiveChatErrorKind = typeof CHAT_ERROR_KINDS[number];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optionalText(value: unknown): string | undefined | null {
  return value === undefined ? undefined : nonEmptyText(value);
}

function owns(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function startupPhase(value: unknown): OpenClawChatRunStartupPhase | null {
  if (typeof value !== 'string') return null;
  return OPENCLAW_CHAT_RUN_STARTUP_PHASES.find((phase) => phase === value) ?? null;
}

function chatErrorKind(value: unknown): OpenClawLiveChatErrorKind | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return CHAT_ERROR_KINDS.find((kind) => kind === value) ?? null;
}

function parseAgentPayload(value: unknown): OpenClawLiveAgentEventPayload | null {
  const source = record(value);
  const runId = nonEmptyText(source?.runId);
  const seq = nonNegativeSafeInteger(source?.seq);
  const stream = nonEmptyText(source?.stream);
  const ts = nonNegativeSafeInteger(source?.ts);
  const data = record(source?.data);
  const sessionKey = optionalText(source?.sessionKey);
  const sessionId = optionalText(source?.sessionId);
  const agentId = optionalText(source?.agentId);
  if (!source || !runId || seq === null || !stream || ts === null || !data
    || sessionKey === null || sessionId === null || agentId === null) {
    return null;
  }
  return {
    runId,
    seq,
    stream,
    ts,
    data,
    ...(sessionKey ? { sessionKey } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

function parseChatPayload(value: unknown): OpenClawLiveChatEventPayload | null {
  const source = record(value);
  const runId = nonEmptyText(source?.runId);
  const sessionKey = nonEmptyText(source?.sessionKey);
  const seq = nonNegativeSafeInteger(source?.seq);
  const agentId = optionalText(source?.agentId);
  const spawnedBy = optionalText(source?.spawnedBy);
  const state = source?.state;
  if (!source || !runId || !sessionKey || seq === null || agentId === null || spawnedBy === null
    || (state !== 'status' && state !== 'delta' && state !== 'final' && state !== 'aborted' && state !== 'error')) {
    return null;
  }

  if (state === 'status') {
    const phase = startupPhase(source.phase);
    if (!phase) return null;
    return {
      runId,
      sessionKey,
      seq,
      state,
      phase,
      ...(agentId ? { agentId } : {}),
      ...(spawnedBy ? { spawnedBy } : {}),
    };
  }

  if (state === 'delta') {
    if (typeof source.deltaText !== 'string' || (source.replace !== undefined && typeof source.replace !== 'boolean')) {
      return null;
    }
    return {
      runId,
      sessionKey,
      seq,
      state,
      deltaText: source.deltaText,
      ...(source.replace === true ? { replace: true } : {}),
      ...(owns(source, 'message') ? { message: source.message } : {}),
      ...(owns(source, 'usage') ? { usage: source.usage } : {}),
      ...(agentId ? { agentId } : {}),
      ...(spawnedBy ? { spawnedBy } : {}),
    };
  }

  const errorMessage = source.errorMessage;
  const stopReason = source.stopReason;
  if ((errorMessage !== undefined && typeof errorMessage !== 'string')
    || (stopReason !== undefined && typeof stopReason !== 'string')) {
    return null;
  }

  const base = {
    runId,
    sessionKey,
    seq,
    ...(owns(source, 'message') ? { message: source.message } : {}),
    ...(owns(source, 'usage') ? { usage: source.usage } : {}),
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(agentId ? { agentId } : {}),
    ...(spawnedBy ? { spawnedBy } : {}),
  };
  if (state === 'final') {
    if (source.yielded !== undefined && source.yielded !== true) return null;
    return {
      ...base,
      state,
      ...(source.yielded === true ? { yielded: true } : {}),
    };
  }
  if (state === 'aborted') {
    return {
      ...base,
      state,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    };
  }
  const errorKind = chatErrorKind(source.errorKind);
  if (errorKind === null) return null;
  return {
    ...base,
    state: 'error',
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(errorKind !== undefined ? { errorKind } : {}),
  };
}

export function parseOpenClawLiveGatewayEvent(value: unknown): OpenClawLiveGatewayEvent | null {
  const envelope = record(value);
  if (!envelope || envelope.type !== 'event') return null;

  if (envelope.event === 'agent') {
    const payload = parseAgentPayload(envelope.payload);
    return payload ? { kind: 'agent', payload } : null;
  }
  if (envelope.event === 'chat') {
    const payload = parseChatPayload(envelope.payload);
    return payload ? { kind: 'chat', payload } : null;
  }
  if (envelope.event === 'session.tool') {
    const payload = parseAgentPayload(envelope.payload);
    if (!payload?.sessionKey || payload.stream !== 'tool') return null;
    return {
      kind: 'session-tool',
      payload: {
        ...payload,
        sessionKey: payload.sessionKey,
      },
    };
  }
  return null;
}

export function isOpenClawChatSendDeliveryUncertain(
  value: unknown,
): value is OpenClawChatSendDeliveryUncertain {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).deliveryUncertain === true
    && typeof (value as Record<string, unknown>).runId === 'string',
  );
}

export function parseOpenClawChatRunStartup(value: unknown): OpenClawChatRunStartup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.state !== 'status') return null;
  const runId = typeof record.runId === 'string' ? record.runId.trim() : '';
  const phase = startupPhase(record.phase);
  return runId && phase ? { runId, phase } : null;
}

export function resolveOpenClawChatDeltaText(
  currentStream: string | null,
  input: OpenClawChatDeltaProjectionInput,
): string | null {
  const deltaText = typeof input.deltaText === 'string' ? input.deltaText : null;
  if (deltaText !== null) {
    if (input.replace === true) return deltaText;
    if (currentStream === null) return input.snapshotText ?? deltaText;
    if (input.snapshotText !== null) {
      const prefixLength = input.snapshotText.length - deltaText.length;
      if (
        prefixLength !== currentStream.length
        || input.snapshotText.slice(0, prefixLength) !== currentStream
      ) {
        return input.snapshotText;
      }
    }
    return `${currentStream}${deltaText}`;
  }
  return input.snapshotText;
}
