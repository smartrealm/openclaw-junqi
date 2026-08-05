import { useSyncExternalStore } from 'react';
import { gateway } from '@/services/gateway';
import { readOpenClawSessionHistoryCapabilities } from '@/services/gateway/sessionCapabilities';

/** 读取当前认证 Gateway 在握手阶段声明的会话历史能力。 */
export function useGatewaySessionHistoryCapabilities() {
  const observation = useSyncExternalStore(
    (notify) => gateway.subscribeHello(() => notify()),
    () => gateway.getHelloObservation(),
    () => null,
  );
  return readOpenClawSessionHistoryCapabilities(observation);
}
