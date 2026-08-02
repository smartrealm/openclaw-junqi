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
  version?: string;
  updatedAt?: number;
  createdAt?: number;
  official: boolean;
  owner?: {
    handle?: string;
    displayName?: string;
    image?: string;
    official: boolean;
  };
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

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function skillRows(payload: unknown): unknown[] {
  const root = record(payload);
  if (!root) return [];
  if (Array.isArray(root.skills)) return root.skills;
  // Older Gateway revisions used `entries`; retain the compatibility reader
  // without emitting that shape from this client.
  return Array.isArray(root.entries) ? root.entries : [];
}

function skillVersion(row: UnknownRecord): string | undefined {
  const direct = text(row.version) ?? text(row.installedVersion) ?? text(row.currentVersion);
  if (direct) return direct;
  const metadata = record(row.meta);
  return metadata ? text(metadata.version) : undefined;
}

export function normalizeOpenClawSkills(payload: unknown): OpenClawSkill[] {
  const unique = new Map<string, OpenClawSkill>();
  for (const raw of skillRows(payload)) {
    const row = record(raw);
    if (!row) continue;
    const key = text(row.skillKey) ?? text(row.slug) ?? text(row.name);
    if (!key) continue;
    unique.set(key, {
      key,
      name: text(row.displayName) ?? text(row.name) ?? key,
      description: text(row.description) ?? text(row.summary) ?? '',
      enabled: optionalBoolean(row.disabled) !== true && optionalBoolean(row.enabled) !== false,
      eligible: optionalBoolean(row.eligible) !== false,
      userInvocable: optionalBoolean(row.userInvocable) === true,
      source: text(row.source) ?? 'unknown',
      ...(text(row.baseDir) ? { baseDir: text(row.baseDir) } : {}),
      ...(skillVersion(row) ? { version: skillVersion(row) } : {}),
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
    if (!row || !slug || !displayName) return [];
    return [{
      score: optionalNumber(row.score) ?? 0,
      slug,
      displayName,
      ...(text(row.summary) ? { summary: text(row.summary) } : {}),
      ...(text(row.version) ? { version: text(row.version) } : {}),
      ...(optionalNumber(row.updatedAt) !== undefined ? { updatedAt: optionalNumber(row.updatedAt) } : {}),
    }];
  });
}

export function normalizeOpenClawSkillDetail(payload: unknown): OpenClawSkillDetail | null {
  const root = record(payload);
  const skill = root ? record(root.skill) : null;
  if (!skill) return null;
  const slug = text(skill.slug);
  const displayName = text(skill.displayName);
  if (!slug || !displayName) return null;
  const latestVersion = root ? record(root.latestVersion) : null;
  const owner = root ? record(root.owner) : null;
  return {
    slug,
    displayName,
    ...(text(skill.summary) ? { summary: text(skill.summary) } : {}),
    ...(text(latestVersion?.version) ? { version: text(latestVersion?.version) } : {}),
    ...(optionalNumber(skill.updatedAt) !== undefined ? { updatedAt: optionalNumber(skill.updatedAt) } : {}),
    ...(optionalNumber(skill.createdAt) !== undefined ? { createdAt: optionalNumber(skill.createdAt) } : {}),
    official: optionalBoolean(skill.isOfficial) === true,
    ...(owner ? {
      owner: {
        ...(text(owner.handle) ? { handle: text(owner.handle) } : {}),
        ...(text(owner.displayName) ? { displayName: text(owner.displayName) } : {}),
        ...(text(owner.image) ? { image: text(owner.image) } : {}),
        official: optionalBoolean(owner.official) === true || optionalBoolean(owner.isOfficial) === true,
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
