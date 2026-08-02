import { AudioLines, FolderOpen, Mic, Radio, RefreshCw, Send, Square, Trash2, TriangleAlert } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { VoiceWakeDetectorStatus } from '@/api/tauri-commands';
import type { VoiceModeSnapshot } from '@/services/voice/VoiceModeCoordinator';

interface VoiceWorkspaceProps {
  snapshot: VoiceModeSnapshot;
  connected: boolean;
  onStartDictation: () => void;
  onRequestWakeWord: () => void;
  onStop: () => void;
  onConfirmDraft: () => void;
  onDiscardDraft: () => void;
  autoArmEnabled: boolean;
  detector: VoiceWakeDetectorStatus | null;
  detectorError: string | null;
  configuringDetector: boolean;
  syncingWakeTriggers: boolean;
  launchOnLogin: boolean;
  onConfigureDetector: () => void;
  onSyncWakeTriggers: () => void;
  onToggleLaunchOnLogin: () => void;
}

function phaseCopy(snapshot: VoiceModeSnapshot, t: TFunction): string {
  if (snapshot.error === 'wake_detector_unavailable') {
    return t('input.voiceWakeUnavailable');
  }
  if (snapshot.error === 'wake_trigger_model_mismatch') {
    return t('input.voiceWakeTriggerModelMismatch');
  }
  if (snapshot.error === 'gateway_unavailable') {
    return t('input.voiceGatewayUnavailable');
  }
  if (snapshot.error === 'target_changed') {
    return t('input.voiceTargetChanged');
  }
  if (snapshot.error === 'capture_failed') {
    return t('input.voiceCaptureFailed');
  }

  switch (snapshot.phase) {
    case 'listening':
      return t('input.voiceWorkspaceListening');
    case 'triggered':
      return t('input.voiceWorkspaceTriggered');
    case 'transcribing':
      return t('input.voiceWorkspaceTranscribing');
    case 'ready_to_send':
      return t('input.voiceWorkspaceDraftReady');
    case 'unavailable':
      return t('input.voiceWorkspaceUnavailable');
    default:
      return t('input.voiceWorkspacePreparing');
  }
}

