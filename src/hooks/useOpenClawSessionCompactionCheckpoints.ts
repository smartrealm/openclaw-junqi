import { useCallback, useRef, useState } from 'react';
import { gateway } from '@/services/gateway';
import {
  OpenClawCompactionCheckpointsUnavailableError,
  type OpenClawCompactionCheckpoint,
} from '@/services/gateway/OpenClawSessionCompactionCheckpointsClient';

export type OpenClawCompactionCheckpointsFailure = 'unavailable' | 'invalid';

export function useOpenClawSessionCompactionCheckpoints(sessionKey: string) {
  const [checkpoints, setCheckpoints] = useState<readonly OpenClawCompactionCheckpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<OpenClawCompactionCheckpointsFailure | null>(null);
  const generation = useRef(0);

  const clear = useCallback(() => {
    generation.current += 1;
    setCheckpoints([]);
    setLoading(false);
    setFailure(null);
  }, []);

  const load = useCallback(async () => {
    const version = ++generation.current;
    setCheckpoints([]);
    setLoading(true);
    setFailure(null);
    try {
      const next = await gateway.listSessionCompactionCheckpoints(sessionKey);
      if (generation.current === version) setCheckpoints(next);
    } catch (error) {
      if (generation.current === version) {
        setFailure(error instanceof OpenClawCompactionCheckpointsUnavailableError ? 'unavailable' : 'invalid');
      }
    } finally {
      if (generation.current === version) setLoading(false);
    }
  }, [sessionKey]);

  return { checkpoints, loading, failure, load, clear };
}
