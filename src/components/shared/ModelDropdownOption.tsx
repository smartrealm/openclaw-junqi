import { Check } from 'lucide-react';
import clsx from 'clsx';

export interface ModelDropdownOptionProps {
  modelId: string;
  label: string;
  detail?: string;
  current: boolean;
  currentLabel: string;
  onSelect: (modelId: string) => void;
}

export function ModelDropdownOption({
  modelId,
  label,
  detail,
  current,
  currentLabel,
  onSelect,
}: ModelDropdownOptionProps) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!current) onSelect(modelId);
      }}
      disabled={current}
      aria-current={current ? 'true' : undefined}
      className={clsx(
        'w-full flex items-center justify-between px-3 py-1.5 text-[12px] text-start transition-colors',
        current
          ? 'cursor-default text-aegis-primary bg-[rgb(var(--aegis-primary)/0.08)]'
          : 'text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.06)]',
      )}
    >
      <div className="flex-1 min-w-0">
        <span className="font-mono truncate block">{label}</span>
        {detail && (
          <span className="text-[9px] text-aegis-text-dim font-mono truncate block">
            {detail}
          </span>
        )}
      </div>
      {current && (
        <span className="ms-3 inline-flex shrink-0 items-center gap-1 text-[9px] font-sans font-medium">
          <Check size={11} aria-hidden="true" />
          {currentLabel}
        </span>
      )}
    </button>
  );
}
