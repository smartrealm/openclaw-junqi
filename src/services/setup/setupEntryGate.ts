export interface SetupEntryGateState {
  setupComplete: boolean | null;
  installationValidationPending: boolean;
  officialSetupValidationPending: boolean;
}

/** 工作台只能在本地安装与当前 OpenClaw 官方配置状态都核验完成后渲染。 */
export function shouldBlockWorkspaceEntry(state: SetupEntryGateState): boolean {
  return state.setupComplete === true
    && (state.installationValidationPending || state.officialSetupValidationPending);
}
