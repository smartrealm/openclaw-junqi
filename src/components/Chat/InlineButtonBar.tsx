// 内联按钮严格投影 Gateway 提供的 callback_data；本组件不增加本地决策语义。

import { useState, useCallback } from 'react';
import clsx from 'clsx';

interface InlineButton {
  text: string;
  callback_data: string;
  style?: 'primary' | 'success' | 'danger';
}

interface InlineButtonBarProps {
  buttons: InlineButton[][];        // Array of rows
  onCallback: (data: string) => void; // Send callback_data as user message
}

const STYLE_CLASSES: Record<string, string> = {
  primary: 'bg-aegis-accent/12 border-aegis-accent/25 text-aegis-accent hover:bg-aegis-accent/20 hover:border-aegis-accent/40',
  success: 'bg-aegis-success/12 border-aegis-success/25 text-aegis-success hover:bg-aegis-success/20 hover:border-aegis-success/40',
  danger:  'bg-aegis-danger/12 border-aegis-danger/25 text-aegis-danger hover:bg-aegis-danger/20 hover:border-aegis-danger/40',
  default: 'bg-[rgb(var(--aegis-overlay)/0.05)] border-[rgb(var(--aegis-overlay)/0.10)] text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.10)] hover:border-[rgb(var(--aegis-overlay)/0.18)]',
};

export function InlineButtonBar({ buttons, onCallback }: InlineButtonBarProps) {
  const [clicked, setClicked] = useState<string | null>(null);

  const handleClick = useCallback((callbackData: string) => {
    if (clicked) return;
    setClicked(callbackData);
    onCallback(callbackData);
  }, [clicked, onCallback]);

  if (!buttons || buttons.length === 0) return null;

  return (
    <div className="px-5 py-1 motion-safe:animate-fade-in">
      <div className="space-y-1.5 max-w-[85%]">
        {buttons.map((row, rowIdx) => (
          <div key={rowIdx} className="flex flex-wrap gap-1.5">
            {row.map((btn, btnIdx) => {
              const isSelected = clicked === btn.callback_data;
              const isDisabled = clicked !== null;
              const styleKey = btn.style || 'default';

              return (
                <button
                  key={`${rowIdx}-${btnIdx}`}
                onClick={() => handleClick(btn.callback_data)}
                disabled={isDisabled}
                aria-pressed={isSelected}
                className={clsx(
                  'rounded-md border px-3 py-1.5 text-[12px] font-medium transition-[background-color,border-color,color,transform,opacity] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] motion-reduce:transition-none',
                  'active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50',
                    isSelected
                      ? 'bg-aegis-accent/20 border-aegis-accent/40 text-aegis-accent ring-2 ring-aegis-accent/20'
                      : isDisabled
                        ? 'opacity-40 cursor-not-allowed ' + STYLE_CLASSES[styleKey]
                        : STYLE_CLASSES[styleKey]
                )}
              >
                {btn.text}
              </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
