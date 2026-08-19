import { useEffect, useRef } from 'react';
import {
  subscribeGatewayProcessRuntime,
  type GatewayProcessRuntimeStatus,
} from '@/services/gateway/gatewayProcessObservation';

export function isGatewayProcessRecovered(status: GatewayProcessRuntimeStatus): boolean {
  return status.ready && status.error === null;
}

export function shouldNotifyGatewayProcessRecovered(
  wasRecovered: boolean,
  status: GatewayProcessRuntimeStatus,
): boolean {
  return !wasRecovered && isGatewayProcessRecovered(status);
}

/**
 * 错误恢复界面与连接管理器共用所选运行时观察结果。持续就绪只通知一次，
 * 避免认证重连失败后由轮询自动重放；运行时再次不可用后才允许新的恢复通知。
 */
export function useGatewayProcessRecovery(onRecovered?: () => void | Promise<void>): void {
  const onRecoveredRef = useRef(onRecovered);
  const wasRecoveredRef = useRef(false);
  onRecoveredRef.current = onRecovered;

  useEffect(() => subscribeGatewayProcessRuntime((status) => {
    const shouldNotify = shouldNotifyGatewayProcessRecovered(wasRecoveredRef.current, status);
    wasRecoveredRef.current = isGatewayProcessRecovered(status);
    if (shouldNotify) void onRecoveredRef.current?.();
  }), []);
}
