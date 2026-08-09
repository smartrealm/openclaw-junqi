import { motion, useReducedMotion } from 'framer-motion';
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { SetupStep } from '@/stores/setup-navigation';
import type { OnboardingPresentationKind } from '@/services/setup/onboardingPresentation';

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
export type SetupStepMotionMode = 'directional' | 'ambient';

interface SetupStepTransitionContextValue {
  readonly direction: SetupStepMotionDirection;
  readonly mode: SetupStepMotionMode;
  readonly reducedMotion: boolean;
  readonly step: SetupStep;
  readonly scene: SetupStep;
}

const SetupStepTransitionContext = createContext<SetupStepTransitionContextValue | null>(null);

export function setupStepMotionMode(kind: OnboardingPresentationKind): SetupStepMotionMode {
  return kind === 'decision' || kind === 'official-wizard' || kind === 'complete'
    ? 'directional'
    : 'ambient';
}

export function setupStepMotionDirection(
  previous: SetupStep | null,
  next: SetupStep,
): SetupStepMotionDirection {
  if (!previous || previous === next) return 0;
  return SETUP_STEP_INDEX[next] >= SETUP_STEP_INDEX[previous] ? -1 : 1;
}

export function setupStepScene(step: SetupStep): SetupStep {
  // Gateway 就绪检查与官方配置向导属于同一用户可见阶段，状态交接时只替换内容。
  return step === 'gateway-ready' ? 'configure-openclaw' : step;
}

export function setupStepEntryState(
  direction: SetupStepMotionDirection,
  reducedMotion: boolean,
  mode: SetupStepMotionMode = 'directional',
): { opacity: number; x: number; y: number } {
  if (reducedMotion || direction === 0) {
    return { opacity: 1, x: 0, y: 0 };
  }
  if (mode === 'ambient') return { opacity: 0.98, x: 0, y: 4 };
  return {
    opacity: 0.96,
    x: direction * -12,
    y: 0,
  };
}

export function SetupStepTransition({
  step,
  kind = 'decision',
  children,
}: {
  step: SetupStep;
  kind?: OnboardingPresentationKind;
  children: ReactNode;
}) {
  const previousStepRef = useRef<SetupStep | null>(null);
  const direction = setupStepMotionDirection(previousStepRef.current, step);
  const reducedMotion = useReducedMotion() ?? false;
  const mode = setupStepMotionMode(kind);
  const scene = setupStepScene(step);

  useLayoutEffect(() => {
    previousStepRef.current = step;
  }, [step]);

  return (
    <SetupStepTransitionContext.Provider value={{ direction, mode, reducedMotion, step, scene }}>
      <div
        className="relative h-screen w-full overflow-hidden"
        data-setup-step-lifecycle="current-only"
        data-setup-step-transition={direction}
        data-setup-step-scene={scene}
      >
        {children}
      </div>
    </SetupStepTransitionContext.Provider>
  );
}

export function SetupStepScene({ children }: { children: ReactNode }) {
  const context = useContext(SetupStepTransitionContext);
  if (!context) {
    return <div className="flex w-full min-w-0 max-w-full justify-center overflow-x-clip">{children}</div>;
  }

  const { direction, mode, reducedMotion, scene } = context;
  return (
    <motion.div
      key={scene}
      initial={setupStepEntryState(direction, reducedMotion, mode)}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{
        duration: reducedMotion ? 0 : mode === 'ambient' ? 0.14 : 0.18,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="flex w-full min-w-0 max-w-full justify-center overflow-x-clip"
      data-setup-scene-motion={mode}
    >
      {children}
    </motion.div>
  );
}
