import { invoke } from '@tauri-apps/api/core';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { createGatewayLifecycleCoordinator } from '@/services/gateway/GatewayLifecycleCoordinator';
import {
  currentAttestedConnectionId,
  waitForGatewayConnectionSettlement,
} from '@/services/gateway/GatewayConnectionSettlement';
import { gateway } from '@/services/gateway';
import {
  getCurrentRuntimeIdentity,
  getCurrentRuntimeIdentityFailure,
  subscribeRuntimeIdentity,
  subscribeRuntimeIdentityFailure,
} from '@/services/gateway/runtimeIdentity';

/**
 * 重启后重新核验所选运行时身份。Wizard 已用该探测约束交接，
 * 其他重启入口也必须经过同一核验，不能连接到错误 Gateway 后报告成功。
 */
async function verifySelectedGatewayIdentity(expectedConnectionId: string): Promise<boolean> {
  if (!gateway.isConnectionCurrent(expectedConnectionId)) return false;
  const verified = await invoke<boolean>('probe_selected_gateway', {});
  return verified && gateway.isConnectionCurrent(expectedConnectionId);
}

/** 前端普通 Gateway 恢复、重连、重启与停止的唯一入口。 */
export const gatewayLifecycle = createGatewayLifecycleCoordinator(
  gatewayManager,
  {
    captureConnectionId: () => gateway.captureConnectionId(),
    isConnectionCurrent: (connectionId) => gateway.isConnectionCurrent(connectionId),
    waitForConnection: (previousConnectionId, timeoutMs, signal) => waitForGatewayConnectionSettlement({
      previousConnectionId,
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(signal ? { signal } : {}),
      source: {
        captureConnectionId: () => gateway.captureConnectionId(),
        capturePendingConnectionId: () => gateway.capturePendingRuntimeIdentityConnectionId(),
        isConnectionCurrent: (connectionId) => gateway.isConnectionCurrent(connectionId),
        getRuntimeIdentity: getCurrentRuntimeIdentity,
        subscribeRuntimeIdentity,
        getFailureDiagnostic: () => {
          const handshakeFailure = gateway.getRuntimeIdentityHandshakeFailure();
          if (handshakeFailure) {
            return `Gateway runtime identity attestation failed: ${handshakeFailure.diagnostic}`;
          }
          const connectionId = gateway.capturePendingRuntimeIdentityConnectionId()
            ?? gateway.captureConnectionId();
          const identityFailure = getCurrentRuntimeIdentityFailure();
          if (
            connectionId
            && identityFailure?.connectionId === connectionId
          ) {
            return `Gateway runtime identity attestation failed: ${identityFailure.diagnostic}`;
          }
          const snapshot = gatewayManager.getStateSnapshot();
          if (snapshot.connectionAttemptError) return snapshot.connectionAttemptError;
          const retry = gateway.getRetryState();
          return retry.phase === 'exhausted'
            ? retry.error || 'Gateway connection attempts exhausted'
            : null;
        },
        getPendingDiagnostic: () => gatewayManager.getStateSnapshot().error ?? gateway.getLastError(),
        subscribeFailure: (listener) => {
          const unsubscribeManager = gatewayManager.onStateChange((snapshot) => {
            if (snapshot.connectionAttemptError) listener(snapshot.connectionAttemptError);
          });
          const unsubscribeRetry = gateway.subscribeRetryState((retry) => {
            if (retry.phase === 'exhausted') {
              listener(retry.error || 'Gateway connection attempts exhausted');
            }
          });
          const unsubscribeIdentityFailure = subscribeRuntimeIdentityFailure((failure) => {
            const connectionId = gateway.capturePendingRuntimeIdentityConnectionId()
              ?? gateway.captureConnectionId();
            if (
              failure
              && connectionId === failure.connectionId
            ) {
              listener(`Gateway runtime identity attestation failed: ${failure.diagnostic}`);
            }
          });
          const unsubscribeHandshakeFailure = gateway.subscribeRuntimeIdentityHandshakeFailure((failure) => {
            if (failure) {
              listener(`Gateway runtime identity attestation failed: ${failure.diagnostic}`);
            }
          });
          return () => {
            unsubscribeManager();
            unsubscribeRetry();
            unsubscribeIdentityFailure();
            unsubscribeHandshakeFailure();
          };
        },
        subscribeAvailability: (listener) => gateway.subscribeRetryState(() => listener()),
      },
    }),
  },
  verifySelectedGatewayIdentity,
  () => getCurrentRuntimeIdentity()?.targetFingerprint ?? null,
);

/** 当前主连接只有同时通过连接围栏和运行时身份核验时才可用于配置交接。 */
export function captureCurrentAttestedGatewayConnectionId(): string | null {
  return currentAttestedConnectionId({
    captureConnectionId: () => gateway.captureConnectionId(),
    isConnectionCurrent: (connectionId) => gateway.isConnectionCurrent(connectionId),
    getRuntimeIdentity: getCurrentRuntimeIdentity,
    subscribeRuntimeIdentity,
  });
}

/** 确认交接期间仍是开始时绑定的同一条已核验连接。 */
export function isAttestedGatewayConnectionCurrent(connectionId: string): boolean {
  return captureCurrentAttestedGatewayConnectionId() === connectionId;
}
