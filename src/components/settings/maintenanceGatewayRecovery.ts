import type { GatewayLifecycleResult } from '@/services/gateway/GatewayLifecycleCoordinator';

export function gatewayLifecycleFailureMessage(
  result: GatewayLifecycleResult,
  fallbackMessage: string,
): string | null {
  if (result.success) return null;
  return result.error?.trim() || fallbackMessage;
}
