import type { OpenClawFieldSchema } from './openclawConfigSchema';

export interface OfficialChannelCatalogEntry {
  id: string;
  accounts: string[];
  installed: boolean;
  origin: 'configured' | 'bundled' | 'installable' | string;
}

export interface OfficialChannelCatalog {
  version?: string;
  source: 'openclaw-cli' | 'offline-fallback';
  entries: OfficialChannelCatalogEntry[];
}

export interface OfficialChannelCapability {
  channel: string;
  accountId?: string;
  configured?: boolean;
  enabled?: boolean;
  label?: string;
  selectionLabel?: string;
  schema: Record<string, OpenClawFieldSchema>;
  required: string[];
  support: Record<string, unknown>;
  actions: string[];
  qrLogin: boolean;
}

export interface ChannelAccountRuntimeStatus {
  accountId: string;
  name?: string | null;
  enabled?: boolean | null;
  configured?: boolean | null;
  linked?: boolean | null;
  running?: boolean | null;
  connected?: boolean | null;
  lastError?: string | null;
  lastConnectedAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastProbeAt?: number | null;
  probe?: unknown;
  audit?: unknown;
  [key: string]: unknown;
}

export interface ChannelsRuntimeSnapshot {
  ts?: number;
  channelOrder?: string[];
  channelLabels?: Record<string, string>;
  channelAccounts?: Record<string, ChannelAccountRuntimeStatus[]>;
  channels?: Record<string, unknown>;
  partial?: boolean;
  warnings?: string[];
  gatewayReachable?: boolean;
  error?: string;
  configuredChannels?: string[];
}

export type ChannelLinkMode = 'embedded_qr' | 'terminal_setup' | 'none';
const CLI_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

let catalogPromise: Promise<OfficialChannelCatalog> | undefined;
const capabilityPromises = new Map<string, Promise<OfficialChannelCapability | null>>();
const OFFLINE_CHANNEL_IDS = [
  'telegram', 'whatsapp', 'discord', 'irc', 'googlechat', 'slack', 'signal', 'imessage',
  'feishu', 'dingtalk-connector', 'openclaw-weixin', 'wecom', 'nostr', 'msteams', 'mattermost',
  'nextcloud-talk', 'matrix', 'raft', 'line', 'zalo', 'clickclack', 'zalouser', 'sms',
  'synology-chat', 'tlon', 'qqbot', 'twitch',
];

export const OFFLINE_CHANNEL_CATALOG: OfficialChannelCatalog = {
  source: 'offline-fallback',
  entries: OFFLINE_CHANNEL_IDS.map((id) => ({ id, accounts: [], installed: false, origin: 'offline-fallback' })),
};

export function assertChannelCliIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!CLI_IDENTIFIER.test(normalized)) throw new Error(`${label} contains unsupported characters.`);
  return normalized;
}

export function normalizeOfficialChannelCatalog(payload: unknown): OfficialChannelCatalog {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const chat = root.chat && typeof root.chat === 'object' && !Array.isArray(root.chat)
    ? root.chat as Record<string, unknown>
    : {};
  return {
    version: typeof root.version === 'string' ? root.version : undefined,
    source: 'openclaw-cli',
    entries: Object.entries(chat).map(([id, raw]) => {
      const entry = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      return {
        id,
        accounts: Array.isArray(entry.accounts)
          ? entry.accounts.filter((account): account is string => typeof account === 'string')
          : [],
        installed: entry.installed === true,
        origin: typeof entry.origin === 'string' ? entry.origin : 'installable',
      };
    }),
  };
}

export function loadOfficialChannelCatalog(force = false): Promise<OfficialChannelCatalog> {
  if (force || !catalogPromise) {
    catalogPromise = window.aegis.channelRuntime.catalog()
      .then(normalizeOfficialChannelCatalog)
      .catch(() => OFFLINE_CHANNEL_CATALOG);
  }
  return catalogPromise;
}

function firstCapabilityRow(payload: unknown): Record<string, any> | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const rows = (payload as Record<string, unknown>).channels;
  return Array.isArray(rows) && rows[0] && typeof rows[0] === 'object'
    ? rows[0] as Record<string, any>
    : undefined;
}

export function normalizeOfficialChannelCapability(payload: unknown): OfficialChannelCapability | null {
  const row = firstCapabilityRow(payload);
  if (!row || typeof row.channel !== 'string') return null;
  const plugin = row.plugin && typeof row.plugin === 'object' ? row.plugin : {};
  const meta = plugin.meta && typeof plugin.meta === 'object' ? plugin.meta : {};
  const schemaRoot = plugin.configSchema?.schema;
  const schema = schemaRoot?.properties && typeof schemaRoot.properties === 'object'
    ? schemaRoot.properties as Record<string, OpenClawFieldSchema>
    : {};
  return {
    channel: row.channel,
    accountId: typeof row.accountId === 'string' ? row.accountId : undefined,
    configured: row.configured === true,
    enabled: row.enabled !== false,
    label: typeof meta.label === 'string' ? meta.label : undefined,
    selectionLabel: typeof meta.selectionLabel === 'string' ? meta.selectionLabel : undefined,
    schema,
    required: Array.isArray(schemaRoot?.required)
      ? schemaRoot.required.filter((field: unknown): field is string => typeof field === 'string')
      : [],
    support: row.support && typeof row.support === 'object' ? row.support : {},
    actions: Array.isArray(row.actions)
      ? row.actions.filter((action: unknown): action is string => typeof action === 'string')
      : [],
    qrLogin: row.qrLogin === true,
  };
}

export function loadOfficialChannelCapability(
  channelId: string,
  force = false,
): Promise<OfficialChannelCapability | null> {
  const channel = assertChannelCliIdentifier(channelId, 'Channel ID');
  if (force) capabilityPromises.delete(channel);
  let pending = capabilityPromises.get(channel);
  if (!pending) {
    pending = window.aegis.channelRuntime.capabilities(channel)
      .then(normalizeOfficialChannelCapability)
      .catch((error) => {
        capabilityPromises.delete(channel);
        throw error;
      });
    capabilityPromises.set(channel, pending);
  }
  return pending;
}

export function channelLinkMode(
  capability: OfficialChannelCapability | null | undefined,
  installed: boolean,
): ChannelLinkMode {
  if (!installed) return 'terminal_setup';
  if (capability?.qrLogin) return 'embedded_qr';
  return 'none';
}

export function buildChannelSetupCommand(channelId: string, accountId?: string): string {
  const channel = assertChannelCliIdentifier(channelId, 'Channel ID');
  const account = accountId?.trim()
    ? ` --account ${assertChannelCliIdentifier(accountId, 'Account ID')}`
    : '';
  return `openclaw channels add --channel ${channel}${account}\n`;
}

const SENSITIVE_KEY = /(token|secret|password|passwd|cookie|authorization|private.?key|api.?key|credential)$/i;

export function redactChannelSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactChannelSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactChannelSecrets(nested),
  ]));
}

export function channelAccountStatus(
  snapshot: ChannelsRuntimeSnapshot | null,
  channelId: string,
  accountId: string,
): ChannelAccountRuntimeStatus | undefined {
  const rows = snapshot?.channelAccounts?.[channelId] ?? [];
  return rows.find((row) => row.accountId === accountId)
    ?? (accountId === 'default' ? rows[0] : undefined);
}
