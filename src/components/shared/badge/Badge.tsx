// Badge + StatusDot — Aegis Design System
// Adapted from Hermes shared-ui, using aegis-* tokens.
// Pattern: data-* attributes drive CSS variants (no clsx tone switching).
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import s from './badge.module.css';

// ── Types ────────────────────────────────────────────────

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
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

export type StatusDotTone =
  | 'neutral'
  | 'primary'
  | 'running'
  | 'live'        // running + pulse animation
  | 'attention'
  | 'success'
  | 'ended'
  | 'failed'
  | 'danger'
  | 'idle'
  | 'warning';

export type StatusDotSize = 'sm' | 'md' | 'lg';

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusDotTone;
  size?: StatusDotSize;
  /** Adds pulse glow animation on top of the running tone */
  live?: boolean;
}

export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(function StatusDot(
  { className, tone = 'neutral', size = 'md', live, ...props },
  ref,
) {
  return (
    <span
      {...props}
      ref={ref}
      className={clsx(s.dot, className)}
      data-tone={tone}
      data-size={size}
      data-live={live ? 'true' : undefined}
    />
  );
});
