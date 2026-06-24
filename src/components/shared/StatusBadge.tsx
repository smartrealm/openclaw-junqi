// ─────────────────────────────────────────────────────────────────
// StatusBadge — kooky-aligned 4-state agent lifecycle indicator.
//
//  idle      gray      no activity
//  running   blue      agent actively producing output
//  attention amber     agent needs user input (e.g. permission prompt)
//  failed    red       error / exception
//  ended     green     completed successfully
//
// Used in: AgentRunView status bar, FollowUpDock input, Pane tab strip,
// NotificationBell, Workspace sidebar.
// ─────────────────────────────────────────────────────────────────

import { Circle, AlertCircle, Loader2, CheckCircle2, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

export type LifecycleState = 'idle' | 'running' | 'attention' | 'failed' | 'ended';

export interface StatusBadgeProps {
  state: LifecycleState;
  /** Show a text label next to the dot. Default false (dot only). */
  label?: boolean;
  /** Pixel size for the dot/icon. Default 8. */
  size?: number;
  /** Optional override for the displayed text. */
  labelText?: string;
  /** Additional className on the root span. */
  className?: string;
  /** Pulse animation (for "running" — subtle infinite glow). Default true when state=running. */
  pulse?: boolean;
}

const STATE_TOKEN: Record<LifecycleState, { color: string; glow: string; i18n: string; fallback: string }> = {
  idle:      { color: 'rgb(var(--aegis-status-idle))',      glow: 'rgb(var(--aegis-status-idle-surface))',      i18n: 'lifecycle.idle',      fallback: 'idle' },
  running:   { color: 'rgb(var(--aegis-status-running))',   glow: 'rgb(var(--aegis-status-running-glow))',    i18n: 'lifecycle.running',   fallback: 'running' },
  attention: { color: 'rgb(var(--aegis-status-attention))', glow: 'rgb(var(--aegis-status-attention-glow))',  i18n: 'lifecycle.attention', fallback: 'attention' },
  failed:    { color: 'rgb(var(--aegis-status-failed))',    glow: 'rgb(var(--aegis-status-failed-glow))',     i18n: 'lifecycle.failed',    fallback: 'failed' },
  ended:     { color: 'rgb(var(--aegis-status-ended))',     glow: 'rgb(var(--aegis-status-running-glow))',    i18n: 'lifecycle.ended',     fallback: 'done' },
};

export function StatusBadge({
  state,
  label = false,
  size = 8,
  labelText,
  className,
  pulse,
}: StatusBadgeProps) {
  const { t } = useTranslation();
  const tok = STATE_TOKEN[state];
  const shouldPulse = pulse ?? state === 'running';

  // Icon variant for states that need more than a dot (running = spinner, attention = alert).
  const Glyph = state === 'running'
    ? <Loader2 size={Math.max(size + 2, 10)} className="animate-spin shrink-0" style={{ color: tok.color }} />
    : state === 'attention'
      ? <AlertCircle size={Math.max(size + 2, 10)} className="shrink-0" style={{ color: tok.color }} />
      : state === 'ended'
        ? <CheckCircle2 size={Math.max(size + 2, 10)} className="shrink-0" style={{ color: tok.color }} />
        : state === 'failed'
          ? <AlertCircle size={Math.max(size + 2, 10)} className="shrink-0" style={{ color: tok.color }} />
          : <Circle size={size} className="shrink-0" style={{ color: tok.color, fill: tok.color }} />;

  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 shrink-0', className)}
      style={shouldPulse ? { filter: `drop-shadow(0 0 4px ${tok.glow})` } : undefined}
      title={t(tok.i18n, tok.fallback)}
      aria-label={t(tok.i18n, tok.fallback)}
    >
      {Glyph}
      {label && (
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: tok.color }}>
          {labelText ?? t(tok.i18n, tok.fallback)}
        </span>
      )}
    </span>
  );
}

/**
 * Compact inline dot for use in compact UI (tab strips, list rows).
 * Always a colored circle — no icon, no label.
 */
export function StatusDot({
  state,
  size = 6,
  pulse,
}: {
  state: LifecycleState;
  size?: number;
  pulse?: boolean;
}) {
  const tok = STATE_TOKEN[state];
  const shouldPulse = pulse ?? state === 'running';
  return (
    <span
      className={'inline-flex rounded-full'}
      style={{
        width: size,
        height: size,
        backgroundColor: tok.color,
        boxShadow: shouldPulse ? `0 0 6px ${tok.glow}` : 'none',
        animation: shouldPulse ? 'aegis-pulse 1.6s ease-in-out infinite' : 'none',
      }}
      title={tok.fallback}
      aria-hidden
    />
  );
}