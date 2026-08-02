export const OPENCLAW_TOOLS_CATALOG_METHOD = 'tools.catalog' as const;

export type OpenClawToolsCatalogSource = 'core' | 'plugin';
export type OpenClawToolsCatalogRisk = 'low' | 'medium' | 'high';
export type OpenClawToolsCatalogProfileId = 'minimal' | 'coding' | 'messaging' | 'full';

export interface OpenClawToolsCatalogInput {
  readonly agentId?: string;
  readonly includePlugins?: boolean;
}

export interface OpenClawToolsCatalogProfile {
  readonly id: OpenClawToolsCatalogProfileId;
  readonly label: string;
}

export interface OpenClawToolsCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly source: OpenClawToolsCatalogSource;
  readonly pluginId?: string;
  readonly optional?: boolean;
  readonly risk?: OpenClawToolsCatalogRisk;
  readonly tags?: readonly string[];
  readonly defaultProfiles: readonly OpenClawToolsCatalogProfileId[];
}

export interface OpenClawToolsCatalogGroup {
  readonly id: string;
  readonly label: string;
  readonly source: OpenClawToolsCatalogSource;
  readonly pluginId?: string;
  readonly tools: readonly OpenClawToolsCatalogEntry[];
}

export interface OpenClawToolsCatalogResult {
  readonly agentId: string;
  readonly profiles: readonly OpenClawToolsCatalogProfile[];
  readonly groups: readonly OpenClawToolsCatalogGroup[];
}

export type OpenClawToolsCatalogRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawToolsCatalogResponseError extends Error {
  readonly code = 'OPENCLAW_TOOLS_CATALOG_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid tools.catalog response');
    this.name = 'OpenClawToolsCatalogResponseError';
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
  if (!normalized) throw new OpenClawToolsCatalogResponseError();
  return normalized;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new OpenClawToolsCatalogResponseError();
  }
  return value as T;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new OpenClawToolsCatalogResponseError();
  const values = value.map(nonEmptyString);
  if (values.some((entry) => !entry)) throw new OpenClawToolsCatalogResponseError();
  return values as string[];
}

const SOURCES: readonly OpenClawToolsCatalogSource[] = ['core', 'plugin'];
const RISKS: readonly OpenClawToolsCatalogRisk[] = ['low', 'medium', 'high'];
const PROFILES: readonly OpenClawToolsCatalogProfileId[] = ['minimal', 'coding', 'messaging', 'full'];

function parseEntry(value: unknown): OpenClawToolsCatalogEntry {
  const source = record(value);
  const id = source ? nonEmptyString(source.id) : null;
  const label = source ? nonEmptyString(source.label) : null;
  if (!source || !id || !label || typeof source.description !== 'string') {
    throw new OpenClawToolsCatalogResponseError();
  }
  if (source.optional !== undefined && typeof source.optional !== 'boolean') {
    throw new OpenClawToolsCatalogResponseError();
  }
  const pluginId = optionalString(source.pluginId);
  const tags = source.tags === undefined ? undefined : stringArray(source.tags);
  const defaultProfiles = stringArray(source.defaultProfiles).map((profile) => oneOf(profile, PROFILES));
  return {
    id,
    label,
    description: source.description,
    source: oneOf(source.source, SOURCES),
    ...(pluginId ? { pluginId } : {}),
    ...(source.optional !== undefined ? { optional: source.optional } : {}),
    ...(source.risk !== undefined ? { risk: oneOf(source.risk, RISKS) } : {}),
    ...(tags ? { tags } : {}),
    defaultProfiles,
  };
}

function parseGroup(value: unknown): OpenClawToolsCatalogGroup {
  const source = record(value);
  const id = source ? nonEmptyString(source.id) : null;
  const label = source ? nonEmptyString(source.label) : null;
  if (!source || !id || !label || !Array.isArray(source.tools)) {
    throw new OpenClawToolsCatalogResponseError();
  }
  const pluginId = optionalString(source.pluginId);
  return {
    id,
    label,
    source: oneOf(source.source, SOURCES),
    ...(pluginId ? { pluginId } : {}),
    tools: source.tools.map(parseEntry),
  };
}

function parseProfile(value: unknown): OpenClawToolsCatalogProfile {
  const source = record(value);
  const label = source ? nonEmptyString(source.label) : null;
  if (!source || !label) throw new OpenClawToolsCatalogResponseError();
  return {
    id: oneOf(source.id, PROFILES),
    label,
  };
}

/** Decode the Gateway's agent-scoped core/plugin tool catalog. */
export function parseOpenClawToolsCatalogResult(value: unknown): OpenClawToolsCatalogResult {
  const source = record(value);
  const agentId = source ? nonEmptyString(source.agentId) : null;
  if (!source || !agentId || !Array.isArray(source.profiles) || !Array.isArray(source.groups)) {
    throw new OpenClawToolsCatalogResponseError();
  }
  return {
    agentId,
    profiles: source.profiles.map(parseProfile),
    groups: source.groups.map(parseGroup),
  };
}

function buildParams(input: OpenClawToolsCatalogInput): Record<string, unknown> {
  const agentId = input.agentId === undefined ? undefined : nonEmptyString(input.agentId);
  if (input.agentId !== undefined && !agentId) {
    throw new Error('Invalid OpenClaw tools.catalog agentId');
  }
  if (input.includePlugins !== undefined && typeof input.includePlugins !== 'boolean') {
    throw new Error('Invalid OpenClaw tools.catalog includePlugins');
  }
  return {
    ...(agentId ? { agentId } : {}),
    ...(input.includePlugins !== undefined ? { includePlugins: input.includePlugins } : {}),
  };
}

/** Narrow read-only client for the official tools.catalog RPC. */
export class OpenClawToolsCatalogClient {
  constructor(private readonly request: OpenClawToolsCatalogRequester) {}

  async get(input: OpenClawToolsCatalogInput = {}): Promise<OpenClawToolsCatalogResult> {
    return parseOpenClawToolsCatalogResult(
      await this.request<unknown>(
        OPENCLAW_TOOLS_CATALOG_METHOD,
        buildParams(input),
      ),
    );
  }
}
