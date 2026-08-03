export type ToolCatalogSource = 'core' | 'plugin';
export type ToolCatalogRisk = 'low' | 'medium' | 'high';
export type ToolCatalogProfileId = 'minimal' | 'coding' | 'messaging' | 'full';

export interface ToolsCatalogParams {
  agentId?: string;
  includePlugins?: boolean;
}

export interface ToolCatalogProfile {
  id: ToolCatalogProfileId;
  label: string;
}

export interface ToolCatalogEntry {
  id: string;
  label: string;
  description: string;
  source: ToolCatalogSource;
  pluginId?: string;
  optional?: boolean;
  risk?: ToolCatalogRisk;
  tags?: string[];
  defaultProfiles: ToolCatalogProfileId[];
}

export interface ToolCatalogGroup {
  id: string;
  label: string;
  source: ToolCatalogSource;
  pluginId?: string;
  tools: ToolCatalogEntry[];
}

export interface ToolsCatalogResult {
  agentId: string;
  profiles: ToolCatalogProfile[];
  groups: ToolCatalogGroup[];
}

const CATALOG_SOURCES: readonly ToolCatalogSource[] = ['core', 'plugin'];
const CATALOG_RISKS: readonly ToolCatalogRisk[] = ['low', 'medium', 'high'];
const PROFILE_IDS: readonly ToolCatalogProfileId[] = ['minimal', 'coding', 'messaging', 'full'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`tools.catalog returned an invalid ${field}`);
  }
  return value.trim();
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`tools.catalog returned an invalid ${field}`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`tools.catalog returned an invalid ${field}`);
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`tools.catalog returned an invalid ${field}`);
  }
  return value as T;
}

function profileList(value: unknown, field: string): ToolCatalogProfileId[] {
  if (!Array.isArray(value)) throw new Error(`tools.catalog returned an invalid ${field}`);
  return value.map((profile, index) => enumValue(profile, PROFILE_IDS, `${field}[${index}]`));
}

function optionalTags(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`tools.catalog returned an invalid ${field}`);
  return value.map((tag, index) => requiredString(tag, `${field}[${index}]`));
}

function parseEntry(value: unknown, groupIndex: number, index: number): ToolCatalogEntry {
  if (!isRecord(value)) throw new Error(`tools.catalog returned an invalid tool at ${groupIndex}:${index}`);
  const field = `groups[${groupIndex}].tools[${index}]`;
  const entry: ToolCatalogEntry = {
    id: requiredString(value.id, `${field}.id`),
    label: requiredString(value.label, `${field}.label`),
    description: text(value.description, `${field}.description`),
    source: enumValue(value.source, CATALOG_SOURCES, `${field}.source`),
    defaultProfiles: profileList(value.defaultProfiles, `${field}.defaultProfiles`),
  };
  const pluginId = optionalString(value.pluginId, `${field}.pluginId`);
  const optional = optionalBoolean(value.optional, `${field}.optional`);
  const risk = value.risk === undefined
    ? undefined
    : enumValue(value.risk, CATALOG_RISKS, `${field}.risk`);
  const tags = optionalTags(value.tags, `${field}.tags`);
  if (pluginId) entry.pluginId = pluginId;
  if (optional !== undefined) entry.optional = optional;
  if (risk) entry.risk = risk;
  if (tags) entry.tags = tags;
  return entry;
}

function parseGroup(value: unknown, index: number): ToolCatalogGroup {
  if (!isRecord(value)) throw new Error(`tools.catalog returned an invalid group at index ${index}`);
  if (!Array.isArray(value.tools)) throw new Error(`tools.catalog returned invalid groups[${index}].tools`);
  const field = `groups[${index}]`;
  const group: ToolCatalogGroup = {
    id: requiredString(value.id, `${field}.id`),
    label: requiredString(value.label, `${field}.label`),
    source: enumValue(value.source, CATALOG_SOURCES, `${field}.source`),
    tools: value.tools.map((tool, toolIndex) => parseEntry(tool, index, toolIndex)),
  };
  const pluginId = optionalString(value.pluginId, `${field}.pluginId`);
  if (pluginId) group.pluginId = pluginId;
  return group;
}

function parseProfile(value: unknown, index: number): ToolCatalogProfile {
  if (!isRecord(value)) throw new Error(`tools.catalog returned an invalid profile at index ${index}`);
  return {
    id: enumValue(value.id, PROFILE_IDS, `profiles[${index}].id`),
    label: requiredString(value.label, `profiles[${index}].label`),
  };
}

export function buildToolsCatalogParams(agentId?: string, includePlugins?: boolean): ToolsCatalogParams {
  const normalizedAgentId = agentId?.trim();
  return {
    ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
    ...(includePlugins === undefined ? {} : { includePlugins }),
  };
}

export function parseToolsCatalogResult(value: unknown): ToolsCatalogResult {
  if (!isRecord(value)) throw new Error('tools.catalog returned an invalid result');
  if (!Array.isArray(value.profiles)) throw new Error('tools.catalog returned invalid profiles');
  if (!Array.isArray(value.groups)) throw new Error('tools.catalog returned invalid groups');
  return {
    agentId: requiredString(value.agentId, 'agentId'),
    profiles: value.profiles.map((profile, index) => parseProfile(profile, index)),
    groups: value.groups.map((group, index) => parseGroup(group, index)),
  };
}
