import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, RefreshCw, Send, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';
import { debugError } from '@/utils/debugLog';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { voiceFileRuntime } from '@/services/chat/voiceFileRuntime';
import type { VoiceRecordingStopResult } from '@/api/tauri-commands';

interface VoiceRecorderProps {
  onSendVoice: (base64: string, mimeType: string, durationSec: number, previewUrl: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

type RecorderFailure = 'microphone' | 'save' | null;

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function VoiceRecorder({ onSendVoice, onCancel, disabled }: VoiceRecorderProps) {
  const { t } = useTranslation();
  const { language } = useSettingsStore();
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failure, setFailure] = useState<RecorderFailure>(null);
  const attemptRef = useRef(0);
  const startingRef = useRef(false);
  const activeRecordingIdRef = useRef<string | null>(null);
  const stopPromiseRef = useRef<{
    recordingId: string;
    promise: Promise<VoiceRecordingStopResult | null>;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    startedAtRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 200);
  }, [clearTimer]);

  const stopNativeRecording = useCallback((recordingId: string) => {
    const pendingStop = stopPromiseRef.current;
    if (pendingStop?.recordingId === recordingId) return pendingStop.promise;
    const pending = voiceFileRuntime.stopRecording(recordingId)
      .catch((error) => {
        debugError('media', '[VoiceRecorder] Native stop failed:', error);
        return null;
      })
      .finally(() => {
        if (stopPromiseRef.current?.promise === pending) stopPromiseRef.current = null;
      });
    stopPromiseRef.current = { recordingId, promise: pending };
    return pending;
  }, []);

  const releaseActiveRecording = useCallback(async () => {
    const recordingId = activeRecordingIdRef.current;
    activeRecordingIdRef.current = null;
    clearTimer();
    setRecording(false);
    if (!recordingId) return null;
    return stopNativeRecording(recordingId);
  }, [clearTimer, stopNativeRecording]);

  const startRecording = useCallback(async () => {
    if (disabled || activeRecordingIdRef.current || startingRef.current) return;
    const attempt = ++attemptRef.current;
    startingRef.current = true;
    setStarting(true);
    setFailure(null);
    setElapsed(0);
    try {
      const result = await voiceFileRuntime.startRecording();
      const recordingId = result.success ? result.recordingId?.trim() : '';
      if (!result.success || !recordingId) throw new Error(result.error || 'native-voice-start-failed');
      if (attempt !== attemptRef.current || disabled) {
        await stopNativeRecording(recordingId);
        return;
      }
      activeRecordingIdRef.current = recordingId;
      setRecording(true);
      startTimer();
    } catch (error) {
      if (attempt === attemptRef.current) {
        debugError('media', '[VoiceRecorder] Native start failed:', error);
        setFailure('microphone');
      }
    } finally {
      if (attempt === attemptRef.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, [disabled, startTimer, stopNativeRecording]);

  const handleSend = useCallback(async () => {
    const recordingId = activeRecordingIdRef.current;
    if (!recordingId || saving) return;
    setSaving(true);
    const result = await releaseActiveRecording();
    try {
      if (!result?.success || !result.data) throw new Error(result?.error || 'native-voice-empty');
      const base64 = result.data.split(',')[1] || '';
      if (!base64) throw new Error('native-voice-base64-empty');
      onSendVoice(base64, 'audio/wav', result.duration ?? elapsed, result.data);
    } catch (error) {
      debugError('media', '[VoiceRecorder] Send failed:', error);
      setFailure('save');
    } finally {
      setSaving(false);
    }
  }, [elapsed, onSendVoice, releaseActiveRecording, saving]);

  const handleCancel = useCallback(async () => {
    attemptRef.current += 1;
    startingRef.current = false;
    await releaseActiveRecording();
    setElapsed(0);
    onCancel();
  }, [onCancel, releaseActiveRecording]);

  useEffect(() => {
    if (!disabled) void startRecording();
    return () => {
      attemptRef.current += 1;
      startingRef.current = false;
      void releaseActiveRecording();
    };
  }, [disabled, releaseActiveRecording, startRecording]);

  const status = saving || starting
    ? <LoadingIndicator size="sm" />
    : failure
      ? <MicOff size={17} aria-hidden="true" />
      : <Mic size={17} aria-hidden="true" />;

  const statusText = failure === 'microphone'
    ? t('voice.micError')
    : failure === 'save'
      ? t('voice.recordingSaveError')
      : recording
        ? t('voice.runtimeListening')
        : t('voice.runtimePreparing');

  return (
    <div className="flex w-full items-center gap-3" dir={getDirection(language)}>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-aegis-text-muted">
        <span
          className={clsx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
            recording ? 'bg-aegis-danger/15 text-aegis-danger' : 'bg-[rgb(var(--aegis-overlay)/0.08)]',
          )}
        >
          {status}
        </span>
        <span
          className="min-w-0 truncate text-[13px] text-aegis-text-muted"
          role={failure ? 'alert' : undefined}
        >
          {statusText}
        </span>
      </div>
      <span className="min-w-[40px] shrink-0 text-center font-mono text-[13px] text-aegis-text-muted" dir="ltr">
        {formatTime(elapsed)}
      </span>
      <button
        type="button"
        onClick={() => { void handleCancel(); }}
        disabled={saving}
        className="p-2 text-aegis-danger transition-colors hover:bg-aegis-danger/20 disabled:opacity-50"
        title={t('voice.cancel')}
        aria-label={t('voice.cancel')}
      >
        <X size={18} />
      </button>
      {failure ? (
        <button
          type="button"
          onClick={() => { void startRecording(); }}
          disabled={disabled || starting || saving}
          className="p-2.5 text-aegis-primary transition-colors hover:bg-aegis-primary/15 disabled:opacity-50"
          title={t('common.retry')}
          aria-label={t('common.retry')}
        >
          <RefreshCw size={18} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { void handleSend(); }}
          disabled={saving || !recording || elapsed < 1}
          className="p-2.5 text-aegis-primary transition-colors hover:bg-aegis-primary/15 disabled:opacity-50"
          title={t('voice.sendRecording')}
          aria-label={t('voice.sendRecording')}
        >
          {saving ? <LoadingIndicator size="sm" /> : <Send size={18} />}
        </button>
      )}
    </div>
  );
}
