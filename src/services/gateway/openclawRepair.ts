import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';

export type GatewayRecoveryRecommendation = 'retry' | 'repair' | 'inspect_config';

export function diagnoseGatewayRecovery(error: string): Promise<GatewayRecoveryRecommendation> {
  return invoke<GatewayRecoveryRecommendation>('diagnose_gateway_recovery', { error });
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
