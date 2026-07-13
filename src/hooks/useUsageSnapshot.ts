import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ENABLE_USAGE_INSIGHTS } from '@/components/Terminal/_nezha-platform';

export interface UsageWindow {
  usedPercent: number;
  remainingPercent: number;
  resetAt?: number | null;
}

export interface ClaudeUsageData {
  fiveHour?: UsageWindow | null;
  sevenDay?: UsageWindow | null;
}

export interface CodexUsageData {
  email?: string | null;
  planType?: string | null;
  primary?: UsageWindow | null;
  secondary?: UsageWindow | null;
}

export type UsageSource<T> =
  | { status: 'available'; data: T }
  | { status: 'unavailable'; reason: string };

export interface UsageSnapshot {
  claude: UsageSource<ClaudeUsageData>;
  codex: UsageSource<CodexUsageData>;
  fetchedAt: number;
}

let cachedSnapshot: UsageSnapshot | null = null;
let cacheUpdatedAt = 0;
let inflightPromise: Promise<void> | null = null;

async function fetchSnapshot(): Promise<void> {
  if (inflightPromise) return inflightPromise;
  inflightPromise = invoke<UsageSnapshot>('read_usage_snapshot')
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      cacheUpdatedAt = Date.now();
    })
    .finally(() => {
      inflightPromise = null;
    });
  return inflightPromise;
}

export function useUsageSnapshot(active: boolean) {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(cachedSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active || !ENABLE_USAGE_INSIGHTS) return;

    const load = async () => {
      if (cachedSnapshot && Date.now() - cacheUpdatedAt < 60_000) {
        if (mountedRef.current) setSnapshot(cachedSnapshot);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await fetchSnapshot();
        if (mountedRef.current) setSnapshot(cachedSnapshot);
      } catch (reason) {
        if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [active]);

  return { snapshot, loading, error };
}

export function getUsageColor(remainingPercent: number): string {
  if (remainingPercent > 70) return 'rgb(var(--aegis-success))';
  if (remainingPercent >= 20) return 'rgb(var(--aegis-warning))';
  return 'rgb(var(--aegis-danger))';
}
