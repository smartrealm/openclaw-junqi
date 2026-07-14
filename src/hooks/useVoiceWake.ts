// Voice wake listener: bridges the Rust VAD (voice-wake events) to the chat
// input box. Phase 1: VAD placeholder wake word + Web Speech API transcription
// where the webview supports it; otherwise the captured WAV is surfaced as an
// audio attachment so the feature still works end-to-end on Windows.
//
// Phase 2 will replace VAD with Porcupine and add a proper cross-platform ASR
// backend (local Whisper). This module keeps the ASR step pluggable so that
// swap does not touch the wake pipeline.

import { useEffect, useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

export type WakePhase = 'idle' | 'listening' | 'wake_detected' | 'transcribing' | 'error';

export interface VoiceWakeOptions {
  /** Called with the transcribed text so the caller can fill the chat input. */
  onTranscript: (text: string) => void;
  /** Called when a captured utterance couldn't be transcribed (e.g. no ASR on
   *  this platform). Lets the caller offer it as an audio attachment instead. */
  onCaptureFallback?: (wavDataUrl: string) => void;
  /** Preferred language for transcription (BCP-47). */
  lang?: string;
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

function getSpeechRecognition(): { new (): SpeechRecognitionLike } | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useVoiceWake({ onTranscript, onCaptureFallback, lang = 'zh-CN' }: VoiceWakeOptions) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<WakePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Pending WAV from a VAD capture awaiting transcription. When the webview
  // lacks Web Speech API we hand this to the fallback instead.
  const pendingWavRef = useRef<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      await invoke('voice_wake_start');
      setEnabled(true);
      setPhase('listening');
    } catch (e: any) {
      setError(typeof e === 'string' ? e : String(e?.message ?? e));
      setPhase('error');
      setEnabled(false);
    }
  }, []);

  const stop = useCallback(async () => {
    try { await invoke('voice_wake_stop'); } catch {}
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
    setEnabled(false);
    setPhase('idle');
  }, []);

  // Try to transcribe a captured utterance via the webview's Speech API.
  // macOS WKWebView does not implement Web Speech API, so on macOS this is
  // expected to fail and the caller should treat the WAV as an attachment.
  // Windows WebView2 sometimes supports it via the OS speech recognizer.
  const transcribe = useCallback((wavDataUrl: string) => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      onCaptureFallback?.(wavDataUrl);
      setPhase('listening');
      return;
    }
    setPhase('transcribing');
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    let gotResult = false;
    rec.onresult = (e: any) => {
      const transcript = e?.results?.[0]?.[0]?.transcript;
      if (transcript) { gotResult = true; onTranscript(String(transcript).trim()); }
    };
    rec.onerror = () => {
      onCaptureFallback?.(wavDataUrl);
      setPhase('listening');
      recognitionRef.current = null;
    };
    rec.onend = () => {
      if (!gotResult) onCaptureFallback?.(wavDataUrl);
      setPhase('listening');
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    try { rec.start(); } catch {
      onCaptureFallback?.(wavDataUrl);
      setPhase('listening');
      recognitionRef.current = null;
    }
  }, [lang, onTranscript, onCaptureFallback]);

  // Subscribe to Rust voice-wake events for the lifetime of `enabled`.
  useEffect(() => {
    if (!enabled) return;
    const unlisten = subscribeTauriEvent('voice-wake', (event: any) => {
      const payload = event.payload || {};
      const st = payload.state;
      if (st === 'wake_detected') {
        setPhase('wake_detected');
        // Pre-arm transcription: we'll feed it the WAV once captured.
      } else if (st === 'captured' && typeof payload.data === 'string') {
        transcribe(payload.data);
      } else if (st === 'error') {
        setError(String(payload.error || 'voice wake error'));
        setPhase('error');
      } else if (st === 'stopped') {
        setPhase('idle');
      }
    });
    return unlisten;
  }, [enabled, transcribe]);

  return { enabled, phase, error, start, stop };
}
