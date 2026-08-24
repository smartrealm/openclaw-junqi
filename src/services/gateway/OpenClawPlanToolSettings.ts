import { gateway } from './index';
import type { OpenClawPlanToolMode } from '@/progress-card/settings';
import { readOpenClawConfigSnapshot } from './OpenClawConfigSnapshot';
import { requireOpenClawConfigPatchAcknowledgement } from './OpenClawRuntimeConfigClient';

interface ConfigGateway {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  callPrivileged(method: string, params: Record<string, unknown>): Promise<unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toolsConfig(config: Record<string, unknown>): Record<string, unknown> {
  return asRecord(config.tools) ?? {};
}

export function resolveOpenClawPlanToolMode(config: Record<string, unknown>): OpenClawPlanToolMode {
  const configured = toolsConfig(config).updatePlan;
  if (configured === true) return 'enabled';
  if (configured === false) return 'disabled';
  return 'automatic';
}

export class OpenClawPlanToolSettingsClient {
  constructor(private readonly client: ConfigGateway) {}

  async read(): Promise<OpenClawPlanToolMode> {
    const snapshot = readOpenClawConfigSnapshot(await this.client.call('config.get', {}));
    return resolveOpenClawPlanToolMode(snapshot.config);
  }

  async write(mode: OpenClawPlanToolMode): Promise<void> {
    const snapshot = readOpenClawConfigSnapshot(await this.client.call('config.get', {}));
    const updatePlan = mode === 'automatic' ? null : mode === 'enabled';

    const result = await this.client.callPrivileged('config.patch', {
      ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
      raw: JSON.stringify({ tools: { updatePlan } }),
      note: 'Update OpenClaw progress card availability',
    });
    requireOpenClawConfigPatchAcknowledgement(result);
  }
}

export const openClawPlanToolSettings = new OpenClawPlanToolSettingsClient(gateway);
