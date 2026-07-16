import { invoke } from '@tauri-apps/api/core';

// Broken-plugin recovery (BUG-CPI-07). See src-tauri/src/commands/plugin_recovery.rs
// for the detection contract: structured `plugins list --json` entries plus a
// file-level replica of the Gateway's payload smoke check; error-text plugin
// ids are hints only and are cross-validated against the structured list.

export interface BrokenGatewayPlugin {
  id: string;
  version: string | null;
  /** "missing-main-entry" | "plugin-error" | "gateway-smoke-check" */
  reason: string;
  detail: string | null;
}

export interface PluginHealOutcome {
  id: string;
  healed: boolean;
  attempted: string[];
  error: string | null;
}

export function listBrokenGatewayPlugins(error?: string): Promise<BrokenGatewayPlugin[]> {
  return invoke<BrokenGatewayPlugin[]>('list_broken_gateway_plugins', { error: error ?? null });
}

/** Findings whose cause only the Gateway's own smoke check can observe.
 * File-level re-checks cannot verify a fix for them, so the heal ladder
 * reports them conservatively unhealed and the flow validates with one
 * controlled Gateway start instead. */
export const UNVERIFIABLE_PLUGIN_REASON = 'gateway-smoke-check';

export type PluginRecoveryNextAction = 'start-gateway' | 'disable-plugins';

export interface PluginRecoveryPlan {
  action: PluginRecoveryNextAction;
  /** Plugins whose repair can only be verified by one controlled Gateway start. */
  startVerification: BrokenGatewayPlugin[];
}

export function healOpenclawPlugin(id: string, reason?: string): Promise<PluginHealOutcome> {
  return invoke<PluginHealOutcome>('heal_openclaw_plugin', { id, reason: reason ?? null });
}

export function disableOpenclawPlugin(id: string): Promise<void> {
  return invoke<void>('disable_openclaw_plugin', { id });
}

/**
 * Plugins whose heal ladder did not end in a verified fix. An outcome missing
 * from `outcomes` counts as unhealed: a heal that never ran cannot claim
 * success.
 */
export function unhealedPlugins(
  broken: BrokenGatewayPlugin[],
  outcomes: PluginHealOutcome[],
): BrokenGatewayPlugin[] {
  const healed = new Set(
    outcomes.filter((outcome) => outcome.healed).map((outcome) => outcome.id),
  );
  return broken.filter((plugin) => !healed.has(plugin.id));
}

/**
 * A smoke-check-only finding cannot be revalidated from the plugin manifest.
 * Once a controlled Gateway start has failed with the same finding, retrying
 * the same update/reinstall ladder cannot add information and must not loop.
 */
export function pluginsNeedingHeal(
  broken: BrokenGatewayPlugin[],
  gatewayStartAttempted: ReadonlySet<string>,
): BrokenGatewayPlugin[] {
  return broken.filter(
    (plugin) => plugin.reason !== UNVERIFIABLE_PLUGIN_REASON || !gatewayStartAttempted.has(plugin.id),
  );
}

/** Combines findings by plugin id while preserving the order shown to users. */
export function mergeBrokenPlugins(...groups: BrokenGatewayPlugin[][]): BrokenGatewayPlugin[] {
  const unique = new Map<string, BrokenGatewayPlugin>();
  for (const group of groups) {
    for (const plugin of group) unique.set(plugin.id, plugin);
  }
  return [...unique.values()];
}

/**
 * Decides the sole next state after a complete healing ladder. Verifiable
 * failures go directly to disable. Smoke-check-only failures receive exactly
 * one real Gateway start; a second observation goes directly to disable.
 */
export function planPluginRecovery(
  remaining: BrokenGatewayPlugin[],
  gatewayStartAttempted: ReadonlySet<string>,
): PluginRecoveryPlan {
  const verifiable = remaining.filter((plugin) => plugin.reason !== UNVERIFIABLE_PLUGIN_REASON);
  if (verifiable.length > 0) return { action: 'disable-plugins', startVerification: [] };

  const startVerification = remaining.filter(
    (plugin) => !gatewayStartAttempted.has(plugin.id),
  );
  if (remaining.length > 0 && startVerification.length === 0) {
    return { action: 'disable-plugins', startVerification: [] };
  }
  return { action: 'start-gateway', startVerification };
}

/** A successful CLI command is not a verified repair for smoke-check-only findings. */
export function isAwaitingGatewayVerification(
  plugin: BrokenGatewayPlugin,
  outcome: PluginHealOutcome,
): boolean {
  return plugin.reason === UNVERIFIABLE_PLUGIN_REASON
    && !outcome.healed
    && outcome.attempted.length > 0
    && !outcome.error;
}
