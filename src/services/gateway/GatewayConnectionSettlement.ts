import type { RuntimeIdentity } from '@/types/gatewayRuntime';

export const GATEWAY_CONNECTION_SETTLEMENT_TIMEOUT_MS = 60_000;

export interface GatewayConnectionSettlementSource {
  captureConnectionId(): string | null;
  isConnectionCurrent(connectionId: string): boolean;
  getRuntimeIdentity(): RuntimeIdentity | null;
  subscribeRuntimeIdentity(listener: (identity: RuntimeIdentity | null) => void): () => void;
}

export class GatewayConnectionSettlementTimeoutError extends Error {
  readonly code = 'GATEWAY_CONNECTION_SETTLEMENT_TIMEOUT';

  constructor(timeoutMs: number) {
    super(`Gateway did not establish a new attested connection within ${Math.ceil(timeoutMs / 1_000)} seconds.`);
    this.name = 'GatewayConnectionSettlementTimeoutError';
  }
}

function settledConnectionId(
  source: GatewayConnectionSettlementSource,
  previousConnectionId: string | null,
): string | null {
  const connectionId = source.captureConnectionId();
  const identity = source.getRuntimeIdentity();
  if (
    !connectionId
    || connectionId === previousConnectionId
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
}: {
  source: GatewayConnectionSettlementSource;
  previousConnectionId: string | null;
  timeoutMs?: number;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let finished = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (connectionId: string) => {
      if (finished) return;
      finished = true;
      globalThis.clearTimeout(timer);
      unsubscribe();
      resolve(connectionId);
    };
    const inspect = () => {
      const connectionId = settledConnectionId(source, previousConnectionId);
      if (connectionId) finish(connectionId);
    };
    const timer = globalThis.setTimeout(() => {
      if (finished) return;
      finished = true;
      unsubscribe();
      reject(new GatewayConnectionSettlementTimeoutError(timeoutMs));
    }, timeoutMs);

    unsubscribe = source.subscribeRuntimeIdentity(inspect);
    inspect();
  });
}
