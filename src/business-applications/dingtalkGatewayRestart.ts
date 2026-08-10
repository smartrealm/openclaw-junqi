import type { GatewayLifecycleResult } from '@/services/gateway/GatewayLifecycleCoordinator';
import {
  waitForDingTalkGatewayReconnect,
  type DingTalkGatewayReconnectSnapshot,
} from './dingtalkGatewayReconnect';

interface DingTalkGatewayLifecycle {
  restart(source: string): Promise<GatewayLifecycleResult>;
}

export async function restartDingTalkGateway({
  lifecycle,
  captureConnectionId,
  read,
}: {
  lifecycle: DingTalkGatewayLifecycle;
  captureConnectionId: () => string | null;
  read: () => DingTalkGatewayReconnectSnapshot;
}): Promise<void> {
  const previousConnectionId = captureConnectionId();
  const result = await lifecycle.restart('business-applications-dingtalk');
  if (!result.success) throw new Error(result.error ?? 'Gateway 重启失败');
  await waitForDingTalkGatewayReconnect({ previousConnectionId, read });
}
