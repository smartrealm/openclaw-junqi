import { useCallback, useEffect, useState } from 'react';
import { gateway } from '@/services/gateway';
import type { MemoryRemHarnessResult, MemoryStatusResult } from '@/services/gateway/memoryDoctor';

interface OpenClawMemoryDiagnosticsState {
  status: MemoryStatusResult | null;
  remHarness: MemoryRemHarnessResult | null;
  loading: boolean;
  statusError: string | null;
  remHarnessError: string | null;
  refresh: () => Promise<void>;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useOpenClawMemoryDiagnostics(): OpenClawMemoryDiagnosticsState {
  const [status, setStatus] = useState<MemoryStatusResult | null>(null);
  const [remHarness, setRemHarness] = useState<MemoryRemHarnessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [remHarnessError, setRemHarnessError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [statusResult, remHarnessResult] = await Promise.allSettled([
      gateway.getMemoryStatus(undefined, true),
      gateway.getMemoryRemHarness({ grounded: true, includePromoted: true, limit: 25 }),
    ]);
    if (statusResult.status === 'fulfilled') {
      setStatus(statusResult.value);
      setStatusError(null);
    } else {
      setStatus(null);
      setStatusError(errorMessage(statusResult.reason));
    }
    if (remHarnessResult.status === 'fulfilled') {
      setRemHarness(remHarnessResult.value);
      setRemHarnessError(null);
    } else {
      setRemHarness(null);
      setRemHarnessError(errorMessage(remHarnessResult.reason));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, remHarness, loading, statusError, remHarnessError, refresh };
}
