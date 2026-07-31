import { Check, Copy, PanelRightOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  const buttonClass = [
    'grid size-7 place-items-center rounded-md text-aegis-text-muted transition-colors',
    '[@media(pointer:coarse)]:size-11',
    'hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary',
  ].join(' ');

  return (
    <div className="flex shrink-0 items-center gap-0.5" data-message-actions>
      {previewable && (
        <button
          type="button"
          onClick={onPreview}
          className={buttonClass}
          title={t('chat.openInCanvas')}
          aria-label={t('chat.openInCanvas')}
        >
          <PanelRightOpen size={14} />
        </button>
      )}
      <button
        type="button"
        onClick={onCopy}
        className={buttonClass}
        title={copied ? t('chat.copied') : t('chat.copy')}
        aria-label={copied ? t('chat.copied') : t('chat.copy')}
      >
        {copied ? <Check size={14} className="text-aegis-success" /> : <Copy size={14} />}
      </button>
    </div>
  );
}
