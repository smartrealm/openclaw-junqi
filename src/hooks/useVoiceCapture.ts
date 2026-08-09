import { useCallback, useEffect, useRef, useState } from 'react';
import { startVoiceCapture, stopVoiceCapture } from '@/api/tauri-commands';
import { decodeVoiceCaptureEvent } from '@/api/voiceCaptureContract';
import { VoiceCaptureOwnership } from '@/services/voice/VoiceCaptureOwnership';
import { voiceRuntime } from '@/runtime/VoiceRuntime';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

export type VoiceCapturePhase = 'idle' | 'starting' | 'listening' | 'hearing' | 'error';

export interface VoiceCapturePcmFrame {
  data: string;
  sampleRateHz: number;
  channels: number;
  inputLevel: number;
}

export interface VoiceCaptureOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onPcmAudio?: (frame: VoiceCapturePcmFrame) => void;
  sessionKey?: string | null;
}

export type VoiceCaptureStartResult =
  | { ok: true }
  | { ok: false; error: string | null };

function createCaptureOwnerId(): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `voice-capture:${randomId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 仅管理用户主动开始的连续音频采集，不实现唤醒词或后台待机。 */
export function useVoiceCapture(options: VoiceCaptureOptions) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<VoiceCapturePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const ownershipRef = useRef<VoiceCaptureOwnership | null>(null);
  if (ownershipRef.current === null) ownershipRef.current = new VoiceCaptureOwnership();
  const operationRef = useRef(0);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const ownership = ownershipRef.current;

  const resetLocalState = useCallback(() => {
    setEnabled(false);
    setError(null);
    setInputLevel(0);
    setPhase('idle');
    voiceRuntime.setIdle(callbacksRef.current.sessionKey);
  }, []);

  const stop = useCallback(async () => {
    const operation = ++operationRef.current;
    const lease = ownership.takeCurrent();
    if (!lease) {
      resetLocalState();
      return;
    }
    try {
      const result = await stopVoiceCapture(lease.ownerId);
      if (operation !== operationRef.current) return;
      if (result.listening) throw new Error('原生语音采集仍在运行');
      resetLocalState();
    } catch (cause) {
      if (operation !== operationRef.current) return;
      const message = errorMessage(cause);
      setEnabled(false);
      setInputLevel(0);
      setError(message);
      setPhase('error');
      voiceRuntime.setError(cause, callbacksRef.current.sessionKey);
    }
  }, [ownership, resetLocalState]);

  const start = useCallback(async (
    format: { sampleRateHz: number; channels: number },
  ): Promise<VoiceCaptureStartResult> => {
    if (ownership.getCurrent()) return enabled ? { ok: true } : { ok: false, error: null };
    const operation = ++operationRef.current;
    const lease = ownership.begin(createCaptureOwnerId());
    setError(null);
    setPhase('starting');
    try {
      const result = await startVoiceCapture(lease.ownerId, format);
      if (operation !== operationRef.current || !ownership.owns(lease)) {
        if (result.listening) await stopVoiceCapture(lease.ownerId).catch(() => undefined);
        return { ok: false, error: null };
      }
      if (!result.listening) throw new Error('原生语音采集未进入监听状态');
      setEnabled(true);
      setPhase('listening');
      voiceRuntime.setListening(callbacksRef.current.sessionKey);
      return { ok: true };
    } catch (cause) {
      if (operation !== operationRef.current || !ownership.release(lease)) {
        return { ok: false, error: null };
      }
      const message = errorMessage(cause);
      setEnabled(false);
      setInputLevel(0);
      setError(message);
      setPhase('error');
      voiceRuntime.setError(cause, callbacksRef.current.sessionKey);
      return { ok: false, error: message };
    }
  }, [enabled, ownership]);

  useEffect(() => subscribeTauriEvent<unknown>('voice-capture', (tauriEvent) => {
    const event = decodeVoiceCaptureEvent(tauriEvent.payload);
    const lease = ownership.getCurrent();
    if (!event || !lease || event.ownerId !== lease.ownerId) return;

    if (event.state === 'listening') {
      setEnabled(true);
      setPhase('listening');
      voiceRuntime.setListening(callbacksRef.current.sessionKey);
      return;
    }
    if (event.state === 'speech_started') {
      setPhase('hearing');
      voiceRuntime.setTranscribing(callbacksRef.current.sessionKey);
      callbacksRef.current.onSpeechStart?.();
      return;
    }
    if (event.state === 'speech_ended') {
      setPhase('listening');
      voiceRuntime.setListening(callbacksRef.current.sessionKey);
      callbacksRef.current.onSpeechEnd?.();
      return;
    }
    if (event.state === 'pcm') {
      setInputLevel(event.inputLevel);
      callbacksRef.current.onPcmAudio?.(event);
      return;
    }
    if (event.state === 'error') {
      operationRef.current += 1;
      ownership.release(lease);
      setEnabled(false);
      setInputLevel(0);
      setError(event.error);
      setPhase('error');
      voiceRuntime.setError(event.error, callbacksRef.current.sessionKey);
      return;
    }
    if (event.state === 'stopped') {
      operationRef.current += 1;
      ownership.release(lease);
      resetLocalState();
    }
  }), [ownership, resetLocalState]);

  useEffect(() => () => {
    operationRef.current += 1;
    const lease = ownership.takeCurrent();
    if (lease) void stopVoiceCapture(lease.ownerId).catch(() => undefined);
    voiceRuntime.setIdle(callbacksRef.current.sessionKey);
  }, [ownership]);

  return { enabled, phase, error, inputLevel, start, stop };
}
