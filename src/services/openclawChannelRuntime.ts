import type { OpenClawFieldSchema } from './openclawConfigSchema';
import {
  getOpenclawChannelCapabilities,
  getOpenclawChannelCatalog,
  getOpenclawChannelLogs,
  getOpenclawChannelStatus,
  installOpenclawChannelPlugin,
} from '@/api/tauri-commands';

export interface OfficialChannelCatalogEntry {
  id: string;
  accounts: string[];
  installed: boolean;
  origin: 'configured' | 'bundled' | 'installable' | string;
  /** Native runtime explicitly authorizes JunQi to install this channel. */
  managedInstall: boolean;
}

export interface OfficialChannelCatalog {
  version?: string;
  source: 'openclaw-cli' | 'unavailable';
  entries: OfficialChannelCatalogEntry[];
}

export interface OfficialChannelPluginInstallResult {
  channel: string;
  alreadyInstalled: boolean;
  installed: boolean;
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
  gatewayMethods: string[];
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
  channelDetailLabels?: Record<string, string>;
  /** Icon semantic from the selected OpenClaw Runtime, not a JunQi channel map. */
  channelSystemImages?: Record<string, string>;
  channelMeta?: Array<{
    id: string;
    label: string;
    detailLabel: string;
    systemImage?: string;
  }>;
  channelAccounts?: Record<string, ChannelAccountRuntimeStatus[]>;
  channels?: Record<string, unknown>;
  partial?: boolean;
  warnings?: string[];
  gatewayReachable?: boolean;
  error?: string;
  configuredChannels?: string[];
}

const CLI_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

export function channelErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  const object = asJsonObject(error);
  const message = object?.message;
  return typeof message === 'string' && message.trim() ? message.trim() : String(error);
}

export function isOpenClawChannelIdentifier(value: string): boolean {
  return CLI_IDENTIFIER.test(value.trim());
}

export function assertChannelCliIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!isOpenClawChannelIdentifier(normalized)) throw new Error(`${label} contains unsupported characters.`);
  return normalized;
}

export async function installManagedExternalChannelPlugin(
  channelId: string,
): Promise<OfficialChannelPluginInstallResult> {
  const channel = assertChannelCliIdentifier(channelId, 'Channel ID');
  const result = await installOpenclawChannelPlugin(channel) as OfficialChannelPluginInstallResult;
  if (!result || result.channel !== channel || result.installed !== true) {
    throw new Error('OpenClaw did not confirm that the channel plugin was installed.');
  }
  return result;
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
        managedInstall: entry.managedInstall === true,
      };
    }),
  };
}

export async function loadOfficialChannelCatalog(_force = false): Promise<OfficialChannelCatalog> {
  // 不使用 JunQi 自建渠道清单。所选 OpenClaw Runtime 是唯一目录权威，每次加载都重新读取，
  // 以便 OpenClaw 升级或插件变化无需重启 JunQi 即可呈现。失败必须传递给页面，不能用空目录
  // 混淆“Runtime 加载失败”与“OpenClaw 没有渠道”。
  return normalizeOfficialChannelCatalog(await getOpenclawChannelCatalog());
}

function capabilityRows(payload: unknown): JsonObject[] {
  const root = asJsonObject(payload);
  const rows = root?.channels;
  return Array.isArray(rows)
    ? rows.map(asJsonObject).filter((row): row is JsonObject => Boolean(row))
    : [];
}

function normalizeCapabilityRow(row: JsonObject): OfficialChannelCapability | null {
  if (!row || typeof row.channel !== 'string') return null;
  const plugin = asJsonObject(row.plugin);
  const meta = asJsonObject(plugin?.meta);
  const configSchema = asJsonObject(plugin?.configSchema);
  const schemaRoot = asJsonObject(configSchema?.schema);
  const schema = asJsonObject(schemaRoot?.properties) as Record<string, OpenClawFieldSchema> | undefined;
  const gatewayMethodDescriptors = Array.isArray(plugin?.gatewayMethodDescriptors)
    ? plugin.gatewayMethodDescriptors
      .map((descriptor) => asJsonObject(descriptor)?.name)
      .filter((method): method is string => typeof method === 'string')
    : [];
  return {
    channel: row.channel,
    accountId: typeof row.accountId === 'string' ? row.accountId : undefined,
    configured: row.configured === true,
    enabled: row.enabled !== false,
    label: typeof meta?.label === 'string' ? meta.label : undefined,
    selectionLabel: typeof meta?.selectionLabel === 'string' ? meta.selectionLabel : undefined,
    schema: schema ?? {},
    required: Array.isArray(schemaRoot?.required)
      ? schemaRoot.required.filter((field: unknown): field is string => typeof field === 'string')
      : [],
    support: asJsonObject(row.support) ?? {},
    actions: Array.isArray(row.actions)
      ? row.actions.filter((action: unknown): action is string => typeof action === 'string')
      : [],
    gatewayMethods: Array.from(new Set([
      ...(Array.isArray(plugin?.gatewayMethods)
        ? plugin.gatewayMethods.filter((method): method is string => typeof method === 'string')
        : []),
      ...gatewayMethodDescriptors,
    ])),
  };
}

