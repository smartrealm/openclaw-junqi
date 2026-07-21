import {
  AUDIO_AUTO_PLAY_STORAGE_KEY,
  VOICE_AUTO_SPEAK_STORAGE_KEY,
  useSettingsStore,
} from '@/stores/settingsStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { debugError, debugLog } from '@/utils/debugLog';
import { emitTauriEvent, subscribeTauriEvent } from '@/utils/tauriEvents';
import { SentenceSplitter, sanitizeSpeechText } from './sentenceSplitter';
import {
  compareVoiceGlobalClaims,
  VOICE_GLOBAL_CONTROL_EVENT,
  VOICE_INTERRUPT_EVENT,
  VOICE_MEDIA_REQUEST_EVENT,
  type VoiceGlobalClaim,
  type VoiceGlobalControl,
  type VoicePhase,
  type VoiceRuntimeSnapshot,
} from './types';

interface StreamState {
  runId: string | null;
  rawText: string;
  /** Cumulative text after control-markup removal, used as the delta base. */
  speechText: string;
  splitter: SentenceSplitter;
  queue: string[];
  externalAudio: boolean;
  externalSource: string | null;
  finished: boolean;
}

interface SpeechItem {
  sessionKey: string;
  text: string;
  generation: number;
}

interface PendingExternalPlayback {
  source: string;
  timer: ReturnType<typeof setTimeout>;
}

interface ExternalPlayback {
  sessionKey: string;
  source: string;
  token: symbol;
  stop: () => void;
}

interface VoiceRuntimeOptions {
  instanceId?: string;
  emitControl?: (control: VoiceGlobalControl) => void | Promise<void>;
  subscribeControl?: (handler: (control: VoiceGlobalControl) => void) => () => void;
}

function createVoiceInstanceId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

/**
 * Desktop voice output coordinator.
 *
 * The default adapter deliberately uses the host WebView's speech engine so
 * JunQi remains usable without a Python/GPU sidecar. OpenTalking, Whisper, or
 * a cloud TTS provider can replace this boundary later without changing the
 * Gateway event wiring or the pet/dynamic-island state contract.
 */
export class VoiceRuntime {
  private streams = new Map<string, StreamState>();
  private queue: SpeechItem[] = [];
  private current: SpeechItem | null = null;
  private generation = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingExternal = new Map<string, PendingExternalPlayback>();
  private externalPlayback: ExternalPlayback | null = null;
  private blockedStreams = new Map<string, string | null>();
  private readonly instanceId: string;
  private readonly emitControl: (control: VoiceGlobalControl) => void | Promise<void>;
  private readonly unsubscribeControl: () => void;
  private latestGlobalClaim: VoiceGlobalClaim | null = null;
  private ownedGlobalClaim: VoiceGlobalClaim | null = null;
  private claimSequence = 0;

  constructor(options: VoiceRuntimeOptions = {}) {
    this.instanceId = options.instanceId || createVoiceInstanceId();
    this.emitControl = options.emitControl || ((control) => emitTauriEvent(VOICE_GLOBAL_CONTROL_EVENT, control));
    const subscribe = options.subscribeControl || ((handler) => (
      subscribeTauriEvent<VoiceGlobalControl>(VOICE_GLOBAL_CONTROL_EVENT, (event) => handler(event.payload))
    ));
    this.unsubscribeControl = subscribe((control) => this.handleGlobalControl(control));
  }

  private get syntheticEnabled(): boolean {
    const stored = useSettingsStore.getState().voiceAutoSpeak;
    return readStoredBoolean(VOICE_AUTO_SPEAK_STORAGE_KEY, stored);
  }

  private get externalMediaEnabled(): boolean {
    const stored = useSettingsStore.getState().audioAutoPlay;
    return readStoredBoolean(AUDIO_AUTO_PLAY_STORAGE_KEY, stored);
  }

  private get anyOutputEnabled(): boolean {
    return this.syntheticEnabled || this.externalMediaEnabled;
  }

  private broadcast(control: VoiceGlobalControl) {
    try {
      void Promise.resolve(this.emitControl(control)).catch((error) => {
        debugError('media', '[VoiceRuntime] global control emit failed:', error);
      });
    } catch (error) {
      debugError('media', '[VoiceRuntime] global control emit failed:', error);
    }
  }

