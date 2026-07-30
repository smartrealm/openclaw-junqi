import clsx from 'clsx';
import type { ReactNode } from 'react';

/**
 * How prominently to present the icon.
 *
 * `framed` puts it in an accented tile — right for a primary surface whose
 * whole job is "there is nothing here yet". `bare` renders the glyph alone,
 * for secondary surfaces (popovers, sidebar panels) where a tile would
 * outweigh the content around it.
 */
export type EmptyStateIconStyle = 'framed' | 'bare';

/** Vertical presence. `comfortable` fills its parent; `compact` sits inline. */
export type EmptyStateDensity = 'comfortable' | 'compact';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  iconStyle?: EmptyStateIconStyle;
  density?: EmptyStateDensity;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  iconStyle = 'framed',
  density = 'comfortable',
  className,
}: EmptyStateProps) {
  const compact = density === 'compact';

  return (
    <div
      className={clsx(
        'flex flex-1 flex-col items-center justify-center text-center',
        compact ? 'gap-2 p-4' : 'gap-4 p-8',
        className,
      )}
    >
      {icon && (
        iconStyle === 'framed' ? (
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-aegis-primary/20 bg-aegis-primary/10 text-aegis-primary">
            {icon}
          </div>
        ) : (
          <span className="text-aegis-text-dim opacity-55">{icon}</span>
        )
      )}
      <div>
        <div
          className={clsx(
            'font-semibold',
            compact ? 'text-xs text-aegis-text-secondary' : 'text-sm text-aegis-text',
          )}
        >
          {title}
        </div>
        {description && (
          <div className="mt-1 max-w-[320px] text-xs leading-relaxed text-aegis-text-dim">
            {description}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}
