import { useEffect, type ReactNode } from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import type { SceneRecoveryReason } from '@/motion/sceneRecovery';

interface SceneTransitionProps {
  children: ReactNode;
  className?: string;
  recoveryRevision?: number;
  recoveryReason?: SceneRecoveryReason | null;
}

export function SceneTransition({
  children,
  className = '',
  recoveryRevision = 0,
  recoveryReason = null,
}: SceneTransitionProps) {
  const controls = useAnimationControls();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      controls.set({ opacity: 1, y: 0, scale: 1, filter: 'saturate(1)' });
      return;
    }
    if (recoveryRevision === 0) {
      void controls.start({
        opacity: 1,
        y: 0,
        transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
      });
      return;
    }
    void controls.start({
      opacity: [0.78, 1],
      y: [7, 0],
      scale: [0.997, 1],
      filter: ['saturate(0.82)', 'saturate(1)'],
      transition: { duration: 0.52, ease: [0.22, 1, 0.36, 1] },
    });
  }, [controls, recoveryRevision, reducedMotion]);

  return (
    <motion.div
      className={className}
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={controls}
      data-scene-recovery={recoveryReason ?? undefined}
    >
      {children}
    </motion.div>
  );
}
