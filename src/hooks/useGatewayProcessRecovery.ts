import { useEffect, useRef } from 'react';
import {
  subscribeGatewayProcessRuntime,
  type GatewayProcessRuntimeStatus,
} from '@/services/gateway/gatewayProcessObservation';

export function isGatewayProcessRecovered(status: GatewayProcessRuntimeStatus): boolean {
  return status.ready && status.error === null;
}

/**
 * Keeps recovery surfaces on the same selected-runtime observation as the
 * connection manager. The latest callback is retained without resubscribing
 * whenever the screen rerenders.
 */
export function useGatewayProcessRecovery(onRecovered?: () => void): void {
  const onRecoveredRef = useRef(onRecovered);
  onRecoveredRef.current = onRecovered;

  useEffect(() => subscribeGatewayProcessRuntime((status) => {
    if (isGatewayProcessRecovered(status)) onRecoveredRef.current?.();
  }), []);
}
