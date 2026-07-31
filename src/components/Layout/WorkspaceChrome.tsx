import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

interface WorkspaceChromeIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  active?: boolean;
  children: ReactNode;
}

export function WorkspaceChromeIconButton({
  label,
  active = false,
  className,
  children,
  type = 'button',
  ...props
}: WorkspaceChromeIconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      title={props.title ?? label}
      aria-label={props['aria-label'] ?? label}
      className={clsx(
        'relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-aegis-text-dim transition-[color,background-color,transform] duration-100',
        'hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text active:translate-y-px',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60',
        'disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-aegis-text-dim',
        active && 'bg-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text',
        className,
      )}
    >
      {children}
    </button>
  );
}

interface WorkspaceSidebarHeaderProps {
  eyebrow?: string;
  title?: string;
  compact?: boolean;
  actions: ReactNode;
}

export function WorkspaceSidebarHeader({
  eyebrow,
  title,
  compact = false,
  actions,
}: WorkspaceSidebarHeaderProps) {
  if (compact) {
    return (
      <header className="flex h-14 shrink-0 items-center justify-center border-b border-aegis-border">
        <div className="flex items-center gap-1">{actions}</div>
      </header>
    );
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-aegis-border px-3.5 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        {eyebrow && (
          <span className="truncate text-[9px] font-semibold uppercase text-aegis-text-dim">
            {eyebrow}
          </span>
        )}
        {title && <strong className="truncate text-[13px] font-semibold text-aegis-text">{title}</strong>}
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </header>
  );
}
