// ═══════════════════════════════════════════════════════════
// InlineButtonBar — Render Gateway inline buttons
//
// When the AI uses the `message` tool with `buttons` param,
// this component renders them as clickable button rows.
// Clicking sends `callback_data: <value>` as a user message.
//
// Button format (from Gateway protocol):
//   buttons: [[{ text, callback_data, style? }]]
//   style: "primary" | "success" | "danger"
//
// Follows the same protocol as Telegram inline keyboards.
// ═══════════════════════════════════════════════════════════

import { useState, useCallback } from 'react';
import { Check } from 'lucide-react';
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
    if (clicked) return; // Prevent double-click
    setClicked(callbackData);
    onCallback(callbackData);
  }, [clicked, onCallback]);

  if (!buttons || buttons.length === 0) return null;

  return (
    <div
      className="px-5 py-1 animate-[inline-button-bar-in_180ms_ease-out]"
    >
      <style>
        {'@keyframes inline-button-bar-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}'}
      </style>
      <div className="space-y-1.5 max-w-[85%]">
        {buttons.map((row, rowIdx) => (
          <div key={rowIdx} className="flex flex-wrap gap-1.5">
            {row.map((btn, btnIdx) => {
              const isClicked = clicked === btn.callback_data;
              const isDisabled = clicked !== null;
              const styleKey = btn.style || 'default';

              return (
                <button
                  key={`${rowIdx}-${btnIdx}`}
                  onClick={() => handleClick(btn.callback_data)}
                  disabled={isDisabled}
                  className={clsx(
                    'px-3.5 py-2 rounded-xl text-[12px] font-medium border transition-all duration-200',
                    'active:scale-[0.97]',
                    isClicked
                      ? 'bg-aegis-accent/20 border-aegis-accent/40 text-aegis-accent ring-2 ring-aegis-accent/20'
                      : isDisabled
                        ? 'opacity-40 cursor-not-allowed ' + STYLE_CLASSES[styleKey]
                        : STYLE_CLASSES[styleKey]
                  )}
                >
                  {btn.text}
                  {isClicked && (
                    <Check size={9} className="ms-1.5 opacity-60" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
