import { useCallback, useEffect, useState } from 'react';
import { gateway } from '@/services/gateway';
import type { SessionTranscriptBranch } from '@/services/gateway/SessionTranscriptHistoryClient';
import { useGatewaySessionCapabilities } from './useGatewaySessionCapabilities';

export function useSessionTranscriptBranches(sessionKey: string, agentId: string, enabled: boolean) {
  const capabilities = useGatewaySessionCapabilities();
  const [branches, setBranches] = useState<SessionTranscriptBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!capabilities.branches || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      setBranches(await gateway.listSessionBranches(sessionKey, agentId || undefined));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [agentId, capabilities.branches, enabled, sessionKey]);

  useEffect(() => {
    setBranches([]);
    setError(null);
    if (enabled && capabilities.branches) void refresh();
  }, [capabilities.branches, enabled, refresh]);

  const switchBranch = useCallback(async (leafEntryId: string) => {
    await gateway.switchSessionBranch(sessionKey, leafEntryId, agentId || undefined);
  }, [agentId, sessionKey]);

  return { capabilities, branches, loading, error, refresh, switchBranch };
}
