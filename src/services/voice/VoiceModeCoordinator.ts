export type VoiceInputMode = 'off' | 'dictation' | 'wake_word';

export type VoiceInputPhase =
  | 'off'
  | 'preparing'
  | 'listening'
  | 'triggered'
  | 'transcribing'
  | 'ready_to_send'
  | 'unavailable'
  | 'error';

export type VoiceModeErrorCode =
  | 'gateway_unavailable'
  | 'wake_detector_unavailable'
  | 'wake_trigger_model_mismatch'
  | 'target_changed'
  | 'capture_failed';

export interface VoiceModeContext {
  sessionKey: string;
  connectionId: string;
}

export type VoiceInputDraft =
  | {
      kind: 'transcript';
      text: string;
      createdAt: number;
      turnId: string;
    }
  | {
      kind: 'audio';
      captureId: string;
      durationSec: number;
      createdAt: number;
      turnId: string;
    };

export interface VoiceModeSnapshot {
  revision: number;
  mode: VoiceInputMode;
  phase: VoiceInputPhase;
  turnId: string | null;
  context: VoiceModeContext | null;
  draft: VoiceInputDraft | null;
  error: VoiceModeErrorCode | null;
}

export interface StartVoiceModeRequest {
  mode: Exclude<VoiceInputMode, 'off'>;
  context: VoiceModeContext;
  wakeDetectorAvailable: boolean;
}

type VoiceModeListener = () => void;
type CaptureStopListener = () => void | Promise<void>;

const INITIAL_SNAPSHOT: VoiceModeSnapshot = {
  revision: 0,
  mode: 'off',
  phase: 'off',
  turnId: null,
  context: null,
  draft: null,
  error: null,
};

function sameContext(left: VoiceModeContext, right: VoiceModeContext): boolean {
  return left.sessionKey === right.sessionKey && left.connectionId === right.connectionId;
}

function validContext(context: VoiceModeContext): boolean {
  return context.sessionKey.trim().length > 0 && context.connectionId.trim().length > 0;
}

export function isVoiceInputCapturePhase(phase: VoiceInputPhase): boolean {
  return phase === 'listening' || phase === 'triggered' || phase === 'transcribing';
}

export class VoiceModeCoordinator {
  private snapshot: VoiceModeSnapshot = INITIAL_SNAPSHOT;
  private turnSequence = 0;
  private captureSequence = 0;
  private readonly listeners = new Set<VoiceModeListener>();
  private readonly captureStopListeners = new Set<CaptureStopListener>();

  getSnapshot = (): VoiceModeSnapshot => this.snapshot;

