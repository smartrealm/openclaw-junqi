// Badge + StatusDot — Aegis Design System
// Adapted from Hermes shared-ui, using aegis-* tokens.
// Pattern: data-* attributes drive CSS variants (no clsx tone switching).
import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  resolveStatusTone,
  statusToneColor,
  statusToneGlow,
  toneAnimatesByDefault,
  type StatusTone,
} from '../status/statusTone';
import s from './badge.module.css';

// ── Types ────────────────────────────────────────────────

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'info'
  | 'success'
  | 'ok'
  | 'warning'
  | 'warn'
  | 'danger'
  | 'err'
  | 'running'
  | 'attention';

export type BadgeVariant = 'soft' | 'outline' | 'solid';
export type BadgeSize    = 'sm' | 'md' | 'lg';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?:    BadgeTone;
  variant?: BadgeVariant;
  size?:    BadgeSize;
  children: ReactNode;
}

// ── Badge ────────────────────────────────────────────────

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone = 'neutral', variant = 'soft', size = 'md', children, ...props },
  ref,
) {
  return (
    <span
      {...props}
      ref={ref}
      className={clsx(s.badge, className)}
      data-tone={tone}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </span>
  );
});

// ── StatusDot ────────────────────────────────────────────

/**
 * Any vocabulary `resolveStatusTone` understands — the canonical tones plus
 * the legacy/lifecycle spellings callers already pass. Kept as a widened
 * string so a caller's own domain type (agent lifecycle, task status) is
 * assignable without a cast; unknown values render `neutral`.
 */
export type StatusDotTone = StatusTone | (string & {});

/** Named size steps, or an explicit pixel diameter. */
export type StatusDotSize = 'sm' | 'md' | 'lg' | number;

export interface StatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone?: StatusDotTone;
  size?: StatusDotSize;
  /**
   * Force the pulse animation on or off. Defaults to the tone's own
   * behavior, so in-flight work animates and settled states do not.
   */
  live?: boolean;
  /** Accessible name. Omit to leave the dot decorative (`aria-hidden`). */
  label?: string;
}

export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(function StatusDot(
  { className, tone = 'neutral', size = 'md', live, label, style, ...props },
  ref,
) {
  const resolved = resolveStatusTone(tone);
  const animated = live ?? toneAnimatesByDefault(resolved);
  const explicitDiameter = typeof size === 'number' ? size : undefined;

  return (
    <span
      {...props}
      ref={ref}
      className={clsx(s.dot, className)}
      data-tone={resolved}
      data-size={typeof size === 'number' ? undefined : size}
      data-live={animated ? 'true' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        ...style,
        ...(explicitDiameter ? { width: explicitDiameter, height: explicitDiameter } : null),
        '--dot-color': statusToneColor(resolved),
        '--dot-glow': statusToneGlow(resolved),
      } as CSSProperties}
    />
  );
});
