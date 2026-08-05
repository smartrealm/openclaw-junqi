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
