import { useEffect, useState } from 'react';
import { gateway, openClawRuntimeConfigClient } from '@/services/gateway';
import { hasReadyChannelAccount } from '@/business-guide/channelReadiness';
import type { ChannelsRuntimeSnapshot } from '@/services/openclawChannelRuntime';

export function useBusinessGuideChannelFact(connected: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!connected) { setReady(false); return; }
    void Promise.all([openClawRuntimeConfigClient.read(), gateway.call('channels.status', { probe: false, timeoutMs: 8000 })])
      .then(([config, snapshot]) => { if (!cancelled) setReady(hasReadyChannelAccount(config.config, snapshot as ChannelsRuntimeSnapshot)); })
      .catch(() => { if (!cancelled) setReady(false); });
    return () => { cancelled = true; };
  }, [connected]);
  return ready;
}
