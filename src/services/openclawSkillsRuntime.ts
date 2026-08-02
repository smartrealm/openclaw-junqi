import { gateway } from '@/services/gateway';

export interface OpenClawSkillGatewayClient {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  callPrivileged(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface OpenClawSkill {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  eligible: boolean;
  userInvocable: boolean;
  source: string;
  baseDir?: string;
  version?: string;
}

export interface OpenClawSkillSearchResult {
  score: number;
  slug: string;
  displayName: string;
  summary?: string;
  version?: string;
  updatedAt?: number;
}

export interface OpenClawSkillDetail {
  slug: string;
  displayName: string;
  summary?: string;
  tags?: Record<string, string>;
  channel?: string | null;
  isOfficial?: boolean | null;
  createdAt: number;
  updatedAt: number;
  latestVersion?: {
    version: string;
    createdAt: number;
    changelog?: string;
  } | null;
  metadata?: {
    os?: string[] | null;
    systems?: string[] | null;
  } | null;
  owner?: {
    handle?: string | null;
    displayName?: string | null;
    image?: string | null;
    official?: boolean | null;
    channel?: string | null;
    isOfficial?: boolean | null;
  } | null;
}

export interface OpenClawSkillInstallRequest {
  slug: string;
  version?: string;
  force?: boolean;
  acknowledgeClawHubRisk?: boolean;
  agentId?: string;
}

export interface OpenClawSkillInstallResult {
  ok: boolean;
  slug?: string;
  version?: string;
  targetDir?: string;
  message?: string;
  warning?: string;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function optionalNullableBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return value;
  return typeof value === 'boolean' ? value : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  return typeof value === 'string' ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  if (!source) return undefined;
  const entries = Object.entries(source);
  if (entries.some(([key, item]) => !key.trim() || typeof item !== 'string')) return undefined;
  return Object.fromEntries(entries.map(([key, item]) => [key, item as string]));
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined;
  return [...value];
}

function optionalNullableStringArray(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) return value;
  return stringArray(value);
}

function skillRows(payload: unknown): unknown[] {
  const root = record(payload);
  if (!root) return [];
  if (Array.isArray(root.skills)) return root.skills;
  // Older Gateway revisions used `entries`; retain the compatibility reader
  // without emitting that shape from this client.
  return Array.isArray(root.entries) ? root.entries : [];
}

function skillInstalledVersion(row: UnknownRecord): string | undefined {
  const clawhub = record(row.clawhub);
  return clawhub ? text(clawhub.installedVersion) : undefined;
}

export function normalizeOpenClawSkills(payload: unknown): OpenClawSkill[] {
  const unique = new Map<string, OpenClawSkill>();
  for (const raw of skillRows(payload)) {
    const row = record(raw);
    if (!row) continue;
    const key = text(row.skillKey);
    const name = text(row.name);
    const description = row.description;
    const source = text(row.source);
    const disabled = row.disabled;
    const eligible = row.eligible;
    const userInvocable = row.userInvocable;
    const version = skillInstalledVersion(row);
    if (
      !key
      || !name
      || typeof description !== 'string'
      || !source
      || typeof disabled !== 'boolean'
      || typeof eligible !== 'boolean'
      || typeof userInvocable !== 'boolean'
    ) continue;
    unique.set(key, {
      key,
      name,
      description,
      enabled: !disabled,
      eligible,
      userInvocable,
      source,
      ...(text(row.baseDir) ? { baseDir: text(row.baseDir) } : {}),
      ...(version ? { version } : {}),
    });
  }
  return [...unique.values()];
}

export function normalizeOpenClawSkillSearch(payload: unknown): OpenClawSkillSearchResult[] {
  const root = record(payload);
  const results = root && Array.isArray(root.results) ? root.results : [];
  return results.flatMap((raw) => {
    const row = record(raw);
    const slug = row ? text(row.slug) : undefined;
    const displayName = row ? text(row.displayName) : undefined;
    const score = row ? optionalNumber(row.score) : undefined;
    const summary = row?.summary;
    const version = row?.version;
    const updatedAt = row ? optionalInteger(row.updatedAt) : undefined;
    if (
      !row
      || !slug
      || !displayName
      || score === undefined
      || (summary !== undefined && typeof summary !== 'string')
      || (version !== undefined && !text(version))
      || (updatedAt === undefined && row.updatedAt !== undefined)
    ) return [];
    return [{
      score,
      slug,
      displayName,
      ...(summary !== undefined ? { summary } : {}),
      ...(version !== undefined ? { version: text(version)! } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    }];
  });
}

export function normalizeOpenClawSkillDetail(payload: unknown): OpenClawSkillDetail | null {
  const root = record(payload);
  const skill = root ? record(root.skill) : null;
  if (!skill) return null;
  const slug = text(skill.slug);
  const displayName = text(skill.displayName);
  const createdAt = optionalInteger(skill.createdAt);
  const updatedAt = optionalInteger(skill.updatedAt);
  if (
    !slug
    || !displayName
    || createdAt === undefined
    || updatedAt === undefined
    || (skill.summary !== undefined && typeof skill.summary !== 'string')
    || (skill.channel !== undefined && skill.channel !== null && typeof skill.channel !== 'string')
    || (skill.isOfficial !== undefined && skill.isOfficial !== null && typeof skill.isOfficial !== 'boolean')
  ) return null;

  const tags = stringRecord(skill.tags);
  if (skill.tags !== undefined && !tags) return null;

  const latestVersionValue = root?.latestVersion;
  const latestVersion = latestVersionValue === undefined || latestVersionValue === null
    ? latestVersionValue
    : record(latestVersionValue);
  if (latestVersionValue !== undefined && latestVersionValue !== null && !latestVersion) return null;
  const latestVersionName = latestVersion ? text(latestVersion.version) : undefined;
  const latestVersionCreatedAt = latestVersion ? optionalInteger(latestVersion.createdAt) : undefined;
  if (latestVersion && (!latestVersionName || latestVersionCreatedAt === undefined)) return null;
  if (latestVersion && latestVersion.changelog !== undefined && typeof latestVersion.changelog !== 'string') return null;

  const metadataValue = root?.metadata;
  const metadata = metadataValue === undefined || metadataValue === null ? metadataValue : record(metadataValue);
  if (metadataValue !== undefined && metadataValue !== null && !metadata) return null;
  const os = metadata ? optionalNullableStringArray(metadata.os) : undefined;
  const systems = metadata ? optionalNullableStringArray(metadata.systems) : undefined;
  if (metadata && ((metadata.os !== undefined && os === undefined) || (metadata.systems !== undefined && systems === undefined))) return null;

  const ownerValue = root?.owner;
  const owner = ownerValue === undefined || ownerValue === null ? ownerValue : record(ownerValue);
  if (ownerValue !== undefined && ownerValue !== null && !owner) return null;
  if (owner && (
    (owner.handle !== undefined && owner.handle !== null && !text(owner.handle))
    || (owner.displayName !== undefined && owner.displayName !== null && !text(owner.displayName))
    || (owner.image !== undefined && owner.image !== null && typeof owner.image !== 'string')
    || (owner.official !== undefined && owner.official !== null && typeof owner.official !== 'boolean')
    || (owner.isOfficial !== undefined && owner.isOfficial !== null && typeof owner.isOfficial !== 'boolean')
    || (owner.channel !== undefined && owner.channel !== null && typeof owner.channel !== 'string')
  )) return null;

  const isOfficial = optionalNullableBoolean(skill.isOfficial);
  const ownerOfficial = owner ? optionalNullableBoolean(owner.official) : undefined;
  const ownerIsOfficial = owner ? optionalNullableBoolean(owner.isOfficial) : undefined;
  return {
    slug,
    displayName,
    ...(skill.summary !== undefined ? { summary: skill.summary as string } : {}),
    ...(tags ? { tags } : {}),
    ...(skill.channel !== undefined ? { channel: optionalNullableString(skill.channel) } : {}),
    ...(isOfficial !== undefined ? { isOfficial } : {}),
    createdAt,
    updatedAt,
    ...(latestVersion === null ? { latestVersion: null } : latestVersion && latestVersionName && latestVersionCreatedAt !== undefined ? {
      latestVersion: {
        version: latestVersionName,
        createdAt: latestVersionCreatedAt,
        ...(latestVersion.changelog !== undefined ? { changelog: latestVersion.changelog as string } : {}),
      },
    } : {}),
    ...(metadata === null ? { metadata: null } : metadata !== undefined ? {
      metadata: {
        ...(os !== undefined ? { os } : {}),
        ...(systems !== undefined ? { systems } : {}),
      },
    } : {}),
    ...(owner === null ? { owner: null } : owner ? {
      owner: {
        ...(owner.handle !== undefined ? { handle: owner.handle === null ? null : text(owner.handle)! } : {}),
        ...(owner.displayName !== undefined ? { displayName: owner.displayName === null ? null : text(owner.displayName)! } : {}),
        ...(owner.image !== undefined ? { image: owner.image === null ? null : owner.image as string } : {}),
        ...(ownerOfficial !== undefined ? { official: ownerOfficial } : {}),
        ...(owner.channel !== undefined ? { channel: owner.channel === null ? null : owner.channel as string } : {}),
        ...(ownerIsOfficial !== undefined ? { isOfficial: ownerIsOfficial } : {}),
      },
    } : {}),
  };
}

function requiredIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizedSearchLimit(limit?: number): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Skill search limit must be an integer between 1 and 100.');
  }
  return limit;
}

