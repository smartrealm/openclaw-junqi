import {
  decodeTalkCatalog,
  decodeTalkSession,
  selectRealtimeRelayConfiguration,
  type TalkAgentControlInput,
  type TalkCatalog,
  type TalkSession,
} from './talkTypes';
import type {
  TalkEventListener,
  TalkGatewayEvent,
  TalkRelayEvent,
  TalkRelayEventListener,
} from './talkEventBridge';
import type { GatewayRequestOptions } from './Connection';

const AUDIO_APPEND_TIMEOUT_MS = 8_000;
const AGENT_CONSULT_WAIT_TIMEOUT_MS = 120_000;
const AGENT_CONSULT_REQUEST_GRACE_MS = 2_000;

export const TALK_AGENT_CONSULT_TOOL_NAME = 'openclaw_agent_consult' as const;
export const TALK_AGENT_CONTROL_TOOL_NAME = 'openclaw_agent_control' as const;

export interface TalkAgentConsultStart {
  runId: string;
  idempotencyKey: string;
}

export interface TalkToolResultOptions {
  suppressResponse?: boolean;
  willContinue?: boolean;
}

export class TalkGatewayUnavailableError extends Error {
  readonly code = 'TALK_GATEWAY_UNAVAILABLE';
  constructor(message: string) { super(message); this.name = 'TalkGatewayUnavailableError'; }
}

export type TalkOutputCancelReason = 'barge-in' | 'playback-overflow';

export interface TalkGatewayClientDependencies {
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (
    method: string,
    params: Record<string, unknown>,
    connectionId: string,
    options?: GatewayRequestOptions,
  ) => Promise<unknown>;
  subscribe: (listener: TalkEventListener) => () => void;
  subscribeRelay: (listener: TalkRelayEventListener) => () => void;
}

