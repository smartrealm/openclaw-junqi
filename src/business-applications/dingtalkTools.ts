import type { OpenClawToolsEffectiveEntry } from '@/stores/gatewayDataStore';

export const DINGTALK_PLUGIN_ID = 'junqi-dingtalk';
export const DINGTALK_TOOL_PREFIX = 'junqi_dingtalk_';
export const DINGTALK_RUNTIME_STATUS_TOOL = 'junqi_dingtalk_runtime_status';
export const DINGTALK_TOOL_SCHEMA_TOOL = 'junqi_dingtalk_tool_schema';
export const DINGTALK_APPROVAL_RECORDS_TOOL = 'junqi_dingtalk_approval_records';
export const DINGTALK_APPROVAL_TASKS_TOOL = 'junqi_dingtalk_approval_tasks';

export type DingTalkDomain =
  | 'contact'
  | 'approval'
  | 'attendance'
  | 'calendar'
  | 'todo'
  | 'minutes'
  | 'doc'
  | 'wiki'
  | 'report'
  | 'mail'
  | 'chat'
  | 'aitable'
  | 'contract'
  | 'recruit'
  | 'goal'
  | 'runtime'
  | 'unknown';
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

export type DingTalkToolContractErrorCode = 'invalid-schema';

export class DingTalkToolContractError extends Error {
  readonly code: DingTalkToolContractErrorCode;

  constructor(code: DingTalkToolContractErrorCode) {
    super(code);
    this.name = 'DingTalkToolContractError';
    this.code = code;
  }
}

export function shouldSurfaceDingTalkArguments({
  runtimeTool,
  argumentsInvalid,
  missingRequiredParameters,
}: {
  runtimeTool: boolean;
  argumentsInvalid: boolean;
  missingRequiredParameters: readonly string[];
}): boolean {
  return !runtimeTool && (argumentsInvalid || missingRequiredParameters.length > 0);
}