export function createOpenClawSkillsRuntime(client: OpenClawSkillGatewayClient) {
  return {
    async list(agentId?: string): Promise<OpenClawSkill[]> {
      const normalizedAgentId = agentId?.trim();
      return normalizeOpenClawSkills(await client.call(
        'skills.status',
        normalizedAgentId ? { agentId: normalizedAgentId } : {},
      ));
    },

    async setEnabled(skillKey: string, enabled: boolean): Promise<void> {
      await client.callPrivileged('skills.update', {
        skillKey: requiredIdentifier(skillKey, 'Skill key'),
        enabled,
      });
    },

    async search(query?: string, limit?: number): Promise<OpenClawSkillSearchResult[]> {
      const normalizedQuery = query?.trim();
      const normalizedLimit = normalizedSearchLimit(limit);
      return normalizeOpenClawSkillSearch(await client.call('skills.search', {
        ...(normalizedQuery ? { query: normalizedQuery } : {}),
        ...(normalizedLimit !== undefined ? { limit: normalizedLimit } : {}),
      }));
    },

    async detail(slug: string): Promise<OpenClawSkillDetail | null> {
      return normalizeOpenClawSkillDetail(await client.call('skills.detail', {
        slug: requiredIdentifier(slug, 'Skill slug'),
      }));
    },

    async installFromClawHub(request: OpenClawSkillInstallRequest): Promise<OpenClawSkillInstallResult> {
      const result = record(await client.callPrivileged('skills.install', {
        source: 'clawhub',
        slug: requiredIdentifier(request.slug, 'Skill slug'),
        ...(text(request.version) ? { version: text(request.version) } : {}),
        ...(request.force === true ? { force: true } : {}),
        ...(request.acknowledgeClawHubRisk === true ? { acknowledgeClawHubRisk: true } : {}),
        ...(text(request.agentId) ? { agentId: text(request.agentId) } : {}),
      }));
      if (!result || result.ok !== true) {
        throw new Error(text(result?.message) ?? 'OpenClaw did not confirm skill installation.');
      }
      return {
        ok: true,
        ...(text(result.slug) ? { slug: text(result.slug) } : {}),
        ...(text(result.version) ? { version: text(result.version) } : {}),
        ...(text(result.targetDir) ? { targetDir: text(result.targetDir) } : {}),
        ...(text(result.message) ? { message: text(result.message) } : {}),
        ...(text(result.warning) ? { warning: text(result.warning) } : {}),
      };
    },
  };
}

export const openClawSkillsRuntime = createOpenClawSkillsRuntime(gateway);
