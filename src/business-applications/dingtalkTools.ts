import type { OpenClawToolsEffectiveEntry } from '@/stores/gatewayDataStore';

export const DINGTALK_PLUGIN_ID = 'junqi-dingtalk';
export const DINGTALK_TOOL_PREFIX = 'junqi_dingtalk_';
export const DINGTALK_RUNTIME_STATUS_TOOL = 'junqi_dingtalk_runtime_status';
export const DINGTALK_TOOL_SCHEMA_TOOL = 'junqi_dingtalk_tool_schema';

export type DingTalkDomain = 'contact' | 'approval' | 'attendance' | 'calendar' | 'todo' | 'runtime' | 'unknown';
export type DingTalkEffect = 'read' | 'write' | 'unknown';

export interface DingTalkEffectiveTool {
  readonly entry: OpenClawToolsEffectiveEntry;
  readonly domain: DingTalkDomain;
  readonly effect: DingTalkEffect;
}

export interface DingTalkToolParameter {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly property: string | null;
}

export interface DingTalkToolSchemaProjection {
  readonly canonicalPath: string;
  readonly schemaDigest: string;
  readonly parameters: readonly DingTalkToolParameter[];
}

export interface DingTalkRuntimeProfileProjection {
  readonly profile: string;
  readonly corpName: string | null;
  readonly userName: string | null;
  readonly status: string | null;
  readonly authorizedDomains: readonly string[];
  readonly expiresAt: string | null;
  readonly isCurrent: boolean;
}

export interface DingTalkRuntimeIdentityProjection {
  readonly available: boolean;
  readonly runtimeError: {
    readonly code: string | null;
    readonly message: string | null;
  } | null;
  readonly currentProfile: string | null;
  readonly profiles: readonly DingTalkRuntimeProfileProjection[];
  readonly user: {
    readonly name: string | null;
    readonly userId: string | null;
    readonly organization: string | null;
    readonly department: string | null;
    readonly avatarUrl: string | null;
  } | null;
}

const DOMAIN_LABELS: Record<DingTalkDomain, string> = {
  contact: '通讯录',
  approval: '审批',
  attendance: '考勤',
  calendar: '日历',
  todo: '待办',
  runtime: '运行时',
  unknown: '未验证',
};

export function dingTalkDomainLabel(domain: DingTalkDomain): string {
  return DOMAIN_LABELS[domain];
}

export function isDingTalkEffectiveTool(entry: OpenClawToolsEffectiveEntry): boolean {
  return entry.source === 'plugin'
    && entry.pluginId === DINGTALK_PLUGIN_ID
    && entry.id.startsWith(DINGTALK_TOOL_PREFIX);
}

function tagDomain(tags: readonly string[] | undefined): DingTalkDomain {
  for (const domain of ['contact', 'approval', 'attendance', 'calendar', 'todo'] as const) {
    if (tags?.includes(domain)) return domain;
  }
  if (tags?.includes('runtime')) return 'runtime';
  return 'unknown';
}

export function projectDingTalkTool(entry: OpenClawToolsEffectiveEntry): DingTalkEffectiveTool {
  return {
    entry,
    domain: tagDomain(entry.tags),
    effect: entry.tags?.includes('write')
      ? 'write'
      : entry.tags?.includes('read') ? 'read' : 'unknown',
  };
}

export function collectDingTalkTools(
  groups: readonly { readonly tools: readonly OpenClawToolsEffectiveEntry[] }[] | undefined,
): DingTalkEffectiveTool[] {
  return (groups ?? [])
    .flatMap((group) => group.tools)
    .filter(isDingTalkEffectiveTool)
    .filter((entry) => !entry.tags?.includes('internal'))
    .map(projectDingTalkTool)
    .sort((left, right) => {
      if (left.domain !== right.domain) return left.domain.localeCompare(right.domain);
      if (left.effect !== right.effect) return left.effect.localeCompare(right.effect);
      return left.entry.label.localeCompare(right.entry.label);
    });
}

export function parseProfileReference(value: string): string | null {
  const normalized = value.trim();
  return /^[^:\s]+:[^:\s]+$/.test(normalized) ? normalized : null;
}

export function parseToolArguments(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('工具参数必须是 JSON 对象');
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(parsed)) result[key] = item;
  return result;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = item;
  return result;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseDingTalkRuntimeOutput(output: unknown): DingTalkRuntimeIdentityProjection {
  const invocation = record(output);
  const toolResult = record(invocation?.output);
  const details = record(toolResult?.details);
  const runtime = record(details?.runtime);
  const runtimeError = record(runtime?.runtimeError);
  const currentProfile = optionalString(runtime?.currentProfile);
  const profiles = Array.isArray(runtime?.profiles) ? runtime.profiles.map((value) => {
    const profile = record(value);
    const profileRef = optionalString(profile?.profile);
    if (!profileRef) throw new Error('DWS profile 投影缺少精确身份。');
    return {
      profile: profileRef,
      corpName: optionalString(profile?.corpName),
      userName: optionalString(profile?.userName),
      status: optionalString(profile?.status),
      authorizedDomains: Array.isArray(profile?.authorizedDomains)
        ? profile.authorizedDomains.flatMap((domain) => optionalString(domain) ? [optionalString(domain)!] : [])
        : [],
      expiresAt: optionalString(profile?.expiresAt),
      isCurrent: profile?.isCurrent === true,
    };
  }) : [];
  const userRecord = record(runtime?.currentUser);
  const avatarUrl = optionalString(userRecord?.avatarUrl);
  return {
    available: runtime?.available === true,
    runtimeError: runtimeError ? {
      code: optionalString(runtimeError.code),
      message: optionalString(runtimeError.message),
    } : null,
    currentProfile,
    profiles,
    user: userRecord ? {
      name: optionalString(userRecord.name),
      userId: optionalString(userRecord.userId),
      organization: optionalString(userRecord.organization),
      department: optionalString(userRecord.department),
      avatarUrl: avatarUrl && /^https:\/\//i.test(avatarUrl) ? avatarUrl : null,
    } : null,
  };
}

export function parseDingTalkToolSchemaOutput(output: unknown): DingTalkToolSchemaProjection {
  const toolResult = record(output);
  const details = record(toolResult?.details);
  const canonicalPath = typeof details?.dwsCanonicalPath === 'string'
    ? details.dwsCanonicalPath.trim()
    : '';
  const schemaDigest = typeof details?.schemaDigest === 'string'
    ? details.schemaDigest.trim()
    : '';
  const parameters = record(details?.parameters);
  if (!canonicalPath || !/^[a-f0-9]{64}$/.test(schemaDigest) || !parameters) {
    throw new Error('OpenClaw 返回的钉钉工具参数契约无效');
  }
  const projection = Object.entries(parameters).map(([name, value]) => {
    const parameter = record(value);
    if (!parameter) throw new Error('DWS 参数契约包含无效字段');
    return {
      name,
      type: typeof parameter.type === 'string' && parameter.type.trim()
        ? parameter.type.trim()
        : 'unknown',
      required: parameter.required === true,
      property: typeof parameter.property === 'string' && parameter.property.trim()
        ? parameter.property.trim()
        : null,
    };
  });
  return { canonicalPath, schemaDigest, parameters: projection };
}
