import { Check, Copy, GitFork, PanelRightOpen, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChatIconButton } from './ChatIconButton';

interface MessageBubbleActionsProps {
  copied: boolean;
  previewable: boolean;
  onCopy: () => void;
  onPreview: () => void;
  transcriptActions?: {
    fork?: () => void;
    rewind?: () => void;
  };
}

export function MessageBubbleActions({
  copied,
  previewable,
  onCopy,
  onPreview,
  transcriptActions,
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
      {transcriptActions?.fork && (
        <ChatIconButton
          type="button"
          onClick={transcriptActions.fork}
          className={buttonClass}
          label={t('chat.sessionTranscript.forkAtMessage')}
        >
          <GitFork size={14} />
        </ChatIconButton>
      )}
      {transcriptActions?.rewind && (
        <ChatIconButton
          type="button"
          onClick={transcriptActions.rewind}
          className={buttonClass}
          label={t('chat.sessionTranscript.rewindToMessage')}
        >
          <RotateCcw size={14} />
        </ChatIconButton>
      )}
      {previewable && (
        <ChatIconButton
          type="button"
          onClick={onPreview}
          className={buttonClass}
          label={t('chat.openInCanvas')}
        >
          <PanelRightOpen size={14} />
        </ChatIconButton>
      )}
      <ChatIconButton
        type="button"
        onClick={onCopy}
        className={buttonClass}
        label={copied ? t('chat.copied') : t('chat.copy')}
      >
        {copied ? <Check size={14} className="text-aegis-success" /> : <Copy size={14} />}
      </ChatIconButton>
    </div>
  );
}
