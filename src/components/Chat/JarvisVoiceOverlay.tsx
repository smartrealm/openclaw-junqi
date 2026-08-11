import { useEffect, useRef } from 'react';
import { AlertTriangle, Radio, RotateCcw, Square, X } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { TalkConversationSnapshot } from '@/services/voice/TalkConversationCoordinator';
import type { VoiceModeSnapshot } from '@/services/voice/VoiceModeCoordinator';

interface JarvisVoiceOverlayProps {
  snapshot: VoiceModeSnapshot;
  talk: TalkConversationSnapshot;
  inputLevel: number;
  sessionLabel: string;
  onStop: () => void;
  onRetry: () => void;
}

const INPUT_METER_SEGMENTS = 20;
const INPUT_METER_FLOOR_DB = -60;

/** 将原生 RMS 映射为对数音量表，不生成虚假的波形数据。 */
export function normalizeVoiceInputLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const decibels = 20 * Math.log10(Math.min(level, 1));
  return Math.max(0, Math.min(1, (decibels - INPUT_METER_FLOOR_DB) / -INPUT_METER_FLOOR_DB));
}

function phaseKey(phase: VoiceModeSnapshot['phase']): string {
  return `input.jarvisPhase.${phase}`;
}

export function JarvisVoiceOverlay({
  snapshot,
  talk,
  inputLevel,
  sessionLabel,
  onStop,
  onRetry,
}: JarvisVoiceOverlayProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLElement>(null);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;
  const reduceMotion = useReducedMotion();
  const active = snapshot.mode === 'talk';
  const meterLevel = normalizeVoiceInputLevel(inputLevel);

  useEffect(() => {
    if (!active) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    (stopButtonRef.current ?? dialogRef.current)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onStopRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialogRef.current.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialogRef.current.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [active]);

  if (!active) return null;
  const errored = snapshot.phase === 'error';
  return (
    <section
      ref={dialogRef}
      className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-aegis-bg-solid text-aegis-text"
      style={{ zIndex: 'var(--z-voice-overlay)' }}
      role="dialog"
      aria-modal="true"
      aria-label={t('input.jarvisOverlayTitle')}
      tabIndex={-1}
    >
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-aegis-border/70 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-aegis-primary/25 bg-aegis-primary/10 text-aegis-primary">
            <Radio size={18} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-[13px] font-semibold">{t('input.jarvisOverlayTitle')}</strong>
            <small className="block truncate text-[11px] text-aegis-text-muted">{sessionLabel}</small>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-aegis-text-muted sm:block" role="status" aria-live="polite">
            {t(phaseKey(snapshot.phase))}
          </span>
          <button
            type="button"
            onClick={onStop}
            className="grid size-9 place-items-center rounded-lg text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50"
            title={t('input.jarvisExit')}
            aria-label={t('input.jarvisExit')}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-5 py-6 sm:px-10 sm:py-8">
          <div className="flex min-h-[190px] shrink-0 flex-col items-center justify-center sm:min-h-[230px]">
            <div
              className={errored
                ? 'grid size-20 place-items-center rounded-full border border-aegis-danger/30 bg-aegis-danger/10 text-aegis-danger'
                : 'grid h-24 w-full max-w-xl grid-cols-[repeat(20,minmax(0,1fr))] items-center gap-1.5'}
              aria-hidden="true"
            >
              {errored ? (
                <AlertTriangle size={30} />
              ) : Array.from({ length: INPUT_METER_SEGMENTS }, (_, index) => {
                const threshold = (index + 1) / INPUT_METER_SEGMENTS;
                const activeSegment = meterLevel >= threshold;
                const color = index >= INPUT_METER_SEGMENTS - 3
                  ? 'bg-aegis-danger'
                  : index >= INPUT_METER_SEGMENTS - 8
                    ? 'bg-aegis-primary'
                    : 'bg-aegis-success';
                return (
                  <motion.span
                    key={index}
                    className={`block h-14 rounded-sm ${color}`}
                    initial={false}
                    animate={{
                      opacity: activeSegment ? 1 : 0.16,
                      scaleY: activeSegment ? 1 : 0.42,
                    }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.08, ease: 'easeOut' }}
                  />
                );
              })}
            </div>
            <h2 className="mt-5 text-center text-[24px] font-semibold sm:text-[30px]">
              {t(phaseKey(snapshot.phase))}
            </h2>
            {errored && (
              <p className="mt-2 max-w-2xl text-center text-[12px] leading-5 text-aegis-text-muted">
                {t(`input.jarvisError.${snapshot.error ?? 'talk_unavailable'}`)}
              </p>
            )}
          </div>

          <div className="grid min-h-0 flex-1 border-y border-aegis-border/60 md:grid-cols-2 md:divide-x md:divide-aegis-border/60">
            <section className="min-h-[120px] overflow-y-auto px-1 py-5 pe-5 sm:py-6 md:min-h-0" aria-label={t('input.jarvisYou')}>
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold text-aegis-text-muted">
                <span className="size-1.5 rounded-full bg-aegis-primary" />
                {t('input.jarvisYou')}
              </div>
              <p className="whitespace-pre-wrap text-[16px] leading-7 text-aegis-text-secondary sm:text-[18px]">
                {talk.userTranscript || t('input.jarvisWaitingForSpeech')}
              </p>
            </section>
            <section className="min-h-[120px] overflow-y-auto border-t border-aegis-border/60 px-1 py-5 sm:py-6 md:min-h-0 md:border-t-0 md:ps-6" aria-label={t('input.jarvisAssistant')}>
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold text-aegis-text-muted">
                <span className="size-1.5 rounded-full bg-aegis-success" />
                {t('input.jarvisAssistant')}
              </div>
              <p className="whitespace-pre-wrap text-[16px] leading-7 text-aegis-text-secondary sm:text-[18px]">
                {talk.assistantText || t('input.jarvisWaitingForResponse')}
              </p>
            </section>
          </div>
        </main>
      </div>

      <footer className="flex min-h-20 shrink-0 items-center justify-center gap-3 border-t border-aegis-border/70 px-4 py-3">
        {errored && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-aegis-border bg-aegis-surface px-4 text-[12px] font-semibold text-aegis-text transition-colors hover:bg-aegis-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50"
          >
            <RotateCcw size={15} />
            {t('input.jarvisRetry')}
          </button>
        )}
        <button
          ref={stopButtonRef}
          type="button"
          onClick={onStop}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-aegis-danger px-5 text-[12px] font-semibold text-aegis-btn-primary-text transition-colors hover:bg-aegis-danger/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-danger/50"
        >
          <Square size={13} fill="currentColor" />
          {t('input.jarvisStop')}
        </button>
      </footer>
    </section>
  );
}
