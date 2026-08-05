export const OPENCLAW_TOOLS_EFFECTIVE_METHOD = 'tools.effective' as const;

export type OpenClawToolsEffectiveSource = 'core' | 'plugin' | 'channel' | 'mcp';
export type OpenClawToolsEffectiveRisk = 'low' | 'medium' | 'high';
export type OpenClawToolsEffectiveNoticeSeverity = 'info' | 'warning';

export interface OpenClawToolsEffectiveInput {
  readonly sessionKey: string;
  readonly agentId?: string;
}

export interface OpenClawToolsEffectiveEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly rawDescription: string;
  readonly source: OpenClawToolsEffectiveSource;
  readonly pluginId?: string;
  readonly channelId?: string;
  readonly mcpServer?: string;
  readonly mcpToolName?: string;
  readonly deniedBySession?: true;
  readonly risk?: OpenClawToolsEffectiveRisk;
  readonly tags?: readonly string[];
}

export interface OpenClawToolsEffectiveGroup {
  readonly id: OpenClawToolsEffectiveSource;
  readonly label: string;
  readonly source: OpenClawToolsEffectiveSource;
  readonly tools: readonly OpenClawToolsEffectiveEntry[];
}

export interface OpenClawToolsEffectiveNotice {
  readonly id: string;
  readonly severity: OpenClawToolsEffectiveNoticeSeverity;
  readonly message: string;
  readonly servers?: readonly string[];
}

export interface OpenClawToolsEffectiveResult {
  readonly agentId: string;
  readonly profile: string;
  readonly groups: readonly OpenClawToolsEffectiveGroup[];
  readonly notices?: readonly OpenClawToolsEffectiveNotice[];
}

export type OpenClawToolsEffectiveRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawToolsEffectiveResponseError extends Error {
  readonly code = 'OPENCLAW_TOOLS_EFFECTIVE_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid tools.effective response');
    this.name = 'OpenClawToolsEffectiveResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = nonEmptyString(value);
  if (!normalized) throw new OpenClawToolsEffectiveResponseError();
  return normalized;
}

function optionalTags(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new OpenClawToolsEffectiveResponseError();
  const tags = value.map(nonEmptyString);
  if (tags.some((tag) => !tag)) throw new OpenClawToolsEffectiveResponseError();
  return tags as string[];
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new OpenClawToolsEffectiveResponseError();
  }
  return value as T;
}

const SOURCES: readonly OpenClawToolsEffectiveSource[] = ['core', 'plugin', 'channel', 'mcp'];
const RISKS: readonly OpenClawToolsEffectiveRisk[] = ['low', 'medium', 'high'];
const NOTICE_SEVERITIES: readonly OpenClawToolsEffectiveNoticeSeverity[] = ['info', 'warning'];

function parseEntry(value: unknown): OpenClawToolsEffectiveEntry {
  const source = record(value);
  const id = source ? nonEmptyString(source.id) : null;
  const label = source ? nonEmptyString(source.label) : null;
  if (
    !source
    || !id
    || !label
    || typeof source.description !== 'string'
    || typeof source.rawDescription !== 'string'
  ) {
    throw new OpenClawToolsEffectiveResponseError();
  }
  if (source.deniedBySession !== undefined && source.deniedBySession !== true) {
    throw new OpenClawToolsEffectiveResponseError();
  }
  const pluginId = optionalString(source.pluginId);
  const channelId = optionalString(source.channelId);
  const mcpServer = optionalString(source.mcpServer);
  const mcpToolName = optionalString(source.mcpToolName);
  const tags = optionalTags(source.tags);
  const entry: OpenClawToolsEffectiveEntry = {
    id,
    label,
    description: source.description,
    rawDescription: source.rawDescription,
    source: oneOf(source.source, SOURCES),
    ...(pluginId ? { pluginId } : {}),
    ...(channelId ? { channelId } : {}),
    ...(mcpServer ? { mcpServer } : {}),
    ...(mcpToolName ? { mcpToolName } : {}),
    ...(source.deniedBySession === true ? { deniedBySession: true } : {}),
    ...(source.risk !== undefined ? { risk: oneOf(source.risk, RISKS) } : {}),
    ...(tags ? { tags } : {}),
  };
  return entry;
}

function parseGroup(value: unknown): OpenClawToolsEffectiveGroup {
  const source = record(value);
  const id = source ? nonEmptyString(source.id) : null;
  const label = source ? nonEmptyString(source.label) : null;
  if (!source || !id || !label || !Array.isArray(source.tools)) {
    throw new OpenClawToolsEffectiveResponseError();
  }
  return {
    id: oneOf(source.id, SOURCES),
    label,
    source: oneOf(source.source, SOURCES),
    tools: source.tools.map(parseEntry),
  };
}

function parseNotice(value: unknown): OpenClawToolsEffectiveNotice {
  const source = record(value);
  const id = source ? nonEmptyString(source.id) : null;
  if (!source || !id || !NOTICE_SEVERITIES.includes(source.severity as OpenClawToolsEffectiveNoticeSeverity)
    || typeof source.message !== 'string') {
    throw new OpenClawToolsEffectiveResponseError();
  }
  const servers = optionalTags(source.servers);
  return {
    id,
    severity: source.severity as OpenClawToolsEffectiveNoticeSeverity,
    message: source.message,
    ...(servers ? { servers } : {}),
  };
}

/** Decode the server-derived effective tool inventory for one OpenClaw session. */
export function parseOpenClawToolsEffectiveResult(value: unknown): OpenClawToolsEffectiveResult {
  const source = record(value);
  const agentId = source ? nonEmptyString(source.agentId) : null;
  const profile = source ? nonEmptyString(source.profile) : null;
  if (!source || !agentId || !profile || !Array.isArray(source.groups)) {
    throw new OpenClawToolsEffectiveResponseError();
  }
  if (source.notices !== undefined && !Array.isArray(source.notices)) {
    throw new OpenClawToolsEffectiveResponseError();
  }
  return {
    agentId,
    profile,
    groups: source.groups.map(parseGroup),
    ...(source.notices !== undefined ? { notices: source.notices.map(parseNotice) } : {}),
  };
}

function buildParams(input: OpenClawToolsEffectiveInput): Record<string, unknown> {
  const sessionKey = nonEmptyString(input.sessionKey);
  if (!sessionKey) throw new Error('OpenClaw tools.effective requires a sessionKey');
  const agentId = input.agentId === undefined ? undefined : nonEmptyString(input.agentId);
  if (input.agentId !== undefined && !agentId) {
    throw new Error('Invalid OpenClaw tools.effective agentId');
  }
  return {
    sessionKey,
    ...(agentId ? { agentId } : {}),
  };
}

/**
 * Narrow client for the read-scoped native effective tool inventory. The
 * Gateway remains the authority for session ownership and policy filtering.
 */
export class OpenClawToolsEffectiveClient {
  constructor(private readonly request: OpenClawToolsEffectiveRequester) {}

  async get(input: OpenClawToolsEffectiveInput): Promise<OpenClawToolsEffectiveResult> {
    return parseOpenClawToolsEffectiveResult(
      await this.request<unknown>(OPENCLAW_TOOLS_EFFECTIVE_METHOD, buildParams(input)),
    );
  }
}
