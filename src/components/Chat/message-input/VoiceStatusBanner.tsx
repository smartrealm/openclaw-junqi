import { Mic, Radio, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface VoiceStatusBannerProps {
  enabled: boolean;
  error: string | null;
  status: string;
  onStop: () => void;
  onRetry: () => void;
  onDismissError: () => void;
}

export function VoiceStatusBanner({
  enabled,
  error,
  status,
  onStop,
  onRetry,
  onDismissError,
}: VoiceStatusBannerProps) {
  const { t } = useTranslation();

  if (enabled) {
    return (
      <div className="mx-3 mt-2 flex min-h-9 items-center gap-2 border-s-2 border-aegis-primary/70 bg-aegis-primary/[0.055] px-3 py-1.5 text-[11px] text-aegis-text-secondary" role="status">
        <Radio size={13} className="shrink-0 animate-pulse text-aegis-primary" />
        <span className="min-w-0 flex-1 truncate font-medium">{status}</span>
        <button
          type="button"
          onClick={onStop}
          className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/[0.1] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
        >
          {t('input.stopDictation')}
        </button>
      </div>
    );
  }

  if (!error) return null;

  return (
    <div className="mx-3 mt-2 flex min-h-9 items-center gap-2 border-s-2 border-aegis-danger/70 bg-aegis-danger/[0.055] px-3 py-1.5 text-[11px] text-aegis-text-secondary" role="alert">
      <Mic size={13} className="shrink-0 text-aegis-danger" />
      <span className="min-w-0 flex-1 truncate" title={error}>{t('input.voiceInputFailed')}：{error}</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/[0.1] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
      >
        {t('input.retryVoiceInput')}
      </button>
      <button
        type="button"
        onClick={onDismissError}
        className="grid size-6 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
        title={t('input.dismissVoiceInputError')}
        aria-label={t('input.dismissVoiceInputError')}
      >
        <X size={12} />
      </button>
    </div>
  );
}
