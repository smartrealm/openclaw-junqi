import { UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChatIconButton } from './ChatIconButton';

interface MessageCollaborationActionButtonProps {
  state: 'confirming' | 'ready' | 'active';
  onClick?: () => void;
}

export function MessageCollaborationActionButton({
  state,
  onClick,
}: MessageCollaborationActionButtonProps) {
  const { t } = useTranslation();
  if (state === 'confirming' || !onClick) return null;

  const label = state === 'active'
    ? t('collaboration.chat.viewRun')
    : t('collaboration.chat.startRun');

  return (
    <ChatIconButton
      type="button"
      data-message-collaboration-action
      label={label}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded text-aegis-text-muted transition-all duration-150 hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aegis-primary [@media(pointer:coarse)]:size-10"
    >
      <UsersRound size={14} aria-hidden="true" />
    </ChatIconButton>
  );
}
