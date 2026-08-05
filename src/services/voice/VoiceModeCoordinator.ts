export type VoiceInputMode = 'off' | 'talk';

export type VoiceInputPhase =
  | 'off'
  | 'preparing'
  | 'listening'
  | 'hearing'
  | 'thinking'
  | 'speaking'
  | 'error';

export type VoiceModeErrorCode =
  | 'gateway_unavailable'
  | 'target_changed'
  | 'capture_failed'
  | 'talk_unavailable'
  | 'talk_session_replaced'
  | 'talk_session_closed';

export interface VoiceModeContext {
  sessionKey: string;
  connectionId: string;
}

export interface VoiceModeSnapshot {
  revision: number;
  mode: VoiceInputMode;
  phase: VoiceInputPhase;
  turnId: string | null;
  context: VoiceModeContext | null;
  error: VoiceModeErrorCode | null;
  errorDetail: string | null;
}

export interface StartVoiceModeRequest {
  context: VoiceModeContext | null;
}

type VoiceModeListener = () => void;
type ResourceReleaseListener = () => void | Promise<void>;

const INITIAL_SNAPSHOT: VoiceModeSnapshot = {
  revision: 0,
  mode: 'off',
  phase: 'off',
  turnId: null,
  context: null,
  error: null,
  errorDetail: null,
};

function sameContext(left: VoiceModeContext, right: VoiceModeContext): boolean {
  return left.sessionKey === right.sessionKey && left.connectionId === right.connectionId;
}

function validContext(context: VoiceModeContext | null): context is VoiceModeContext {
  return context !== null
    && context.sessionKey.trim().length > 0
    && context.connectionId.trim().length > 0;
}

export function isVoiceInputCapturePhase(phase: VoiceInputPhase): boolean {
  return phase === 'listening' || phase === 'hearing' || phase === 'thinking';
}

export class VoiceModeCoordinator {
  private snapshot: VoiceModeSnapshot = INITIAL_SNAPSHOT;
  private turnSequence = 0;
  private readonly listeners = new Set<VoiceModeListener>();
  private readonly resourceReleaseListeners = new Set<ResourceReleaseListener>();
  private releaseOperation: Promise<void> | null = null;

  getSnapshot = (): VoiceModeSnapshot => this.snapshot;

  subscribe = (listener: VoiceModeListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeResourceRelease = (listener: ResourceReleaseListener): (() => void) => {
    this.resourceReleaseListeners.add(listener);
    return () => this.resourceReleaseListeners.delete(listener);
  };

  private commit(next: Omit<VoiceModeSnapshot, 'revision'>): VoiceModeSnapshot {
    this.snapshot = { ...next, revision: this.snapshot.revision + 1 };
    for (const listener of [...this.listeners]) listener();
    return this.snapshot;
  }

  start(request: StartVoiceModeRequest): VoiceModeSnapshot {
    if (!validContext(request.context)) {
      return this.commit({
        mode: 'talk',
        phase: 'error',
        turnId: null,
        context: null,
        error: 'gateway_unavailable',
        errorDetail: null,
      });
    }

    const turnId = `voice-turn-${++this.turnSequence}`;
    return this.commit({
      mode: 'talk',
      phase: 'preparing',
      turnId,
      context: { ...request.context },
      error: null,
      errorDetail: null,
    });
  }

  ownsTurn(turnId: string | null, context: VoiceModeContext | null): boolean {
    const snapshot = this.snapshot;
    return Boolean(
      turnId
      && context
      && snapshot.turnId === turnId
      && snapshot.context
      && sameContext(snapshot.context, context),
    );
  }

  transition(
    turnId: string | null,
    context: VoiceModeContext,
    phase: Exclude<VoiceInputPhase, 'off' | 'error'>,
  ): boolean {
    if (!this.ownsTurn(turnId, context) || this.snapshot.mode !== 'talk' || this.snapshot.phase === 'error') {
      return false;
    }
    if (this.snapshot.phase === phase) return true;
    this.commit({ ...this.snapshot, phase, error: null, errorDetail: null });
    return true;
  }

  fail(
    turnId: string | null,
    context: VoiceModeContext | null,
    code: VoiceModeErrorCode,
    detail: string | null = null,
  ): boolean {
    if (!this.ownsTurn(turnId, context)) return false;
    this.commit({ ...this.snapshot, phase: 'error', error: code, errorDetail: detail });
    return true;
  }

  invalidateContext(context: VoiceModeContext): boolean {
    const snapshot = this.snapshot;
    if (!snapshot.context || sameContext(snapshot.context, context)) return false;
    this.commit({
      ...snapshot,
      mode: 'talk',
      phase: 'error',
      turnId: null,
      context: null,
      error: 'target_changed',
      errorDetail: null,
    });
    return true;
  }

  invalidate(code: VoiceModeErrorCode = 'target_changed', detail: string | null = null): boolean {
    const snapshot = this.snapshot;
    if (snapshot.mode === 'off' && snapshot.phase === 'off') return false;
    this.commit({
      ...snapshot,
      mode: 'talk',
      phase: 'error',
      turnId: null,
      context: null,
      error: code,
      errorDetail: detail,
    });
    return true;
  }

  stop(): boolean {
    const snapshot = this.snapshot;
    if (snapshot.mode === 'off' && snapshot.phase === 'off') return false;
    this.commit({
      mode: 'off',
      phase: 'off',
      turnId: null,
      context: null,
      error: null,
      errorDetail: null,
    });
    return true;
  }

  async stopAndReleaseResources(): Promise<boolean> {
    const stopped = this.stop();
    if (!this.releaseOperation) {
      this.releaseOperation = Promise.allSettled(
        [...this.resourceReleaseListeners].map((listener) => Promise.resolve().then(listener)),
      ).then(() => undefined).finally(() => {
        this.releaseOperation = null;
      });
    }
    await this.releaseOperation;
    return stopped;
  }

  async stopOwnedTurnAndReleaseResources(
    turnId: string | null,
    context: VoiceModeContext | null,
  ): Promise<boolean> {
    if (!this.ownsTurn(turnId, context)) return false;
    return this.stopAndReleaseResources();
  }
}

export const voiceModeCoordinator = new VoiceModeCoordinator();
