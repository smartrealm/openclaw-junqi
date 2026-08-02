import type { TalkGatewayEvent } from '@/services/gateway/talkEventBridge';
import type { TalkGatewayClient } from '@/services/gateway/TalkGatewayClient';
import { MAX_VOICE_WAKE_PCM_FRAMES } from './VoiceWakeAudioLimits';

export type TalkConversationPhase = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

export interface TalkConversationSnapshot {
  phase: TalkConversationPhase;
  sessionId: string | null;
  sessionKey: string | null;
  connectionId: string | null;
  error: string | null;
}

export interface TalkConversationDependencies {
  client: Pick<TalkGatewayClient, 'createRealtimeRelay' | 'appendAudio' | 'cancelOutput' | 'close' | 'subscribe'>;
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  interruptLocalOutput: (sessionKey: string) => void;
  playOutput: (audioBase64: string) => void | Promise<void>;
  finishOutput: () => void | Promise<void>;
  stopOutput: () => void | Promise<void>;
  now?: () => number;
}

type Listener = (snapshot: TalkConversationSnapshot) => void;

const INITIAL: TalkConversationSnapshot = {
  phase: 'idle', sessionId: null, sessionKey: null, connectionId: null, error: null,
};

export class TalkConversationCoordinator {
  private snapshot = INITIAL;
  private sessionKey: string | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private appendQueue: Promise<void> = Promise.resolve();
  private playbackQueue: Promise<void> = Promise.resolve();
  private playbackGeneration = 0;
  private playbackSessionId: string | null = null;
  private pendingFrames: Array<{ data: string; sampleRateHz: number; channels: number }> = [];
  private opening: Promise<TalkConversationSnapshot> | null = null;
  private generation = 0;
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

  start(sessionKey: string): Promise<TalkConversationSnapshot> {
    // A replacement turn owns a fresh input queue. Frames can arrive before
    // the asynchronous cleanup below has reached the connecting state.
    this.pendingFrames = [];
    const opening = this.open(sessionKey);
    this.opening = opening;
    void opening.then(
      () => { if (this.opening === opening) this.opening = null; },
      () => { if (this.opening === opening) this.opening = null; },
    );
    return opening;
  }

  /** Resolves the relay setup already in progress, if there is one. */
  waitForOpening(): Promise<TalkConversationSnapshot | null> {
    return this.opening ?? Promise.resolve(null);
  }

