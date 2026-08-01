import { invoke } from '@tauri-apps/api/core';
import { gatewayManager } from './GatewayConnectionManager';
import { createGatewayLifecycleCoordinator } from './GatewayLifecycleCoordinator';

/**
 * Re-attests the selected runtime after a restart. The wizard already gated its
 * handoff on this probe; every other restart source (config manager, channel
 * settings, recovery) went without it and could report success while connected
 * to a Gateway that does not own the selected state.
 */
async function verifySelectedGatewayIdentity(): Promise<boolean> {
  return invoke<boolean>('probe_selected_gateway', {});
}

/** The only ordinary frontend Gateway restart/recovery entry point. */
export const gatewayLifecycle = createGatewayLifecycleCoordinator(
  gatewayManager,
  verifySelectedGatewayIdentity,
);
