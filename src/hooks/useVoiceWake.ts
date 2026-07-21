// Voice wake listener: use the Web Speech API when the host WebView exposes a
// recognizer, and fall back to the native VAD capture on platforms such as
// macOS WKWebView. A captured WAV is never passed to SpeechRecognition (that
// API listens to the microphone); it is handed to the caller as an attachment
// or to a future provider adapter instead.

import { useEffect, useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { subscribeTauriEvent } from '@/utils/tauriEvents';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { useVoiceStore } from '@/stores/voiceStore';

export type WakePhase = 'idle' | 'listening' | 'wake_detected' | 'transcribing' | 'error';

export interface VoiceWakeOptions {
  /** Called with the transcribed text so the caller can fill the chat input. */
  onTranscript: (text: string) => void;
  /** Called when a captured utterance couldn't be transcribed (e.g. no ASR on
   *  this platform). Lets the caller offer it as an audio attachment instead. */
  onCaptureFallback?: (wavDataUrl: string) => void | Promise<void>;
  /** Called just before a new utterance is accepted. */
  onWakeDetected?: () => void;
  /** Preferred language for transcription (BCP-47). */
  lang?: string;
  /** Session that owns captured input and runtime state. */
  sessionKey?: string | null;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}

interface QueuedCapture {
  wavDataUrl: string;
  sessionKey: string | null | undefined;
  onCaptureFallback?: (wavDataUrl: string) => void | Promise<void>;
}

function getSpeechRecognition(): { new (): SpeechRecognitionLike } | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function isVoiceOutputActive(): boolean {
  const voice = useVoiceStore.getState();
  return voice.remoteOutput !== null || voice.phase === 'queued' || voice.phase === 'speaking';
}

export function useVoiceWake({
  onTranscript,
  onCaptureFallback,
  onWakeDetected,
  lang = 'zh-CN',
  sessionKey = null,
}: VoiceWakeOptions) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<WakePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const stoppedRef = useRef(true);
  const nativeVADRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureQueueRef = useRef<QueuedCapture[]>([]);
  const captureDrainingRef = useRef(false);
  const suppressNativeCaptureRef = useRef(false);
  const callbacksRef = useRef({ onTranscript, onCaptureFallback, onWakeDetected, sessionKey });
  callbacksRef.current = { onTranscript, onCaptureFallback, onWakeDetected, sessionKey };

  const updatePhase = useCallback((next: WakePhase, ownerSessionKey?: string | null) => {
    const resolvedSessionKey = ownerSessionKey === undefined
      ? callbacksRef.current.sessionKey
      : ownerSessionKey;
    setPhase(next);
    if (next === 'listening' || next === 'wake_detected') voiceRuntime.setListening(resolvedSessionKey);
    else if (next === 'transcribing') voiceRuntime.setTranscribing(resolvedSessionKey);
    else if (next === 'idle') voiceRuntime.setIdle(resolvedSessionKey);
  }, []);

  const drainCaptureQueue = useCallback(async () => {
    if (captureDrainingRef.current) return;
    captureDrainingRef.current = true;
    try {
      while (!stoppedRef.current && captureQueueRef.current.length > 0) {
        const capture = captureQueueRef.current.shift();
        if (!capture) continue;
        // A queued utterance belongs to the session that was active when the
        // native VAD emitted it. Drop it after a session switch instead of
        // sending old microphone input through the latest callback closure.
        if (capture.sessionKey !== callbacksRef.current.sessionKey) continue;
        updatePhase('transcribing', capture.sessionKey);
        try {
          await capture.onCaptureFallback?.(capture.wavDataUrl);
        } catch (captureError) {
          setError(captureError instanceof Error ? captureError.message : String(captureError));
          voiceRuntime.setError(captureError, capture.sessionKey);
        }
      }
    } finally {
      captureDrainingRef.current = false;
      if (!stoppedRef.current && nativeVADRef.current) updatePhase('listening');
    }
  }, [updatePhase]);

  const startNativeVAD = useCallback(async () => {
    if (nativeVADRef.current || stoppedRef.current) return;
    nativeVADRef.current = true;
    try {
      await invoke('voice_wake_start');
      if (stoppedRef.current) {
        await invoke('voice_wake_stop').catch(() => undefined);
        nativeVADRef.current = false;
        return;
      }
      setEnabled(true);
      setError(null);
      updatePhase('listening');
    } catch (error) {
      nativeVADRef.current = false;
      setError(typeof error === 'string' ? error : String((error as any)?.message ?? error));
      updatePhase('error');
      voiceRuntime.setError(error, callbacksRef.current.sessionKey);
      setEnabled(false);
    }
  }, [updatePhase]);

  const startBrowserRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor || stoppedRef.current || nativeVADRef.current || recognitionRef.current) return;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event: any) => {
      if (stoppedRef.current || recognitionRef.current !== rec) return;
      const results = event?.results;
      const startIndex = Number(event?.resultIndex || 0);
      for (let index = startIndex; index < (results?.length || 0); index += 1) {
        const result = results[index];
        if (!result?.isFinal) continue;
        const transcript = String(result?.[0]?.transcript || '').trim();
        if (!transcript) continue;
        updatePhase('transcribing');
        const callbacks = callbacksRef.current;
        callbacks.onWakeDetected?.();
        if (stoppedRef.current || recognitionRef.current !== rec) return;
        callbacks.onTranscript(transcript);
        if (!stoppedRef.current && recognitionRef.current === rec) updatePhase('listening');
      }
    };
    rec.onerror = (event: any) => {
      if (stoppedRef.current || recognitionRef.current !== rec || event?.error === 'aborted') return;
      const message = String(event?.error || 'speech recognition failed');
      // Silence is a normal end condition for some continuous recognizers.
      // Let onend restart the browser backend instead of switching providers.
      if (message === 'no-speech') return;
      // Some WebViews expose the constructor but cannot access the OS speech
      // service. Fall back to the native VAD instead of leaving the control
      // enabled with no input path.
      recognitionRef.current = null;
      try { rec.stop(); } catch {}
      void startNativeVAD();
    };
    rec.onend = () => {
      if (recognitionRef.current !== rec) return;
      recognitionRef.current = null;
      if (stoppedRef.current || nativeVADRef.current) return;
      // WebView speech recognizers end after silence on some platforms. Keep
      // the wake control live until the user explicitly turns it off.
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (!stoppedRef.current && !nativeVADRef.current && !recognitionRef.current) {
          startBrowserRecognition();
        }
      }, 180);
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (error) {
      if (recognitionRef.current === rec) recognitionRef.current = null;
      if (!stoppedRef.current) {
        setError(String(error));
        updatePhase('error');
        voiceRuntime.setError(error, callbacksRef.current.sessionKey);
        void startNativeVAD();
      }
    }
  }, [lang, startNativeVAD, updatePhase]);

  const start = useCallback(async () => {
    if (!stoppedRef.current && (recognitionRef.current || nativeVADRef.current)) return;
    voiceRuntime.interruptAll();
    setError(null);
    stoppedRef.current = false;
    captureQueueRef.current = [];
    suppressNativeCaptureRef.current = false;
    const Ctor = getSpeechRecognition();
    if (Ctor) {
      nativeVADRef.current = false;
      setEnabled(true);
      updatePhase('listening');
      startBrowserRecognition();
      return;
    }
    await startNativeVAD();
  }, [startBrowserRecognition, startNativeVAD, updatePhase]);

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    captureQueueRef.current = [];
    suppressNativeCaptureRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (nativeVADRef.current) {
      try { await invoke('voice_wake_stop'); } catch {}
    }
    nativeVADRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) { try { recognition.stop(); } catch {} }
    setEnabled(false);
    updatePhase('idle');
  }, [updatePhase]);

  useEffect(() => () => {
    stoppedRef.current = true;
    captureQueueRef.current = [];
    suppressNativeCaptureRef.current = false;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) { try { recognition.stop(); } catch {} }
    if (nativeVADRef.current) void invoke('voice_wake_stop').catch(() => undefined);
    nativeVADRef.current = false;
    voiceRuntime.setIdle(callbacksRef.current.sessionKey);
  }, []);

  // Subscribe to Rust voice-wake events for the lifetime of `enabled`.
  useEffect(() => {
    if (!enabled) return;
    const unlisten = subscribeTauriEvent('voice-wake', (event: any) => {
      if (stoppedRef.current || !nativeVADRef.current) return;
      const payload = event.payload || {};
      const st = payload.state;
      if (st === 'wake_detected') {
        suppressNativeCaptureRef.current = isVoiceOutputActive();
        if (suppressNativeCaptureRef.current) return;
        updatePhase('wake_detected');
        callbacksRef.current.onWakeDetected?.();
      } else if (st === 'captured' && typeof payload.data === 'string') {
        if (suppressNativeCaptureRef.current) {
          suppressNativeCaptureRef.current = false;
          return;
        }
        captureQueueRef.current.push({
          wavDataUrl: payload.data,
          sessionKey: callbacksRef.current.sessionKey,
          onCaptureFallback: callbacksRef.current.onCaptureFallback,
        });
        void drainCaptureQueue();
      } else if (st === 'error') {
        nativeVADRef.current = false;
        captureQueueRef.current = [];
        suppressNativeCaptureRef.current = false;
        setError(String(payload.error || 'voice wake error'));
        updatePhase('error');
        voiceRuntime.setError(payload.error, callbacksRef.current.sessionKey);
        setEnabled(false);
      } else if (st === 'stopped') {
        nativeVADRef.current = false;
        suppressNativeCaptureRef.current = false;
        setEnabled(false);
        updatePhase('idle');
      }
    });
    return unlisten;
  }, [drainCaptureQueue, enabled, updatePhase]);

  return { enabled, phase, error, start, stop };
}
