import { FormEvent, useEffect, useRef, useState } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { JunQiLogo } from '@/components/shared/JunQiLogo';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import {
  focusPrivacyUnlock,
  unlockPrivacyLock,
  unlockPrivacyWithSystemAuthentication,
} from './api';
import { usePrivacyLockStore } from './store';

export interface PrivacyLockScreenProps {
  compact?: boolean;
}

function errorKey(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  if (value.includes('retry_later')) return 'privacyLock.errors.retryLater';
  if (value.includes('lock_state_changed')) return 'privacyLock.errors.stateChanged';
  if (value.includes('credential')) return 'privacyLock.errors.credentialUnavailable';
  if (value.includes('cancel')) return 'privacyLock.errors.cancelled';
  if (value.includes('timeout')) return 'privacyLock.errors.timeout';
  if (value.includes('busy')) return 'privacyLock.errors.busy';
  if (value.includes('system_authentication')) return 'privacyLock.errors.systemUnavailable';
  return 'privacyLock.errors.incorrectPin';
}

export function PrivacyLockScreen({ compact = false }: PrivacyLockScreenProps) {
  const { t } = useTranslation();
  const snapshot = usePrivacyLockStore((state) => state.snapshot);
  const setSnapshot = usePrivacyLockStore((state) => state.setSnapshot);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [snapshot?.revision]);

  useEffect(() => {
    if (!snapshot?.locked || snapshot.retryAfterMs <= 0) return;
    const timer = window.setTimeout(() => {
      void usePrivacyLockStore.getState().refresh().catch(() => undefined);
    }, Math.min(snapshot.retryAfterMs + 25, 1_000));
    return () => window.clearTimeout(timer);
  }, [snapshot?.locked, snapshot?.retryAfterMs]);

  useEffect(() => {
    if (compact || !snapshot?.locked) return;
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPin('');
      setError(null);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', clearOnEscape);
    return () => window.removeEventListener('keydown', clearOnEscape);
  }, [compact, snapshot?.locked]);

  if (!snapshot?.locked) return null;

  if (compact) {
    return (
      <main className="flex h-screen w-full items-center justify-center bg-aegis-bg p-5 text-center">
        <div className="flex max-w-[280px] flex-col items-center gap-3">
          <LockKeyhole size={24} className="text-aegis-primary" aria-hidden="true" />
          <h1 className="text-[14px] font-semibold text-aegis-text">{t('privacyLock.lockedTitle')}</h1>
          <p className="text-[12px] leading-relaxed text-aegis-text-muted">{t('privacyLock.unlockInMain')}</p>
          <button
            type="button"
            onClick={() => void focusPrivacyUnlock()}
            className="rounded-lg border border-aegis-primary/30 bg-aegis-primary/10 px-3 py-2 text-[12px] font-medium text-aegis-primary transition-colors hover:bg-aegis-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50"
          >
            {t('privacyLock.openMain')}
          </button>
        </div>
      </main>
    );
  }

  const unlockWithPin = async (event: FormEvent) => {
    event.preventDefault();
    if (!pin || busy || snapshot.retryAfterMs > 0) return;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await unlockPrivacyLock(snapshot.revision, pin));
      setPin('');
    } catch (reason) {
      setError(errorKey(reason));
      setPin('');
      void usePrivacyLockStore.getState().refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const unlockWithSystem = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await unlockPrivacyWithSystemAuthentication(
        snapshot.revision,
        t('privacyLock.systemPrompt'),
      ));
    } catch (reason) {
      setError(errorKey(reason));
      void usePrivacyLockStore.getState().refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const retrySeconds = Math.max(1, Math.ceil(snapshot.retryAfterMs / 1000));

  return (
    <main className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-aegis-bg p-6">
      <div className="ambient-glow-teal" aria-hidden="true" />
      <div className="relative z-[1] w-[min(400px,100%)] rounded-2xl border border-aegis-border bg-aegis-surface p-7 shadow-[var(--aegis-shadow-popover)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <JunQiLogo variant="emblem" className="h-[42px] w-[42px]" />
          <div className="mt-4 flex h-10 w-10 items-center justify-center rounded-xl border border-aegis-primary/20 bg-aegis-primary/10">
            <LockKeyhole size={19} className="text-aegis-primary" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-[18px] font-semibold text-aegis-text">{t('privacyLock.lockedTitle')}</h1>
          <p className="mt-2 text-[12px] leading-relaxed text-aegis-text-muted">{t('privacyLock.backgroundRunning')}</p>
        </div>

        <form onSubmit={unlockWithPin} className="space-y-3">
          <label htmlFor="privacy-lock-pin" className="block text-[12px] font-medium text-aegis-text-muted">
            {t('privacyLock.pinLabel')}
          </label>
          <input
            ref={inputRef}
            id="privacy-lock-pin"
            type="password"
            autoComplete="current-password"
            value={pin}
            disabled={busy || snapshot.retryAfterMs > 0}
            onChange={(event) => setPin(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'privacy-lock-error' : undefined}
            className="h-11 w-full rounded-xl border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] px-3 text-[14px] text-aegis-text outline-none transition-colors focus:border-aegis-primary/60 focus-visible:ring-2 focus-visible:ring-aegis-primary/30 disabled:cursor-wait disabled:opacity-60"
          />
          {error && (
            <p id="privacy-lock-error" role="alert" className="text-[11px] leading-relaxed text-aegis-danger">
              {t(error)}
            </p>
          )}
          {snapshot.retryAfterMs > 0 && (
            <p role="status" className="text-[11px] text-aegis-warning">
              {t('privacyLock.retryAfter', { seconds: retrySeconds })}
            </p>
          )}
          <button
            type="submit"
            disabled={!pin || busy || snapshot.retryAfterMs > 0}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-aegis-primary text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy && <LoadingIndicator variant="spinner" size={14} className="text-white" />}
            {t('privacyLock.unlock')}
          </button>
        </form>

        {snapshot.systemAuthentication === 'available' && (
          <button
            type="button"
            disabled={busy || snapshot.retryAfterMs > 0}
            onClick={() => void unlockWithSystem()}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-aegis-border text-[12px] font-medium text-aegis-text transition-colors hover:border-aegis-primary/40 hover:text-aegis-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 disabled:cursor-wait disabled:opacity-50"
          >
            <ShieldCheck size={15} aria-hidden="true" />
            {t('privacyLock.useSystemAuthentication')}
          </button>
        )}
      </div>
    </main>
  );
}