  subscribe = (listener: VoiceModeListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeCaptureStop = (listener: CaptureStopListener): (() => void) => {
    this.captureStopListeners.add(listener);
    return () => this.captureStopListeners.delete(listener);
  };

  private commit(next: Omit<VoiceModeSnapshot, 'revision'>): VoiceModeSnapshot {
    this.snapshot = { ...next, revision: this.snapshot.revision + 1 };
    for (const listener of [...this.listeners]) listener();
    return this.snapshot;
  }

  start(request: StartVoiceModeRequest): VoiceModeSnapshot {
    if (!validContext(request.context)) {
      return this.commit({
        mode: 'off',
        phase: 'error',
        turnId: null,
        context: null,
        draft: null,
        error: 'gateway_unavailable',
      });
    }

    const turnId = `voice-turn-${++this.turnSequence}`;
    if (request.mode === 'wake_word' && !request.wakeDetectorAvailable) {
      return this.commit({
        mode: 'wake_word',
        phase: 'unavailable',
        turnId,
        context: { ...request.context },
        draft: null,
        error: 'wake_detector_unavailable',
      });
    }

    return this.commit({
      mode: request.mode,
      phase: 'listening',
      turnId,
      context: { ...request.context },
      draft: null,
      error: null,
    });
  }

  isCurrentTurn(turnId: string | null, context: VoiceModeContext): boolean {
    const snapshot = this.snapshot;
    return Boolean(
      this.ownsTurn(turnId, context)
      && snapshot.phase !== 'off'
      && snapshot.phase !== 'unavailable'
      && snapshot.phase !== 'error',
    );
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

  markTriggered(turnId: string | null, context: VoiceModeContext): boolean {
    if (!this.isCurrentTurn(turnId, context) || this.snapshot.phase !== 'listening') return false;
    this.commit({ ...this.snapshot, phase: 'triggered' });
    return true;
  }

  markTranscribing(turnId: string | null, context: VoiceModeContext): boolean {
    if (
      !this.isCurrentTurn(turnId, context)
      || (this.snapshot.phase !== 'listening' && this.snapshot.phase !== 'triggered')
    ) {
      return false;
    }
    this.commit({ ...this.snapshot, phase: 'transcribing' });
    return true;
  }

  resumeListening(turnId: string | null, context: VoiceModeContext): boolean {
    if (!this.isCurrentTurn(turnId, context)) return false;
    if (this.snapshot.phase !== 'triggered' && this.snapshot.phase !== 'transcribing') return false;
    this.commit({ ...this.snapshot, phase: 'listening', error: null });
    return true;
  }

  private canAcceptInput(turnId: string | null, context: VoiceModeContext): boolean {
    return this.isCurrentTurn(turnId, context)
      && (this.snapshot.phase === 'listening'
        || this.snapshot.phase === 'triggered'
        || this.snapshot.phase === 'transcribing');
  }

  acceptTranscript(turnId: string | null, context: VoiceModeContext, transcript: string): boolean {
    if (!turnId || !this.canAcceptInput(turnId, context)) return false;
    const text = transcript.trim();
    if (!text) return false;
    this.commit({
      ...this.snapshot,
      phase: 'ready_to_send',
      draft: { kind: 'transcript', text, createdAt: Date.now(), turnId },
      error: null,
    });
    return true;
  }

  acceptAudioCapture(
    turnId: string | null,
    context: VoiceModeContext,
    durationSec: number,
  ): VoiceInputDraft | null {
    if (!turnId || !this.canAcceptInput(turnId, context)) return null;
    const draft: VoiceInputDraft = {
      kind: 'audio',
      captureId: `voice-capture-${++this.captureSequence}`,
      durationSec: Math.max(0, Math.round(durationSec)),
      createdAt: Date.now(),
      turnId,
    };
    this.commit({ ...this.snapshot, phase: 'ready_to_send', draft, error: null });
    return draft;
  }

  fail(turnId: string | null, context: VoiceModeContext, code: VoiceModeErrorCode): boolean {
    if (!this.isCurrentTurn(turnId, context)) return false;
    this.commit({ ...this.snapshot, phase: 'error', error: code });
    return true;
  }

  reportUnavailable(turnId: string | null, context: VoiceModeContext, code: VoiceModeErrorCode): boolean {
    const snapshot = this.snapshot;
    if (!turnId || snapshot.turnId !== turnId || !snapshot.context || !sameContext(snapshot.context, context)) {
      return false;
    }
    this.commit({ ...snapshot, phase: code === 'wake_detector_unavailable' ? 'unavailable' : 'error', error: code });
    return true;
  }

  takeDraft(turnId: string | null, context: VoiceModeContext): VoiceInputDraft | null {
    const snapshot = this.snapshot;
    if (!this.isCurrentTurn(turnId, context) || snapshot.phase !== 'ready_to_send' || !snapshot.draft) {
      return null;
    }
    const draft = snapshot.draft;
    this.commit({ ...snapshot, phase: 'listening', draft: null, error: null });
    return draft;
  }

  getDraft(turnId: string | null, context: VoiceModeContext): VoiceInputDraft | null {
    const snapshot = this.snapshot;
    if (
      !this.isCurrentTurn(turnId, context)
      || snapshot.phase !== 'ready_to_send'
      || !snapshot.draft
      || snapshot.draft.turnId !== turnId
    ) {
      return null;
    }
    return snapshot.draft;
  }

  discardDraft(turnId: string | null, context: VoiceModeContext | null): boolean {
    const snapshot = this.snapshot;
    const staleDraft = snapshot.phase === 'error'
      && snapshot.turnId === null
      && snapshot.context === null;
    const currentTurn = context !== null && this.isCurrentTurn(turnId, context);
    if (!snapshot.draft || (!currentTurn && !staleDraft)) return false;
    this.commit({
      mode: 'off',
      phase: 'off',
      turnId: null,
      context: null,
      draft: null,
      error: null,
    });
    return true;
  }

  invalidateContext(context: VoiceModeContext): boolean {
    const snapshot = this.snapshot;
    if (!snapshot.context || sameContext(snapshot.context, context)) return false;
    this.commit({
      ...snapshot,
      mode: 'off',
      phase: 'error',
      turnId: null,
      context: null,
      error: 'target_changed',
    });
    return true;
  }

  invalidate(code: VoiceModeErrorCode = 'target_changed'): boolean {
    const snapshot = this.snapshot;
    if (!snapshot.context) return false;
    this.commit({
      ...snapshot,
      mode: 'off',
      phase: 'error',
      turnId: null,
      context: null,
      error: code,
    });
    return true;
  }

  invalidateOwnedTurn(
    turnId: string | null,
    context: VoiceModeContext | null,
    code: VoiceModeErrorCode = 'target_changed',
  ): boolean {
    if (!this.ownsTurn(turnId, context)) return false;
    return this.invalidate(code);
  }

  stop(): boolean {
    const snapshot = this.snapshot;
    if (snapshot.mode === 'off' && snapshot.phase === 'off' && snapshot.draft === null) return false;
    this.commit({
      mode: 'off',
      phase: 'off',
      turnId: null,
      context: null,
      draft: null,
      error: null,
    });
    return true;
  }

  async stopAndReleaseCapture(): Promise<boolean> {
    const stopped = this.stop();
    await Promise.all([...this.captureStopListeners].map(async (listener) => {
      try {
        await listener();
      } catch {
        // Capture release is best-effort after the coordinator has fenced the turn.
      }
    }));
    return stopped;
  }

  async stopOwnedTurnAndReleaseCapture(
    turnId: string | null,
    context: VoiceModeContext | null,
  ): Promise<boolean> {
    if (!this.ownsTurn(turnId, context)) return false;
    return this.stopAndReleaseCapture();
  }
}

export const voiceModeCoordinator = new VoiceModeCoordinator();
