import { gateway } from '@/services/gateway';

export interface OpenClawSkillGatewayClient {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  callPrivileged(method: string, params?: Record<string, unknown>): Promise<unknown>;
  hasAdvertisedMethod?(method: string): boolean | null;
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

export interface OpenClawSkillSecurityVerdict {
  registry: string;
  ok: boolean;
  decision: string;
  reasons: string[];
  requestedSlug: string;
  requestedVersion: string;
  slug?: string | null;
  version?: string | null;
  displayName?: string | null;
  publisherHandle?: string | null;
  publisherDisplayName?: string | null;
  createdAt?: number | null;
  checkedAt?: number | null;
  skillUrl?: string | null;
  securityAuditUrl?: string | null;
  securityStatus?: string | null;
  securityPassed?: boolean | null;
  error?: {
    code?: string;
    message?: string;
  };
}

/** Read-only rendered card for an installed OpenClaw skill. */
export interface OpenClawSkillCard {
  skillKey: string;
  sizeBytes: number;
  content: string;
}

export type OpenClawSkillCuratorState = 'active' | 'stale' | 'archived';

export interface OpenClawSkillCuratorEntry {
  skillFile: string;
  skillKey: string;
  skillName: string;
  state: OpenClawSkillCuratorState;
  pinned: boolean;
  createdAtMs: number;
  stateChangedAtMs: number;
  lastUsedAtMs: number | null;
  useCount: number;
  archivedReason: string | null;
}

export interface OpenClawSkillCuratorStatus {
  lastAttemptAtMs: number | null;
  lastSuccessAtMs: number | null;
  lastError: string | null;
  counts: Record<OpenClawSkillCuratorState, number>;
  skills: OpenClawSkillCuratorEntry[];
  overlaps: Array<{ left: string; right: string; score: number }>;
}

export type OpenClawSkillProposalKind = 'create' | 'update';
export type OpenClawSkillProposalStatus = 'pending' | 'applied' | 'rejected' | 'quarantined' | 'stale';
export type OpenClawSkillProposalScanState = 'pending' | 'clean' | 'failed' | 'quarantined';

export interface OpenClawSkillProposal {
  id: string;
  kind: OpenClawSkillProposalKind;
  status: OpenClawSkillProposalStatus;
  title: string;
  description: string;
  skillName: string;
  skillKey: string;
  createdAt: string;
  updatedAt: string;
  scanState: OpenClawSkillProposalScanState;
}

export interface OpenClawSkillProposalManifest {
  updatedAt: string;
  proposals: OpenClawSkillProposal[];
}

export class OpenClawSkillCardUnsupportedError extends Error {
  readonly code = 'OPENCLAW_SKILL_CARD_UNSUPPORTED';

  constructor() {
    super('The connected OpenClaw Gateway does not advertise skills.skillCard.');
    this.name = 'OpenClawSkillCardUnsupportedError';
  }
}

export class OpenClawSkillCuratorUnsupportedError extends Error {
  readonly code = 'OPENCLAW_SKILL_CURATOR_UNSUPPORTED';

  constructor() {
    super('The connected OpenClaw Gateway does not advertise skills.curator.status.');
    this.name = 'OpenClawSkillCuratorUnsupportedError';
  }
}

export class OpenClawSkillProposalsUnsupportedError extends Error {
  readonly code = 'OPENCLAW_SKILL_PROPOSALS_UNSUPPORTED';

