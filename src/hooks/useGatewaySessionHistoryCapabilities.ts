import { useSyncExternalStore } from 'react';
import { gateway } from '@/services/gateway';
import { readOpenClawSessionHistoryCapabilities } from '@/services/gateway/sessionCapabilities';

const subscribeGatewayHello = (notify: () => void) => gateway.subscribeHello(notify);
const readGatewayHello = () => gateway.getHelloObservation();
const readServerGatewayHello = () => null;

/** 认证连接建立后开放官方会话历史调用，具体结果由对应 RPC 判定。 */
export function useGatewaySessionHistoryCapabilities() {
  const observation = useSyncExternalStore(
    subscribeGatewayHello,
    readGatewayHello,
    readServerGatewayHello,
  );
  return readOpenClawSessionHistoryCapabilities(observation);
}