export interface TalkGatewayConnectionClient {
  readonly connectionId: string;
  createRealtimeRelay: (sessionKey: string) => Promise<TalkSession>;
  startAgentConsult: (
    sessionKey: string,
    relaySessionId: string,
    callId: string,
    args: unknown,
  ) => Promise<TalkAgentConsultStart>;
  waitForAgentConsult: (runId: string, signal?: AbortSignal) => Promise<string>;
  steerAgent: (
    sessionId: string,
    sessionKey: string,
    input: TalkAgentControlInput,
  ) => Promise<unknown>;
  submitToolResult: (
    sessionId: string,
    callId: string,
    result: unknown,
    options?: TalkToolResultOptions,
  ) => Promise<void>;
  abortAgentConsult: (sessionKey: string, runId: string) => Promise<void>;
  appendAudio: (
    sessionId: string,
    audioBase64: string,
    timestamp: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  acknowledgeMark: (sessionId: string, markName: string) => Promise<void>;
  cancelOutput: (
    sessionId: string,
    turnId?: string | null,
    reason?: TalkOutputCancelReason,
  ) => Promise<void>;
  cancelTurn: (sessionId: string, turnId?: string | null) => Promise<void>;
  close: (sessionId: string) => Promise<void>;
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TalkGatewayUnavailableError(`${label} is required`);
  return normalized;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function decodeAgentConsultStart(value: unknown): TalkAgentConsultStart | null {
  const source = record(value);
  if (!source) return null;
  const runId = typeof source.runId === 'string' ? source.runId.trim() : '';
  const idempotencyKey = typeof source.idempotencyKey === 'string'
    ? source.idempotencyKey.trim()
    : '';
  return runId && idempotencyKey ? { runId, idempotencyKey } : null;
}

function decodeAgentConsultResult(value: unknown, expectedRunId: string): string | null {
  const source = record(value);
  const runId = typeof source?.runId === 'string' ? source.runId.trim() : '';
  if (!source || runId !== expectedRunId) return null;
  if (source.status === 'error') {
    const detail = typeof source.error === 'string' && source.error.trim()
      ? source.error.trim()
      : 'OpenClaw tool call failed';
    throw new TalkGatewayUnavailableError(detail);
  }
  if (source.status === 'timeout') {
    const detail = typeof source.error === 'string' && source.error.trim()
      ? source.error.trim()
      : 'OpenClaw tool call timed out';
    throw new TalkGatewayUnavailableError(detail);
  }
  if (source.status !== 'ok') return null;
  const terminalReply = record(source.terminalReply);
  if (!terminalReply) return 'OpenClaw finished with no text.';
  if (terminalReply.disposition === 'silent' || terminalReply.disposition === 'empty') {
    return 'OpenClaw finished with no text.';
  }
  if (terminalReply.disposition !== 'visible' || typeof terminalReply.text !== 'string') return null;
  const text = terminalReply.text.trim();
  return text || 'OpenClaw finished with no text.';
}

export class TalkGatewayClient {
  constructor(private readonly dependencies: TalkGatewayClientDependencies) {}

  private async request(
    connectionId: string,
    method: string,
    params: Record<string, unknown>,
    options?: GatewayRequestOptions,
  ): Promise<unknown> {
    if (!this.dependencies.isConnectionCurrent(connectionId)) {
      throw new TalkGatewayUnavailableError('The Talk Gateway connection lease is no longer current');
    }
    const response = await this.dependencies.requestFenced(method, params, connectionId, options);
    if (!this.dependencies.isConnectionCurrent(connectionId)) {
      throw new TalkGatewayUnavailableError('Gateway connection changed during the Talk request');
    }
    return response;
  }

  /** 将整个 Talk 生命周期固定到创建它的 Gateway 连接，重连后旧租约只能失败。 */
  bindConnection(connectionId: string): TalkGatewayConnectionClient {
    const expectedConnectionId = requireIdentifier(connectionId, 'Gateway connection id');
    const request = (
      method: string,
      params: Record<string, unknown>,
      options?: GatewayRequestOptions,
    ) => this.request(expectedConnectionId, method, params, options);
    const getCatalog = async (): Promise<TalkCatalog> => {
      const catalog = decodeTalkCatalog(await request('talk.catalog', {}));
      if (!catalog) throw new TalkGatewayUnavailableError('Gateway Talk catalog is absent, unready, or malformed');
      return catalog;
    };

    return {
      connectionId: expectedConnectionId,
      createRealtimeRelay: async (sessionKey) => {
        const normalizedSessionKey = requireIdentifier(sessionKey, 'OpenClaw session key');
        const selection = selectRealtimeRelayConfiguration(await getCatalog());
        if (!selection) {
          throw new TalkGatewayUnavailableError('Gateway does not advertise a Talk relay compatible with native PCM audio');
        }
        const session = decodeTalkSession(await request('talk.session.create', {
          sessionKey: normalizedSessionKey,
          provider: selection.provider.id,
          mode: 'realtime',
          transport: 'gateway-relay',
          brain: 'agent-consult',
        }), selection);
        if (!session) throw new TalkGatewayUnavailableError('Gateway returned an invalid realtime Talk session');
        return session;
      },
      startAgentConsult: async (sessionKey, relaySessionId, callId, args) => {
        const normalizedRelaySessionId = requireIdentifier(relaySessionId, 'Talk relay session id');
        const response = decodeAgentConsultStart(await request('talk.client.toolCall', {
          sessionKey: requireIdentifier(sessionKey, 'OpenClaw session key'),
          voiceSessionId: normalizedRelaySessionId,
          callId: requireIdentifier(callId, 'Talk tool call id'),
          name: TALK_AGENT_CONSULT_TOOL_NAME,
          args,
          relaySessionId: normalizedRelaySessionId,
        }));
        if (!response) throw new TalkGatewayUnavailableError('Gateway returned an invalid Talk tool run identity');
        return response;
      },
      waitForAgentConsult: async (runId, signal) => {
        const normalizedRunId = requireIdentifier(runId, 'OpenClaw run id');
        const result = decodeAgentConsultResult(await request('agent.wait', {
          runId: normalizedRunId,
          timeoutMs: AGENT_CONSULT_WAIT_TIMEOUT_MS,
        }, {
          signal,
          timeoutMs: AGENT_CONSULT_WAIT_TIMEOUT_MS + AGENT_CONSULT_REQUEST_GRACE_MS,
        }), normalizedRunId);
        if (result === null) throw new TalkGatewayUnavailableError('Gateway returned an invalid Talk tool result');
        return result;
      },
      steerAgent: (sessionId, sessionKey, input) => request('talk.session.steer', {
        sessionId: requireIdentifier(sessionId, 'Talk session id'),
        sessionKey: requireIdentifier(sessionKey, 'OpenClaw session key'),
        text: requireIdentifier(input.text, 'Talk agent control text'),
        ...(input.mode ? { mode: input.mode } : {}),
      }),
      submitToolResult: async (sessionId, callId, result, options) => {
        await request('talk.session.submitToolResult', {
          sessionId: requireIdentifier(sessionId, 'Talk session id'),
          callId: requireIdentifier(callId, 'Talk tool call id'),
          result,
          ...(options ? { options } : {}),
        });
      },
      abortAgentConsult: async (sessionKey, runId) => {
        await request('chat.abort', {
          sessionKey: requireIdentifier(sessionKey, 'OpenClaw session key'),
          runId: requireIdentifier(runId, 'OpenClaw run id'),
        });
      },
      appendAudio: async (sessionId, audioBase64, timestamp, signal) => {
        const normalizedSessionId = requireIdentifier(sessionId, 'Talk session id');
        if (!audioBase64 || !Number.isFinite(timestamp)) {
          throw new TalkGatewayUnavailableError('Talk audio input is invalid');
        }
        await request('talk.session.appendAudio', {
          sessionId: normalizedSessionId,
          audioBase64,
          timestamp,
        }, {
          signal,
          timeoutMs: AUDIO_APPEND_TIMEOUT_MS,
        });
      },
      acknowledgeMark: async (sessionId, markName) => {
        await request('talk.session.acknowledgeMark', {
          sessionId: requireIdentifier(sessionId, 'Talk session id'),
          markName: requireIdentifier(markName, 'Talk playback mark'),
        });
      },
      cancelOutput: async (sessionId, turnId, reason = 'barge-in') => {
        await request('talk.session.cancelOutput', {
          sessionId: requireIdentifier(sessionId, 'Talk session id'),
          ...(turnId?.trim() ? { turnId: turnId.trim() } : {}),
          reason,
        });
      },
      cancelTurn: async (sessionId, turnId) => {
        await request('talk.session.cancelTurn', {
          sessionId: requireIdentifier(sessionId, 'Talk session id'),
          ...(turnId?.trim() ? { turnId: turnId.trim() } : {}),
          reason: 'user-stop',
        });
      },
      close: async (sessionId) => {
        await request('talk.session.close', {
          sessionId: requireIdentifier(sessionId, 'Talk session id'),
        });
      },
    };
  }

  subscribe(listener: (event: TalkGatewayEvent) => void): () => void {
    return this.dependencies.subscribe(listener);
  }

  subscribeRelay(listener: (event: TalkRelayEvent) => void): () => void {
    return this.dependencies.subscribeRelay(listener);
  }
}
