import { LoaderCircle, Power } from 'lucide-react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { SettingsSwitch } from './SettingsSwitch';

export interface AutostartPreferenceRowProps {
  title: string;
  description: string;
  actionLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  badge?: ReactNode;
  pendingLabel?: string | null;
  error?: string | null;
  disabled?: boolean;
  className?: string;
}

function AutostartPreferenceSkeleton({ className }: Pick<AutostartPreferenceRowProps, 'className'>) {
  return (
    <div className={clsx('flex min-h-[80px] items-start gap-3 py-4 text-left', className)} aria-busy="true">
      <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-aegis-surface" />
      <div className="min-w-0 flex-1 space-y-2 py-1">
        <span className="block h-3 w-40 animate-pulse rounded bg-aegis-surface" />
        <span className="block h-3 w-full max-w-xl animate-pulse rounded bg-aegis-surface" />
      </div>
      <span className="h-6 w-11 shrink-0 animate-pulse rounded-full bg-aegis-surface" />
    </div>
  );
}

/** A shared status row for independent OpenClaw and desktop login policies. */
export function AutostartPreferenceRow({
  title,
  description,
  actionLabel,
  checked,
  onCheckedChange,
  badge,
  pendingLabel = null,
  error = null,
  disabled = false,
  className,
}: AutostartPreferenceRowProps) {
  const busy = pendingLabel !== null;

  return (
    <div className={clsx('flex min-h-[80px] items-start gap-3 py-4 text-left', className)} aria-busy={busy}>
      <span className={clsx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
        checked ? 'bg-aegis-success/15 text-aegis-success' : 'bg-aegis-primary/15 text-aegis-primary',
      )}>
        <Power size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-aegis-text">{title}</span>
          {badge}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-aegis-text-secondary">{description}</p>
        {pendingLabel && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-aegis-text-muted" role="status">
            <LoaderCircle size={12} className="animate-spin" />
            {pendingLabel}
          </p>
        )}
        {error && <p className="mt-2 break-words text-xs text-aegis-danger">{error}</p>}
      </div>
      <div className="flex h-9 shrink-0 items-center gap-2">
        {busy && <LoaderCircle size={14} className="animate-spin text-aegis-primary" aria-hidden="true" />}
        <SettingsSwitch
          checked={checked}
          disabled={disabled || busy}
          label={actionLabel}
          onCheckedChange={onCheckedChange}
        />
      </div>
    </div>
  );
}

AutostartPreferenceRow.Skeleton = AutostartPreferenceSkeleton;
