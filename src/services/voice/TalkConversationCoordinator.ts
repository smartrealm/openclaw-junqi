import type { TalkGatewayEvent } from '@/services/gateway/talkEventBridge';
import type { TalkGatewayClient } from '@/services/gateway/TalkGatewayClient';

export type TalkConversationPhase = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

export interface TalkConversationSnapshot {
  phase: TalkConversationPhase;
  sessionId: string | null;
  connectionId: string | null;
  error: string | null;
}

export interface TalkConversationDependencies {
  client: Pick<TalkGatewayClient, 'createRealtimeRelay' | 'appendAudio' | 'cancelOutput' | 'close' | 'subscribe'>;
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  interruptLocalOutput: (sessionKey: string) => void;
  playOutput: (audioBase64: string) => void | Promise<void>;
  stopOutput: () => void | Promise<void>;
  now?: () => number;
}

type Listener = (snapshot: TalkConversationSnapshot) => void;

const INITIAL: TalkConversationSnapshot = { phase: 'idle', sessionId: null, connectionId: null, error: null };

export class TalkConversationCoordinator {
  private snapshot = INITIAL;
  private sessionKey: string | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private appendQueue: Promise<void> = Promise.resolve();
  private pendingFrames: Array<{ data: string; sampleRateHz: number; channels: number }> = [];
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;

  constructor(private readonly dependencies: TalkConversationDependencies) {
    this.now = dependencies.now ?? (() => Date.now());
  }

  getSnapshot = (): TalkConversationSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: TalkConversationSnapshot): void {
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  private ownsSession(): boolean {
    return Boolean(
      this.snapshot.sessionId
      && this.snapshot.connectionId
      && this.dependencies.isConnectionCurrent(this.snapshot.connectionId),
    );
  }

  async start(sessionKey: string): Promise<TalkConversationSnapshot> {
    if (this.sessionKey) this.dependencies.interruptLocalOutput(this.sessionKey);
    await Promise.resolve(this.dependencies.stopOutput()).catch(() => undefined);
    await this.stop();
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId || !sessionKey.trim()) {
      this.set({ ...INITIAL, phase: 'error', error: 'No attested Gateway connection is available for Talk' });
      return this.snapshot;
    }
    this.set({ phase: 'connecting', sessionId: null, connectionId, error: null });
    try {
      const session = await this.dependencies.client.createRealtimeRelay(sessionKey);
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        await this.dependencies.client.close(session.sessionId).catch(() => undefined);
        throw new Error('Gateway connection changed while creating the Talk session');
      }
      this.sessionKey = sessionKey;
      this.unsubscribeEvents = this.dependencies.client.subscribe((event) => this.handleEvent(event));
      this.set({ phase: 'listening', sessionId: session.sessionId, connectionId, error: null });
      const pendingFrames = this.pendingFrames;
      this.pendingFrames = [];
      for (const frame of pendingFrames) this.appendPcm(frame);
    } catch (error) {
      this.set({ ...INITIAL, phase: 'error', error: error instanceof Error ? error.message : String(error) });
    }
    return this.snapshot;
  }

  appendPcm(frame: { data: string; sampleRateHz: number; channels: number }): void {
    if (frame.sampleRateHz !== 24_000 || frame.channels !== 1 || !frame.data) return;
    if (this.snapshot.phase === 'connecting') {
      if (this.pendingFrames.length < 50) this.pendingFrames.push(frame);
      return;
    }
    if (!this.ownsSession()) return;
    const sessionId = this.snapshot.sessionId;
    if (!sessionId) return;
    this.appendQueue = this.appendQueue
      .then(async () => {
        if (!this.ownsSession() || this.snapshot.sessionId !== sessionId) return;
        await this.dependencies.client.appendAudio(sessionId, frame.data, this.now());
      })
      .catch((error) => {
        if (this.snapshot.sessionId === sessionId) {
          this.set({ ...INITIAL, phase: 'error', error: error instanceof Error ? error.message : String(error) });
        }
      });
  }

  async interrupt(): Promise<void> {
    const { sessionId } = this.snapshot;
    const sessionKey = this.sessionKey;
    if (!sessionId || !sessionKey || !this.ownsSession()) return;
    this.dependencies.interruptLocalOutput(sessionKey);
    await Promise.resolve(this.dependencies.stopOutput()).catch(() => undefined);
    await this.dependencies.client.cancelOutput(sessionId).catch((error) => {
      if (this.snapshot.sessionId === sessionId) {
        this.set({ ...this.snapshot, phase: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  async stop(): Promise<void> {
    const sessionId = this.snapshot.sessionId;
    const ownsSession = this.ownsSession();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.sessionKey = null;
    this.appendQueue = Promise.resolve();
    this.pendingFrames = [];
    await Promise.resolve(this.dependencies.stopOutput()).catch(() => undefined);
    this.set(INITIAL);
    if (sessionId && ownsSession) await this.dependencies.client.close(sessionId).catch(() => undefined);
  }

  private handleEvent(event: TalkGatewayEvent): void {
    if (event.sessionId !== this.snapshot.sessionId || !this.ownsSession()) return;
    if (event.type === 'output.audio.started' || event.type === 'output.audio.delta') {
      this.set({ ...this.snapshot, phase: 'speaking', error: null });
      if (event.audioBase64) {
        void Promise.resolve(this.dependencies.playOutput(event.audioBase64)).catch((error) => {
          if (this.snapshot.sessionId === event.sessionId) {
            this.set({ ...this.snapshot, phase: 'error', error: error instanceof Error ? error.message : String(error) });
          }
        });
      }
    } else if (event.type === 'output.audio.done' || event.type === 'turn.cancelled') {
      void Promise.resolve(this.dependencies.stopOutput()).catch(() => undefined);
      this.set({ ...this.snapshot, phase: 'listening', error: null });
    } else if (event.type === 'session.error' || event.type === 'session.closed') {
      this.set({ ...INITIAL, phase: 'error', error: `Talk session ${event.type}` });
    }
  }
}
