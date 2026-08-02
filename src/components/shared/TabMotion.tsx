import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';

interface ActiveTabIndicatorProps {
  layoutId: string;
  className?: string;
}

export function ActiveTabIndicator({ layoutId, className }: ActiveTabIndicatorProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      aria-hidden="true"
      layoutId={layoutId}
      className={clsx('pointer-events-none absolute', className)}
      transition={reduceMotion
        ? { duration: 0 }
        : { type: 'spring', stiffness: 420, damping: 36, mass: 0.72 }}
    />
  );
}

interface AnimatedTabPanelProps {
  children: ReactNode;
  className?: string;
  transitionKey: string;
}

export function AnimatedTabPanel({ children, className, transitionKey }: AnimatedTabPanelProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      key={transitionKey}
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion
        ? { duration: 0 }
        : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
