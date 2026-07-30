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

import type { ReactNode } from 'react';
import { Circle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { LoadingIndicator } from './LoadingIndicator';
import {
  resolveStatusTone,
  statusToneColor,
  statusToneGlow,
  toneAnimatesByDefault,
} from './status/statusTone';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

/**
 * Agent lifecycle vocabulary. Kept as this module's public domain type
 * because callers (AgentRunView, ActivityCenter) speak lifecycle, not
 * presentation tones — `resolveStatusTone` bridges the two.
 */
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

/** Glyph shape per lifecycle state. Color comes from the shared tone table. */
const STATE_GLYPH: Record<LifecycleState, 'spinner' | 'alert' | 'check' | 'dot'> = {
  idle: 'dot',
  running: 'spinner',
  attention: 'alert',
  failed: 'alert',
  ended: 'check',
};

const STATE_I18N: Record<LifecycleState, { key: string; fallback: string }> = {
  idle: { key: 'lifecycle.idle', fallback: 'idle' },
  running: { key: 'lifecycle.running', fallback: 'running' },
  attention: { key: 'lifecycle.attention', fallback: 'attention' },
  failed: { key: 'lifecycle.failed', fallback: 'failed' },
  ended: { key: 'lifecycle.ended', fallback: 'done' },
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
  const tone = resolveStatusTone(state);
  const color = statusToneColor(tone);
  const glow = statusToneGlow(tone);
  const copy = STATE_I18N[state];
  const shouldPulse = pulse ?? toneAnimatesByDefault(tone);
  const glyphSize = Math.max(size + 2, 10);

  let Glyph: ReactNode;
  switch (STATE_GLYPH[state]) {
    case 'spinner':
      Glyph = <LoadingIndicator size={glyphSize} className="shrink-0" style={{ color }} />;
      break;
    case 'alert':
      Glyph = <AlertCircle size={glyphSize} className="shrink-0" style={{ color }} />;
      break;
    case 'check':
      Glyph = <CheckCircle2 size={glyphSize} className="shrink-0" style={{ color }} />;
      break;
    default:
      Glyph = <Circle size={size} className="shrink-0" style={{ color, fill: color }} />;
  }

  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 shrink-0', className)}
      style={shouldPulse ? { filter: `drop-shadow(0 0 4px ${glow})` } : undefined}
      title={t(copy.key, copy.fallback)}
      aria-label={t(copy.key, copy.fallback)}
    >
      {Glyph}
      {label && (
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color }}>
          {labelText ?? t(copy.key, copy.fallback)}
        </span>
      )}
    </span>
  );
}

/**
 * Compact inline dot for tab strips and list rows.
 *
 * Re-exported from the shared Aegis primitive rather than reimplemented:
 * this module previously carried its own third copy of `StatusDot`
 * (BUG-FCA-04). A `LifecycleState` is a valid `tone` because
 * `resolveStatusTone` accepts the lifecycle vocabulary.
 */
export { StatusDot } from './badge';