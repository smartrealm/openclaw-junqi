import { Check, Copy, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

interface MessageBubbleActionsProps {
  copied: boolean;
  previewable: boolean;
  onCopy: () => void;
  onPreview: () => void;
}

export function MessageBubbleActions({
  copied,
  previewable,
  onCopy,
  onPreview,
}: MessageBubbleActionsProps) {
  const { t } = useTranslation();
  const buttonClass = clsx(
    'grid size-7 place-items-center rounded-md border border-aegis-border bg-[rgb(var(--aegis-bg)/0.92)] text-aegis-text-muted shadow-sm backdrop-blur-sm transition-all',
    'opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100',
    'hover:border-aegis-border-hover hover:bg-[rgb(var(--aegis-elevated))] hover:text-aegis-text',
  );

  return (
    <div className="absolute right-1 top-1 z-10 flex items-center gap-1">
      {previewable && (
        <button
          type="button"
          onClick={onPreview}
          className={buttonClass}
          title={t('resultCards.preview')}
          aria-label={t('resultCards.preview')}
        >
          <Eye size={14} />
        </button>
      )}
      <button
        type="button"
        onClick={onCopy}
        className={clsx(buttonClass, copied && 'opacity-100')}
        title={copied ? t('chat.copied') : t('chat.copy')}
        aria-label={copied ? t('chat.copied') : t('chat.copy')}
      >
        {copied ? <Check size={14} className="text-aegis-success" /> : <Copy size={14} />}
      </button>
    </div>
  );
}
