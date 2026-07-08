/**
 * Shared opaque card surface. Despite the historical component name,
 * this is intentionally not a glassmorphism card: no backdrop blur,
 * no shimmer edge, and only a restrained hover tint.
 */

import clsx from 'clsx';
import React, { type ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  delay?: number;
  noPad?: boolean;
  onClick?: () => void;
}

export const GlassCard = React.memo(function GlassCard({
  children,
  className = '',
  hover = true,
  delay = 0,
  noPad = false,
  onClick,
}: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'relative overflow-hidden rounded-xl',
        'border border-aegis-border',
        'bg-aegis-card',
        'animate-slide-up',
        hover && 'hover:border-aegis-border-hover hover:bg-aegis-hover hover:-translate-y-px',
        'transition-[background,border-color,transform] duration-200',
        onClick && 'cursor-pointer',
        className,
      )}
      style={delay > 0 ? { animationDelay: `${delay}s` } : undefined}
    >
      <div className={noPad ? undefined : 'p-5'}>
        {children}
      </div>
    </div>
  );
});
