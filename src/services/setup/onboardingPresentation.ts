import type { SetupStep } from '@/stores/setup-navigation';

export type OnboardingPresentationKind =
  | 'decision'
  | 'operation'
  | 'gateway-ready'
  | 'official-wizard'
  | 'failure'
  | 'complete';

export interface OnboardingPresentation {
  state: SetupStep;
  stage: number;
  kind: OnboardingPresentationKind;
}

/**
 * 引导呈现状态机只负责用户可见的阶段和交互语义。
 * 安装器、Gateway 与 OpenClaw Wizard 各自保留真实业务转换，避免 UI 伪造运行时状态。
 */
const PRESENTATION_STATES = {
  welcome: { state: 'welcome', stage: -1, kind: 'decision' },
  detecting: { state: 'detecting', stage: 0, kind: 'operation' },
  'environment-review': { state: 'environment-review', stage: 0, kind: 'decision' },
  storage: { state: 'storage', stage: 1, kind: 'decision' },
  'gateway-stopped': { state: 'gateway-stopped', stage: 2, kind: 'operation' },
  'choosing-mode': { state: 'choosing-mode', stage: 2, kind: 'decision' },
  checking: { state: 'checking', stage: 2, kind: 'operation' },
  'install-git': { state: 'install-git', stage: 2, kind: 'operation' },
  'git-missing': { state: 'git-missing', stage: 2, kind: 'decision' },
  'node-missing': { state: 'node-missing', stage: 2, kind: 'decision' },
  'install-node': { state: 'install-node', stage: 2, kind: 'operation' },
  'install-openclaw': { state: 'install-openclaw', stage: 2, kind: 'operation' },
  // Gateway 已就绪后立即进入配置阶段的统一容器；底层状态仍保留运行时事实。
  'gateway-ready': { state: 'gateway-ready', stage: 3, kind: 'gateway-ready' },
  'configure-openclaw': { state: 'configure-openclaw', stage: 3, kind: 'official-wizard' },
  ready: { state: 'ready', stage: 4, kind: 'complete' },
  error: { state: 'error', stage: 2, kind: 'failure' },
} as const satisfies Record<SetupStep, OnboardingPresentation>;

export class OnboardingPresentationMachine {
  private current: OnboardingPresentation;

  constructor(initial: SetupStep) {
    this.current = PRESENTATION_STATES[initial];
  }

  transition(next: SetupStep): OnboardingPresentation {
    this.current = PRESENTATION_STATES[next];
    return this.snapshot;
  }

  get snapshot(): OnboardingPresentation {
    return { ...this.current };
  }
}

export function createOnboardingPresentationMachine(initial: SetupStep): OnboardingPresentationMachine {
  return new OnboardingPresentationMachine(initial);
}
