import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, X, Send, Loader2, Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';
import clsx from 'clsx';

// ═══════════════════════════════════════════════════════════
// VoiceRecorder — Record audio and save to shared folder
// Uses MediaRecorder API → saves WAV/WebM to disk via IPC
// Then sends the file path as a text message
// ═══════════════════════════════════════════════════════════

interface VoiceRecorderProps {
  onSendVoice: (base64: string, mimeType: string, durationSec: number, previewUrl: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function VoiceRecorder({ onSendVoice, onCancel, disabled }: VoiceRecorderProps) {
  const { t } = useTranslation();
  const { language } = useSettingsStore();
  const dir = getDirection(language);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [level, setLevel] = useState(0); // Audio level 0-1 for visualizer

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frozenHistory = useRef<number[]>([]); // Left: speaking segments accumulate
  const liveHistory = useRef<number[]>(new Array(180).fill(0.05)); // Right: scrolling window
  const noiseSum = useRef(0);
  const noiseSamples = useRef(0);

  // ── Format elapsed time ──
  const formatTime = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Audio level visualizer ──
  const updateLevel = useCallback(() => {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height, mid = h / 2;
    const DIVIDER_X = Math.min(Math.floor(w * 0.65), (frozenHistory.current.length > 0 ? Math.floor(w * 0.06) + frozenHistory.current.length : 0));

    const tdData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(tdData);

    let sum = 0;
    for (let i = 0; i < tdData.length; i++) {
      const v = (tdData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / tdData.length);
    const level = Math.min(1, rms * 3);

    // Running noise gate
    if (rms < 0.04 && noiseSamples.current < 300) {
      noiseSum.current += rms;
      noiseSamples.current++;
    }
    const baseline = noiseSamples.current > 20 ? noiseSum.current / noiseSamples.current : 0.01;
    const threshold = Math.max(0.04, baseline * 3);
    const speaking = !paused && rms > threshold;

    const val = speaking ? (0.5 + (level * 0.5)) : 0.05;

    // Left: frozen — push only when speaking
    if (speaking) {
      frozenHistory.current.push(val);
      const MAX_FROZEN = 600;
      if (frozenHistory.current.length > MAX_FROZEN) frozenHistory.current.shift();
    }

    // Right: live — always push (flat when silent)
    liveHistory.current.push(val);
    if (liveHistory.current.length > 180) liveHistory.current.shift();

    // Draw
    ctx.clearRect(0, 0, w, h);

    // ── Left: frozen history (same style as live) ──
    const fh = frozenHistory.current;
    if (fh.length > 0) {
      const fgrad = ctx.createLinearGradient(0, mid - h * 0.3, 0, mid + h * 0.3);
      fgrad.addColorStop(0, 'rgba(14,165,233,0.10)');
      fgrad.addColorStop(0.5, 'rgba(14,165,233,0.015)');
      fgrad.addColorStop(1, 'rgba(14,165,233,0.10)');
      ctx.beginPath();
      for (let i = 0; i < fh.length; i++) {
        const x = (i / Math.max(fh.length - 1, 1)) * DIVIDER_X;
        const y = mid + (fh[i] - 0.5) * h * 1.0;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineTo(DIVIDER_X, mid + h * 0.3);
      ctx.lineTo(0, mid + h * 0.3);
      ctx.closePath();
      ctx.fillStyle = fgrad;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < fh.length; i++) {
        const x = (i / Math.max(fh.length - 1, 1)) * DIVIDER_X;
        const y = mid + (fh[i] - 0.5) * h * 1.0;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 1.2;
      ctx.shadowColor = '#0ea5e9';
      ctx.shadowBlur = 4;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Divider line ──
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(DIVIDER_X, mid - h * 0.35);
    ctx.lineTo(DIVIDER_X, mid + h * 0.35);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Right: live scrolling ──
    const lh = liveHistory.current;
    const grad = ctx.createLinearGradient(DIVIDER_X, mid - h * 0.3, DIVIDER_X, mid + h * 0.3);
    grad.addColorStop(0, 'rgba(14,165,233,0.12)');
    grad.addColorStop(0.5, 'rgba(14,165,233,0.02)');
    grad.addColorStop(1, 'rgba(14,165,233,0.12)');
    ctx.beginPath();
    for (let i = 0; i < lh.length; i++) {
      const x = DIVIDER_X + (i / (lh.length - 1)) * (w - DIVIDER_X);
      const y = mid + (lh[i] - 0.5) * h * 1.0;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, mid + h * 0.3);
    ctx.lineTo(DIVIDER_X, mid + h * 0.3);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < lh.length; i++) {
      const x = DIVIDER_X + (i / (lh.length - 1)) * (w - DIVIDER_X);
      const y = mid + (lh[i] - 0.5) * h * 1.0;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#0ea5e9';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    animFrameRef.current = requestAnimationFrame(updateLevel);
  }, [paused]);

  const pauseRef = useRef(0);

  // ── Pause / Resume ──
  const togglePause = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (paused) {
      rec.resume();
      setPaused(false);
      startTimeRef.current += Date.now() - (pauseRef.current || Date.now());
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)), 200);
      animFrameRef.current = requestAnimationFrame(updateLevel);
    } else {
      rec.pause();
      setPaused(true);
      pauseRef.current = Date.now();
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    }
  }, [paused, updateLevel]);

