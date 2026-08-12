import type { ChannelConfig, GatewayRuntimeConfig } from '@/types/openclawConfig';
import {
  CONFIG_REVISION_CONFLICT_PREFIX,
  isChannelConfigurationMetadataKey,
  isConfigRevisionConflict,
  mergeChannelConfigPartitions,
} from './channelConfigMerge';
import { openClawRuntimeConfigClient } from './gateway';
import { buildOpenClawConfigPatch } from '@/services/gateway/OpenClawConfigPatch';

export type ChannelBindingSource = 'account' | 'channel';

export interface ChannelAccountBinding {
  id: string;
  label: string;
  enabled: boolean;
  agentId?: string;
  source: ChannelBindingSource;
  config: Record<string, unknown>;
}

export interface ChannelGroupView {
  id: string;
  enabled: boolean;
  known: boolean;
  config: ChannelConfig;
  accounts: ChannelAccountBinding[];
}

export type ChannelAccountReadinessState = 'ready' | 'disabled' | 'missing_credentials' | 'unbound' | 'unknown';

export interface ChannelAccountReadiness {
  state: ChannelAccountReadinessState;
  missingFields: string[];
  messages: string[];
}

export interface ChannelAgentOption {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface ChannelAccountRuntimeState {
  enabled?: boolean | null;
  configured?: boolean | null;
  linked?: boolean | null;
  running?: boolean | null;
  connected?: boolean | null;
  lastError?: string | null;
  probe?: unknown;
}

export interface ChannelConfigRepository {
  detect(): Promise<{ path: string; exists: boolean }>;
  read(): Promise<{ config: GatewayRuntimeConfig; revision?: string }>;
  write(config: GatewayRuntimeConfig, expectedRevision?: string): Promise<void>;
  restart(): Promise<{ success: boolean; error?: string } | null>;
}

type ChannelRouteBinding = NonNullable<GatewayRuntimeConfig['bindings']>[number];
const CHANNEL_CONFIG_SAVE_ATTEMPTS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function accountLabel(id: string, account: Record<string, unknown>) {
  const raw = account.name ?? account.label ?? account.accountName;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : id === 'default' ? 'Default' : id;
}

function routeBindingAgentId(
  bindings: GatewayRuntimeConfig['bindings'],
  channelId: string,
  accountId: string,
): string | undefined {
  const routes = (bindings ?? []).filter((binding) => (
    binding.type !== 'acp' && binding.match?.channel === channelId
  ));
  const specific = routes.find((binding) => binding.match.accountId === accountId && !binding.match.peer);
  const channelWide = routes.find((binding) => !binding.match.accountId && !binding.match.peer);
  return specific?.agentId ?? channelWide?.agentId;
}

export function getChannelAccounts(
  channelId: string,
  cfg: ChannelConfig,
  bindings?: GatewayRuntimeConfig['bindings'],
): ChannelAccountBinding[] {
  const accounts = cfg.accounts;
  if (isRecord(accounts)) {
    return Object.entries(accounts).map(([accountId, rawAccount]) => {
      const account = isRecord(rawAccount) ? rawAccount : {};
      return {
        id: accountId,
        label: accountLabel(accountId, account),
        enabled: account.enabled !== false && cfg.enabled !== false,
        agentId: routeBindingAgentId(bindings, channelId, accountId)
          ?? (typeof account.agentId === 'string' ? account.agentId : undefined),
        source: 'account',
        config: account,
      };
    });
  }

  return [{
    id: 'default',
    label: 'Default',
    enabled: cfg.enabled !== false,
    agentId: routeBindingAgentId(bindings, channelId, 'default')
      ?? (typeof cfg.agentId === 'string' ? cfg.agentId : undefined),
    source: 'channel',
    config: cfg,
  }];
}

export function buildChannelGroups(config: GatewayRuntimeConfig | null): ChannelGroupView[] {
  const channels = config?.channels ?? {};
  return Object.entries(channels)
    .filter(([id]) => !isChannelConfigurationMetadataKey(id))
    .map(([id, cfg]) => ({
      id,
      enabled: cfg?.enabled !== false,
      // 渠道是否已知由所选 Runtime 的目录判定，不能只凭配置内容认定。
      known: false,
      config: cfg,
      accounts: getChannelAccounts(id, cfg, config?.bindings),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 遵循所选 OpenClaw Runtime 的默认智能体契约：缺少 `agents.list` 时使用隐式
 * `main` 智能体；否则优先使用显式默认项，未指定时使用第一个已配置项。
 */
export function getChannelAgentOptions(config: GatewayRuntimeConfig | null): ChannelAgentOption[] {
  const configured = (config?.agents?.list ?? []).filter((agent) => (
    typeof agent?.id === 'string' && Boolean(agent.id.trim())
  ));
  if (configured.length === 0) {
    return [{ id: 'main', name: 'main', isDefault: true }];
  }
  const defaultAgentId = configured.find((agent) => agent.default === true)?.id.trim()
    ?? configured[0].id.trim();
  return configured.map((agent) => {
    const id = agent.id.trim();
    return {
      id,
      name: typeof agent.name === 'string' && agent.name.trim() ? agent.name.trim() : id,
      isDefault: id === defaultAgentId,
    };
  });
}

export function assessChannelAccountReadiness(
  _channelId: string,
  account: ChannelAccountBinding,
  runtime?: ChannelAccountRuntimeState,
): ChannelAccountReadiness {
  const messages: string[] = [];
  if (!account.enabled || runtime?.enabled === false) {
    messages.push('disabled');
    return { state: 'disabled', missingFields: [], messages };
  }

  if (!runtime) {
    messages.push('unknown');
    return { state: 'unknown', missingFields: [], messages };
  }
  if (runtime.configured === false || runtime.linked === false) {
    messages.push('missing_credentials');
    return { state: 'missing_credentials', missingFields: [], messages };
  }

  if (typeof runtime.lastError === 'string' && runtime.lastError.trim()) {
    messages.push('runtime_error');
    return { state: 'unknown', missingFields: [], messages };
  }
  if (runtime.running === false) {
    messages.push('stopped');
    return { state: 'unknown', missingFields: [], messages };
  }
  if (runtime.connected === false) {
    messages.push('disconnected');
    return { state: 'unknown', missingFields: [], messages };
  }
  if (isRecord(runtime.probe) && (runtime.probe.ok === false || runtime.probe.error)) {
    messages.push('probe_failed');
    return { state: 'unknown', missingFields: [], messages };
  }
  if (runtime.configured !== true && runtime.linked !== true) {
    messages.push('unknown');
    return { state: 'unknown', missingFields: [], messages };
  }

  // 根级 binding 只是覆盖项；没有显式绑定时由 OpenClaw 默认智能体接管，
  // 因而不能把官方向导配置完成的账号误判为不可用。
  messages.push(account.agentId ? 'ready' : 'default_agent');
  return { state: 'ready', missingFields: [], messages };
}

export function channelAccountEditorValues(
  account: ChannelAccountBinding | undefined,
): Record<string, unknown> {
  const config = account?.config ?? {};
  return {
    ...config,
    enabled: config.enabled !== false,
    name: accountLabel(account?.id ?? 'default', config) === 'Default'
      ? ''
      : accountLabel(account?.id ?? 'default', config),
    agentId: account?.agentId
      ?? (typeof config.agentId === 'string' ? config.agentId : ''),
  };
}

export function summarizeChannelReadiness(groups: ChannelGroupView[]) {
  const summary: Record<ChannelAccountReadinessState, number> = {
    ready: 0,
    disabled: 0,
    missing_credentials: 0,
    unbound: 0,
    unknown: 0,
  };

  for (const group of groups) {
    for (const account of group.accounts) {
      summary[assessChannelAccountReadiness(group.id, account).state] += 1;
    }
  }

  return summary;
}

export function updateChannelBinding(
  config: GatewayRuntimeConfig,
  channelId: string,
  account: Pick<ChannelAccountBinding, 'id' | 'source'>,
  agentId: string,
): GatewayRuntimeConfig {
  const channels = { ...(config.channels ?? {}) };
  const current = { ...(channels[channelId] ?? {}) };
  const accountId = account.id === 'default' && account.source === 'channel' ? undefined : account.id;
  const isManagedRoute = (binding: ChannelRouteBinding) => (
    binding.type !== 'acp'
    && binding.match?.channel === channelId
    && binding.match.accountId === accountId
    && !binding.match.peer
    && !binding.match.guildId
    && !binding.match.teamId
    && !binding.match.roles?.length
  );
  const bindings = (config.bindings ?? []).filter((binding) => !isManagedRoute(binding));
  if (account.source === 'account') {
    const accounts = { ...((isRecord(current.accounts) ? current.accounts : {}) as Record<string, Record<string, unknown>>) };
    const nextAccount = { ...(isRecord(accounts[account.id]) ? accounts[account.id] : {}) };
    delete nextAccount.agentId;
    accounts[account.id] = nextAccount;
    current.accounts = accounts;
  } else {
    delete current.agentId;
  }
  channels[channelId] = current;
  if (agentId) {
    bindings.push({
      type: 'route',
      agentId,
      match: { channel: channelId, ...(accountId ? { accountId } : {}) },
    });
  }
  return { ...config, channels, bindings };
}

export function updateChannelEnabled(config: GatewayRuntimeConfig, channelId: string, enabled: boolean): GatewayRuntimeConfig {
  const channels = { ...(config.channels ?? {}) };
  channels[channelId] = { ...(channels[channelId] ?? {}), enabled };
  return { ...config, channels };
}

export function removeChannel(config: GatewayRuntimeConfig, channelId: string): GatewayRuntimeConfig {
  const channels = { ...(config.channels ?? {}) };
  delete channels[channelId];
  const bindings = (config.bindings ?? []).filter((binding) => binding.match?.channel !== channelId);
  return { ...config, channels, bindings };
}

export function addChannel(config: GatewayRuntimeConfig, channelId: string): GatewayRuntimeConfig {
  const channels = { ...(config.channels ?? {}) };
  // 所有渠道专属默认值都由 Runtime 或插件拥有。
  channels[channelId] = { enabled: true };
  return { ...config, channels };
}

export function upsertChannelAccount(
  config: GatewayRuntimeConfig,
  channelId: string,
  account: Pick<ChannelAccountBinding, 'id' | 'source'>,
  accountConfig: Record<string, unknown>,
): GatewayRuntimeConfig {
  const requestedAgentId = typeof accountConfig.agentId === 'string' ? accountConfig.agentId : '';
  const cleanConfig = { ...accountConfig };
  delete cleanConfig.agentId;
  const channels = { ...(config.channels ?? {}) };
  const current = { ...(channels[channelId] ?? {}) };

  if (account.source === 'account') {
    const accounts = { ...((isRecord(current.accounts) ? current.accounts : {}) as Record<string, Record<string, unknown>>) };
    accounts[account.id] = cleanConfig;
    current.accounts = accounts;
    channels[channelId] = current;
    return updateChannelBinding({ ...config, channels }, channelId, account, requestedAgentId);
  }

  // 编辑器从当前完整对象开始，替换时保留未知官方字段，同时允许删除用户清空的字段。
  channels[channelId] = cleanConfig;
  return updateChannelBinding({ ...config, channels }, channelId, account, requestedAgentId);
}

export function addChannelAccount(
  config: GatewayRuntimeConfig,
  channelId: string,
  accountId: string,
  accountConfig: Record<string, unknown>,
): GatewayRuntimeConfig {
  return upsertChannelAccount(
    config,
    channelId,
    { id: accountId, source: 'account' },
    accountConfig,
  );
}

export function removeChannelAccount(
  config: GatewayRuntimeConfig,
  channelId: string,
  accountId: string,
): GatewayRuntimeConfig {
  const channels = { ...(config.channels ?? {}) };
  const current = { ...(channels[channelId] ?? {}) };
  const existingAccounts = current.accounts;
  if (!existingAccounts || typeof existingAccounts !== 'object' || Array.isArray(existingAccounts)) {
    return { ...config, channels };
  }

  const accounts = { ...existingAccounts };
  delete accounts[accountId];
  current.accounts = accounts;
  channels[channelId] = current;
  const bindings = (config.bindings ?? []).filter((binding) => !(
    binding.match?.channel === channelId && binding.match.accountId === accountId
  ));
  return { ...config, channels, bindings };
}

export function removeAgentChannelBindings(config: GatewayRuntimeConfig, agentId: string): { next: GatewayRuntimeConfig; removed: number } {
  const channels = config?.channels;
  let removed = 0;
  const bindings = (config.bindings ?? []).filter((binding) => {
    if (binding.agentId !== agentId) return true;
    removed += 1;
    return false;
  });
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
    return removed === 0
      ? { next: config, removed }
      : { next: { ...config, bindings }, removed };
  }
  const nextChannels: Record<string, ChannelConfig> = { ...channels };

  for (const [channelId, rawChannel] of Object.entries(channels)) {
    if (isChannelConfigurationMetadataKey(channelId) || !isRecord(rawChannel)) continue;

    const nextChannel: Record<string, unknown> = { ...rawChannel };
    if (nextChannel.agentId === agentId) {
      delete nextChannel.agentId;
      removed += 1;
    }

    const accounts = nextChannel.accounts;
    if (isRecord(accounts)) {
      let accountsChanged = false;
      const nextAccounts: Record<string, unknown> = { ...accounts };
      for (const [accountId, rawAccount] of Object.entries(accounts)) {
        if (!isRecord(rawAccount) || rawAccount.agentId !== agentId) continue;
        const nextAccount = { ...rawAccount };
        delete nextAccount.agentId;
        Reflect.set(nextAccounts, accountId, nextAccount);
        accountsChanged = true;
        removed += 1;
      }
      if (accountsChanged) nextChannel.accounts = nextAccounts;
    }

    Reflect.set(nextChannels, channelId, nextChannel);
  }

  if (removed === 0) return { next: config, removed };
  return { next: { ...config, channels: nextChannels, bindings }, removed };
}

export async function persistChannelsOnly(
  base: GatewayRuntimeConfig,
  next: GatewayRuntimeConfig,
): Promise<GatewayRuntimeConfig> {
  return persistChannelsOnlyWithRepository(gatewayChannelConfigRepository, base, next);
}

export const gatewayChannelConfigRepository: ChannelConfigRepository = {
  async detect() {
    const snapshot = await openClawRuntimeConfigClient.read();
    return { path: snapshot.path ?? '', exists: snapshot.exists };
  },
  async read() {
    const snapshot = await openClawRuntimeConfigClient.read();
    return { config: snapshot.config, revision: snapshot.hash };
  },
  async write(config: GatewayRuntimeConfig, expectedRevision?: string) {
    const snapshot = await openClawRuntimeConfigClient.read();
    if (snapshot.exists && snapshot.hash !== expectedRevision) {
      throw new Error(`${CONFIG_REVISION_CONFLICT_PREFIX}: Gateway config hash changed`);
    }
    const patchPlan = buildOpenClawConfigPatch(snapshot.config, config);
    await openClawRuntimeConfigClient.patch(patchPlan.patch, snapshot, patchPlan.replacePaths);
  },
  async restart() {
    const { gatewayLifecycle } = await import('@/runtime/gatewayLifecycle');
    return gatewayLifecycle.restart('channel-config-repository').catch(() => null);
  },
};

export async function persistChannelsOnlyWithRepository(
  repository: ChannelConfigRepository,
  base: GatewayRuntimeConfig,
  next: GatewayRuntimeConfig,
): Promise<GatewayRuntimeConfig> {
  let lastConflict: unknown;

  for (let attempt = 0; attempt < CHANNEL_CONFIG_SAVE_ATTEMPTS; attempt += 1) {
    const latest = await repository.read();
    const partitions = mergeChannelConfigPartitions(
      base,
      next,
      latest.config,
    );
    const merged: GatewayRuntimeConfig = {
      ...latest.config,
      channels: partitions.channels,
      bindings: partitions.bindings,
    };

    try {
      await repository.write(merged, latest.revision);
      return merged;
    } catch (error) {
      if (!isConfigRevisionConflict(error) || attempt + 1 === CHANNEL_CONFIG_SAVE_ATTEMPTS) {
        throw error;
      }
      lastConflict = error;
    }
  }

  throw lastConflict instanceof Error
    ? lastConflict
    : new Error('Unable to save channel configuration after concurrent updates.');
}

export async function cleanupDeletedAgentChannelBindings(agentId: string): Promise<number> {
  return cleanupDeletedAgentChannelBindingsWithRepository(gatewayChannelConfigRepository, agentId);
}

export async function cleanupDeletedAgentChannelBindingsWithRepository(
  repository: ChannelConfigRepository,
  agentId: string,
): Promise<number> {
  const detected = await repository.detect();
  if (!detected.exists) return 0;
  const { config } = await repository.read();
  const { next, removed } = removeAgentChannelBindings(config, agentId);
  if (removed === 0) return 0;
  await persistChannelsOnlyWithRepository(repository, config, next);
  window.dispatchEvent(new CustomEvent('aegis:config-saved', { detail: { channelsChanged: true, deletedAgentId: agentId } }));
  await repository.restart();
  return removed;
}
