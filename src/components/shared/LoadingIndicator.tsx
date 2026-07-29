import type { CSSProperties } from 'react';
import clsx from 'clsx';

export type LoadingIndicatorVariant = 'spinner' | 'dots';

export interface LoadingIndicatorProps {
  variant?: LoadingIndicatorVariant;
  size?: number | string;
  className?: string;
  label?: string;
}

function normalizeSize(size: number | string): string {
  if (typeof size === 'number') return Number.isFinite(size) && size > 0 ? `${size}px` : '16px';
  return size.trim() || '16px';
}

function indicatorSize(size: number | string, variant: LoadingIndicatorVariant): CSSProperties {
  const height = normalizeSize(size);
  if (variant === 'spinner') return { width: height, height };
  return { width: `calc(${height} * 2.5)`, height };
}

/** Shared indeterminate progress indicator for compact and content loading states. */
export function LoadingIndicator({
  variant = 'spinner',
  size = 16,
  className,
  label,
}: LoadingIndicatorProps) {
  const accessibilityProps = label
    ? { role: 'status', 'aria-label': label, 'aria-live': 'polite' as const }
    : { 'aria-hidden': true as const };

  return (
    <span
      {...accessibilityProps}
      className={clsx('aegis-loading-indicator', className)}
      style={indicatorSize(size, variant)}
      data-loading-indicator={variant}
    >
      {variant === 'dots' ? (
        <svg className="aegis-loading-indicator__dots" viewBox="0 0 30 12" fill="currentColor">
          <circle cx="5" cy="6" r="3" />
          <circle cx="15" cy="6" r="3" />
          <circle cx="25" cy="6" r="3" />
        </svg>
      ) : (
        <svg className="aegis-loading-indicator__spinner" viewBox="0 0 24 24" fill="none">
          <circle className="aegis-loading-indicator__track" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" />
          <path
            d="M12 3a9 9 0 0 1 8.55 6.22"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}