  private nextGlobalClaim(sessionKey: string): VoiceGlobalClaim {
    const previous = this.latestGlobalClaim;
    const claim: VoiceGlobalClaim = {
      claimedAt: Math.max(Date.now(), (previous?.claimedAt ?? 0) + 1),
      sequence: ++this.claimSequence,
      instanceId: this.instanceId,
      sessionKey,
    };
    this.latestGlobalClaim = claim;
    return claim;
  }

  private publishGlobalClaim(sessionKey: string) {
    const claim = this.nextGlobalClaim(sessionKey);
    this.ownedGlobalClaim = claim;
    useVoiceStore.getState().setRemoteOutput(null);
    this.broadcast({ type: 'claim', claim });
  }

  private publishGlobalStop() {
    this.broadcast({ type: 'stop', claim: this.nextGlobalClaim('') });
  }

  private releaseGlobalClaim(broadcast = true) {
    const claim = this.ownedGlobalClaim;
    if (!claim) return;
    this.ownedGlobalClaim = null;
    if (broadcast) this.broadcast({ type: 'release', claim });
  }

  private handleGlobalControl(control: VoiceGlobalControl) {
    if (control.type === 'stop') {
      if (control.claim.instanceId === this.instanceId) return;
      if (this.latestGlobalClaim && compareVoiceGlobalClaims(control.claim, this.latestGlobalClaim) < 0) return;
      this.latestGlobalClaim = control.claim;
      this.interruptAll({ broadcast: false });
      return;
    }
    if (control.type === 'release') {
      if (control.claim.instanceId === this.instanceId) return;
      if (this.latestGlobalClaim && compareVoiceGlobalClaims(control.claim, this.latestGlobalClaim) < 0) return;
      this.latestGlobalClaim = control.claim;
      const remote = useVoiceStore.getState().remoteOutput;
      if (remote && compareVoiceGlobalClaims(control.claim, remote) >= 0) {
        useVoiceStore.getState().setRemoteOutput(null);
      }
      return;
    }
    if (control.claim.instanceId === this.instanceId) return;
    if (this.latestGlobalClaim && compareVoiceGlobalClaims(control.claim, this.latestGlobalClaim) <= 0) return;
    this.latestGlobalClaim = control.claim;
    this.releaseGlobalClaim(false);
    if (this.hasLocalOutput()) this.interruptAll({ broadcast: false });
    useVoiceStore.getState().setRemoteOutput(control.claim);
  }

  private hasLocalOutput(): boolean {
    return Boolean(
      this.current
      || this.externalPlayback
      || this.queue.length
      || this.pendingExternal.size
      || this.streams.size,
    );
  }

  private suppressCurrentStreams(sessionKey?: string | null) {
    for (const [key, stream] of this.streams) {
      if (!sessionKey || key === sessionKey) this.blockedStreams.set(key, stream.runId);
    }
  }

  private isStreamBlocked(sessionKey: string, runId: string | null): boolean {
    if (!this.blockedStreams.has(sessionKey)) return false;
    if (this.blockedStreams.get(sessionKey) === runId) return true;
    this.blockedStreams.delete(sessionKey);
    return false;
  }

  dispose() {
    this.releaseGlobalClaim();
    this.unsubscribeControl();
    this.interruptAll({ broadcast: false });
  }

  private snapshot(): VoiceRuntimeSnapshot {
    const store = useVoiceStore.getState();
    return {
      phase: store.phase,
      sessionKey: store.sessionKey,
      queueLength: this.queue.length,
      startedAt: store.startedAt,
      lastError: store.lastError,
    };
  }

