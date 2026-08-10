export const GATEWAY_TRANSPORT_LIFECYCLE_ERROR_CODE = "GATEWAY_TRANSPORT_LIFECYCLE";

export type GatewayTransportLifecycle = "closed" | "credentials-changed" | "target-changed";

/**
 * socket 生命周期变化时拒绝尚未完成的 RPC。
 * 用户可见的恢复状态由连接状态机统一持有。
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

/** 本地等待超时，不代表远端操作失败或已取消。 */
export class GatewayRequestTimeoutError extends Error {
  readonly code = "GATEWAY_REQUEST_TIMEOUT";

  constructor(readonly timeoutMs: number) {
    super(`Request timeout (${timeoutMs}ms)`);
    this.name = "GatewayRequestTimeoutError";
  }
}

export function isGatewayTransportLifecycleError(value: unknown): boolean {
  if (value instanceof GatewayTransportLifecycleError) return true;
  if (!value || typeof value !== "object") return false;
  return (value as { code?: unknown }).code === GATEWAY_TRANSPORT_LIFECYCLE_ERROR_CODE;
}
