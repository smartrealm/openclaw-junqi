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
  // 同一用户可见阶段内的运行状态只替换内容，不能重新挂载整块页面。
  if (step === 'welcome') return 'environment-review';
  if (step === 'detecting') return 'environment-review';
  if (step === 'gateway-ready') return 'configure-openclaw';
  return step;
}

export function setupStepScrollKey(step: SetupStep, contentIdentity = 'screen'): string {
  // 视觉场景可以复用动效，但每个真实步骤必须拥有独立的滚动起点。
  return `${step}:${contentIdentity}`;
}

export function useSetupStepScrollKey(contentIdentity?: string): string | null {
  const context = useContext(SetupStepTransitionContext);
  return context
    ? setupStepScrollKey(context.step, contentIdentity)
    : contentIdentity ?? null;
}

export function setupStepEntryState(
  direction: SetupStepMotionDirection,
  reducedMotion: boolean,
  mode: SetupStepMotionMode = 'directional',
): { opacity: number; x: number; y: number } {
  if (reducedMotion || direction === 0) {
    return { opacity: 1, x: 0, y: 0 };
  }
  // 运行状态会随探测和日志更新；进入时保持几何位置，避免状态交接被误感知为页面闪动。
  if (mode === 'ambient') return { opacity: 1, x: 0, y: 0 };
  return {
    opacity: 0.96,
    x: direction * 12,
    y: 0,
  };
}

export function setupContentEntryState(
  reducedMotion: boolean,
): { opacity: number; y: number } {
  // 同一官方向导场景内只做轻量内容过渡，外层标题、滚动容器和操作区保持原位。
  return reducedMotion
    ? { opacity: 1, y: 0 }
    : { opacity: 0.96, y: 4 };
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

export function SetupStepScene({ children, className }: { children: ReactNode; className?: string }) {
  const context = useContext(SetupStepTransitionContext);
  const sceneClassName = ['flex w-full min-w-0 max-w-full justify-center overflow-x-clip', className]
    .filter(Boolean)
    .join(' ');
  if (!context) {
    return <div className={sceneClassName}>{children}</div>;
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
      className={sceneClassName}
      data-setup-scene-motion={mode}
    >
      {children}
    </motion.div>
  );
}

export function SetupContentScene({
  identity,
  children,
  className,
}: {
  identity: string;
  children: ReactNode;
  className?: string;
}) {
  const context = useContext(SetupStepTransitionContext);
  const reducedMotion = context?.reducedMotion ?? true;
  const contentClassName = ['min-h-full w-full', className]
    .filter(Boolean)
    .join(' ');

  if (!context) {
    return (
      <div className={contentClassName} data-setup-content-motion={identity}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      key={identity}
      initial={setupContentEntryState(reducedMotion)}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reducedMotion ? 0 : 0.14,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={contentClassName}
      data-setup-content-motion={identity}
    >
      {children}
    </motion.div>
  );
}
