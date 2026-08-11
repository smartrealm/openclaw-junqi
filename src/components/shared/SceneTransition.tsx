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
    if (reducedMotion || recoveryRevision === 0) {
      controls.set({ opacity: 1, y: 0, scale: 1, filter: 'saturate(1)' });
      return;
    }
    // Gateway 恢复只说明连接状态改变，不能让整页位移、缩放或改变饱和度。
    void controls.start({
      opacity: [0.94, 1],
      y: 0,
      scale: 1,
      filter: 'saturate(1)',
      transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
    });
  }, [controls, recoveryRevision, reducedMotion]);

  return (
    <motion.div
      className={className}
      initial={false}
      animate={controls}
      data-scene-recovery={recoveryReason ?? undefined}
    >
      {children}
    </motion.div>
  );
}
