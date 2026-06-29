/**
 * GlassCard — renamed for legacy compat; now an OPAQUE card matching
 * nezha's paper-stack aesthetic. No backdrop-blur, no shimmer edge,
 * no hover lift. Just a solid surface with a 1px hairline that swaps
 * to a hover tint on hover.
 *
 * The word "Glass" is retained in the filename to avoid a 50-file
 * import churn; the component itself is a plain card.
 *
 * Spec: NEZHA-VISUAL-DNA.md §1.1 (paper-stack), §1.4 (no shadow),
 * §1.5 (radii), §1.6 (quiet motion).
 */

import { motion } from 'framer-motion';
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
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className={clsx(
        'relative overflow-hidden rounded-xl',
        'border border-aegis-border',
        'bg-aegis-card',
        hover && 'hover:border-aegis-border-hover hover:bg-aegis-hover hover:-translate-y-px',
        'transition-[background,border-color,transform] duration-200',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      <div className={noPad ? undefined : 'p-5'}>
        {children}
      </div>
    </motion.div>
  );
});