  constructor() {
    super('The connected OpenClaw Gateway does not advertise skills.proposals.list.');
    this.name = 'OpenClawSkillProposalsUnsupportedError';
  }
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
  sha256?: string;
}

// OpenClaw's upload handler accepts archives up to 256 MiB and decoded chunks
// up to 4 MiB. JunQi uses a smaller client chunk to stay below that protocol
// boundary across desktop WebView implementations.
export const MAX_SKILL_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const SKILL_ARCHIVE_CHUNK_BYTES = 3 * 1024 * 1024;

export type SkillArchiveUploadPhase = 'starting' | 'uploading' | 'committing' | 'installing';

export interface SkillArchiveUploadProgress {
  phase: SkillArchiveUploadPhase;
  completedBytes: number;
  totalBytes: number;
}

export interface OpenClawSkillArchiveInstallRequest {
  slug: string;
  bytes: Uint8Array;
  force?: boolean;
  agentId?: string;
  onProgress?: (progress: SkillArchiveUploadProgress) => void;
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

function requiredFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function optionalNullableInteger(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value;
  return optionalInteger(value);
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

function optionalFieldIsValid<T>(value: unknown, normalize: (candidate: unknown) => T | undefined): boolean {
  return value === undefined || normalize(value) !== undefined;
}

function normalizeOpenClawSkillSecurityVerdict(value: unknown): OpenClawSkillSecurityVerdict | null {
  const row = record(value);
  if (!row) return null;
  const registry = text(row.registry);
  const decision = text(row.decision);
  const reasons = stringArray(row.reasons);
  const requestedSlug = text(row.requestedSlug);
  const requestedVersion = text(row.requestedVersion);
  if (!registry || typeof row.ok !== 'boolean' || !decision || !reasons || !requestedSlug || !requestedVersion) {
    return null;
  }
  if (
    !optionalFieldIsValid(row.slug, optionalNullableString)
    || !optionalFieldIsValid(row.version, optionalNullableString)
    || !optionalFieldIsValid(row.displayName, optionalNullableString)
    || !optionalFieldIsValid(row.publisherHandle, optionalNullableString)
    || !optionalFieldIsValid(row.publisherDisplayName, optionalNullableString)
    || !optionalFieldIsValid(row.createdAt, optionalNullableInteger)
    || !optionalFieldIsValid(row.checkedAt, optionalNullableInteger)
    || !optionalFieldIsValid(row.skillUrl, optionalNullableString)
    || !optionalFieldIsValid(row.securityAuditUrl, optionalNullableString)
    || !optionalFieldIsValid(row.securityStatus, optionalNullableString)
    || !optionalFieldIsValid(row.securityPassed, optionalNullableBoolean)
  ) return null;

  const errorValue = row.error;
  const error = errorValue === undefined ? undefined : record(errorValue);
  if (errorValue !== undefined && !error) return null;
  if (error && (
    (error.code !== undefined && typeof error.code !== 'string')
    || (error.message !== undefined && typeof error.message !== 'string')
  )) return null;

  return {
    registry,
    ok: row.ok,
    decision,
    reasons,
    requestedSlug,
    requestedVersion,
    ...(row.slug !== undefined ? { slug: optionalNullableString(row.slug) } : {}),
    ...(row.version !== undefined ? { version: optionalNullableString(row.version) } : {}),
    ...(row.displayName !== undefined ? { displayName: optionalNullableString(row.displayName) } : {}),
    ...(row.publisherHandle !== undefined ? { publisherHandle: optionalNullableString(row.publisherHandle) } : {}),
    ...(row.publisherDisplayName !== undefined ? { publisherDisplayName: optionalNullableString(row.publisherDisplayName) } : {}),
    ...(row.createdAt !== undefined ? { createdAt: optionalNullableInteger(row.createdAt) } : {}),
    ...(row.checkedAt !== undefined ? { checkedAt: optionalNullableInteger(row.checkedAt) } : {}),
    ...(row.skillUrl !== undefined ? { skillUrl: optionalNullableString(row.skillUrl) } : {}),
    ...(row.securityAuditUrl !== undefined ? { securityAuditUrl: optionalNullableString(row.securityAuditUrl) } : {}),
    ...(row.securityStatus !== undefined ? { securityStatus: optionalNullableString(row.securityStatus) } : {}),
    ...(row.securityPassed !== undefined ? { securityPassed: optionalNullableBoolean(row.securityPassed) } : {}),
    ...(error ? {
      error: {
        ...(error.code !== undefined ? { code: error.code as string } : {}),
        ...(error.message !== undefined ? { message: error.message as string } : {}),
      },
    } : {}),
  };
}

export function normalizeOpenClawSkillSecurityVerdicts(payload: unknown): OpenClawSkillSecurityVerdict[] {
  const root = record(payload);
  if (root?.schema !== 'openclaw.skills.security-verdicts.v1' || !Array.isArray(root.items)) return [];
  return root.items.flatMap((item) => {
    const verdict = normalizeOpenClawSkillSecurityVerdict(item);
    return verdict ? [verdict] : [];
  });
}

export function normalizeOpenClawSkillCard(
  payload: unknown,
  expectedSkillKey: string,
): OpenClawSkillCard | null {
  const root = record(payload);
  const skillKey = text(root?.skillKey);
  const path = text(root?.path);
  const sizeBytes = root?.sizeBytes;
  const content = root?.content;
  if (
    root?.schema !== 'openclaw.skills.skill-card.v1'
    || !skillKey
    || skillKey !== expectedSkillKey
    || !path
    || typeof sizeBytes !== 'number'
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
    || typeof content !== 'string'
  ) return null;
  return { skillKey, sizeBytes, content };
}

function normalizeOpenClawSkillCuratorEntry(value: unknown): OpenClawSkillCuratorEntry | null {
  const entry = record(value);
  const skillFile = text(entry?.skillFile);
  const skillKey = text(entry?.skillKey);
  const skillName = text(entry?.skillName);
  const state = entry?.state;
  const createdAtMs = requiredFiniteNumber(entry?.createdAtMs);
  const stateChangedAtMs = requiredFiniteNumber(entry?.stateChangedAtMs);
  const lastUsedAtMs = entry?.lastUsedAtMs;
  const useCount = requiredFiniteNumber(entry?.useCount);
  const archivedReason = entry?.archivedReason;
  if (
    !skillFile
    || !skillKey
    || !skillName
    || (state !== 'active' && state !== 'stale' && state !== 'archived')
    || typeof entry?.pinned !== 'boolean'
    || createdAtMs === null
    || stateChangedAtMs === null
    || (lastUsedAtMs !== null && requiredFiniteNumber(lastUsedAtMs) === null)
    || useCount === null
    || (archivedReason !== null && typeof archivedReason !== 'string')
  ) return null;
  return {
    skillFile,
    skillKey,
    skillName,
    state,
    pinned: entry.pinned,
    createdAtMs,
    stateChangedAtMs,
    lastUsedAtMs: lastUsedAtMs === null ? null : requiredFiniteNumber(lastUsedAtMs)!,
    useCount,
    archivedReason: archivedReason as string | null,
  };
}

export function normalizeOpenClawSkillCuratorStatus(payload: unknown): OpenClawSkillCuratorStatus | null {
  const root = record(payload);
  const counts = record(root?.counts);
  const lastAttemptAtMs = root?.lastAttemptAtMs;
  const lastSuccessAtMs = root?.lastSuccessAtMs;
  const lastError = root?.lastError;
  if (
    !root
    || !counts
    || !Array.isArray(root.skills)
    || !Array.isArray(root.overlaps)
    || (lastAttemptAtMs !== null && requiredFiniteNumber(lastAttemptAtMs) === null)
    || (lastSuccessAtMs !== null && requiredFiniteNumber(lastSuccessAtMs) === null)
    || (lastError !== null && typeof lastError !== 'string')
  ) return null;
  const active = requiredFiniteNumber(counts.active);
  const stale = requiredFiniteNumber(counts.stale);
  const archived = requiredFiniteNumber(counts.archived);
  if (active === null || stale === null || archived === null) return null;
  const skills = root.skills.map(normalizeOpenClawSkillCuratorEntry);
  if (skills.some((skill) => skill === null)) return null;
  const overlaps = root.overlaps.map((value) => {
    const overlap = record(value);
    const left = text(overlap?.left);
    const right = text(overlap?.right);
    const score = requiredFiniteNumber(overlap?.score);
    return left && right && score !== null ? { left, right, score } : null;
  });
  if (overlaps.some((overlap) => overlap === null)) return null;
  return {
    lastAttemptAtMs: lastAttemptAtMs === null ? null : requiredFiniteNumber(lastAttemptAtMs)!,
    lastSuccessAtMs: lastSuccessAtMs === null ? null : requiredFiniteNumber(lastSuccessAtMs)!,
    lastError: lastError as string | null,
    counts: { active, stale, archived },
    skills: skills as OpenClawSkillCuratorEntry[],
    overlaps: overlaps as Array<{ left: string; right: string; score: number }>,
  };
}

function normalizeOpenClawSkillProposal(value: unknown): OpenClawSkillProposal | null {
  const proposal = record(value);
  const id = text(proposal?.id);
  const kind = proposal?.kind;
  const status = proposal?.status;
  const title = text(proposal?.title);
  const description = text(proposal?.description);
  const skillName = text(proposal?.skillName);
  const skillKey = text(proposal?.skillKey);
  const createdAt = text(proposal?.createdAt);
  const updatedAt = text(proposal?.updatedAt);
  const scanState = proposal?.scanState;
  if (
    !id
    || (kind !== 'create' && kind !== 'update')
    || (status !== 'pending' && status !== 'applied' && status !== 'rejected' && status !== 'quarantined' && status !== 'stale')
    || !title
    || !description
    || !skillName
    || !skillKey
    || !createdAt
    || !updatedAt
    || (scanState !== 'pending' && scanState !== 'clean' && scanState !== 'failed' && scanState !== 'quarantined')
  ) return null;
  return { id, kind, status, title, description, skillName, skillKey, createdAt, updatedAt, scanState };
}

export function normalizeOpenClawSkillProposalManifest(payload: unknown): OpenClawSkillProposalManifest | null {
  const root = record(payload);
  const updatedAt = text(root?.updatedAt);
  if (
    root?.schema !== 'openclaw.skill-workshop.proposals-manifest.v1'
    || !updatedAt
    || !Array.isArray(root.proposals)
  ) return null;
  const proposals = root.proposals.map(normalizeOpenClawSkillProposal);
  if (proposals.some((proposal) => proposal === null)) return null;
  return { updatedAt, proposals: proposals as OpenClawSkillProposal[] };
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

const SKILL_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredSkillSlug(value: string): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.includes('/')
    || normalized.includes('\\')
    || normalized.includes('..')
    || !SKILL_SLUG_PATTERN.test(normalized)
    || [...normalized].some((character) => character.charCodeAt(0) > 127)
  ) {
    throw new Error('Skill slug is invalid. Use letters, numbers, and hyphens only.');
  }
  return normalized;
}

function normalizedSha256(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return SHA256_PATTERN.test(normalized) ? normalized : undefined;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('This runtime cannot encode skill archives.');
  }
  let binary = '';
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + blockSize, bytes.length)));
  }
  return globalThis.btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('This runtime cannot verify skill archive hashes.');
  }
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface OpenClawSkillUploadResult {
  uploadId: string;
  receivedBytes: number;
  expiresAt: number;
  sha256?: string;
}