  private async open(sessionKey: string): Promise<TalkConversationSnapshot> {
    await this.interruptPriorOutput();
    await this.stop({ retainPendingFrames: true });
    const generation = ++this.generation;
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId || !sessionKey.trim()) {
      this.pendingFrames = [];
      this.set({ ...INITIAL, phase: 'error', error: 'No attested Gateway connection is available for Talk' });
      return this.snapshot;
    }
    this.set({ phase: 'connecting', sessionId: null, sessionKey, connectionId, error: null });
    try {
      const session = await this.dependencies.client.createRealtimeRelay(sessionKey);
      if (generation !== this.generation || !this.dependencies.isConnectionCurrent(connectionId)) {
        await this.dependencies.client.close(session.sessionId).catch(() => undefined);
        if (generation !== this.generation) {
          if (this.snapshot.phase === 'idle') this.pendingFrames = [];
          return this.snapshot;
        }
        throw new Error('Gateway connection changed while creating the Talk session');
      }
      this.sessionKey = sessionKey;
      this.unsubscribeEvents = this.dependencies.client.subscribe((event) => this.handleEvent(event));
      this.set({ phase: 'listening', sessionId: session.sessionId, sessionKey, connectionId, error: null });
      const pendingFrames = this.pendingFrames;
      this.pendingFrames = [];
      for (const frame of pendingFrames) this.enqueuePcm(frame);
    } catch (error) {
      this.pendingFrames = [];
      this.set({ ...INITIAL, phase: 'error', error: error instanceof Error ? error.message : String(error) });
    }
    return this.snapshot;
  }

  appendPcm(frame: { data: string; sampleRateHz: number; channels: number }): void {
    if (frame.sampleRateHz !== 24_000 || frame.channels !== 1 || !frame.data) return;
    if (this.opening || this.snapshot.phase === 'connecting') {
      if (this.pendingFrames.length < MAX_VOICE_WAKE_PCM_FRAMES) this.pendingFrames.push(frame);
      return;
    }
    this.enqueuePcm(frame);
  }

  private enqueuePcm(frame: { data: string; sampleRateHz: number; channels: number }): void {
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
    await this.stopNativeOutput();
    await this.dependencies.client.cancelOutput(sessionId).catch((error) => {
      if (this.snapshot.sessionId === sessionId) {
        this.set({ ...this.snapshot, phase: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  /** Stops the audible old turn before fencing it at the selected Gateway. */
  private async interruptPriorOutput(): Promise<void> {
    const { sessionId } = this.snapshot;
    const sessionKey = this.sessionKey;
    const ownsSession = this.ownsSession();
    if (sessionKey) this.dependencies.interruptLocalOutput(sessionKey);
    await this.stopNativeOutput();
    if (!sessionId || !ownsSession) return;
    await this.dependencies.client.cancelOutput(sessionId).catch(() => undefined);
  }

  async stop(options: { retainPendingFrames?: boolean } = {}): Promise<void> {
    this.generation += 1;
    const sessionId = this.snapshot.sessionId;
    const ownsSession = this.ownsSession();
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.sessionKey = null;
    this.appendQueue = Promise.resolve();
    if (!options.retainPendingFrames) this.pendingFrames = [];
    await this.stopNativeOutput();
    this.set(INITIAL);
    if (sessionId && ownsSession) await this.dependencies.client.close(sessionId).catch(() => undefined);
  }

  private handleEvent(event: TalkGatewayEvent): void {
    if (event.sessionId !== this.snapshot.sessionId || !this.ownsSession()) return;
    if (event.type === 'output.audio.started' || event.type === 'output.audio.delta') {
      this.set({ ...this.snapshot, phase: 'speaking', error: null });
      if (event.audioBase64) this.enqueueOutput(event.sessionId, event.audioBase64);
    } else if (event.type === 'output.audio.done') {
      this.finishOutput(event.sessionId);
    } else if (event.type === 'turn.cancelled') {
      void this.stopNativeOutput();
      this.set({ ...this.snapshot, phase: 'listening', error: null });
    } else if (event.type === 'session.error' || event.type === 'session.closed') {
      void this.stopNativeOutput();
      this.set({ ...INITIAL, phase: 'error', error: `Talk session ${event.type}` });
    }
  }

  private enqueueOutput(sessionId: string, audioBase64: string): void {
    const playbackGeneration = this.playbackGeneration;
    this.playbackSessionId = sessionId;
    this.playbackQueue = this.playbackQueue
      .then(async () => {
        if (playbackGeneration !== this.playbackGeneration
          || this.snapshot.sessionId !== sessionId
          || !this.ownsSession()) return;
        await this.dependencies.playOutput(audioBase64);
      })
      .catch((error) => this.handlePlaybackError(sessionId, playbackGeneration, error));
  }

  private finishOutput(sessionId: string): void {
    if (this.playbackSessionId !== sessionId) {
      this.set({ ...this.snapshot, phase: 'listening', error: null });
      return;
    }
    const playbackGeneration = this.playbackGeneration;
    this.playbackQueue = this.playbackQueue
      .then(async () => {
        if (playbackGeneration !== this.playbackGeneration
          || this.snapshot.sessionId !== sessionId
          || !this.ownsSession()) return;
        await this.dependencies.finishOutput();
        if (playbackGeneration === this.playbackGeneration && this.snapshot.sessionId === sessionId) {
          this.playbackSessionId = null;
          this.set({ ...this.snapshot, phase: 'listening', error: null });
        }
      })
      .catch((error) => this.handlePlaybackError(sessionId, playbackGeneration, error));
  }

  private async stopNativeOutput(): Promise<void> {
    this.playbackGeneration += 1;
    this.playbackSessionId = null;
    this.playbackQueue = Promise.resolve();
    await Promise.resolve(this.dependencies.stopOutput()).catch(() => undefined);
  }

  private handlePlaybackError(sessionId: string, playbackGeneration: number, error: unknown): void {
    if (playbackGeneration === this.playbackGeneration && this.snapshot.sessionId === sessionId) {
      this.set({ ...this.snapshot, phase: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }
}
