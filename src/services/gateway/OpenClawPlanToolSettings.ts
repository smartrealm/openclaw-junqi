import { gateway } from './index';
import type { OpenClawPlanToolMode } from '@/agent-execution-plan/settings';

interface ConfigGateway {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  callPrivileged(method: string, params: Record<string, unknown>): Promise<unknown>;
}

interface ConfigSnapshot {
  config: Record<string, unknown>;
  baseHash: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readConfigSnapshot(value: unknown): ConfigSnapshot {
  const snapshot = asRecord(value);
  const config = asRecord(snapshot?.config)
    ?? asRecord(snapshot?.resolved)
    ?? asRecord(snapshot?.sourceConfig);
  const baseHash = typeof snapshot?.baseHash === 'string'
    ? snapshot.baseHash
    : typeof snapshot?.hash === 'string'
      ? snapshot.hash
      : '';
  if (!config || !baseHash) throw new Error('OpenClaw config snapshot is unavailable');
  return { config, baseHash };
}

function experimentalConfig(config: Record<string, unknown>): Record<string, unknown> {
  const tools = asRecord(config.tools);
  return { ...(asRecord(tools?.experimental) ?? {}) };
}

export function resolveOpenClawPlanToolMode(config: Record<string, unknown>): OpenClawPlanToolMode {
  const configured = experimentalConfig(config).planTool;
  if (configured === true) return 'enabled';
  if (configured === false) return 'disabled';
  return 'automatic';
}

export class OpenClawPlanToolSettingsClient {
  constructor(private readonly client: ConfigGateway) {}

  async read(): Promise<OpenClawPlanToolMode> {
    const snapshot = readConfigSnapshot(await this.client.call('config.get', {}));
    return resolveOpenClawPlanToolMode(snapshot.config);
  }

  async write(mode: OpenClawPlanToolMode): Promise<void> {
    const snapshot = readConfigSnapshot(await this.client.call('config.get', {}));
    const experimental = experimentalConfig(snapshot.config);
    if (mode === 'automatic') delete experimental.planTool;
    else experimental.planTool = mode === 'enabled';

    await this.client.callPrivileged('config.patch', {
      baseHash: snapshot.baseHash,
      raw: JSON.stringify({ tools: { experimental } }),
      replacePaths: ['tools.experimental'],
      note: 'Update structured Chat execution plan availability',
    });
  }
}

export const openClawPlanToolSettings = new OpenClawPlanToolSettingsClient(gateway);
