export const GATEWAY_TRANSPORT_LIFECYCLE_ERROR_CODE = "GATEWAY_TRANSPORT_LIFECYCLE";

export type GatewayTransportLifecycle = "closed" | "credentials-changed";

/**
 * Expected rejection for RPCs that were in flight while the socket lifecycle
 * moved on. Connection status already owns the user-visible recovery state.
 */
export class GatewayTransportLifecycleError extends Error {
  readonly code = GATEWAY_TRANSPORT_LIFECYCLE_ERROR_CODE;

  constructor(
    message = "Gateway connection closed",
    readonly lifecycle: GatewayTransportLifecycle = "closed",
  ) {
    super(message);
    this.name = "GatewayTransportLifecycleError";
  }
}

export function isGatewayTransportLifecycleError(value: unknown): boolean {
  if (value instanceof GatewayTransportLifecycleError) return true;
  if (!value || typeof value !== "object") return false;
  return (value as { code?: unknown }).code === GATEWAY_TRANSPORT_LIFECYCLE_ERROR_CODE;
}