function requiredUploadResult(payload: unknown, operation: string): OpenClawSkillUploadResult {
  const value = record(payload);
  const uploadId = text(value?.uploadId);
  const receivedBytes = value?.receivedBytes;
  const expiresAt = value?.expiresAt;
  if (
    !uploadId
    || !UPLOAD_ID_PATTERN.test(uploadId)
    || typeof receivedBytes !== 'number'
    || !Number.isSafeInteger(receivedBytes)
    || receivedBytes < 0
    || typeof expiresAt !== 'number'
    || !Number.isFinite(expiresAt)
  ) {
    throw new Error(`OpenClaw returned an invalid ${operation} upload response.`);
  }
  const hash = value?.sha256;
  if (hash !== undefined && !normalizedSha256(hash)) {
    throw new Error(`OpenClaw returned an invalid ${operation} upload hash.`);
  }
  return {
    uploadId,
    receivedBytes,
    expiresAt,
    ...(hash !== undefined ? { sha256: normalizedSha256(hash)! } : {}),
  };
}

export function createOpenClawSkillsRuntime(client: OpenClawSkillGatewayClient) {
  return {
    proposalsCapability(): boolean | null {
      return client.hasAdvertisedMethod?.('skills.proposals.list') ?? null;
    },

    curatorStatusCapability(): boolean | null {
      return client.hasAdvertisedMethod?.('skills.curator.status') ?? null;
    },

    skillCardCapability(): boolean | null {
      return client.hasAdvertisedMethod?.('skills.skillCard') ?? null;
    },

    archiveUploadCapability(): boolean | null {
      const methods = [
        'skills.upload.begin',
        'skills.upload.chunk',
        'skills.upload.commit',
      ].map((method) => client.hasAdvertisedMethod?.(method) ?? null);
      if (methods.some((supported) => supported === false)) return false;
      if (methods.some((supported) => supported === null)) return null;
      return true;
    },

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

    async securityVerdicts(agentId?: string): Promise<OpenClawSkillSecurityVerdict[]> {
      const normalizedAgentId = agentId?.trim();
      return normalizeOpenClawSkillSecurityVerdicts(await client.call(
        'skills.securityVerdicts',
        normalizedAgentId ? { agentId: normalizedAgentId } : {},
      ));
    },

    async skillCard(skillKey: string, agentId?: string): Promise<OpenClawSkillCard> {
      const normalizedSkillKey = requiredIdentifier(skillKey, 'Skill key');
      if (client.hasAdvertisedMethod?.('skills.skillCard') === false) {
        throw new OpenClawSkillCardUnsupportedError();
      }
      const normalizedAgentId = agentId?.trim();
      const card = normalizeOpenClawSkillCard(await client.call('skills.skillCard', {
        skillKey: normalizedSkillKey,
        ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
      }), normalizedSkillKey);
      if (!card) throw new Error('OpenClaw returned an invalid skill card response.');
      return card;
    },

    async curatorStatus(): Promise<OpenClawSkillCuratorStatus> {
      if (client.hasAdvertisedMethod?.('skills.curator.status') === false) {
        throw new OpenClawSkillCuratorUnsupportedError();
      }
      const status = normalizeOpenClawSkillCuratorStatus(await client.call('skills.curator.status', {}));
      if (!status) throw new Error('OpenClaw returned an invalid skill curator status response.');
      return status;
    },

    async proposals(agentId?: string): Promise<OpenClawSkillProposalManifest> {
      if (client.hasAdvertisedMethod?.('skills.proposals.list') === false) {
        throw new OpenClawSkillProposalsUnsupportedError();
      }
      const normalizedAgentId = agentId?.trim();
      const manifest = normalizeOpenClawSkillProposalManifest(await client.call('skills.proposals.list', {
        ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
      }));
      if (!manifest) throw new Error('OpenClaw returned an invalid skill proposal manifest response.');
      return manifest;
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

    async installArchive(request: OpenClawSkillArchiveInstallRequest): Promise<OpenClawSkillInstallResult> {
      const slug = requiredSkillSlug(request.slug);
      if (
        !(request.bytes instanceof Uint8Array)
        || request.bytes.length < 1
        || request.bytes.length > MAX_SKILL_ARCHIVE_BYTES
      ) {
        throw new Error(`Skill archive must be between 1 byte and ${MAX_SKILL_ARCHIVE_BYTES} bytes.`);
      }

      const digest = await sha256Hex(request.bytes);
      const force = request.force === true;
      const idempotencyKey = `junqi-skill-upload:${slug}:${digest}:${force ? 'force' : 'safe'}`;
      const progress = (phase: SkillArchiveUploadPhase, completedBytes: number) => {
        request.onProgress?.({ phase, completedBytes, totalBytes: request.bytes.length });
      };

      progress('starting', 0);
      const begin = requiredUploadResult(await client.callPrivileged('skills.upload.begin', {
        kind: 'skill-archive',
        slug,
        sizeBytes: request.bytes.length,
        sha256: digest,
        ...(force ? { force: true } : {}),
        idempotencyKey,
      }), 'begin');
      if (begin.receivedBytes > request.bytes.length) {
        throw new Error('OpenClaw returned an upload offset beyond the archive size.');
      }

      let receivedBytes = begin.receivedBytes;
      if (receivedBytes > 0) progress('uploading', receivedBytes);
      while (receivedBytes < request.bytes.length) {
        const nextOffset = Math.min(receivedBytes + SKILL_ARCHIVE_CHUNK_BYTES, request.bytes.length);
        const response = requiredUploadResult(await client.callPrivileged('skills.upload.chunk', {
          uploadId: begin.uploadId,
          offset: receivedBytes,
          dataBase64: bytesToBase64(request.bytes.subarray(receivedBytes, nextOffset)),
        }), 'chunk');
        if (response.uploadId !== begin.uploadId || response.receivedBytes !== nextOffset) {
          throw new Error('OpenClaw returned an unexpected upload offset.');
        }
        receivedBytes = nextOffset;
        progress('uploading', receivedBytes);
      }

      progress('committing', receivedBytes);
      const committed = requiredUploadResult(await client.callPrivileged('skills.upload.commit', {
        uploadId: begin.uploadId,
        sha256: digest,
      }), 'commit');
      if (
        committed.uploadId !== begin.uploadId
        || committed.receivedBytes !== request.bytes.length
        || committed.sha256 !== digest
      ) {
        throw new Error('OpenClaw did not confirm the complete skill archive.');
      }

      progress('installing', request.bytes.length);
      const result = record(await client.callPrivileged('skills.install', {
        source: 'upload',
        uploadId: begin.uploadId,
        slug,
        ...(force ? { force: true } : {}),
        sha256: digest,
        ...(text(request.agentId) ? { agentId: text(request.agentId) } : {}),
      }));
      if (!result || result.ok !== true) {
        throw new Error(text(result?.error) ?? text(result?.message) ?? 'OpenClaw did not confirm skill archive installation.');
      }

      const reportedSlug = result.slug;
      if (reportedSlug !== undefined && (typeof reportedSlug !== 'string' || reportedSlug.trim() !== slug)) {
        throw new Error('OpenClaw returned a different installed skill slug.');
      }
      const installedHash = result.sha256 === undefined ? undefined : normalizedSha256(result.sha256);
      if (result.sha256 !== undefined && (!installedHash || installedHash !== digest)) {
        throw new Error('OpenClaw returned a different installed skill archive hash.');
      }
      return {
        ok: true,
        ...(text(result.slug) ? { slug: text(result.slug) } : {}),
        ...(text(result.targetDir) ? { targetDir: text(result.targetDir) } : {}),
        ...(text(result.message) ? { message: text(result.message) } : {}),
        ...(text(result.warning) ? { warning: text(result.warning) } : {}),
        ...(installedHash ? { sha256: installedHash } : {}),
      };
    },
  };
}

export const openClawSkillsRuntime = createOpenClawSkillsRuntime(gateway);