export interface DingTalkRuntimeProfileProjection {
  readonly profile: string;
  readonly corpName: string | null;
  readonly userName: string | null;
  readonly status: string | null;
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

export interface DingTalkBusinessEvidenceProjection {
  readonly dwsCanonicalPath: string | null;
  readonly schemaDigest: string | null;
  readonly recoveryEventId: string | null;
  readonly verificationStatus: 'verified' | 'succeeded_unverified' | 'unknown' | null;
  readonly verifierToolName: string | null;
  readonly verifierCanonicalPath: string | null;
  readonly verifierSchemaDigest: string | null;
  readonly resourceId: string | null;
  readonly verificationReasonCode: string | null;
}

export interface DingTalkSubmitLinkProjection {
  readonly approveType: string;
  readonly formName: string;
  readonly processCode: string;
  readonly submitUrl: string;
}

export type DingTalkCatalogAvailability =
  | 'no-session'
  | 'loading-tools'
  | 'no-tools'
  | 'no-runtime-tool'
  | 'loading-identity'
  | 'identity-error'
  | 'profile-required'
  | 'ready';

export function resolveDingTalkCatalogAvailability({
  sessionExists,
  toolsLoading,
  pluginVisibleInSession,
  runtimeToolAvailable,
  runtimeIdentitySettled,
  runtimeIdentityError,
  profileAuthenticated,
}: {
  sessionExists: boolean;
  toolsLoading: boolean;
  pluginVisibleInSession: boolean;
  runtimeToolAvailable: boolean;
  runtimeIdentitySettled: boolean;
  runtimeIdentityError: string | null;
  profileAuthenticated: boolean;
}): DingTalkCatalogAvailability {
  if (!sessionExists) return 'no-session';
  if (toolsLoading) return 'loading-tools';
  if (!pluginVisibleInSession) return 'no-tools';
  if (!runtimeToolAvailable) return 'no-runtime-tool';
  if (!runtimeIdentitySettled) return 'loading-identity';
  if (runtimeIdentityError) return 'identity-error';
  return profileAuthenticated ? 'ready' : 'profile-required';
}

export function isDingTalkEffectiveTool(entry: OpenClawToolsEffectiveEntry): boolean {
  return entry.source === 'plugin'
    && entry.pluginId === DINGTALK_PLUGIN_ID
    && entry.id.startsWith(DINGTALK_TOOL_PREFIX);
}

export function hasAvailableDingTalkRuntimeTool(
  groups: readonly { readonly tools: readonly OpenClawToolsEffectiveEntry[] }[] | undefined,
): boolean {
  return (groups ?? []).some((group) => group.tools.some((entry) => (
    entry.id === DINGTALK_RUNTIME_STATUS_TOOL
      && !entry.deniedBySession
      && isDingTalkEffectiveTool(entry)
  )));
}

function tagDomain(tags: readonly string[] | undefined): DingTalkDomain {
  for (const domain of [
    'contact',
    'approval',
    'attendance',
    'calendar',
    'todo',
    'minutes',
    'doc',
    'wiki',
    'report',
    'mail',
    'chat',
    'aitable',
    'contract',
    'recruit',
    'goal',
  ] as const) {
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

export function isDingTalkProfileAuthenticated(
  runtime: DingTalkRuntimeIdentityProjection | null,
  selectedProfile: string,
): boolean {
  if (!runtime?.available) return false;
  const profileRef = parseProfileReference(selectedProfile);
  if (!profileRef) return false;
  return runtime.profiles.some((profile) => (
    profile.profile === profileRef && profile.status === 'active'
  ));
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

/** 仅投影 DWS 返回的关联元数据，禁止将业务数据或原始输出写入活动记录。 */
export function parseDingTalkBusinessEvidence(output: unknown): DingTalkBusinessEvidenceProjection {
  const invocation = record(output);
  const toolResult = record(invocation?.output);
  const details = record(toolResult?.details);
  const schemaDigest = optionalString(details?.schemaDigest);
  const verification = record(details?.verification);
  const verificationStatus = verification?.status === 'verified'
    || verification?.status === 'succeeded_unverified'
    || verification?.status === 'unknown'
    ? verification.status
    : null;
  const verifierSchemaDigest = optionalString(verification?.verifierSchemaDigest);
  return {
    dwsCanonicalPath: optionalString(details?.dwsCanonicalPath),
    schemaDigest: schemaDigest && /^[a-f0-9]{64}$/.test(schemaDigest) ? schemaDigest : null,
    recoveryEventId: optionalString(details?.recoveryEventId),
    verificationStatus,
    verifierToolName: optionalString(verification?.verifierToolName),
    verifierCanonicalPath: optionalString(verification?.verifierCanonicalPath),
    verifierSchemaDigest: verifierSchemaDigest && /^[a-f0-9]{64}$/.test(verifierSchemaDigest)
      ? verifierSchemaDigest
      : null,
    resourceId: optionalString(verification?.resourceId),
    verificationReasonCode: optionalString(verification?.reasonCode),
  };
}

/** 只投影 DWS 审批模板的官方提交入口，其他业务结果继续按原始结果展示。 */
export function collectDingTalkSubmitLinks(output: unknown): readonly DingTalkSubmitLinkProjection[] {
  const invocation = record(output);
  const toolResult = record(invocation?.output);
  const details = record(toolResult?.details);
  const data = record(details?.data);
  if (!Array.isArray(data?.templates)) return [];

  const seen = new Set<string>();
  const links: DingTalkSubmitLinkProjection[] = [];
  for (const value of data.templates) {
    const template = record(value);
    const approveType = optionalString(template?.approveType);
    const formName = optionalString(template?.formName);
    const processCode = optionalString(template?.processCode);
    const submitUrl = optionalString(template?.submitUrl);
    if (!approveType || !formName || !processCode || !submitUrl || seen.has(submitUrl)) continue;
    seen.add(submitUrl);
    links.push({ approveType, formName, processCode, submitUrl });
  }
  return links;
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
    throw new DingTalkToolContractError('invalid-schema');
  }
  const projection = Object.entries(parameters).map(([name, value]) => {
    const parameter = record(value);
    if (!parameter) throw new DingTalkToolContractError('invalid-schema');
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
