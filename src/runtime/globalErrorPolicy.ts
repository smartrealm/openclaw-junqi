import { isGatewayTransportLifecycleError } from "@/services/gateway/GatewayTransportError";

export type GlobalPromiseRejectionOutcome = "gateway-recoverable" | "fatal";

interface PromiseRejectionLike {
  readonly reason: unknown;
  preventDefault(): void;
}

function errorDetail(reason: unknown): unknown {
  if (reason instanceof Error) return reason.stack || reason.message;
  return reason;
}

/**
 * Keeps expected Gateway transport churn inside the shared connection UI while
 * preserving the fatal overlay for genuine unhandled programming failures.
 */
export function handleUnhandledPromiseRejection(
  event: PromiseRejectionLike,
  showFatal: (title: string, detail: unknown) => void,
): GlobalPromiseRejectionOutcome {
  if (isGatewayTransportLifecycleError(event.reason)) {
    event.preventDefault();
    return "gateway-recoverable";
  }

  showFatal("Promise Rejection", errorDetail(event.reason));
  return "fatal";
}
