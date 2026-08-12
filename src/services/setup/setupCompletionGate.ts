export interface SetupCompletionDependencies {
  probeGateway: () => Promise<boolean>;
  requiresOnboarding: () => Promise<boolean>;
}

export type SetupCompletionResult =
  | { ready: true }
  | { ready: false; reason: 'gateway-unavailable' | 'onboarding-required' };

export type WizardSessionLossReconciliation =
  | { state: 'terminal-unknown' }
  | { state: 'gateway-unavailable' };

export type WizardCompletionLifecycleResult =
  | { ready: true; owner: 'docker' | 'official-native-service' }
  | { ready: false; reason: 'native-handoff-unavailable' };

/**
 * Docker Gateway 本身就是所选生命周期所有者，官方 Wizard 完成后只需重新连接并核验。
 * 只有 Native 运行方式需要把前台进程交接给 OpenClaw 官方系统服务。
 */
export async function prepareWizardCompletionLifecycle(
  runtimeMode: 'native' | 'docker',
  handoffNativeGateway: () => Promise<boolean>,
): Promise<WizardCompletionLifecycleResult> {
  if (runtimeMode === 'docker') return { ready: true, owner: 'docker' };
  if (!(await handoffNativeGateway())) {
    return { ready: false, reason: 'native-handoff-unavailable' };
  }
  return { ready: true, owner: 'official-native-service' };
}

/** 组合所选 Gateway 健康与当前流程已经取得的官方 Wizard 终态。 */
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
 * Wizard 的进程内会话丢失后，Gateway 健康只能证明当前服务可达，不能证明旧 Runner
 * 已完成、失败或回滚。恢复结果必须保留未知，不得从配置文件或旧步骤补造终态。
 */
export async function reconcileWizardSessionLoss(
  dependencies: Pick<SetupCompletionDependencies, 'probeGateway'>,
): Promise<WizardSessionLossReconciliation> {
  if (!(await dependencies.probeGateway())) return { state: 'gateway-unavailable' };
  return { state: 'terminal-unknown' };
}
