// 快捷回复只投影现有消息中的按钮标记，点击后仍由上层发送真实用户消息。

import { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { ParsedButton } from '@/utils/buttonParser';

interface QuickReplyBarProps {
  buttons: ParsedButton[];
  onSend: (text: string) => void;
  onDismiss: () => void;
}

export function QuickReplyBar({ buttons, onSend, onDismiss }: QuickReplyBarProps) {
  const { t } = useTranslation();
  const [clicked, setClicked] = useState<string | null>(null);

  const handleClick = useCallback((btn: ParsedButton) => {
    if (clicked) return;
    setClicked(btn.value);
    onSend(btn.value);
  }, [clicked, onSend]);

  if (!buttons.length) return null;

  return (
    <div className="mx-4 mb-2 motion-safe:animate-fade-in">
      <div className={clsx(
        'relative rounded-lg border px-3 py-2.5',
        'bg-aegis-surface border-aegis-border shadow-sm',
      )}>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('chat.dismissQuickReplies')}
          className={clsx(
            'absolute top-2 end-2 rounded-md p-1 transition-colors',
            'text-aegis-text-dim hover:text-aegis-text-secondary',
            'hover:bg-aegis-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50'
          )}
        >
          <X size={14} />
        </button>

        <div className="flex flex-wrap gap-2 pe-6">
          {buttons.map((btn, idx) => {
            const isSelected = clicked === btn.value;
            const isDisabled = clicked !== null;

            return (
              <button
                key={idx}
                onClick={() => handleClick(btn)}
                disabled={isDisabled}
                aria-pressed={isSelected}
                className={clsx(
                  'rounded-md border px-3 py-1.5 text-[13px] font-medium transition-[background-color,border-color,color,transform,opacity] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] motion-reduce:transition-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50',
                  isSelected
                    ? 'bg-aegis-primary/10 border-aegis-primary/35 text-aegis-primary'
                    : isDisabled
                      ? 'cursor-not-allowed border-aegis-border bg-aegis-surface text-aegis-text-dim opacity-45'
                      : clsx(
                        'bg-aegis-elevated border-aegis-border',
                        'text-aegis-text-secondary',
                        'hover:bg-aegis-primary/10 hover:border-aegis-primary/30 hover:text-aegis-primary',
                        'active:bg-aegis-primary/15'
                      )
                )}
              >
                {btn.text}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
