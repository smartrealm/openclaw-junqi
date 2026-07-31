import { useEffect, useState } from 'react';

export function gatewayUptimeMs(
  connected: boolean,
  connectionStartedAt: number | null,
  now = Date.now(),
): number {
  if (!connected || connectionStartedAt === null) return 0;
  return Math.max(0, now - connectionStartedAt);
}

export function millisecondsUntilNextGatewayUptimeTick(
  connectionStartedAt: number,
  now = Date.now(),
): number {
  const elapsed = Math.max(0, now - connectionStartedAt);
  const remainder = elapsed % 60_000;
  return remainder === 0 ? 60_000 : 60_000 - remainder;
}

/** Refresh exactly when the displayed minute of the Gateway uptime changes. */
export function useGatewayUptime(connected: boolean, connectionStartedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (!connected || connectionStartedAt === null) return undefined;

    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 60_000);
    }, millisecondsUntilNextGatewayUptimeTick(connectionStartedAt));

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [connected, connectionStartedAt]);

  return gatewayUptimeMs(connected, connectionStartedAt, now);
}
