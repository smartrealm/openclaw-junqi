import { Check, Copy, Ellipsis, GitFork, PanelRightOpen, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChatIconButton } from './ChatIconButton';
import { resolveMessageBubbleActionLayout } from './messageBubbleActionLayout';

interface MessageBubbleActionsProps {
  copied: boolean;
  previewable: boolean;
  onCopy: () => void;
  onPreview: () => void;
  onEditAndResend?: () => void;
  onFork?: () => void;
  messageCutDisabled?: boolean;
  messageCutDisabledReason?: string;
}

export function MessageBubbleActions({
  copied,
  previewable,
  onCopy,
  onPreview,
  onEditAndResend,
  onFork,
  messageCutDisabled = false,
  messageCutDisabledReason,
}: MessageBubbleActionsProps) {
  const { t } = useTranslation();
  const layout = resolveMessageBubbleActionLayout({
    canEditAndResend: Boolean(onEditAndResend),
    canFork: Boolean(onFork),
    previewable,
  });
  const buttonClass = [
    'grid size-7 place-items-center rounded-md text-aegis-text-muted transition-colors',
    '[@media(pointer:coarse)]:size-11',
    'hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary',
  ].join(' ');
  const editAndResendText = t('chat.messageCut.editAndResend');
  const moreActionsText = t('chat.messageCut.moreActions');
  const editAndResendLabel = messageCutDisabledReason
    ? t('chat.messageCut.disabledAction', {
      action: editAndResendText,
      reason: messageCutDisabledReason,
    })
    : editAndResendText;
  const moreActionsLabel = messageCutDisabledReason
    ? t('chat.messageCut.disabledAction', {
      action: moreActionsText,
      reason: messageCutDisabledReason,
    })
    : moreActionsText;

  return (
    <div className="flex shrink-0 items-center gap-0.5" data-message-actions>
      {layout.primary === 'editAndResend' && onEditAndResend && (
        <button
          type="button"
          onClick={onEditAndResend}
          disabled={messageCutDisabled}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-aegis-text-secondary [@media(pointer:coarse)]:h-11"
          aria-label={editAndResendLabel}
          title={editAndResendLabel}
          data-message-edit-resend-action
        >
          <Pencil size={14} aria-hidden="true" />
          <span>{editAndResendText}</span>
        </button>
      )}
      {layout.direct.includes('preview') && (
        <ChatIconButton
          type="button"
          onClick={onPreview}
          className={buttonClass}
          label={t('chat.openInCanvas')}
        >
          <PanelRightOpen size={14} />
        </ChatIconButton>
      )}
      {layout.direct.includes('copy') && (
        <ChatIconButton
          type="button"
          onClick={onCopy}
          className={buttonClass}
          label={copied ? t('chat.copied') : t('chat.copy')}
        >
          {copied ? <Check size={14} className="text-aegis-success" /> : <Copy size={14} />}
        </ChatIconButton>
      )}
      {layout.overflow.includes('fork') && onFork && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ChatIconButton
              type="button"
              disabled={messageCutDisabled}
              className={buttonClass}
              label={moreActionsLabel}
            >
              <Ellipsis size={14} />
            </ChatIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-48 border-aegis-menu-border bg-aegis-menu-bg p-1.5 text-aegis-text"
          >
            <DropdownMenuItem
              onSelect={onFork}
              className="h-8 justify-start text-[12px] text-aegis-text-secondary focus:bg-aegis-hover/40 focus:text-aegis-text"
            >
              <GitFork size={14} aria-hidden="true" />
              <span>{t('chat.messageCut.fork')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
