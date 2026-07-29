/**
 * Shared opaque card surface. Despite the historical component name,
 * this is intentionally not a glassmorphism card: no backdrop blur,
 * no shimmer edge, and only a restrained hover tint.
 */

import clsx from 'clsx';
import React, { createContext, type ReactNode, useContext } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  delay?: number;
  noPad?: boolean;
  onClick?: () => void;
}

const GlassCardEnterMotionContext = createContext(true);

export function GlassCardEnterMotionScope({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <GlassCardEnterMotionContext.Provider value={enabled}>
      {children}
    </GlassCardEnterMotionContext.Provider>
  );
}

export const GlassCard = React.memo(function GlassCard({
  children,
  className = '',
  hover = true,
  delay = 0,
  noPad = false,
  onClick,
}: GlassCardProps) {
  const enterMotionEnabled = useContext(GlassCardEnterMotionContext);

  return (
    <div
      onClick={onClick}
      className={clsx(
        'relative overflow-hidden rounded-xl',
        'border border-aegis-border',
        'bg-aegis-card',
        enterMotionEnabled && 'animate-slide-up',
        hover && 'hover:border-aegis-border-hover hover:bg-aegis-hover hover:-translate-y-px',
        'transition-[background,border-color,transform] duration-200',
        onClick && 'cursor-pointer',
        className,
      )}
      style={enterMotionEnabled && delay > 0 ? { animationDelay: `${delay}s` } : undefined}
    >
      <div className={noPad ? undefined : 'p-5'}>
        {children}
      </div>
    </div>
  );
});
