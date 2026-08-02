import { useCallback, useEffect, useState } from 'react';
import {
  loadOpenClawWorkspaceMemory,
  type OpenClawWorkspaceMemorySnapshot,
} from '@/services/openclawWorkspaceMemory';

interface OpenClawWorkspaceMemoryState {
  snapshot: OpenClawWorkspaceMemorySnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useOpenClawWorkspaceMemories(): OpenClawWorkspaceMemoryState {
  const [snapshot, setSnapshot] = useState<OpenClawWorkspaceMemorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await loadOpenClawWorkspaceMemory());
    } catch (reason) {
      setSnapshot(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}