export function normalizeOfficialChannelCapabilities(payload: unknown): OfficialChannelCapability[] {
  return capabilityRows(payload)
    .map(normalizeCapabilityRow)
    .filter((row): row is OfficialChannelCapability => row !== null);
}

export function normalizeOfficialChannelCapability(payload: unknown): OfficialChannelCapability | null {
  return normalizeOfficialChannelCapabilities(payload)[0] ?? null;
}

export function selectOfficialChannelCapability(
  capabilities: OfficialChannelCapability[],
  channelId: string,
  accountId?: string,
): OfficialChannelCapability | null {
  const channelRows = capabilities.filter((row) => row.channel === channelId);
  const pluginContracts = new Set(channelRows.map((row) => JSON.stringify({
    schema: row.schema,
    required: row.required,
    gatewayMethods: [...row.gatewayMethods].sort(),
  })));
  if (pluginContracts.size > 1) return null;
  if (accountId) {
    const accountRow = channelRows.find((row) => row.accountId === accountId);
    if (accountRow) return accountRow;
  }
  return channelRows[0] ?? null;
}

export function loadOfficialChannelCapability(
  channelId: string,
  _force = false,
): Promise<OfficialChannelCapability | null> {
  const channel = assertChannelCliIdentifier(channelId, 'Channel ID');
  // capability 属于所选 OpenClaw Runtime，升级或插件操作后可能变化，因此每次重新读取，
  // 不保留覆盖整个渲染进程生命周期的 JunQi 缓存。
  return getOpenclawChannelCapabilities(channel)
    .then(normalizeOfficialChannelCapability);
}

export function loadOfficialChannelCapabilities(channelId: string): Promise<OfficialChannelCapability[]> {
  const channel = assertChannelCliIdentifier(channelId, 'Channel ID');
  return getOpenclawChannelCapabilities(channel)
    .then(normalizeOfficialChannelCapabilities);
}

export async function resolveUniqueWebLoginProvider(
  catalog: OfficialChannelCatalog,
): Promise<string | null> {
  const installed = catalog.entries.filter((entry) => entry.installed);
  const capabilities = await Promise.all(installed.map(async (entry) => ({
    channelId: entry.id,
    rows: await loadOfficialChannelCapabilities(entry.id).catch(() => []),
  })));
  const providers = capabilities.filter(({ rows }) => rows.length > 0 && rows.every((row) => (
    row.gatewayMethods.includes('web.login.start')
    && row.gatewayMethods.includes('web.login.wait')
  )));
  return providers.length === 1 ? providers[0].channelId : null;
}

export function loadOfficialChannelStatus(channel?: string, probe = false): Promise<unknown> {
  return getOpenclawChannelStatus(channel, probe);
}

export type OpenClawChannelStatusCall = (
  method: 'channels.status',
  params: { probe: boolean; timeoutMs: number; channel?: string },
) => Promise<unknown>;

export async function loadOfficialChannelRuntimeState(
  call: OpenClawChannelStatusCall,
  channel?: string,
  probe = false,
): Promise<unknown> {
  const params = {
    probe,
    timeoutMs: probe ? 15000 : 8000,
    ...(channel ? { channel } : {}),
  };
  try {
    return await call('channels.status', params);
  } catch {
    // Gateway RPC 不可用时仍由所选 Runtime 的官方 CLI 返回配置态或探测结果，
    // 页面不自行解释连接失败，也不把空数据伪装成无渠道。
    return loadOfficialChannelStatus(channel, probe);
  }
}

export function loadOfficialChannelLogs(channel?: string, lines = 200): Promise<unknown> {
  return getOpenclawChannelLogs(channel, lines);
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

export function runtimeChannelIds(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const runtime = snapshot as ChannelsRuntimeSnapshot;
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && isOpenClawChannelIdentifier(value)) ids.add(value.trim());
  };
  runtime.channelOrder?.forEach(add);
  runtime.configuredChannels?.forEach(add);
  Object.keys(runtime.channelAccounts ?? {}).forEach(add);
  Object.keys(runtime.channels ?? {}).forEach(add);
  return Array.from(ids);
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
