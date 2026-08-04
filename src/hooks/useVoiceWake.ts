// 桌面语音输入统一由 Tauri 原生采集负责：听写使用本地 VAD，唤醒词使用本地
// Sherpa-ONNX 检测。WebView 不参与麦克风采集、识别或回退。

import { useEffect, useCallback, useRef, useState } from 'react';
import { startVoiceWake, stopVoiceWake, type VoiceWakeCaptureMode } from '@/api/tauri-commands';
import { subscribeTauriEvent } from '@/utils/tauriEvents';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import {
  VoiceWakeAcceptanceGate,
  type VoiceWakePcmFrame,
} from '@/services/voice/VoiceWakeAcceptanceGate';
import { shouldAcceptVoiceWakeDuringOutput } from '@/services/voice/VoiceWakeBargeInPolicy';
import { useVoiceStore } from '@/stores/voiceStore';

let nextVoiceWakeOwner = 0;

function createVoiceWakeOwnerId(): string {
  nextVoiceWakeOwner += 1;
  return `voice-wake-owner-${nextVoiceWakeOwner}`;
}

export type WakePhase = 'idle' | 'listening' | 'wake_detected' | 'transcribing' | 'error';
export type { VoiceWakeCaptureMode } from '@/api/tauri-commands';

export interface VoiceWakeOptions {
  /** 原生采集无法转写时，向调用方交付确认后的音频草稿。 */
  onCaptureFallback?: (wavDataUrl: string) => void | Promise<void>;
  /** 接受新的原生语音轮次前执行身份和路由核验。 */
  onWakeDetected?: (trigger: string | null) => boolean | void | Promise<boolean | void>;
  /** 原生 VAD 或关键词触发后发出的 PCM16 帧。 */
  onPcmAudio?: (frame: VoiceWakePcmFrame) => void | Promise<void>;
  /** 拥有采集输入和运行时状态的会话。 */
  sessionKey?: string | null;
}

interface QueuedCapture {
  wavDataUrl: string;
  sessionKey: string | null | undefined;
  onCaptureFallback?: (wavDataUrl: string) => void | Promise<void>;
}

