import { UsersRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';

interface MessageCollaborationActionButtonProps {
  state: 'confirming' | 'ready' | 'active';
  onClick?: () => void;
}

export function MessageCollaborationActionButton({
  state,
  onClick,
}: MessageCollaborationActionButtonProps) {
  const { t } = useTranslation();
  const label = state === 'active'
    ? t('collaboration.chat.viewRun')
    : state === 'ready'
      ? t('collaboration.chat.startRun')
      : t('collaboration.chat.confirmingMessage');
  const disabled = state === 'confirming' || !onClick;

  return (
    <button
      type="button"
      data-message-collaboration-action
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-aegis-primary/25 px-2 text-[10px] font-medium text-aegis-primary transition-colors hover:bg-aegis-primary/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aegis-primary disabled:cursor-wait disabled:opacity-45 disabled:hover:bg-transparent [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-3"
    >
      {state === 'confirming'
        ? <LoadingIndicator size={13} />
        : <UsersRound size={13} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  );
}
