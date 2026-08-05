import { useSyncExternalStore } from 'react';
import { gateway } from '@/services/gateway';
import { readOpenClawSessionCapabilities } from '@/services/gateway/sessionCapabilities';

/** React view of capabilities declared by the currently authenticated Gateway. */
export function useGatewaySessionCapabilities() {
  const observation = useSyncExternalStore(
    (notify) => gateway.subscribeHello(() => notify()),
    () => gateway.getHelloObservation(),
    () => null,
  );
  return readOpenClawSessionCapabilities(observation);
}