  // ── Start Recording ──
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });
      streamRef.current = stream;

      // Setup audio analyser for level visualization
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Pick best supported format
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      if (canvasRef.current) { const r = canvasRef.current.getBoundingClientRect(); canvasRef.current.width = r.width * 2; canvasRef.current.height = r.height * 2; }
      recorder.start(100); // Collect chunks every 100ms
      setRecording(true);
      startTimeRef.current = Date.now();

      // Start elapsed timer
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 200);

      // Start level visualizer
      updateLevel();
    } catch (err) {
      console.error('[VoiceRecorder] Failed to start:', err);
      alert(t('voice.micError'));
    }
  }, [updateLevel]);

  // ── Stop Recording ──
  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob());
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        resolve(blob);
      };

      recorder.stop();
      setRecording(false);

      // Cleanup
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      analyserRef.current = null;
    });
  }, []);

  // ── Send Voice ──
  const handleSend = useCallback(async () => {
    setSaving(true);
    try {
      const blob = await stopRecording();
      if (blob.size === 0) {
        setSaving(false);
        onCancel();
        return;
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('voice-read-failed'));
        reader.readAsDataURL(blob);
      });
      const base64 = dataUrl.split(',')[1] || '';
      if (!base64) throw new Error('voice-base64-empty');
      const mimeType = blob.type || 'audio/webm';
      onSendVoice(base64, mimeType, elapsed, dataUrl);
      setSaving(false);
    } catch (err) {
      console.error('[VoiceRecorder] Send failed:', err);
      setSaving(false);
    }
  }, [stopRecording, elapsed, onSendVoice, onCancel]);

  // ── Cancel ──
  const handleCancel = useCallback(async () => {
    await stopRecording();
    setElapsed(0);
    setLevel(0);
    onCancel();
  }, [stopRecording, onCancel]);

  // Auto-start recording when mounted
  useEffect(() => {
    startRecording();
    return () => {
      // Cleanup on unmount
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="flex items-center gap-3 w-full px-3 py-2" dir={dir}>
      {/* Waveform — full width */}
      <div className="flex-1 h-10 flex items-center">
        <canvas ref={canvasRef} width={400} height={40} className="w-full h-full rounded" />
      </div>

      {/* Elapsed time */}
      <span className="text-[13px] font-mono text-aegis-text-muted shrink-0 min-w-[40px] text-center" dir="ltr">
        {formatTime(elapsed)}
      </span>

      {/* Pause / Resume */}
      <button
        onClick={togglePause}
        disabled={saving}
        className={clsx(
          'p-2 rounded-lg transition-colors',
          paused ? 'text-aegis-danger hover:bg-aegis-danger/[0.08]' : 'text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.06)]',
        )}
        title={paused ? 'Resume' : 'Pause'}
      >
        {paused ? <Play size={18} /> : <Pause size={18} />}
      </button>

      {/* Cancel */}
      <button
        onClick={handleCancel}
        className="p-2 rounded-lg hover:bg-aegis-danger/20 text-aegis-danger transition-colors"
        title={t('voice.cancel')}
      >
        <X size={18} />
      </button>

      {/* Send */}
      <button
        onClick={handleSend}
        disabled={saving || elapsed < 1}
        className={clsx(
          'p-2.5 rounded-xl transition-all',
          'bg-aegis-primary hover:bg-aegis-primary-hover text-aegis-btn-primary-text',
          'shadow-lg shadow-aegis-primary/20',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none'
        )}
        title={t('voice.sendRecording')}
      >
        {saving ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Send size={18} className="rotate-180" />
        )}
      </button>
    </div>
  );
}
