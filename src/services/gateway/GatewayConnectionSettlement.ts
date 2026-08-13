import type { RuntimeIdentity } from '@/types/gatewayRuntime';

export const GATEWAY_CONNECTION_SETTLEMENT_TIMEOUT_MS = 60_000;

export interface GatewayConnectionSettlementSource {
  captureConnectionId(): string | null;
  capturePendingConnectionId?: () => string | null;
  isConnectionCurrent(connectionId: string): boolean;
  getRuntimeIdentity(): RuntimeIdentity | null;
  subscribeRuntimeIdentity(listener: (identity: RuntimeIdentity | null) => void): () => void;
  getFailureDiagnostic?: () => string | null;
  getPendingDiagnostic?: () => string | null;
  subscribeFailure?: (listener: (diagnostic: string) => void) => () => void;
  subscribeAvailability?: (listener: () => void) => () => void;
}

export class GatewayConnectionSettlementTimeoutError extends Error {
  readonly code = 'GATEWAY_CONNECTION_SETTLEMENT_TIMEOUT';

  constructor(timeoutMs: number, diagnostic?: string | null) {
    const suffix = diagnostic?.trim() ? ` Last connection error: ${diagnostic.trim()}` : '';
    super(`Gateway did not establish a new attested connection within ${Math.ceil(timeoutMs / 1_000)} seconds.${suffix}`);
    this.name = 'GatewayConnectionSettlementTimeoutError';
  }
}

export class GatewayConnectionSettlementFailureError extends Error {
  readonly code = 'GATEWAY_CONNECTION_SETTLEMENT_FAILED';

  constructor(diagnostic: string) {
    super(diagnostic);
    this.name = 'GatewayConnectionSettlementFailureError';
  }
}

export class GatewayConnectionSettlementAbortedError extends Error {
  readonly code = 'GATEWAY_CONNECTION_SETTLEMENT_ABORTED';

  constructor() {
    super('Gateway connection settlement was cancelled.');
    this.name = 'GatewayConnectionSettlementAbortedError';
  }
}

export function currentAttestedConnectionId(
  source: GatewayConnectionSettlementSource,
  excludedConnectionId: string | null = null,
): string | null {
  const connectionId = source.captureConnectionId();
  const identity = source.getRuntimeIdentity();
  if (
    !connectionId
    || connectionId === excludedConnectionId
    || !source.isConnectionCurrent(connectionId)
    || !identity?.verified
    || identity.connectionId !== connectionId
  ) {
    return null;
  }
  return connectionId;
}

/**
 * 统一等待一次生命周期操作产生的新连接。只有 hello-ok、当前连接围栏和
 * Runtime Identity 核验全部收敛后，重启或恢复才可向调用方报告成功。
 */
export function waitForGatewayConnectionSettlement({
  source,
  previousConnectionId,
  timeoutMs = GATEWAY_CONNECTION_SETTLEMENT_TIMEOUT_MS,
  signal,
}: {
  source: GatewayConnectionSettlementSource;
  previousConnectionId: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let finished = false;
    const unsubscribes: Array<() => void> = [];
    const registerUnsubscribe = (unsubscribe: () => void) => {
      if (finished) unsubscribe();
      else unsubscribes.push(unsubscribe);
    };
    const cleanup = () => {
      globalThis.clearTimeout(timer);
      unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
    };
    const finish = (connectionId: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(connectionId);
    };
    const fail = (diagnostic: string) => {
      if (finished || !diagnostic.trim()) return;
      finished = true;
      cleanup();
      reject(new GatewayConnectionSettlementFailureError(diagnostic.trim()));
    };
    const abort = () => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new GatewayConnectionSettlementAbortedError());
    };
    const inspect = () => {
      const connectionId = currentAttestedConnectionId(source, previousConnectionId);
      if (connectionId) {
        finish(connectionId);
        return;
      }
      const candidateConnectionId = source.capturePendingConnectionId?.()
        ?? source.captureConnectionId();
      const identity = source.getRuntimeIdentity();
      if (
        candidateConnectionId
        && candidateConnectionId !== previousConnectionId
        && identity?.connectionId === candidateConnectionId
        && !identity.verified
      ) {
        const issues = identity.issues?.length > 0
          ? identity.issues.join(', ')
          : 'unknown attestation failure';
        fail(`Gateway connected, but runtime identity verification failed: ${issues}`);
      }
    };
    const timer = globalThis.setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new GatewayConnectionSettlementTimeoutError(timeoutMs, source.getPendingDiagnostic?.()));
    }, timeoutMs);

    if (signal?.aborted) {
      abort();
      return;
    }
    if (signal) {
      signal.addEventListener('abort', abort, { once: true });
      registerUnsubscribe(() => signal.removeEventListener('abort', abort));
    }

    const immediateFailure = source.getFailureDiagnostic?.();
    if (immediateFailure) {
      fail(immediateFailure);
      return;
    }
    registerUnsubscribe(source.subscribeRuntimeIdentity(inspect));
    if (source.subscribeFailure) registerUnsubscribe(source.subscribeFailure(fail));
    if (source.subscribeAvailability) registerUnsubscribe(source.subscribeAvailability(inspect));
    inspect();
  });
}
