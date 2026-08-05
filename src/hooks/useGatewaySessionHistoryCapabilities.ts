import { useSyncExternalStore } from 'react';
import { gateway } from '@/services/gateway';
import { readOpenClawSessionHistoryCapabilities } from '@/services/gateway/sessionCapabilities';

const subscribeGatewayHello = (notify: () => void) => gateway.subscribeHello(notify);
const readGatewayHello = () => gateway.getHelloObservation();
const readServerGatewayHello = () => null;

/** 读取当前认证 Gateway 在握手阶段声明的会话历史能力。 */
export function useGatewaySessionHistoryCapabilities() {
  const observation = useSyncExternalStore(
    subscribeGatewayHello,
    readGatewayHello,
    readServerGatewayHello,
  );
  return readOpenClawSessionHistoryCapabilities(observation);
}
