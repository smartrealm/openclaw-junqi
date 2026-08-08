import { motion, useReducedMotion } from 'framer-motion';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { SetupStep } from '@/stores/setup-navigation';

const SETUP_STEP_INDEX: Record<SetupStep, number> = {
  welcome: 0,
  detecting: 1,
  'environment-review': 2,
  storage: 3,
  'gateway-stopped': 4,
  'choosing-mode': 5,
  checking: 6,
  'install-git': 7,
  'git-missing': 8,
  'node-missing': 9,
  'install-node': 10,
  'install-openclaw': 11,
  'gateway-ready': 12,
  'configure-openclaw': 13,
  ready: 14,
  error: 15,
};

export type SetupStepMotionDirection = -1 | 0 | 1;

export function setupStepMotionDirection(
  previous: SetupStep | null,
  next: SetupStep,
): SetupStepMotionDirection {
  if (!previous || previous === next) return 0;
  return SETUP_STEP_INDEX[next] >= SETUP_STEP_INDEX[previous] ? -1 : 1;
}

export function setupStepEntryState(
  direction: SetupStepMotionDirection,
  reducedMotion: boolean,
): { opacity: number; x: number } {
  if (reducedMotion) {
    return { opacity: 1, x: 0 };
  }
  return {
    opacity: 0,
    x: direction === 0 ? 0 : direction * -28,
  };
}

export function SetupStepTransition({ step, children }: { step: SetupStep; children: ReactNode }) {
  const previousStepRef = useRef<SetupStep | null>(null);
  const direction = setupStepMotionDirection(previousStepRef.current, step);
  const reducedMotion = useReducedMotion() ?? false;

  useLayoutEffect(() => {
    previousStepRef.current = step;
  }, [step]);

  return (
    <div className="relative h-screen w-full overflow-hidden">
      <motion.div
        key={step}
        initial={setupStepEntryState(direction, reducedMotion)}
        animate={{ opacity: 1, x: 0 }}
        transition={{
          duration: reducedMotion ? 0 : 0.2,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="h-full w-full"
        data-setup-step-lifecycle="current-only"
        data-setup-step-transition={direction}
        data-setup-step-scene={step}
      >
        {children}
      </motion.div>
    </div>
  );
}
