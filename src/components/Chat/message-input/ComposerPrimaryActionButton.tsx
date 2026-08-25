import { CornerUpRight, ListPlus, Send, Square } from 'lucide-react';
import clsx from 'clsx';
import type { ComposerPrimaryAction } from './composerPrimaryAction';

interface ComposerPrimaryActionButtonProps {
  action: ComposerPrimaryAction;
  canSend: boolean;
  dir: 'ltr' | 'rtl';
  label: string;
  onSend: () => void;
  onStop: () => void;
}

/** 固定主操作位只渲染当前动作，避免发送、转向和停止同时竞争。 */
export function ComposerPrimaryActionButton({
  action,
  canSend,
  dir,
  label,
  onSend,
  onStop,
}: ComposerPrimaryActionButtonProps) {
  return (
    <button
      type="button"
      onClick={action.kind === 'stop' ? onStop : onSend}
      disabled={action.disabled}
      className={clsx(
        'relative grid size-[34px] shrink-0 place-items-center rounded-lg transition-[background-color,color,box-shadow,transform] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60',
        action.kind === 'stop'
          ? 'bg-aegis-danger/80 text-[rgb(var(--aegis-btn-primary-text))] hover:bg-aegis-danger active:scale-[0.98] focus-visible:ring-aegis-danger/60'
          : canSend
            ? 'bg-aegis-primary text-[rgb(var(--aegis-btn-primary-text))] hover:bg-aegis-primary-hover active:scale-[0.98]'
            : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
      )}
      title={label}
      aria-label={label}
      data-composer-primary-action={action.label}
    >
      {action.kind === 'stop' ? (
        <Square size={12} fill="currentColor" />
      ) : action.label === 'steer' ? (
        <CornerUpRight size={16} className={dir === 'rtl' ? '-rotate-90' : ''} />
      ) : action.label === 'queue' ? (
        <ListPlus size={16} />
      ) : (
        <Send size={16} className={dir === 'rtl' ? 'rotate-180' : ''} />
      )}
    </button>
  );
}
