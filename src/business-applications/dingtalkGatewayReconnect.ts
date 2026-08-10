export interface DingTalkGatewayReconnectSnapshot {
  readonly connected: boolean;
  readonly connectionId: string | null;
  readonly identityConnectionId: string | null;
  readonly identityVerified: boolean;
}

export async function waitForDingTalkGatewayReconnect({
  previousConnectionId,
  read,
  timeoutMs = 60_000,
  pollIntervalMs = 500,
  now = Date.now,
  wait = (delayMs) => new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  }),
}: {
  previousConnectionId: string | null;
  read: () => DingTalkGatewayReconnectSnapshot;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  wait?: (delayMs: number) => Promise<void>;
}): Promise<void> {
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    const snapshot = read();
    if (
      snapshot.connected
      && snapshot.connectionId
      && snapshot.connectionId !== previousConnectionId
      && snapshot.identityVerified
      && snapshot.identityConnectionId === snapshot.connectionId
    ) return;
    await wait(pollIntervalMs);
  }
  throw new Error('Gateway 重启后未在 60 秒内恢复连接。');
}
