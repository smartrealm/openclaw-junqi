import { useEffect, useState } from 'react';
import { Check, FolderOpen, Radio, RefreshCw, SlidersHorizontal, Square, Trash2, TriangleAlert, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { VoiceWakeDetectorStatus } from '@/api/tauri-commands';
import type { VoiceModeSnapshot } from '@/services/voice/VoiceModeCoordinator';
import type { TalkConversationPhase } from '@/services/voice/TalkConversationCoordinator';

interface VoiceWakeOverlayProps {
  snapshot: VoiceModeSnapshot;
  talkPhase: TalkConversationPhase;
  detector: VoiceWakeDetectorStatus | null;
  detectorError: string | null;
  configuringDetector: boolean;
  syncingWakeTriggers: boolean;
  modelWakeKeywords: string[];
  selectedWakeKeywords: string[];
  onStop: () => void;
  onConfigureDetector: () => void;
  onSyncWakeTriggers: () => void;
  onSaveWakeTriggers: (keywords: string[]) => Promise<boolean>;
  onConfirmDraft: () => void;
  onDiscardDraft: () => void;
}

export function shouldShowVoiceWakeOverlay(snapshot: VoiceModeSnapshot): boolean {
  return snapshot.mode === 'wake_word' && snapshot.phase !== 'off';
}

function phaseCopy(snapshot: VoiceModeSnapshot, talkPhase: TalkConversationPhase, t: TFunction): string {
  if (talkPhase === 'speaking') return t('input.voiceWorkspaceSpeaking');
  if (talkPhase === 'connecting') return t('input.voiceWorkspaceThinking');
  if (snapshot.error === 'wake_detector_unavailable') return t('input.voiceWakeUnavailable');
  if (snapshot.error === 'wake_trigger_model_mismatch') return t('input.voiceWakeTriggerModelMismatch');
  if (snapshot.error === 'session_category_unavailable') return t('input.voiceSessionCategoryUnavailable');
  if (snapshot.error === 'gateway_unavailable') return t('input.voiceGatewayUnavailable');
  if (snapshot.error === 'target_changed') return t('input.voiceTargetChanged');
  if (snapshot.error === 'capture_failed') return t('input.voiceCaptureFailed');

  switch (snapshot.phase) {
    case 'listening': return t('input.voiceWorkspaceListening');
    case 'triggered': return t('input.voiceWorkspaceTriggered');
    case 'transcribing': return t('input.voiceWorkspaceTranscribing');
    case 'ready_to_send': return t('input.voiceWorkspaceDraftReady');
    case 'unavailable': return t('input.voiceWorkspaceUnavailable');
    default: return t('input.voiceWorkspacePreparing');
  }
}

export function VoiceWakeOverlay({
  snapshot,
  talkPhase,
  detector,
  detectorError,
  configuringDetector,
  syncingWakeTriggers,
  modelWakeKeywords,
  selectedWakeKeywords,
  onStop,
  onConfigureDetector,
  onSyncWakeTriggers,
  onSaveWakeTriggers,
  onConfirmDraft,
  onDiscardDraft,
}: VoiceWakeOverlayProps) {
  const { t } = useTranslation();
  const [editingPhrases, setEditingPhrases] = useState(false);
  const [draftPhrases, setDraftPhrases] = useState<string[]>([]);
  const visible = shouldShowVoiceWakeOverlay(snapshot);

  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onStop();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onStop, visible]);

  if (!visible) return null;

  const active = snapshot.phase === 'listening'
    || snapshot.phase === 'triggered'
    || snapshot.phase === 'transcribing';
  const draftCopy = snapshot.draft?.kind === 'transcript'
    ? snapshot.draft.text
    : snapshot.draft ? t('input.voiceAudioDraft') : null;
  const ready = snapshot.phase === 'ready_to_send' && snapshot.draft !== null && snapshot.error === null;
  const unavailable = snapshot.error === 'wake_detector_unavailable'
    || snapshot.error === 'wake_trigger_model_mismatch';
  const failed = snapshot.phase === 'error' || unavailable;
  const canEditPhrases = detector?.available === true
    && snapshot.phase !== 'triggered'
    && snapshot.phase !== 'transcribing'
    && snapshot.phase !== 'ready_to_send';
  const openPhraseEditor = () => {
    setDraftPhrases(selectedWakeKeywords);
    setEditingPhrases(true);
  };
  const togglePhrase = (keyword: string) => {
    setDraftPhrases((current) => current.includes(keyword)
      ? current.filter((candidate) => candidate !== keyword)
      : [...current, keyword]);
  };
  const savePhrases = async () => {
    if (await onSaveWakeTriggers(draftPhrases)) setEditingPhrases(false);
  };

  return (
    <section
      className="fixed inset-0 z-[2147480800] isolate flex min-h-[100dvh] flex-col bg-aegis-bg-solid/95 px-5 py-5 text-aegis-text backdrop-blur-xl sm:px-10 sm:py-8"
      role="dialog"
      aria-modal="true"
      aria-label={t('input.voiceWorkspaceTitle')}
    >
      <div className="flex items-center justify-between border-b border-[rgb(var(--aegis-overlay)/0.09)] pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Radio size={16} className={clsx('shrink-0 text-aegis-primary', active && 'animate-pulse motion-reduce:animate-none')} />
          <span className="truncate text-[12px] font-semibold text-aegis-text">{t('input.voiceModeWake')}</span>
          <span className="hidden border-s border-[rgb(var(--aegis-overlay)/0.11)] ps-3 text-[11px] text-aegis-text-muted sm:inline">
            {t('input.voiceWorkspaceLocalOnly')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canEditPhrases && (
            <button
              type="button"
              onClick={openPhraseEditor}
              className="grid size-9 place-items-center border border-[rgb(var(--aegis-overlay)/0.12)] text-aegis-text-muted transition-colors hover:border-aegis-primary/50 hover:bg-aegis-primary/[0.08] hover:text-aegis-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
              title={t('input.voiceWakePhrases')}
              aria-label={t('input.voiceWakePhrases')}
            >
              <SlidersHorizontal size={17} />
            </button>
          )}
          <button
            type="button"
            onClick={onStop}
            className="grid size-9 place-items-center border border-[rgb(var(--aegis-overlay)/0.12)] text-aegis-text-muted transition-colors hover:border-aegis-danger/50 hover:bg-aegis-danger/[0.08] hover:text-aegis-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
            title={t('input.voiceWorkspaceStop')}
            aria-label={t('input.voiceWorkspaceStop')}
          >
            <X size={17} />
          </button>
        </div>
      </div>

      <div className="grid flex-1 place-items-center py-8">
        <div className="w-full max-w-2xl text-center">
          <div
            className={clsx(
              'mx-auto grid size-36 place-items-center border border-aegis-primary/45 bg-aegis-primary/[0.055] text-aegis-primary shadow-[inset_0_0_0_8px_rgb(var(--aegis-primary)/0.025)] sm:size-44',
              active && 'animate-pulse motion-reduce:animate-none',
              failed && 'border-aegis-danger/50 bg-aegis-danger/[0.06] text-aegis-danger',
            )}
            aria-hidden="true"
          >
            {failed ? <TriangleAlert size={42} /> : <Radio size={48} />}
          </div>

          <h2 className="mt-8 text-2xl font-semibold text-aegis-text sm:text-3xl">
            {phaseCopy(snapshot, talkPhase, t)}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[13px] leading-6 text-aegis-text-muted">
            {ready ? t('input.voiceWorkspaceLocalOnly') : t('input.voiceWorkspacePreparing')}
          </p>

          {editingPhrases && (
            <section className="mx-auto mt-7 max-w-xl border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.025)] p-4 text-start" aria-label={t('input.voiceWakePhrases')}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[12px] font-semibold text-aegis-text">{t('input.voiceWakePhrases')}</h3>
                <button
                  type="button"
                  onClick={() => setEditingPhrases(false)}
                  className="grid size-7 place-items-center text-aegis-text-muted transition-colors hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                  title={t('common.cancel')}
                  aria-label={t('common.cancel')}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {modelWakeKeywords.map((keyword) => (
                  <label key={keyword} className="flex min-w-0 items-center gap-2 border border-[rgb(var(--aegis-overlay)/0.1)] px-3 py-2 text-[12px] text-aegis-text-secondary">
                    <input
                      type="checkbox"
                      checked={draftPhrases.includes(keyword)}
                      onChange={() => togglePhrase(keyword)}
                      className="size-3.5 shrink-0 accent-[rgb(var(--aegis-primary))]"
                    />
                    <span className="truncate">{keyword}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingPhrases(false)}
                  className="h-9 border border-[rgb(var(--aegis-overlay)/0.14)] px-3 text-[12px] font-semibold text-aegis-text-secondary transition-colors hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => { void savePhrases(); }}
                  disabled={draftPhrases.length === 0 || syncingWakeTriggers}
                  className="inline-flex h-9 items-center gap-2 bg-aegis-primary px-3 text-[12px] font-semibold text-white transition-colors hover:bg-aegis-primary/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-40"
                >
                  <Check size={15} />
                  {t('input.voiceWakeSavePhrases')}
                </button>
              </div>
            </section>
          )}

          {unavailable && (
            <div className="mx-auto mt-7 max-w-md border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.025)] p-4 text-start">
              <button
                type="button"
                onClick={onConfigureDetector}
                disabled={configuringDetector}
                className="inline-flex h-9 items-center gap-2 border border-aegis-primary/45 bg-aegis-primary/[0.08] px-3 text-[12px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/[0.14] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-40"
              >
                <FolderOpen size={15} />
                {configuringDetector ? t('input.voiceWakeCheckingModel') : t('input.voiceWakeConfigureModel')}
              </button>
              <p className="mt-3 text-[11px] leading-5 text-aegis-text-muted">
                {detector?.available ? t('input.voiceWakeModelReady') : t('input.voiceWakeModelRequired')}
              </p>
              {snapshot.error === 'wake_trigger_model_mismatch' && (
                <button
                  type="button"
                  onClick={onSyncWakeTriggers}
                  disabled={!detector?.available || syncingWakeTriggers}
                  className="mt-3 inline-flex h-9 items-center gap-2 border border-aegis-primary/45 bg-aegis-primary/[0.08] px-3 text-[12px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/[0.14] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60 disabled:opacity-40"
                >
                  <RefreshCw size={15} className={clsx(syncingWakeTriggers && 'animate-spin motion-reduce:animate-none')} />
                  {t('input.voiceWakeSyncTriggers')}
                </button>
              )}
              {detectorError && <p className="mt-2 text-[11px] leading-5 text-aegis-danger">{detectorError}</p>}
            </div>
          )}

          {draftCopy && (
            <div className="mx-auto mt-8 max-w-xl border-s-2 border-aegis-primary/70 bg-[rgb(var(--aegis-overlay)/0.025)] px-4 py-3 text-start text-[14px] leading-6 text-aegis-text-secondary">
              {draftCopy}
            </div>
          )}

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            {ready && (
              <button
                type="button"
                onClick={onConfirmDraft}
                className="inline-flex h-10 items-center gap-2 bg-aegis-primary px-4 text-[12px] font-semibold text-white transition-colors hover:bg-aegis-primary/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
              >
                <Check size={16} />
                {t('input.voiceConfirmDraft')}
              </button>
            )}
            {snapshot.draft && (
              <button
                type="button"
                onClick={onDiscardDraft}
                className="inline-flex h-10 items-center gap-2 border border-[rgb(var(--aegis-overlay)/0.14)] px-4 text-[12px] font-semibold text-aegis-text-secondary transition-colors hover:border-aegis-danger/45 hover:text-aegis-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
              >
                <Trash2 size={16} />
                {t('input.voiceDiscardDraft')}
              </button>
            )}
            {!ready && !snapshot.draft && (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex h-10 items-center gap-2 border border-[rgb(var(--aegis-overlay)/0.14)] px-4 text-[12px] font-semibold text-aegis-text-secondary transition-colors hover:border-aegis-danger/45 hover:text-aegis-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
              >
                <Square size={14} fill="currentColor" />
                {t('input.voiceWorkspaceStop')}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
