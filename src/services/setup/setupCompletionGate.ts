import {
  OpenClawSetupMethodUnavailableError,
  type OpenClawSetupDetection,
} from '@/services/gateway/OpenClawSetupClient';

export interface SetupCompletionDependencies {
  probeGateway: () => Promise<boolean>;
  requiresOnboarding: () => Promise<boolean>;
}

export type SetupCompletionResult =
  | { ready: true }
  | { ready: false; reason: 'gateway-unavailable' | 'onboarding-required' };

export type WizardSessionLossReconciliation =
  | { state: 'complete' }
  | { state: 'gateway-unavailable' | 'onboarding-required' };

/**
 * 只有官方结构化检测明确返回完成时才跳过官方向导。旧 Gateway 缺少检测方法时，
 * 由同一 Gateway 的官方向导决定既有配置和可跳过步骤，桌面端不能臆测为已完成。
 */
export async function shouldStartOfficialOnboarding(
  detect: () => Promise<OpenClawSetupDetection>,
): Promise<boolean> {
  try {
    return !(await detect()).setupComplete;
  } catch (error) {
    if (
      error instanceof OpenClawSetupMethodUnavailableError
      && error.availability === 'unsupported'
    ) {
      return true;
    }
    throw error;
  }
}

/** 按 OpenClaw 原生跳过引导条件验证选定运行时。 */
export async function validateSetupCompletion(
  dependencies: SetupCompletionDependencies,
): Promise<SetupCompletionResult> {
  if (!(await dependencies.probeGateway())) {
    return { ready: false, reason: 'gateway-unavailable' };
  }
  if (await dependencies.requiresOnboarding()) {
    return { ready: false, reason: 'onboarding-required' };
  }
  return { ready: true };
}

/**
 * Wizard 的进程内会话丢失后，只能使用同一 Runtime 的官方结构化检测重新判断。
 * 该函数不启动 Wizard，也不把配置文件存在、端口健康或客户端旧步骤当成完成事实。
 */
export async function reconcileWizardSessionLoss(
  dependencies: SetupCompletionDependencies,
): Promise<WizardSessionLossReconciliation> {
  const completion = await validateSetupCompletion(dependencies);
  if (completion.ready) return { state: 'complete' };
  return { state: completion.reason };
}
