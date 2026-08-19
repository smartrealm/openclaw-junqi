/**
 * 管理首批 Gateway 数据到达后工作区的单次放行。
 *
 * 此状态不属于 Gateway 连接生命周期。它必须保持同一实例，避免数据水合改变
 * 主连接 effect 的依赖并销毁已完成握手的 WebSocket。
 */
export interface WorkspaceBootstrapReadiness {
  updateGatewayDataReady(ready: boolean): void;
  markInitialWorkspaceDataReady(allowIncompleteData?: boolean): boolean;
  isWorkspaceDataReady(): boolean;
  reset(): void;
}

/**
 * 当前连接的会话快照是工作区首屏的权威放行条件。调用方不应等待某一个
 * 特定请求完成，因为生命周期重连期间该请求可能被新的会话刷新合法取代。
 */
export function releaseWorkspaceAfterGatewayData(
  readiness: WorkspaceBootstrapReadiness,
  gatewayDataReady: boolean,
): boolean {
  readiness.updateGatewayDataReady(gatewayDataReady);
  return gatewayDataReady && readiness.markInitialWorkspaceDataReady();
}

export function shouldReleaseWorkspaceAfterGatewayRetryExhaustion(
  setupComplete: boolean,
  setupValidationPending: boolean,
): boolean {
  return setupComplete && !setupValidationPending;
}

export function createWorkspaceBootstrapReadiness(): WorkspaceBootstrapReadiness {
  let gatewayDataReady = false;
  let workspaceDataReady = false;

  return {
    updateGatewayDataReady(ready) {
      gatewayDataReady = ready;
    },
    markInitialWorkspaceDataReady(allowIncompleteData = false) {
      if (workspaceDataReady) return false;
      if (!allowIncompleteData && !gatewayDataReady) return false;
      workspaceDataReady = true;
      return true;
    },
    isWorkspaceDataReady() {
      return workspaceDataReady;
    },
    reset() {
      gatewayDataReady = false;
      workspaceDataReady = false;
    },
  };
}
