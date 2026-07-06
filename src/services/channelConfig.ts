import type { ChannelConfig, GatewayRuntimeConfig } from '@/pages/ConfigManager/types';
import { getChannelTemplate } from '@/pages/ConfigManager/channelTemplates';

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

export type ChannelAccountReadinessState = 'ready' | 'disabled' | 'missing_credentials' | 'unbound';

export interface ChannelAccountReadiness {
  state: ChannelAccountReadinessState;
  missingFields: string[];
  messages: string[];
}

export interface ChannelConfigRepository {
  detect(): Promise<{ path: string; exists: boolean }>;
  read(path: string): Promise<GatewayRuntimeConfig>;
  write(path: string, config: GatewayRuntimeConfig): Promise<void>;
  restart(): Promise<{ success: boolean; error?: string } | null>;
}

const CHANNEL_ORDER = ['feishu', 'dingtalk', 'wecom', 'wechat', 'telegram', 'discord', 'slack', 'whatsapp', 'qqbot'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function accountLabel(id: string, account: Record<string, unknown>) {
  const raw = account.name ?? account.label ?? account.accountName;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : id === 'default' ? 'Default' : id;
}

export function getChannelAccounts(cfg: ChannelConfig): ChannelAccountBinding[] {
  const accounts = cfg.accounts;
  if (isRecord(accounts)) {
    return Object.entries(accounts).map(([accountId, rawAccount]) => {
      const account = isRecord(rawAccount) ? rawAccount : {};
      return {
        id: accountId,
        label: accountLabel(accountId, account),
        enabled: account.enabled !== false && cfg.enabled !== false,
        agentId: typeof account.agentId === 'string' ? account.agentId : undefined,
        source: 'account',
        config: account,
      };
    });
  }

  return [{
    id: 'default',
    label: 'Default',
    enabled: cfg.enabled !== false,
    agentId: typeof cfg.agentId === 'string' ? cfg.agentId : undefined,
    source: 'channel',
    config: cfg,
  }];
}

export function buildChannelGroups(config: GatewayRuntimeConfig | null): ChannelGroupView[] {
  const channels = config?.channels ?? {};
  return Object.entries(channels)
    .filter(([id]) => id !== 'modelByChannel')
    .map(([id, cfg]) => ({
      id,
      enabled: cfg?.enabled !== false,
      known: Boolean(getChannelTemplate(id)),
      config: cfg,
      accounts: getChannelAccounts(cfg),
    }))
    .sort((a, b) => {
      const ia = CHANNEL_ORDER.indexOf(a.id);
      const ib = CHANNEL_ORDER.indexOf(b.id);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.id.localeCompare(b.id);
    });
}

function hasUsableValue(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
}

export function getRequiredCredentialFields(channelId: string): string[] {
  const tmpl = getChannelTemplate(channelId);
  if (!tmpl) return [];
  const fields: string[] = [];
  if (tmpl.id === 'feishu') {
    fields.push('appId', 'appSecret');
  }
  if (tmpl.id === 'dingtalk') {
    fields.push('appKey', 'appSecret', 'robotCode');
  }
  if (tmpl.tokenField) {
    fields.push(tmpl.tokenField);
  }
  return fields;
}

export function assessChannelAccountReadiness(
  channelId: string,
  account: ChannelAccountBinding,
): ChannelAccountReadiness {
  const messages: string[] = [];
  if (!account.enabled) {
    messages.push('disabled');
    return { state: 'disabled', missingFields: [], messages };
  }

  const missingFields = getRequiredCredentialFields(channelId)
    .filter((field) => !hasUsableValue(account.config[field]));
  if (missingFields.length > 0) {
    messages.push('missing_credentials');
    return { state: 'missing_credentials', missingFields, messages };
  }

  if (!account.agentId) {
    messages.push('unbound');
    return { state: 'unbound', missingFields: [], messages };
  }

  messages.push('ready');
  return { state: 'ready', missingFields: [], messages };
}

export function summarizeChannelReadiness(groups: ChannelGroupView[]) {
  const summary: Record<ChannelAccountReadinessState, number> = {
    ready: 0,
    disabled: 0,
    missing_credentials: 0,
    unbound: 0,
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
  if (account.source === 'account') {
    const accounts = { ...((isRecord(current.accounts) ? current.accounts : {}) as Record<string, Record<string, unknown>>) };
    const nextAccount = { ...(isRecord(accounts[account.id]) ? accounts[account.id] : {}) };
    if (agentId) nextAccount.agentId = agentId;
    else delete nextAccount.agentId;
    accounts[account.id] = nextAccount;
    current.accounts = accounts;
  } else {
    if (agentId) current.agentId = agentId;
    else delete current.agentId;
  }
  channels[channelId] = current;
  return { ...config, channels };
}

export function updateChannelEnabled(config: GatewayRuntimeConfig, channelId: string, enabled: boolean): GatewayRuntimeConfig {
  const channels = { ...(config.channels ?? {}) };
  channels[channelId] = { ...(channels[channelId] ?? {}), enabled };
  return { ...config, channels };
}

export function removeChannel(config: GatewayRuntimeConfig, channelId: string): GatewayRuntimeConfig {
  const channels = { ...(config.channels ?? {}) };
  delete channels[channelId];
  return { ...config, channels };
}

export function addChannel(config: GatewayRuntimeConfig, channelId: string): GatewayRuntimeConfig {
  const tmpl = getChannelTemplate(channelId);
  const channels = { ...(config.channels ?? {}) };
  channels[channelId] = {
    enabled: true,
    ...(tmpl?.defaultDmPolicy ? { dmPolicy: tmpl.defaultDmPolicy } : {}),
    ...(tmpl?.defaultGroupPolicy ? { groupPolicy: tmpl.defaultGroupPolicy } : {}),
    ...(tmpl?.defaultStreaming ? { streaming: tmpl.id === 'feishu' ? tmpl.defaultStreaming !== 'off' : { mode: tmpl.defaultStreaming } } : {}),
  };
  return { ...config, channels };
}

export function upsertChannelAccount(
  config: GatewayRuntimeConfig,
  channelId: string,
  account: Pick<ChannelAccountBinding, 'id' | 'source'>,
  accountConfig: Record<string, unknown>,
): GatewayRuntimeConfig {
  const channels = { ...(config.channels ?? {}) };
  const current = { ...(channels[channelId] ?? {}) };

  if (account.source === 'account') {
    const accounts = { ...((isRecord(current.accounts) ? current.accounts : {}) as Record<string, Record<string, unknown>>) };
    accounts[account.id] = { ...accountConfig };
    current.accounts = accounts;
    channels[channelId] = current;
    return { ...config, channels };
  }

  channels[channelId] = {
    ...current,
    ...accountConfig,
  };
  return { ...config, channels };
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
  if (!isRecord(current.accounts)) return { ...config, channels };

  const accounts = { ...(current.accounts as Record<string, unknown>) };
  delete accounts[accountId];
  current.accounts = accounts;
  channels[channelId] = current;
  return { ...config, channels };
}

export function removeAgentChannelBindings(config: GatewayRuntimeConfig, agentId: string): { next: GatewayRuntimeConfig; removed: number } {
  const channels = config?.channels;
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
    return { next: config, removed: 0 };
  }

  let removed = 0;
  const nextChannels: Record<string, any> = { ...channels };

  for (const [channelId, rawChannel] of Object.entries(channels as Record<string, any>)) {
    if (channelId === 'modelByChannel' || !isRecord(rawChannel)) continue;

    const nextChannel: Record<string, any> = { ...rawChannel };
    if (nextChannel.agentId === agentId) {
      delete nextChannel.agentId;
      removed += 1;
    }

    const accounts = nextChannel.accounts;
    if (isRecord(accounts)) {
      let accountsChanged = false;
      const nextAccounts: Record<string, any> = { ...accounts };
      for (const [accountId, rawAccount] of Object.entries(accounts)) {
        if (!isRecord(rawAccount) || rawAccount.agentId !== agentId) continue;
        const nextAccount = { ...rawAccount };
        delete nextAccount.agentId;
        nextAccounts[accountId] = nextAccount;
        accountsChanged = true;
        removed += 1;
      }
      if (accountsChanged) nextChannel.accounts = nextAccounts;
    }

    nextChannels[channelId] = nextChannel;
  }

  if (removed === 0) return { next: config, removed };
  return { next: { ...config, channels: nextChannels }, removed };
}

export async function persistChannelsOnly(configPath: string, next: GatewayRuntimeConfig): Promise<GatewayRuntimeConfig> {
  return persistChannelsOnlyWithRepository(tauriChannelConfigRepository, configPath, next);
}

export const tauriChannelConfigRepository: ChannelConfigRepository = {
  async detect() {
    return window.aegis.config.detect();
  },
  async read(path: string) {
    const { data } = await window.aegis.config.read(path);
    return data as GatewayRuntimeConfig;
  },
  async write(path: string, config: GatewayRuntimeConfig) {
    const result = await window.aegis.config.write(path, config);
    if (result?.success === false) {
      throw new Error(result.error || 'Failed to write config');
    }
  },
  async restart() {
    return window.aegis.config.restart().catch(() => null);
  },
};

export async function persistChannelsOnlyWithRepository(
  repository: ChannelConfigRepository,
  configPath: string,
  next: GatewayRuntimeConfig,
): Promise<GatewayRuntimeConfig> {
  const latestDiskConfig = await repository.read(configPath);
  const merged = {
    ...(latestDiskConfig as GatewayRuntimeConfig),
    channels: next.channels ?? {},
  };
  await repository.write(configPath, merged);
  return merged;
}

export async function cleanupDeletedAgentChannelBindings(agentId: string): Promise<number> {
  return cleanupDeletedAgentChannelBindingsWithRepository(tauriChannelConfigRepository, agentId);
}

export async function cleanupDeletedAgentChannelBindingsWithRepository(
  repository: ChannelConfigRepository,
  agentId: string,
): Promise<number> {
  const detected = await repository.detect();
  if (!detected.exists) return 0;
  const data = await repository.read(detected.path);
  const { next, removed } = removeAgentChannelBindings(data, agentId);
  if (removed === 0) return 0;
  await persistChannelsOnlyWithRepository(repository, detected.path, next);
  window.dispatchEvent(new CustomEvent('aegis:config-saved', { detail: { channelsChanged: true, deletedAgentId: agentId } }));
  await repository.restart();
  return removed;
}
