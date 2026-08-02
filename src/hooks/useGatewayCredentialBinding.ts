import { useCallback } from 'react';
import { bindGatewayCredentialToCurrentInstance } from '@/services/gateway/GatewayCredentialBinding';

export function useGatewayCredentialBinding() {
  return useCallback(
    (gatewayUrl: string, collaborationInstanceId: string, expectedConnectionId: string) => (
      bindGatewayCredentialToCurrentInstance(
        gatewayUrl,
        collaborationInstanceId,
        expectedConnectionId,
      )
    ),
    [],
  );
}
