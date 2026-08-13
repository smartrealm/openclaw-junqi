import { invoke } from '@tauri-apps/api/core';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { createGatewayLifecycleCoordinator } from '@/services/gateway/GatewayLifecycleCoordinator';
import { waitForGatewayConnectionSettlement } from '@/services/gateway/GatewayConnectionSettlement';
import { gateway } from '@/services/gateway';
import {
  getCurrentRuntimeIdentity,
  subscribeRuntimeIdentity,
} from '@/services/gateway/runtimeIdentity';

/**
 * 重启后重新核验所选运行时身份。Wizard 已用该探测约束交接，
 * 其他重启入口也必须经过同一核验，不能连接到错误 Gateway 后报告成功。
 */
async function verifySelectedGatewayIdentity(): Promise<boolean> {
  return invoke<boolean>('probe_selected_gateway', {});
}

/** 前端普通 Gateway 恢复、重连、重启与停止的唯一入口。 */
export const gatewayLifecycle = createGatewayLifecycleCoordinator(
  gatewayManager,
  {
    captureConnectionId: () => gateway.captureConnectionId(),
    waitForConnection: (previousConnectionId) => waitForGatewayConnectionSettlement({
      previousConnectionId,
      source: {
        captureConnectionId: () => gateway.captureConnectionId(),
        isConnectionCurrent: (connectionId) => gateway.isConnectionCurrent(connectionId),
        getRuntimeIdentity: getCurrentRuntimeIdentity,
        subscribeRuntimeIdentity,
      },
    }),
  },
  verifySelectedGatewayIdentity,
);

/** 当前主连接只有同时通过连接围栏和运行时身份核验时才可用于配置交接。 */
export function captureCurrentAttestedGatewayConnectionId(): string | null {
  const connectionId = gateway.captureConnectionId();
  const identity = getCurrentRuntimeIdentity();
  return (
    connectionId
    && gateway.isConnectionCurrent(connectionId)
    && identity?.verified
    && identity.connectionId === connectionId
  ) ? connectionId : null;
}

/** 确认交接期间仍是开始时绑定的同一条已核验连接。 */
export function isAttestedGatewayConnectionCurrent(connectionId: string): boolean {
  return captureCurrentAttestedGatewayConnectionId() === connectionId;
}
