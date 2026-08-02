import {
  decodeTalkCatalog,
  decodeTalkSession,
  selectRealtimeRelayProvider,
  type TalkCatalog,
  type TalkSession,
} from './talkTypes';
import type { TalkEventListener, TalkGatewayEvent } from './talkEventBridge';

export class TalkGatewayUnavailableError extends Error {
  readonly code = 'TALK_GATEWAY_UNAVAILABLE';
  constructor(message: string) { super(message); this.name = 'TalkGatewayUnavailableError'; }
}

export interface TalkGatewayClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
  subscribe: (listener: TalkEventListener) => () => void;
}

export class TalkGatewayClient {
  constructor(private readonly dependencies: TalkGatewayClientDependencies) {}

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) throw new TalkGatewayUnavailableError('No attested Gateway connection is available for Talk');
    const response = await this.dependencies.requestFenced(method, params, connectionId);
    if (!this.dependencies.isConnectionCurrent(connectionId)) {
      throw new TalkGatewayUnavailableError('Gateway connection changed during the Talk request');
    }
    return response;
  }

  async getCatalog(): Promise<TalkCatalog> {
    const catalog = decodeTalkCatalog(await this.request('talk.catalog', {}));
    if (!catalog) throw new TalkGatewayUnavailableError('Gateway Talk catalog is absent, unready, or malformed');
    return catalog;
  }

  async createRealtimeRelay(sessionKey: string): Promise<TalkSession> {
    if (!sessionKey.trim()) throw new TalkGatewayUnavailableError('Talk requires a non-empty OpenClaw session key');
    const provider = selectRealtimeRelayProvider(await this.getCatalog());
    if (!provider) throw new TalkGatewayUnavailableError('Gateway does not advertise a barge-in capable PCM realtime relay');
    const session = decodeTalkSession(await this.request('talk.session.create', {
      sessionKey,
      provider: provider.id,
      mode: 'realtime',
      transport: 'gateway-relay',
      brain: 'agent-consult',
    }));
    if (!session) throw new TalkGatewayUnavailableError('Gateway returned an invalid realtime Talk session');
    return session;
  }

  async appendAudio(sessionId: string, audioBase64: string, timestamp: number): Promise<void> {
    if (!sessionId.trim() || !audioBase64 || !Number.isFinite(timestamp)) {
      throw new TalkGatewayUnavailableError('Talk audio input is invalid');
    }
    await this.request('talk.session.appendAudio', { sessionId, audioBase64, timestamp });
  }

  async cancelOutput(sessionId: string): Promise<void> {
    await this.request('talk.session.cancelOutput', { sessionId, reason: 'barge-in' });
  }

  async close(sessionId: string): Promise<void> {
    await this.request('talk.session.close', { sessionId });
  }

  subscribe(listener: (event: TalkGatewayEvent) => void): () => void { return this.dependencies.subscribe(listener); }
}
