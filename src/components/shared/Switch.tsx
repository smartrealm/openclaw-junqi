import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  visibleLabel?: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  visibleLabel,
  disabled = false,
  size = 'md',
  className,
}: SwitchProps) {
  const compact = size === 'sm';
  return (
    <label className={clsx('inline-flex items-center gap-2.5 select-none', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={clsx(
          'relative shrink-0 rounded-full border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45',
          'disabled:cursor-not-allowed',
          compact ? 'h-5 w-9' : 'h-6 w-11',
          checked ? 'border-aegis-primary/55 bg-aegis-primary/35' : 'border-aegis-border bg-aegis-input',
        )}
      >
        <span
          aria-hidden="true"
          className={clsx(
            'absolute rounded-full transition-transform',
            compact ? 'start-0.5 top-0.5 h-4 w-4' : 'start-0.5 top-0.5 h-[18px] w-[18px]',
            checked
              ? compact ? 'translate-x-4 bg-aegis-primary rtl:-translate-x-4' : 'translate-x-[21px] bg-aegis-primary rtl:-translate-x-[21px]'
              : 'translate-x-0 bg-aegis-text-dim',
          )}
        />
      </button>
      {visibleLabel && <span className="text-sm text-aegis-text-secondary">{visibleLabel}</span>}
    </label>
  );
}
