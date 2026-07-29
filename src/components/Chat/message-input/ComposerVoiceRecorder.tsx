import { lazy, Suspense } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const VoiceRecorder = lazy(() => import('../VoiceRecorder').then((module) => ({ default: module.VoiceRecorder })));

interface ComposerVoiceRecorderProps {
  dir: 'ltr' | 'rtl';
  disabled: boolean;
  onSend: (base64: string, mimeType: string, durationSec: number, previewUrl: string) => void;
  onCancel: () => void;
}

export function ComposerVoiceRecorder({
  dir,
  disabled,
  onSend,
  onCancel,
}: ComposerVoiceRecorderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-end gap-2 p-3" dir={dir}>
      <div className="relative flex min-h-[52px] flex-1 items-center rounded-2xl border border-[rgb(var(--aegis-overlay)/0.06)] bg-aegis-surface px-3 py-2 transition-[border-color,box-shadow] duration-200 focus-within:border-aegis-primary/30 focus-within:shadow-[0_0_0_3px_rgb(var(--aegis-primary)/0.06),0_0_16px_rgb(var(--aegis-primary)/0.08)]">
        <Suspense
          fallback={
            <div className="flex w-full items-center gap-3" dir={dir}>
              <div className="h-10 flex-1 animate-pulse rounded bg-[rgb(var(--aegis-overlay)/0.04)]" />
              <span className="min-w-[40px] shrink-0 text-center font-mono text-[13px] text-aegis-text-muted" dir="ltr">0:00</span>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg p-2 text-aegis-danger transition-colors hover:bg-aegis-danger/20"
                title={t('voice.cancel')}
                aria-label={t('voice.cancel')}
              >
                <X size={18} />
              </button>
            </div>
          }
        >
          <VoiceRecorder onSendVoice={onSend} onCancel={onCancel} disabled={disabled} />
        </Suspense>
      </div>
    </div>
  );
}