  private setPhase(phase: VoicePhase, patch: Partial<VoiceRuntimeSnapshot> = {}) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const current = useVoiceStore.getState();
    useVoiceStore.getState().setSnapshot({
      ...this.snapshot(),
      ...patch,
      phase,
      startedAt: patch.startedAt !== undefined
        ? patch.startedAt
        : (phase === 'idle' || phase === 'interrupted' || phase === 'error' ? null : current.startedAt ?? Date.now()),
      queueLength: this.queue.length,
      sessionKey: patch.sessionKey !== undefined ? patch.sessionKey : current.sessionKey,
      lastError: phase === 'error' ? (patch.lastError ?? current.lastError) : null,
    });
  }

  private scheduleIdle(sessionKey: string | null, delay = 700) {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      const current = useVoiceStore.getState();
      if (current.sessionKey === sessionKey && current.phase !== 'speaking') {
        this.setPhase('idle', { sessionKey, startedAt: null });
      }
    }, delay);
  }

  setListening(sessionKey: string | null = null) {
    this.setPhase('listening', { sessionKey, startedAt: Date.now(), lastError: null });
  }

  setTranscribing(sessionKey: string | null = null) {
    this.setPhase('transcribing', { sessionKey, startedAt: Date.now(), lastError: null });
  }

  setIdle(sessionKey: string | null = null) {
    const phase = useVoiceStore.getState().phase;
    if (phase === 'speaking' || phase === 'queued') return;
    this.setPhase('idle', { sessionKey, startedAt: null, lastError: null });
  }

  setError(error: unknown, sessionKey: string | null = null) {
    const message = error instanceof Error ? error.message : String(error || 'Voice runtime error');
    this.setPhase('error', { sessionKey, startedAt: null, lastError: message });
  }

  consumeStream(sessionKey: string, content: string, runId?: string | null, mediaUrl?: string) {
    const normalizedRunId = runId || null;
    if (!sessionKey || (!content && !mediaUrl) || this.isStreamBlocked(sessionKey, normalizedRunId)) return;
    if (!this.anyOutputEnabled) return;
    const state = this.streams.get(sessionKey);
    const sameStream = Boolean(state && isSameStream(state, content, normalizedRunId));
    if (state && !sameStream && !state.externalAudio && this.syntheticEnabled) {
      const tail = sanitizeSpeechText(state.splitter.flush() || '');
      if (tail) {
        this.queue.push({ sessionKey, text: tail, generation: this.generation });
      }
    }
    const next: StreamState = state && sameStream
      ? state
      : {
          runId: normalizedRunId,
          rawText: '',
          speechText: '',
          splitter: new SentenceSplitter(),
          queue: [],
          externalAudio: false,
          externalSource: null,
          finished: false,
        };
    if (!next.runId && normalizedRunId) next.runId = normalizedRunId;
    if (mediaUrl && this.externalMediaEnabled) {
      next.externalAudio = true;
      next.externalSource = mediaUrl;
      this.clearQueuedSession(sessionKey);
      if (this.current?.sessionKey === sessionKey) this.cancelCurrentSyntheticPlayback();
    }

    const sanitizedContent = sanitizeSpeechText(content);
    const delta = deriveDelta(next.speechText, sanitizedContent);
    next.rawText = content;
    next.speechText = sanitizedContent;
    if (this.syntheticEnabled && !next.externalAudio && delta) {
      next.queue.push(...next.splitter.feed(delta).map(sanitizeSpeechText).filter(Boolean));
      this.queue.push(...next.queue.splice(0).map((text) => ({
        sessionKey,
        text,
        generation: this.generation,
      })));
    }
    this.streams.set(sessionKey, next);
    if (this.queue.length > 0 || this.current?.sessionKey === sessionKey) {
      this.setPhase(this.current ? 'speaking' : 'queued', { sessionKey });
      void this.pump();
    }
  }

  finishStream(
    sessionKey: string,
    content: string,
    state: 'final' | 'aborted' | 'error' = 'final',
    runId?: string | null,
    mediaUrl?: string,
  ) {
    if (!sessionKey) return;
    const normalizedRunId = runId || null;
    if (this.isStreamBlocked(sessionKey, normalizedRunId)) {
      if (state === 'final' || state === 'aborted' || state === 'error') {
        this.blockedStreams.delete(sessionKey);
        this.streams.delete(sessionKey);
      }
      return;
    }
    if (state !== 'final') {
      this.interrupt(sessionKey, state === 'error' ? 'error' : 'interrupted');
      return;
    }
    if (!this.anyOutputEnabled) {
      this.streams.delete(sessionKey);
      return;
    }
    const stream = this.streams.get(sessionKey);
    if (!stream || !isSameStream(stream, content, normalizedRunId)) {
      this.consumeStream(sessionKey, content, runId, mediaUrl);
    }
    const current = this.streams.get(sessionKey);
    if (!current) return;
    if (content && current.rawText !== content) {
      const sanitizedContent = sanitizeSpeechText(content);
      const delta = deriveDelta(current.speechText, sanitizedContent);
      current.rawText = content;
      current.speechText = sanitizedContent;
      if (this.syntheticEnabled && !current.externalAudio && delta) {
        this.queue.push(...current.splitter.feed(delta).map(sanitizeSpeechText).filter(Boolean).map((text) => ({
          sessionKey,
          text,
          generation: this.generation,
        })));
      }
    }
    if (mediaUrl && this.externalMediaEnabled) {
      current.externalAudio = true;
      current.externalSource = mediaUrl;
    }
    if (!current.externalAudio) {
      if (!this.syntheticEnabled) {
        this.streams.delete(sessionKey);
        return;
      }
      const tail = sanitizeSpeechText(current.splitter.flush() || '');
      if (tail) this.queue.push({ sessionKey, text: tail, generation: this.generation });
      current.finished = true;
      this.setPhase(this.current ? 'speaking' : (this.queue.length ? 'queued' : 'idle'), { sessionKey });
      if (!this.current && this.queue.length === 0) {
        this.streams.delete(sessionKey);
      } else {
        void this.pump();
      }
    } else {
      // The existing AudioPlayer owns MEDIA: playback. Avoid double speaking it.
      this.clearQueuedSession(sessionKey);
      if (this.current?.sessionKey === sessionKey) {
        this.cancelCurrentSyntheticPlayback();
      }
      const source = mediaUrl || current.externalSource;
      if (source) this.requestExternalPlayback(sessionKey, source);
      this.streams.delete(sessionKey);
      if (!this.current && this.queue.length === 0 && !source) {
        this.setPhase('idle', { sessionKey, startedAt: null });
      }
    }
  }

  speakMessage(sessionKey: string, text: string, mediaUrl?: string) {
    if (mediaUrl && this.externalMediaEnabled) {
      this.requestExternalPlayback(sessionKey, mediaUrl);
      return;
    }
    if (this.syntheticEnabled) this.finishStream(sessionKey, text, 'final');
  }

  interrupt(sessionKey?: string | null, phase: 'interrupted' | 'error' = 'interrupted') {
    const target = sessionKey || this.current?.sessionKey || null;
    const visibleSession = useVoiceStore.getState().sessionKey;
    const shouldUpdatePhase = !target
      || this.current?.sessionKey === target
      || (!this.current && visibleSession === target);
    if (target) {
      if (this.streams.has(target)) this.suppressCurrentStreams(target);
      else this.blockedStreams.delete(target);
      this.clearQueuedSession(target);
    }
    this.stopExternalPlayback(target);
    // Notify rendered media players as well as the synthetic speech engine.
    if (target) this.signalInterrupt(target);
    if (!target || this.current?.sessionKey === target) {
      this.cancelCurrentSyntheticPlayback();
    }
    if (target) this.streams.delete(target);
    if (shouldUpdatePhase) {
      this.setPhase(phase, { sessionKey: target, startedAt: null });
      if (phase === 'interrupted' && this.queue.length === 0) this.scheduleIdle(target);
    }
    if (!this.current && this.queue.length > 0) {
      void this.pump();
    } else if (!this.current && !this.externalPlayback) {
      this.releaseGlobalClaim();
    }
  }

  /** User-originated barge-in: preserve local session scoping and stop output in companion WebViews. */
  interruptGlobally(sessionKey?: string | null) {
    this.interrupt(sessionKey);
    useVoiceStore.getState().setRemoteOutput(null);
    this.publishGlobalStop();
  }

  interruptAll(options: { broadcast?: boolean; preserveRemote?: boolean } = {}) {
    const broadcast = options.broadcast !== false;
    const previousPhase = useVoiceStore.getState().phase;
    const previousSessionKey = useVoiceStore.getState().sessionKey;
    this.suppressCurrentStreams();
    this.generation += 1;
    this.queue = [];
    this.streams.clear();
    this.pendingExternal.forEach(({ timer }) => clearTimeout(timer));
    this.pendingExternal.clear();
    this.stopExternalPlayback(null);
    this.stopPlayback();
    this.current = null;
    this.releaseGlobalClaim(!broadcast);
    if (!options.preserveRemote) useVoiceStore.getState().setRemoteOutput(null);
    if (previousPhase === 'listening' || previousPhase === 'transcribing') {
      this.setPhase(previousPhase, { sessionKey: previousSessionKey });
    } else {
      this.setPhase('interrupted', { sessionKey: null, startedAt: null });
      this.scheduleIdle(null);
    }
    if (broadcast) this.publishGlobalStop();
  }

  private clearQueuedSession(sessionKey: string) {
    this.queue = this.queue.filter((item) => item.sessionKey !== sessionKey);
  }

  private requestExternalPlayback(sessionKey: string, source: string) {
    if (!this.externalMediaEnabled || !sessionKey || !source) return;
    this.clearQueuedSession(sessionKey);
    if (this.current?.sessionKey === sessionKey) this.cancelCurrentSyntheticPlayback();
    const previous = this.pendingExternal.get(sessionKey);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(() => {
      const pending = this.pendingExternal.get(sessionKey);
      if (pending?.source !== source) return;
      this.pendingExternal.delete(sessionKey);
      if (useVoiceStore.getState().sessionKey === sessionKey) {
        this.setPhase('idle', { sessionKey, startedAt: null });
      }
    }, 15_000);
    this.pendingExternal.set(sessionKey, { source, timer });
    this.setPhase('queued', { sessionKey, startedAt: Date.now() });
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VOICE_MEDIA_REQUEST_EVENT, { detail: { sessionKey, source } }));
    }
  }

  /** Called by the matching assistant AudioPlayer when its source is ready. */
  claimExternalPlayback(sessionKey: string, source: string): boolean {
    const pending = this.pendingExternal.get(sessionKey);
    if (!this.externalMediaEnabled || !pending || pending.source !== source) return false;
    clearTimeout(pending.timer);
    this.pendingExternal.delete(sessionKey);
    return true;
  }

  /** Mark a claimed HTML audio element as the active external voice output. */
  startExternalPlayback(sessionKey: string, source: string, token: symbol, stop: () => void) {
    // Physical output is global, but pending requests are session-scoped.
    // Replacing the active player must not discard another session's request.
    this.stopExternalPlayback(null, token, false);
    if (this.current) this.cancelCurrentSyntheticPlayback();
    this.externalPlayback = { sessionKey, source, token, stop };
    this.publishGlobalClaim(sessionKey);
    this.setPhase('speaking', { sessionKey, startedAt: Date.now() });
  }

  endExternalPlayback(token: symbol) {
    if (this.externalPlayback?.token !== token) return;
    const sessionKey = this.externalPlayback.sessionKey;
    this.externalPlayback = null;
    if (this.queue.length > 0) {
      this.setPhase('queued', { sessionKey: this.queue[0].sessionKey });
      void this.pump();
    } else {
      this.releaseGlobalClaim();
      this.setPhase('idle', { sessionKey, startedAt: null });
      this.scheduleIdle(sessionKey);
    }
  }

  failExternalPlayback(sessionKey: string, source: string, token?: symbol) {
    if (token && this.externalPlayback?.token !== token) return;
    if (this.externalPlayback?.sessionKey === sessionKey && this.externalPlayback.source === source) {
      this.externalPlayback = null;
    }
    const pending = this.pendingExternal.get(sessionKey);
    if (pending?.source === source) {
      clearTimeout(pending.timer);
      this.pendingExternal.delete(sessionKey);
    }
    if (this.externalPlayback) return;
    if (this.queue.length > 0) {
      this.setPhase('queued', { sessionKey: this.queue[0].sessionKey });
      void this.pump();
      return;
    }
    this.releaseGlobalClaim();
    this.setError(new Error('外部音频播放失败'), sessionKey);
  }

  private stopExternalPlayback(sessionKey: string | null, exceptToken?: symbol, clearPending = true) {
    const active = this.externalPlayback;
    if (active && (!sessionKey || active.sessionKey === sessionKey) && active.token !== exceptToken) {
      this.externalPlayback = null;
      active.stop();
    }
    if (sessionKey) {
      const pending = this.pendingExternal.get(sessionKey);
      if (pending) clearTimeout(pending.timer);
      this.pendingExternal.delete(sessionKey);
    } else if (clearPending) {
      this.pendingExternal.forEach(({ timer }) => clearTimeout(timer));
      this.pendingExternal.clear();
    }
  }

  /**
   * Cancel the active utterance without invalidating unrelated sessions.
   * `generation` is global because speechSynthesis is global, so surviving
   * queue entries must be rebased explicitly after a scoped cancellation.
   */
  private cancelCurrentSyntheticPlayback() {
    this.generation += 1;
    this.stopSyntheticPlayback();
    this.current = null;
    this.queue = this.queue.map((item) => ({ ...item, generation: this.generation }));
  }

  private stopPlayback() {
    this.stopSyntheticPlayback();
    this.stopExternalPlayback(null, undefined, false);
    this.signalInterrupt();
  }

  private signalInterrupt(sessionKey: string | null = null) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VOICE_INTERRUPT_EVENT, { detail: { sessionKey } }));
    }
  }

  private stopSyntheticPlayback() {
    const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (synthesis && typeof synthesis.cancel === 'function') {
      synthesis.cancel();
    }
  }

  private async pump(): Promise<void> {
    if (this.current || this.queue.length === 0) return;
    if (!this.syntheticEnabled) {
      this.queue = [];
      return;
    }
    this.stopExternalPlayback(null, undefined, false);
    const item = this.queue.shift();
    if (!item || item.generation !== this.generation) {
      void this.pump();
      return;
    }
    this.current = item;
    this.publishGlobalClaim(item.sessionKey);
    this.setPhase('speaking', { sessionKey: item.sessionKey, startedAt: Date.now() });
    try {
      await this.speakText(item.text, item.generation);
    } catch (error) {
      if (item.generation === this.generation) {
        debugError('media', '[VoiceRuntime] speech failed:', error);
        this.setError(error, item.sessionKey);
      }
    } finally {
      const wasCurrent = this.current === item;
      if (wasCurrent) this.current = null;
      const stream = this.streams.get(item.sessionKey);
      if (stream?.finished && !this.queue.some((queued) => queued.sessionKey === item.sessionKey)) {
        this.streams.delete(item.sessionKey);
      }
      if (item.generation === this.generation && wasCurrent) {
        if (this.queue.length) {
          void this.pump();
        } else {
          if (!this.externalPlayback) this.releaseGlobalClaim();
          this.scheduleIdle(item.sessionKey);
        }
      }
    }
  }

  private speakText(text: string, generation: number): Promise<void> {
    const synthesis = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synthesis || typeof synthesis.speak !== 'function' || typeof SpeechSynthesisUtterance === 'undefined') {
      return Promise.reject(new Error('系统语音合成不可用'));
    }
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = resolveSpeechLanguage();
      utterance.rate = 1;
      utterance.pitch = 1;
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve();
      };
      utterance.onend = () => settle();
      utterance.onerror = (event) => {
        if (generation !== this.generation || event.error === 'canceled' || event.error === 'interrupted') {
          settle();
          return;
        }
        settle(new Error(`speech synthesis ${event.error || 'failed'}`));
      };
      debugLog('media', '[VoiceRuntime] speak:', text.slice(0, 80));
      synthesis.speak(utterance);
    });
  }
}

function deriveDelta(previous: string, next: string): string {
  if (!previous) return next;
  if (next.startsWith(previous)) return next.slice(previous.length);
  if (previous.startsWith(next)) return '';
  return next;
}

function isSameStream(state: StreamState, content: string, runId: string | null): boolean {
  if (state.runId && runId && state.runId === runId) return true;
  // Some Gateway event variants learn the run id after the first text chunk.
  // Treat a monotonic cumulative payload as the same stream in that case.
  if ((!state.runId || !runId) && content.startsWith(state.rawText)) return true;
  return false;
}

function resolveSpeechLanguage(): string {
  const language = String(useSettingsStore.getState().language);
  if (language === 'zh') return 'zh-CN';
  if (language === 'zh-TW') return 'zh-TW';
  if (language === 'ar') return 'ar-SA';
  return 'en-US';
}

export const voiceRuntime = new VoiceRuntime();
