import type { ChannelsRuntimeSnapshot } from '@/services/openclawChannelRuntime';
import { extractAvailableModelsFromGatewayResult } from '@/services/gateway/modelCatalog';

export type OpenClawRuntimeReadiness = 'checking' | 'ready' | 'not_ready' | 'unavailable';

export interface OpenClawStartupRuntimeState {
  provider: OpenClawRuntimeReadiness;
  channel: OpenClawRuntimeReadiness;
}

export interface OpenClawStartupRuntimeDependencies {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  readChannelStatus(): Promise<unknown>;
}

function configuredChannelAccount(account: unknown): boolean {
  if (!account || typeof account !== 'object') return false;
  const status = account as Record<string, unknown>;
  return status.configured === true
    || status.linked === true
    || status.running === true
    || status.connected === true;
}

export function hasConfiguredChannel(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const runtime = snapshot as ChannelsRuntimeSnapshot;
  if (runtime.configuredChannels?.some((channel) => typeof channel === 'string' && channel.trim())) {
    return true;
  }
  return Object.values(runtime.channelAccounts ?? {})
    .some((accounts) => Array.isArray(accounts) && accounts.some(configuredChannelAccount));
}

async function readProviderState(
  dependencies: OpenClawStartupRuntimeDependencies,
): Promise<OpenClawRuntimeReadiness> {
  try {
    const result = await dependencies.call('models.list', { view: 'configured' });
    return extractAvailableModelsFromGatewayResult(result).length > 0 ? 'ready' : 'not_ready';
  } catch {
    return 'unavailable';
  }
}

async function readChannelState(
  dependencies: OpenClawStartupRuntimeDependencies,
): Promise<OpenClawRuntimeReadiness> {
  let result: unknown;
  try {
    result = await dependencies.call('channels.status', { probe: false, timeoutMs: 8_000 });
  } catch {
    try {
      result = await dependencies.readChannelStatus();
    } catch {
      return 'unavailable';
    }
  }
  return hasConfiguredChannel(result) ? 'ready' : 'not_ready';
}

export async function inspectOpenClawStartupRuntime(
  dependencies: OpenClawStartupRuntimeDependencies,
): Promise<OpenClawStartupRuntimeState> {
  const [provider, channel] = await Promise.all([
    readProviderState(dependencies),
    readChannelState(dependencies),
  ]);
  return { provider, channel };
}
