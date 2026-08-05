import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { KeyRound, LockKeyhole, ShieldCheck, TimerReset } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/shared/GlassCard';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { SettingsSwitch } from './SettingsSwitch';
import {
  changePrivacyLockPin,
  disablePrivacyLock,
  enablePrivacyLock,
  lockPrivacyNow,
  refreshPrivacySystemAuthentication,
  updatePrivacyLockSettings,
} from '@/privacy-lock/api';
import { usePrivacyLockStore } from '@/privacy-lock/store';
import type { PrivacyLockSettings } from '@/privacy-lock/types';

const AUTO_LOCK_OPTIONS = [0, 60, 300, 600, 1800, 3600] as const;

type SecretAction = 'enable' | 'change' | 'disable' | null;

function operationErrorKey(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('pin_policy')) return 'privacyLock.errors.pinPolicy';
  if (text.includes('authentication_failed')) return 'privacyLock.errors.incorrectPin';
  if (text.includes('credential')) return 'privacyLock.errors.credentialUnavailable';
  if (text.includes('shortcut')) return 'privacyLock.errors.shortcutConflict';
  return 'privacyLock.errors.operationFailed';
}

function SecretDialog({
  action,
  onClose,
}: {
  action: SecretAction;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const snapshot = usePrivacyLockStore((state) => state.snapshot);
  const setSnapshot = usePrivacyLockStore((state) => state.setSnapshot);
  const [currentPin, setCurrentPin] = useState('');
  const [nextPin, setNextPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentPin('');
    setNextPin('');
    setConfirmPin('');
    setError(null);
  }, [action]);

  useEffect(() => {
    if (!action) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLElement>('input, button');
    first?.focus();
    return () => previous?.focus();
  }, [action]);

  if (!action || !snapshot) return null;
  const needsNewPin = action === 'enable' || action === 'change';
  const nextValid = !needsNewPin || (nextPin === confirmPin && nextPin.length >= 6);

  const submit = async () => {
    if (busy || !nextValid) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'enable') {
        setSnapshot(await enablePrivacyLock(nextPin, {
          ...snapshot.settings,
          enabled: true,
        }));
      } else if (action === 'change') {
        await changePrivacyLockPin(currentPin, nextPin);
      } else {
        setSnapshot(await disablePrivacyLock(currentPin));
      }
      onClose();
    } catch (reason) {
      setError(operationErrorKey(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[2147481000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div ref={dialogRef} onKeyDown={handleDialogKeyDown} role="dialog" aria-modal="true" aria-labelledby="privacy-secret-title" className="w-[min(420px,100%)] rounded-xl border border-aegis-border bg-aegis-menu-bg p-5 shadow-[var(--aegis-shadow-popover)]">
        <h2 id="privacy-secret-title" className="text-[15px] font-semibold text-aegis-text">
          {t(`privacyLock.actions.${action}Title`)}
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-aegis-text-muted">
          {t(`privacyLock.actions.${action}Description`)}
        </p>
        <div className="mt-5 space-y-3">
          {action !== 'enable' && (
            <label className="block text-[12px] text-aegis-text-muted">
              {t('privacyLock.currentPin')}
              <input autoFocus type="password" autoComplete="current-password" value={currentPin} onChange={(event) => setCurrentPin(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] px-3 text-aegis-text outline-none focus:border-aegis-primary/60" />
            </label>
          )}
          {needsNewPin && (
            <>
              <label className="block text-[12px] text-aegis-text-muted">
                {t('privacyLock.newPin')}
                <input autoFocus={action === 'enable'} type="password" autoComplete="new-password" value={nextPin} onChange={(event) => setNextPin(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] px-3 text-aegis-text outline-none focus:border-aegis-primary/60" />
              </label>
              <label className="block text-[12px] text-aegis-text-muted">
                {t('privacyLock.confirmPin')}
                <input type="password" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] px-3 text-aegis-text outline-none focus:border-aegis-primary/60" />
              </label>
              {confirmPin && nextPin !== confirmPin && <p role="alert" className="text-[11px] text-aegis-danger">{t('privacyLock.errors.pinMismatch')}</p>}
            </>
          )}
          {error && <p role="alert" className="text-[11px] text-aegis-danger">{t(error)}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-2 text-[12px] text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)]">{t('common.cancel')}</button>
          <button type="button" disabled={busy || !nextValid || (action !== 'enable' && !currentPin)} onClick={() => void submit()} className="flex min-w-[84px] items-center justify-center gap-2 rounded-lg bg-aegis-primary px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-45">
            {busy && <LoadingIndicator variant="spinner" size={13} className="text-white" />}
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PrivacyLockSettingsPanel() {
  const { t } = useTranslation();
  const snapshot = usePrivacyLockStore((state) => state.snapshot);
  const setSnapshot = usePrivacyLockStore((state) => state.setSnapshot);
  const [action, setAction] = useState<SecretAction>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshPrivacySystemAuthentication().then(setSnapshot).catch(() => undefined);
  }, [setSnapshot]);

  if (!snapshot) return <LoadingIndicator variant="dots" size={12} className="text-aegis-primary" />;

  const save = async (settings: PrivacyLockSettings) => {
    setSaving(true);
    setError(null);
    try {
      setSnapshot(await updatePrivacyLockSettings(settings));
    } catch (reason) {
      setError(operationErrorKey(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <GlassCard>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-aegis-primary/10 text-aegis-primary"><LockKeyhole size={17} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-[14px] font-semibold text-aegis-text">{t('privacyLock.settings.title')}</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-aegis-text-muted">{t('privacyLock.settings.description')}</p>
              </div>
              <SettingsSwitch checked={snapshot.enabled} disabled={saving} label={t('privacyLock.settings.title')} onCheckedChange={(enabled) => {
                if (enabled) setAction('enable');
                else setAction('disable');
              }} />
            </div>
            {snapshot.enabled && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void lockPrivacyNow().then(setSnapshot)} className="rounded-lg border border-aegis-primary/30 bg-aegis-primary/10 px-3 py-2 text-[12px] font-medium text-aegis-primary hover:bg-aegis-primary/15">{t('privacyLock.settings.lockNow')}</button>
                <button type="button" onClick={() => setAction('change')} className="rounded-lg border border-aegis-border px-3 py-2 text-[12px] text-aegis-text-muted hover:text-aegis-text">{t('privacyLock.settings.changePin')}</button>
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-aegis-text"><TimerReset size={16} className="text-aegis-primary" />{t('privacyLock.settings.autoLock')}</h3>
        <div className="mt-4 space-y-4">
          <label className="flex items-center justify-between gap-4 text-[12px] text-aegis-text-muted">
            <span>{t('privacyLock.settings.idleDelay')}</span>
            <select disabled={!snapshot.enabled || saving || !snapshot.idleDetectionSupported} value={snapshot.settings.autoLockSeconds} onChange={(event) => void save({ ...snapshot.settings, autoLockSeconds: Number(event.target.value) })} className="h-9 rounded-lg border border-aegis-border bg-aegis-surface px-3 text-aegis-text disabled:opacity-50">
              {AUTO_LOCK_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{t(`privacyLock.settings.delays.${seconds}`)}</option>)}
            </select>
          </label>
          {!snapshot.idleDetectionSupported && <p className="text-[11px] text-aegis-warning">{t('privacyLock.settings.idleUnavailable')}</p>}
          <div className="flex items-center justify-between gap-4"><span className="text-[12px] text-aegis-text-muted">{t('privacyLock.settings.lockOnResume')}</span><SettingsSwitch checked={snapshot.settings.lockOnResume} disabled label={t('privacyLock.settings.lockOnResume')} onCheckedChange={() => undefined} /></div>
          <div className="flex items-center justify-between gap-4"><span className="text-[12px] text-aegis-text-muted">{t('privacyLock.settings.lockOnStartup')}</span><SettingsSwitch checked={snapshot.settings.lockOnStartup} disabled label={t('privacyLock.settings.lockOnStartup')} onCheckedChange={() => undefined} /></div>
          <p className="text-[11px] leading-relaxed text-aegis-text-dim">{t('privacyLock.settings.mandatoryFence')}</p>
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-aegis-text"><KeyRound size={16} className="text-aegis-primary" />{t('privacyLock.settings.shortcut')}</h3>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-4"><span className="text-[12px] text-aegis-text-muted">{t('privacyLock.settings.enableShortcut')}</span><SettingsSwitch checked={snapshot.settings.globalShortcutEnabled} disabled={!snapshot.enabled || saving} label={t('privacyLock.settings.enableShortcut')} onCheckedChange={(value) => void save({ ...snapshot.settings, globalShortcutEnabled: value })} /></div>
          <label className="block text-[12px] text-aegis-text-muted">{t('privacyLock.settings.shortcutValue')}<input disabled={!snapshot.enabled || !snapshot.settings.globalShortcutEnabled || saving} value={snapshot.settings.globalShortcut} onChange={(event) => setSnapshot({ ...snapshot, settings: { ...snapshot.settings, globalShortcut: event.target.value } })} onBlur={() => void save(snapshot.settings)} className="mt-1.5 h-9 w-full rounded-lg border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] px-3 font-mono text-[12px] text-aegis-text outline-none focus:border-aegis-primary/60 disabled:opacity-50" /></label>
          {snapshot.shortcutError && <p role="alert" className="text-[11px] text-aegis-danger">{t('privacyLock.errors.shortcutConflict')}</p>}
        </div>
      </GlassCard>

      <GlassCard>
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-aegis-text"><ShieldCheck size={16} className="text-aegis-primary" />{t('privacyLock.settings.systemAuthentication')}</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-aegis-text-muted">{t(`privacyLock.systemStatus.${snapshot.systemAuthentication}`)}</p>
      </GlassCard>
      {error && <p role="alert" className="text-[12px] text-aegis-danger">{t(error)}</p>}
      <SecretDialog action={action} onClose={() => setAction(null)} />
    </>
  );
}
