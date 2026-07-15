import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';

export type GatewayRecoveryRecommendation = 'retry' | 'repair' | 'inspect_config';

export function diagnoseGatewayRecovery(error: string): Promise<GatewayRecoveryRecommendation> {
  return invoke<GatewayRecoveryRecommendation>('diagnose_gateway_recovery', { error });
}

const MIGRATION_RETRY_PATTERN = /startup migrations are already running[\s\S]*?after\s+(\d{4}-\d{2}-\d{2}T\S+?Z)\b/i;
const MAX_MIGRATION_RETRY_DELAY_MS = 5 * 60 * 1000;

export function gatewayMigrationRetryDelayMs(error: string, now = Date.now()): number {
  const expiresAt = MIGRATION_RETRY_PATTERN.exec(error)?.[1];
  if (!expiresAt) return 0;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.min(MAX_MIGRATION_RETRY_DELAY_MS, Math.max(0, timestamp - now + 1_000));
}

export interface OpenClawRepairCoordinator {
  run: () => Promise<boolean>;
  isRepairing: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export function createOpenClawRepairCoordinator(
  repair: () => Promise<boolean>,
): OpenClawRepairCoordinator {
  let activeRepair: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    run: () => {
      if (activeRepair) return activeRepair;
      activeRepair = repair().finally(() => {
        activeRepair = null;
        notify();
      });
      notify();
      return activeRepair;
    },
    isRepairing: () => activeRepair !== null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const coordinator = createOpenClawRepairCoordinator(() => invoke<boolean>('repair_openclaw'));

export function isOpenClawRepairing(): boolean {
  return coordinator.isRepairing();
}

export function runOpenClawRepair(): Promise<boolean> {
  return coordinator.run();
}

export function useOpenClawRepairing(): boolean {
  return useSyncExternalStore(coordinator.subscribe, isOpenClawRepairing, isOpenClawRepairing);
}
