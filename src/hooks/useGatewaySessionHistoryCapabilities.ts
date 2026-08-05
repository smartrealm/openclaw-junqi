import { useSyncExternalStore } from 'react';
import { gateway } from '@/services/gateway';
import { readOpenClawSessionHistoryCapabilities } from '@/services/gateway/sessionCapabilities';

export function useGatewaySessionHistoryCapabilities() {
  const observation = useSyncExternalStore(
    (notify) => gateway.subscribeHello(() => notify()),
    () => gateway.getHelloObservation(),
    () => null,
  );
  return readOpenClawSessionHistoryCapabilities(observation);
}
