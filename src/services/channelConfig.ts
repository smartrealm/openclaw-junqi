import type { ChannelConfig, GatewayRuntimeConfig } from '@/types/openclawConfig';
import {
  CONFIG_REVISION_CONFLICT_PREFIX,
  isChannelConfigurationMetadataKey,
  isConfigRevisionConflict,
  mergeChannelConfigPartitions,
} from './channelConfigMerge';
import { openClawRuntimeConfigClient } from './gateway';

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
      // Recognition belongs to the selected Runtime catalog. Config parsing
      // alone cannot declare a channel known.
      known: false,
      config: cfg,
      accounts: getChannelAccounts(id, cfg, config?.bindings),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Mirrors OpenClaw's selected-Runtime default-agent contract: an absent
 * `agents.list` means the implicit `main` agent; otherwise the explicitly
 * default entry wins, falling back to the first configured entry.
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

function hasUsableValue(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
}

export function getRequiredCredentialFields(channelId: string): string[] {
  // DingTalk is the only JunQi-managed external plugin and therefore the only
  // reviewed channel-specific exception. All other requirements come from the
  // selected Runtime's capability schema/status, never from Desktop metadata.
  return channelId === 'dingtalk-connector' ? ['clientId', 'clientSecret'] : [];
}

export function assessChannelAccountReadiness(
  channelId: string,
  account: ChannelAccountBinding,
  runtime?: ChannelAccountRuntimeState,
): ChannelAccountReadiness {
  const messages: string[] = [];
  if (!account.enabled || runtime?.enabled === false) {
    messages.push('disabled');
    return { state: 'disabled', missingFields: [], messages };
  }

  const reviewedLocalRequirements = getRequiredCredentialFields(channelId);
  const missingFields = runtime
    ? []
    : reviewedLocalRequirements.filter((field) => !hasUsableValue(account.config[field]));
  if (!runtime && reviewedLocalRequirements.length === 0) {
    messages.push('unknown');
    return { state: 'unknown', missingFields: [], messages };
  }
  const runtimeMissing = runtime?.configured === false || runtime?.linked === false;
  if (runtimeMissing || missingFields.length > 0) {
    messages.push('missing_credentials');
    return { state: 'missing_credentials', missingFields, messages };
  }

  // Root bindings are overrides. OpenClaw routes an unmatched channel/account
  // to its selected default agent, so absence of an explicit binding is not a
  // delivery failure and must not make a healthy Wizard-configured account
  // appear unusable.
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
  // The Runtime/plugin owns every channel-specific default.
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

  // The editor starts from the complete current object, so replacement keeps
  // unknown official fields while allowing a user-cleared field to disappear.
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

function hasManagedBinding(
  bindings: ChannelRouteBinding[],
  channelId: string,
  accountId: string | undefined,
): boolean {
  return bindings.some((binding) => (
    binding.type !== 'acp'
    && binding.match?.channel === channelId
    && binding.match.accountId === accountId
    && !binding.match.peer
    && !binding.match.guildId
    && !binding.match.teamId
    && !binding.match.roles?.length
  ));
}

function migrateLegacyDingtalkFields(value: Record<string, unknown>): Record<string, unknown> {
  const next = { ...value };
  if (next.clientId === undefined && next.appKey !== undefined) next.clientId = next.appKey;
  if (next.clientSecret === undefined && next.appSecret !== undefined) next.clientSecret = next.appSecret;
  if (next.endpoint === undefined && next.callbackUrl !== undefined) next.endpoint = next.callbackUrl;
  delete next.appKey;
  delete next.appSecret;
  delete next.robotCode;
  delete next.callbackUrl;
  delete next.useStream;
  return next;
}

export function migrateLegacyChannelBindings(config: GatewayRuntimeConfig): GatewayRuntimeConfig {
  const bindings = (config.bindings ?? []).map((binding) => (
    binding.match?.channel === 'dingtalk'
      ? { ...binding, match: { ...binding.match, channel: 'dingtalk-connector' } }
      : binding
  ));
  const channels: Record<string, ChannelConfig> = {};
  for (const [channelId, rawChannel] of Object.entries(config.channels ?? {})) {
    if (isChannelConfigurationMetadataKey(channelId)) {
      Reflect.set(channels, channelId, rawChannel);
      continue;
    }
    const officialChannelId = channelId === 'dingtalk' ? 'dingtalk-connector' : channelId;
    const channel: Record<string, unknown> = channelId === 'dingtalk'
      ? migrateLegacyDingtalkFields({ ...(rawChannel ?? {}) })
      : { ...(rawChannel ?? {}) };
    const channelAgentId = typeof channel.agentId === 'string' ? channel.agentId.trim() : '';
    delete channel.agentId;
    if (channelAgentId && !hasManagedBinding(bindings, officialChannelId, undefined)) {
      bindings.push({ type: 'route', agentId: channelAgentId, match: { channel: officialChannelId } });
    }
    if (isRecord(channel.accounts)) {
      const accounts: Record<string, unknown> = {};
      for (const [accountId, rawAccount] of Object.entries(channel.accounts)) {
        const rawAccountRecord = isRecord(rawAccount) ? { ...rawAccount } : {};
        const account = channelId === 'dingtalk'
          ? migrateLegacyDingtalkFields(rawAccountRecord)
          : rawAccountRecord;
        const accountAgentId = typeof account.agentId === 'string' ? account.agentId.trim() : '';
        delete account.agentId;
        if (accountAgentId && !hasManagedBinding(bindings, officialChannelId, accountId)) {
          bindings.push({ type: 'route', agentId: accountAgentId, match: { channel: officialChannelId, accountId } });
        }
        accounts[accountId] = account;
      }
      channel.accounts = accounts;
    }
    Reflect.set(channels, officialChannelId, {
      ...(channels[officialChannelId] ?? {}),
      ...channel,
    });
  }
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
    await openClawRuntimeConfigClient.replace(config, snapshot);
  },
  async restart() {
    const { gatewayLifecycle } = await import('@/services/gateway/gatewayLifecycle');
    return gatewayLifecycle.restart('channel-config-repository').catch(() => null);
  },
};

export async function persistChannelsOnlyWithRepository(
  repository: ChannelConfigRepository,
  base: GatewayRuntimeConfig,
  next: GatewayRuntimeConfig,
): Promise<GatewayRuntimeConfig> {
  const normalizedBase = migrateLegacyChannelBindings(base);
  const normalizedNext = migrateLegacyChannelBindings(next);
  let lastConflict: unknown;

  for (let attempt = 0; attempt < CHANNEL_CONFIG_SAVE_ATTEMPTS; attempt += 1) {
    const latest = await repository.read();
    const partitions = mergeChannelConfigPartitions(
      normalizedBase,
      normalizedNext,
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