export function VoiceWorkspace({
  snapshot,
  connected,
  onStartDictation,
  onRequestWakeWord,
  onStop,
  onConfirmDraft,
  onDiscardDraft,
  autoArmEnabled,
  detector,
  detectorError,
  configuringDetector,
  syncingWakeTriggers,
  launchOnLogin,
  onConfigureDetector,
  onSyncWakeTriggers,
  onToggleLaunchOnLogin,
}: VoiceWorkspaceProps) {
  const { t } = useTranslation();
  const visible = snapshot.mode !== 'off' || snapshot.phase === 'error' || snapshot.draft !== null;

  if (!visible) return null;

  const active = snapshot.phase === 'listening'
    || snapshot.phase === 'triggered'
    || snapshot.phase === 'transcribing';
  const confirmable = snapshot.phase === 'ready_to_send' && snapshot.error === null && snapshot.draft !== null;
  const modeSwitchBlocked = snapshot.draft !== null;
  const draftCopy = snapshot.draft?.kind === 'transcript'
    ? snapshot.draft.text
    : snapshot.draft
      ? t('input.voiceAudioDraft')
      : null;

  return (
    <section
      className="border-b border-[rgb(var(--aegis-overlay)/0.06)] px-3 py-3"
      aria-label={t('input.voiceWorkspaceTitle')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex h-8 shrink-0 items-center border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)] p-0.5">
          <button
            type="button"
            onClick={onStop}
            className={clsx(
              'h-7 min-w-[48px] px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60',
              snapshot.mode === 'off' ? 'bg-aegis-surface text-aegis-text' : 'text-aegis-text-muted hover:text-aegis-text',
            )}
            aria-pressed={snapshot.mode === 'off'}
          >
            {t('input.voiceModeOff')}
          </button>
          <button
            type="button"
            onClick={onStartDictation}
            disabled={!connected || modeSwitchBlocked}
            className={clsx(
              'h-7 min-w-[74px] px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-40',
              snapshot.mode === 'dictation' ? 'bg-aegis-primary/14 text-aegis-primary' : 'text-aegis-text-muted hover:text-aegis-text',
            )}
            aria-pressed={snapshot.mode === 'dictation'}
          >
            {t('input.voiceModeDictation')}
          </button>
          <button
            type="button"
            onClick={onRequestWakeWord}
            disabled={!connected || modeSwitchBlocked}
            className={clsx(
              'h-7 min-w-[54px] px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-40',
              snapshot.mode === 'wake_word' ? 'bg-aegis-primary/14 text-aegis-primary' : 'text-aegis-text-muted hover:text-aegis-text',
            )}
            aria-pressed={snapshot.mode === 'wake_word'}
          >
            {t('input.voiceModeWake')}
          </button>
        </div>
        <p className="min-w-0 flex-1 text-end text-[11px] text-aegis-text-muted" role="status" aria-live="polite">
          {phaseCopy(snapshot, t)}
        </p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[112px_minmax(0,1fr)_auto] sm:items-center">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'grid size-[72px] shrink-0 place-items-center border border-aegis-primary/30 bg-aegis-primary/[0.035] text-aegis-primary',
              active && 'animate-pulse motion-reduce:animate-none',
              snapshot.phase === 'error' && 'border-aegis-danger/40 bg-aegis-danger/[0.04] text-aegis-danger',
            )}
            aria-hidden="true"
          >
            {snapshot.phase === 'error' || snapshot.phase === 'unavailable'
              ? <TriangleAlert size={22} />
              : snapshot.mode === 'wake_word' ? <Radio size={22} /> : <AudioLines size={22} />}
          </div>
          <div className="min-w-0 sm:hidden">
            <p className="text-[12px] font-medium text-aegis-text">{phaseCopy(snapshot, t)}</p>
            <p className="mt-0.5 text-[11px] text-aegis-text-muted">{t('input.voiceWorkspaceLocalOnly')}</p>
          </div>
        </div>

        <div className="min-w-0">
          <p className="hidden text-[12px] font-medium text-aegis-text sm:block">{phaseCopy(snapshot, t)}</p>
          <p className="mt-0.5 text-[11px] text-aegis-text-muted">{t('input.voiceWorkspaceLocalOnly')}</p>
          {(snapshot.error === 'wake_detector_unavailable' || snapshot.error === 'wake_trigger_model_mismatch') && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onConfigureDetector}
                disabled={configuringDetector}
                className="inline-flex h-7 items-center gap-1.5 border border-aegis-primary/35 px-2 text-[11px] font-medium text-aegis-primary transition-colors hover:bg-aegis-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-40"
              >
                <FolderOpen size={13} />
                {configuringDetector ? t('input.voiceWakeCheckingModel') : t('input.voiceWakeConfigureModel')}
              </button>
              <span className="text-[10px] text-aegis-text-muted">
                {detector?.available ? t('input.voiceWakeModelReady') : t('input.voiceWakeModelRequired')}
              </span>
              {snapshot.error === 'wake_trigger_model_mismatch' && (
                <button
                  type="button"
                  onClick={onSyncWakeTriggers}
                  disabled={!detector?.available || syncingWakeTriggers}
                  className="inline-flex h-7 items-center gap-1.5 border border-aegis-primary/35 px-2 text-[11px] font-medium text-aegis-primary transition-colors hover:bg-aegis-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-40"
                >
                  <RefreshCw size={13} className={clsx(syncingWakeTriggers && 'animate-spin motion-reduce:animate-none')} />
                  {t('input.voiceWakeSyncTriggers')}
                </button>
              )}
              {detectorError && <span className="text-[10px] text-aegis-danger">{detectorError}</span>}
            </div>
          )}
          {snapshot.mode === 'wake_word' && (
            <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-aegis-text-muted">
              <input
                type="checkbox"
                checked={launchOnLogin && autoArmEnabled}
                onChange={onToggleLaunchOnLogin}
                className="size-3.5 accent-[rgb(var(--aegis-primary))]"
              />
              {t('input.voiceWakeLaunchOnLogin')}
            </label>
          )}
          {draftCopy && (
            <p className="mt-2 max-h-14 overflow-y-auto whitespace-pre-wrap border-s-2 border-aegis-primary/50 ps-2 text-[12px] leading-5 text-aegis-text-secondary">
              {draftCopy}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:justify-end">
          {confirmable && (
            <button
              type="button"
              onClick={onConfirmDraft}
              className="grid size-8 place-items-center bg-aegis-primary text-white transition-colors hover:bg-aegis-primary/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
              title={t('input.voiceConfirmDraft')}
              aria-label={t('input.voiceConfirmDraft')}
            >
              <Send size={15} />
            </button>
          )}
          {snapshot.draft && (
            <button
              type="button"
              onClick={onDiscardDraft}
              className="grid size-8 place-items-center text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
              title={t('input.voiceDiscardDraft')}
              aria-label={t('input.voiceDiscardDraft')}
            >
              <Trash2 size={15} />
            </button>
          )}
          {snapshot.mode !== 'off' && (
            <button
              type="button"
              onClick={onStop}
              className="grid size-8 place-items-center text-aegis-text-muted transition-colors hover:bg-aegis-danger/15 hover:text-aegis-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
              title={t('input.voiceWorkspaceStop')}
              aria-label={t('input.voiceWorkspaceStop')}
            >
              <Square size={13} fill="currentColor" />
            </button>
          )}
          {snapshot.mode === 'off' && !snapshot.draft && (
            <Mic size={16} className="text-aegis-text-muted" aria-hidden="true" />
          )}
        </div>
      </div>
    </section>
  );
}
