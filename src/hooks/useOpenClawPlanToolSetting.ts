import { useCallback, useEffect, useState } from 'react';
import {
  openClawPlanToolSettings,
} from '@/services/gateway/OpenClawPlanToolSettings';
import type { OpenClawPlanToolMode } from '@/agent-execution-plan/settings';

export function useOpenClawPlanToolSetting(active: boolean) {
  const [mode, setMode] = useState<OpenClawPlanToolMode>('automatic');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      setMode(await openClawPlanToolSettings.read());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(async (next: OpenClawPlanToolMode) => {
    setSaving(true);
    setError(null);
    try {
      await openClawPlanToolSettings.write(next);
      setMode(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, []);

  return { mode, loading, saving, error, update, refresh };
}
