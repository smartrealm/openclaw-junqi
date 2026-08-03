export type EffectiveToolSource = 'core' | 'plugin' | 'channel' | 'mcp';
export type EffectiveToolRisk = 'low' | 'medium' | 'high';
export type EffectiveToolNoticeSeverity = 'info' | 'warning';

export interface ToolsEffectiveParams {
  sessionKey: string;
  agentId?: string;
}

export interface EffectiveToolEntry {
  id: string;
  label: string;
  description: string;
  rawDescription: string;
  source: EffectiveToolSource;
  pluginId?: string;
  channelId?: string;
  risk?: EffectiveToolRisk;
  tags?: string[];
}

export interface EffectiveToolGroup {
  id: EffectiveToolSource;
  label: string;
  source: EffectiveToolSource;
  tools: EffectiveToolEntry[];
}

export interface EffectiveToolNotice {
  id: string;
  severity: EffectiveToolNoticeSeverity;
  message: string;
}

export interface ToolsEffectiveResult {
  agentId: string;
  profile: string;
  groups: EffectiveToolGroup[];
  notices?: EffectiveToolNotice[];
}

const TOOL_SOURCES: readonly EffectiveToolSource[] = ['core', 'plugin', 'channel', 'mcp'];
const TOOL_RISKS: readonly EffectiveToolRisk[] = ['low', 'medium', 'high'];
const NOTICE_SEVERITIES: readonly EffectiveToolNoticeSeverity[] = ['info', 'warning'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`tools.effective returned an invalid ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`tools.effective returned an invalid ${field}`);
  }
  return value as T;
}

function optionalTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('tools.effective returned invalid tags');
  return value.map((tag, index) => requiredString(tag, `tags[${index}]`));
}

function parseToolEntry(value: unknown, index: number): EffectiveToolEntry {
  if (!isRecord(value)) throw new Error(`tools.effective returned an invalid tool at index ${index}`);
  const entry: EffectiveToolEntry = {
    id: requiredString(value.id, `groups[].tools[${index}].id`),
    label: requiredString(value.label, `groups[].tools[${index}].label`),
    description: typeof value.description === 'string' ? value.description : (() => {
      throw new Error(`tools.effective returned an invalid groups[].tools[${index}].description`);
    })(),
    rawDescription: typeof value.rawDescription === 'string' ? value.rawDescription : (() => {
      throw new Error(`tools.effective returned an invalid groups[].tools[${index}].rawDescription`);
    })(),
    source: enumValue(value.source, TOOL_SOURCES, `groups[].tools[${index}].source`),
  };
  const pluginId = optionalString(value.pluginId, `groups[].tools[${index}].pluginId`);
  const channelId = optionalString(value.channelId, `groups[].tools[${index}].channelId`);
  const risk = value.risk === undefined
    ? undefined
    : enumValue(value.risk, TOOL_RISKS, `groups[].tools[${index}].risk`);
  const tags = optionalTags(value.tags);
  if (pluginId) entry.pluginId = pluginId;
  if (channelId) entry.channelId = channelId;
  if (risk) entry.risk = risk;
  if (tags) entry.tags = tags;
  return entry;
}

function parseGroup(value: unknown, index: number): EffectiveToolGroup {
  if (!isRecord(value)) throw new Error(`tools.effective returned an invalid group at index ${index}`);
  if (!Array.isArray(value.tools)) throw new Error(`tools.effective returned invalid groups[${index}].tools`);
  return {
    id: enumValue(value.id, TOOL_SOURCES, `groups[${index}].id`),
    label: requiredString(value.label, `groups[${index}].label`),
    source: enumValue(value.source, TOOL_SOURCES, `groups[${index}].source`),
    tools: value.tools.map((tool, toolIndex) => parseToolEntry(tool, toolIndex)),
  };
}

function parseNotice(value: unknown, index: number): EffectiveToolNotice {
  if (!isRecord(value)) throw new Error(`tools.effective returned an invalid notice at index ${index}`);
  if (typeof value.message !== 'string') throw new Error(`tools.effective returned an invalid notices[${index}].message`);
  return {
    id: requiredString(value.id, `notices[${index}].id`),
    severity: enumValue(value.severity, NOTICE_SEVERITIES, `notices[${index}].severity`),
    message: value.message,
  };
}

export function buildToolsEffectiveParams(
  sessionKey: string,
  agentId?: string,
): ToolsEffectiveParams {
  const normalizedSessionKey = requiredString(sessionKey, 'sessionKey');
  const normalizedAgentId = agentId?.trim();
  return {
    sessionKey: normalizedSessionKey,
    ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
  };
}

export function parseToolsEffectiveResult(value: unknown): ToolsEffectiveResult {
  if (!isRecord(value)) throw new Error('tools.effective returned an invalid result');
  if (!Array.isArray(value.groups)) throw new Error('tools.effective returned invalid groups');
  const notices = value.notices === undefined
    ? undefined
    : !Array.isArray(value.notices)
      ? (() => { throw new Error('tools.effective returned invalid notices'); })()
      : value.notices.map((notice, index) => parseNotice(notice, index));
  const result: ToolsEffectiveResult = {
    agentId: requiredString(value.agentId, 'agentId'),
    profile: requiredString(value.profile, 'profile'),
    groups: value.groups.map((group, index) => parseGroup(group, index)),
  };
  if (notices) result.notices = notices;
  return result;
}