function isVoiceOutputActive(): boolean {
  const voice = useVoiceStore.getState();
  return voice.remoteOutput !== null || voice.phase === 'queued' || voice.phase === 'speaking';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPromiseLike(value: unknown): value is PromiseLike<boolean | void> {
  return isRecord(value) && typeof value.then === 'function';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return String(error);
}

export function useVoiceWake({
  onCaptureFallback,
  onWakeDetected,
  onPcmAudio,
  sessionKey = null,
}: VoiceWakeOptions) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<WakePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(true);
  const nativeVADRef = useRef(false);
  const captureQueueRef = useRef<QueuedCapture[]>([]);
  const captureDrainingRef = useRef(false);
  const suppressNativeCaptureRef = useRef(false);
  const wakeAcceptanceGateRef = useRef(new VoiceWakeAcceptanceGate());
  const [ownerId] = useState(createVoiceWakeOwnerId);
  const callbacksRef = useRef({ onCaptureFallback, onWakeDetected, onPcmAudio, sessionKey });
  callbacksRef.current = { onCaptureFallback, onWakeDetected, onPcmAudio, sessionKey };

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
        // 排队语音归属原生 VAD 事件产生时的会话，切换后不能交给最新回调。
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

  const startNativeVAD = useCallback(async (mode: VoiceWakeCaptureMode, streamPcm = false) => {
    if (nativeVADRef.current || stoppedRef.current) return;
    nativeVADRef.current = true;
    try {
      await startVoiceWake(mode, { streamPcm, ownerId });
      if (stoppedRef.current) {
        await stopVoiceWake(ownerId).catch(() => undefined);
        nativeVADRef.current = false;
        return;
      }
      setEnabled(true);
      setError(null);
      updatePhase('listening');
    } catch (error) {
      nativeVADRef.current = false;
      setError(errorMessage(error));
      updatePhase('error');
      voiceRuntime.setError(error, callbacksRef.current.sessionKey);
      setEnabled(false);
    }
  }, [ownerId, updatePhase]);

  const start = useCallback(async (
    mode: VoiceWakeCaptureMode = 'dictation',
    options: { streamPcm?: boolean } = {},
  ) => {
    if (!stoppedRef.current && nativeVADRef.current) return;
    voiceRuntime.interruptAll();
    setError(null);
    stoppedRef.current = false;
    captureQueueRef.current = [];
    suppressNativeCaptureRef.current = false;
    wakeAcceptanceGateRef.current.reject();
    await startNativeVAD(mode, options.streamPcm === true);
  }, [startNativeVAD]);

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    captureQueueRef.current = [];
    suppressNativeCaptureRef.current = false;
    wakeAcceptanceGateRef.current.reject();
    if (nativeVADRef.current) {
      try { await stopVoiceWake(ownerId); } catch {}
    }
    nativeVADRef.current = false;
    setEnabled(false);
    setError(null);
    updatePhase('idle');
  }, [ownerId, updatePhase]);

  useEffect(() => () => {
    stoppedRef.current = true;
    captureQueueRef.current = [];
    suppressNativeCaptureRef.current = false;
    wakeAcceptanceGateRef.current.reject();
    if (nativeVADRef.current) void stopVoiceWake(ownerId).catch(() => undefined);
    nativeVADRef.current = false;
    voiceRuntime.setIdle(callbacksRef.current.sessionKey);
  }, [ownerId]);

  // 仅在原生 listener 已启动时订阅 Rust 事件，避免旧事件穿透到新会话。
  useEffect(() => {
    if (!enabled) return;
    const unlisten = subscribeTauriEvent<unknown>('voice-wake', (event) => {
      if (stoppedRef.current || !nativeVADRef.current) return;
      const payload = isRecord(event.payload) ? event.payload : {};
      const st = payload.state;
      if (st === 'wake_detected') {
        const trigger = typeof payload.trigger === 'string' && payload.trigger.trim().length > 0
          ? payload.trigger.trim()
          : null;
        suppressNativeCaptureRef.current = !shouldAcceptVoiceWakeDuringOutput(
          trigger,
          isVoiceOutputActive(),
        );
        if (suppressNativeCaptureRef.current) return;
        updatePhase('wake_detected');
        const completeCapture = (wavDataUrl: string, ownerSessionKey: string | null | undefined) => {
          captureQueueRef.current.push({
            wavDataUrl,
            sessionKey: ownerSessionKey,
            onCaptureFallback: callbacksRef.current.onCaptureFallback,
          });
          void drainCaptureQueue();
        };
        const completeAcceptance = (accepted: boolean | void) => {
          if (accepted === false) {
            wakeAcceptanceGateRef.current.reject();
            suppressNativeCaptureRef.current = true;
            updatePhase('listening');
            return;
          }
          const buffered = wakeAcceptanceGateRef.current.accept();
          for (const frame of buffered.pcmFrames) {
            void callbacksRef.current.onPcmAudio?.(frame);
          }
          if (buffered.capture) {
            completeCapture(buffered.capture.wavDataUrl, buffered.capture.sessionKey);
          }
        };
        const accepted = callbacksRef.current.onWakeDetected?.(trigger);
        if (isPromiseLike(accepted)) {
          wakeAcceptanceGateRef.current.begin();
          void Promise.resolve(accepted).then((result) => {
            if (stoppedRef.current || !nativeVADRef.current || !wakeAcceptanceGateRef.current.isPending()) {
              wakeAcceptanceGateRef.current.reject();
              return;
            }
            completeAcceptance(result);
          }).catch((wakeError) => {
            wakeAcceptanceGateRef.current.reject();
            suppressNativeCaptureRef.current = true;
            setError(wakeError instanceof Error ? wakeError.message : String(wakeError));
            updatePhase('error');
            voiceRuntime.setError(wakeError, callbacksRef.current.sessionKey);
          });
        } else if (accepted === false) {
          suppressNativeCaptureRef.current = true;
          updatePhase('listening');
        }
      } else if (
        st === 'pcm'
        && typeof payload.data === 'string'
        && payload.encoding === 'pcm16'
        && typeof payload.sampleRateHz === 'number'
        && typeof payload.channels === 'number'
        && Number.isInteger(payload.sampleRateHz)
        && Number.isInteger(payload.channels)
      ) {
        if (wakeAcceptanceGateRef.current.retainPcm({
          data: payload.data,
          sampleRateHz: payload.sampleRateHz,
          channels: payload.channels,
        })) return;
        // 关键词被拒绝后，原生停止命令抵达 worker 前仍可能有在途 PCM 回调。
        if (suppressNativeCaptureRef.current) return;
        void callbacksRef.current.onPcmAudio?.({
          data: payload.data,
          sampleRateHz: payload.sampleRateHz,
          channels: payload.channels,
        });
      } else if (st === 'captured' && typeof payload.data === 'string') {
        if (wakeAcceptanceGateRef.current.retainCapture({
          wavDataUrl: payload.data,
          sessionKey: callbacksRef.current.sessionKey,
        })) return;
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
        wakeAcceptanceGateRef.current.reject();
        setError(String(payload.error || 'voice wake error'));
        updatePhase('error');
        voiceRuntime.setError(payload.error, callbacksRef.current.sessionKey);
        setEnabled(false);
      } else if (st === 'stopped') {
        nativeVADRef.current = false;
        suppressNativeCaptureRef.current = false;
        wakeAcceptanceGateRef.current.reject();
        setEnabled(false);
        updatePhase('idle');
      }
    });
    return unlisten;
  }, [drainCaptureQueue, enabled, updatePhase]);

  return { enabled, phase, error, start, stop };
}
