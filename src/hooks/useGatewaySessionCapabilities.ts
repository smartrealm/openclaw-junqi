import { useSyncExternalStore } from 'react';
import { gateway } from '@/services/gateway';
import { readOpenClawSessionCapabilities } from '@/services/gateway/sessionCapabilities';

/** 读取当前认证 Gateway 在握手阶段声明的能力。 */
export function useGatewaySessionCapabilities() {
  const observation = useSyncExternalStore(
    (notify) => gateway.subscribeHello(() => notify()),
    () => gateway.getHelloObservation(),
    () => null,
  );
  return readOpenClawSessionCapabilities(observation);
}
