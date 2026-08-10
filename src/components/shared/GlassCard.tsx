/**
 * 共享不透明卡片表面。虽然组件保留历史名称，但不使用玻璃拟态、背景模糊或发光边缘，
 * 只通过轻微的背景和边框变化反馈悬停。
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
        'relative overflow-hidden rounded-lg',
        'border border-aegis-border',
        'bg-aegis-card',
        enterMotionEnabled && 'animate-slide-up',
        hover && 'hover:border-aegis-border-hover hover:bg-aegis-hover',
        'transition-[background,border-color,transform] duration-200',
        onClick && 'cursor-pointer',
        className,
      )}
      style={enterMotionEnabled && delay > 0 ? { animationDelay: `${delay}s` } : undefined}
    >
      <div className={noPad ? undefined : 'p-4'}>
        {children}
      </div>
    </div>
  );
});
