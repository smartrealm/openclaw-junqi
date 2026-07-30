import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={clsx('flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center', className)}>
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-aegis-primary/20 bg-aegis-primary/10 text-aegis-primary">
          {icon}
        </div>
      )}
      <div>
        <div className="text-sm font-semibold text-aegis-text">{title}</div>
        {description && <div className="mt-1 max-w-[320px] text-xs leading-relaxed text-aegis-text-dim">{description}</div>}
      </div>
      {action}
    </div>
  );
}
