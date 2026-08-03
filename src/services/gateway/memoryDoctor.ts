export interface MemoryStatusParams {
  agentId?: string;
  probe?: boolean;
  deep?: boolean;
}

export interface MemoryEmbeddingStatus {
  ok: boolean;
  checked?: boolean;
  error?: string;
}

export interface MemoryPhaseStatus {
  enabled: boolean;
  cron: string;
  managedCronPresent: boolean;
  lookbackDays?: number;
  limit?: number;
  minScore?: number;
  minRecallCount?: number;
  minUniqueQueries?: number;
  recencyHalfLifeDays?: number;
  maxAgeDays?: number;
  minPatternStrength?: number;
}

export interface MemoryDreamingStatus {
  enabled: boolean;
  timezone?: string;
  verboseLogging: boolean;
  storageMode: string;
  separateReports: boolean;
  shortTermCount: number;
  recallSignalCount: number;
  dailySignalCount: number;
  groundedSignalCount: number;
  totalSignalCount: number;
  phaseSignalCount: number;
  lightPhaseHitCount: number;
  remPhaseHitCount: number;
  promotedTotal: number;
  promotedToday: number;
  phases: {
    light: MemoryPhaseStatus;
    deep: MemoryPhaseStatus;
    rem: MemoryPhaseStatus;
  };
  storeError?: string;
}

export interface MemoryStatusResult {
  agentId: string;
  provider?: string;
  embedding: MemoryEmbeddingStatus;
  dreaming?: MemoryDreamingStatus;
}

export interface MemoryRemHarnessParams {
  grounded?: boolean;
  includePromoted?: boolean;
  limit?: number;
}

export interface MemoryRemConfig {
  enabled: boolean;
  lookbackDays: number;
  limit: number;
  minPatternStrength: number;
}

export interface MemoryDeepConfig {
  minScore: number;
  minRecallCount: number;
  minUniqueQueries: number;
  recencyHalfLifeDays: number;
  maxAgeDays: number | null;
}

export interface MemoryGroundedPreview {
  scannedFiles: number;
  files: Array<{ path: string; renderedMarkdown: string }>;
}

export interface MemoryDeepCandidate {
  key: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  recallCount: number;
  uniqueQueries: number;
  avgScore: number;
  maxScore: number;
  ageDays: number;
  firstRecalledAt?: string;
  lastRecalledAt?: string;
  promoted: boolean;
  promotedAt?: string;
}

export interface MemoryRemHarnessSuccess {
  ok: true;
  agentId: string;
  workspaceDir: string;
  remConfig: MemoryRemConfig;
  deepConfig: MemoryDeepConfig;
  rem: {
    skipped: boolean;
    sourceEntryCount: number;
    reflections: string[];
    candidateTruths: Array<{ snippet: string; confidence: number }>;
    bodyLines: string[];
  };
  grounded: MemoryGroundedPreview | null;
  deep: {
    candidateLimit: number;
    truncated: boolean;
    candidates: MemoryDeepCandidate[];
  };
}

export interface MemoryRemHarnessFailure {
  ok: false;
  agentId: string;
  workspaceDir: string;
  error: string;
}

export type MemoryRemHarnessResult = MemoryRemHarnessSuccess | MemoryRemHarnessFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`doctor.memory returned an invalid ${field}`);
  }
  return allowEmpty ? value : value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`doctor.memory returned an invalid ${field}`);
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`doctor.memory returned an invalid ${field}`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredNumber(value, field);
}

function optionalNullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  return requiredNumber(value, field);
}

function parseEmbedding(value: unknown): MemoryEmbeddingStatus {
  if (!isRecord(value)) throw new Error('doctor.memory returned an invalid embedding');
  const result: MemoryEmbeddingStatus = { ok: requiredBoolean(value.ok, 'embedding.ok') };
  if (value.checked !== undefined) result.checked = requiredBoolean(value.checked, 'embedding.checked');
  if (value.error !== undefined) result.error = requiredString(value.error, 'embedding.error', true);
  return result;
}

function parsePhase(value: unknown, field: string): MemoryPhaseStatus {
  if (!isRecord(value)) throw new Error(`doctor.memory returned an invalid ${field}`);
  const result: MemoryPhaseStatus = {
    enabled: requiredBoolean(value.enabled, `${field}.enabled`),
    cron: requiredString(value.cron, `${field}.cron`, true),
    managedCronPresent: requiredBoolean(value.managedCronPresent, `${field}.managedCronPresent`),
  };
  const numericFields = [
    'lookbackDays',
    'limit',
    'minScore',
    'minRecallCount',
    'minUniqueQueries',
    'recencyHalfLifeDays',
    'maxAgeDays',
    'minPatternStrength',
  ] as const;
  for (const key of numericFields) {
    const valueAtKey = optionalNumber(value[key], `${field}.${key}`);
    if (valueAtKey !== undefined) result[key] = valueAtKey;
  }
  return result;
}

function parseDreaming(value: unknown): MemoryDreamingStatus {
  if (!isRecord(value)) throw new Error('doctor.memory returned an invalid dreaming status');
  if (!isRecord(value.phases)) throw new Error('doctor.memory returned invalid dreaming.phases');
  const result: MemoryDreamingStatus = {
    enabled: requiredBoolean(value.enabled, 'dreaming.enabled'),
    verboseLogging: requiredBoolean(value.verboseLogging, 'dreaming.verboseLogging'),
    storageMode: requiredString(value.storageMode, 'dreaming.storageMode'),
    separateReports: requiredBoolean(value.separateReports, 'dreaming.separateReports'),
    shortTermCount: requiredNumber(value.shortTermCount, 'dreaming.shortTermCount'),
    recallSignalCount: requiredNumber(value.recallSignalCount, 'dreaming.recallSignalCount'),
    dailySignalCount: requiredNumber(value.dailySignalCount, 'dreaming.dailySignalCount'),
    groundedSignalCount: requiredNumber(value.groundedSignalCount, 'dreaming.groundedSignalCount'),
    totalSignalCount: requiredNumber(value.totalSignalCount, 'dreaming.totalSignalCount'),
    phaseSignalCount: requiredNumber(value.phaseSignalCount, 'dreaming.phaseSignalCount'),
    lightPhaseHitCount: requiredNumber(value.lightPhaseHitCount, 'dreaming.lightPhaseHitCount'),
    remPhaseHitCount: requiredNumber(value.remPhaseHitCount, 'dreaming.remPhaseHitCount'),
    promotedTotal: requiredNumber(value.promotedTotal, 'dreaming.promotedTotal'),
    promotedToday: requiredNumber(value.promotedToday, 'dreaming.promotedToday'),
    phases: {
      light: parsePhase(value.phases.light, 'dreaming.phases.light'),
      deep: parsePhase(value.phases.deep, 'dreaming.phases.deep'),
      rem: parsePhase(value.phases.rem, 'dreaming.phases.rem'),
    },
  };
  const timezone = optionalString(value.timezone, 'dreaming.timezone');
  const storeError = optionalString(value.storeError, 'dreaming.storeError');
  if (timezone) result.timezone = timezone;
  if (storeError) result.storeError = storeError;
  return result;
}

export function buildMemoryStatusParams(agentId?: string, deep = false): MemoryStatusParams {
  const normalizedAgentId = agentId?.trim();
  return {
    ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
    ...(deep ? { probe: true, deep: true } : {}),
  };
}

export function parseMemoryStatusResult(value: unknown): MemoryStatusResult {
  if (!isRecord(value)) throw new Error('doctor.memory.status returned an invalid result');
  const result: MemoryStatusResult = {
    agentId: requiredString(value.agentId, 'agentId'),
    embedding: parseEmbedding(value.embedding),
  };
  const provider = optionalString(value.provider, 'provider');
  if (provider) result.provider = provider;
  if (value.dreaming !== undefined) result.dreaming = parseDreaming(value.dreaming);
  return result;
}

export function buildMemoryRemHarnessParams(options: MemoryRemHarnessParams = {}): MemoryRemHarnessParams {
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)) {
    throw new Error('doctor.memory.remHarness limit must be an integer from 1 to 100');
  }
  return {
    ...(options.grounded === undefined ? {} : { grounded: options.grounded }),
    ...(options.includePromoted === undefined ? {} : { includePromoted: options.includePromoted }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  };
}

function parseGrounded(value: unknown): MemoryGroundedPreview | null {
  if (value === null) return null;
  if (!isRecord(value) || !Array.isArray(value.files)) {
    throw new Error('doctor.memory.remHarness returned invalid grounded preview');
  }
  return {
    scannedFiles: requiredNumber(value.scannedFiles, 'grounded.scannedFiles'),
    files: value.files.map((file, index) => {
      if (!isRecord(file)) throw new Error(`doctor.memory.remHarness returned invalid grounded.files[${index}]`);
      return {
        path: requiredString(file.path, `grounded.files[${index}].path`),
        renderedMarkdown: requiredString(file.renderedMarkdown, `grounded.files[${index}].renderedMarkdown`, true),
      };
    }),
  };
}

function parseDeepCandidate(value: unknown, index: number): MemoryDeepCandidate {
  if (!isRecord(value)) throw new Error(`doctor.memory.remHarness returned invalid deep.candidates[${index}]`);
  const result: MemoryDeepCandidate = {
    key: requiredString(value.key, `deep.candidates[${index}].key`),
    path: requiredString(value.path, `deep.candidates[${index}].path`),
    startLine: requiredNumber(value.startLine, `deep.candidates[${index}].startLine`),
    endLine: requiredNumber(value.endLine, `deep.candidates[${index}].endLine`),
    snippet: requiredString(value.snippet, `deep.candidates[${index}].snippet`, true),
    recallCount: requiredNumber(value.recallCount, `deep.candidates[${index}].recallCount`),
    uniqueQueries: requiredNumber(value.uniqueQueries, `deep.candidates[${index}].uniqueQueries`),
    avgScore: requiredNumber(value.avgScore, `deep.candidates[${index}].avgScore`),
    maxScore: requiredNumber(value.maxScore, `deep.candidates[${index}].maxScore`),
    ageDays: requiredNumber(value.ageDays, `deep.candidates[${index}].ageDays`),
    promoted: requiredBoolean(value.promoted, `deep.candidates[${index}].promoted`),
  };
  const firstRecalledAt = optionalString(value.firstRecalledAt, `deep.candidates[${index}].firstRecalledAt`);
  const lastRecalledAt = optionalString(value.lastRecalledAt, `deep.candidates[${index}].lastRecalledAt`);
  const promotedAt = optionalString(value.promotedAt, `deep.candidates[${index}].promotedAt`);
  if (firstRecalledAt) result.firstRecalledAt = firstRecalledAt;
  if (lastRecalledAt) result.lastRecalledAt = lastRecalledAt;
  if (promotedAt) result.promotedAt = promotedAt;
  return result;
}

export function parseMemoryRemHarnessResult(value: unknown): MemoryRemHarnessResult {
  if (!isRecord(value)) throw new Error('doctor.memory.remHarness returned an invalid result');
  const agentId = requiredString(value.agentId, 'agentId');
  const workspaceDir = requiredString(value.workspaceDir, 'workspaceDir');
  if (value.ok === false) {
    return {
      ok: false,
      agentId,
      workspaceDir,
      error: requiredString(value.error, 'error', true),
    };
  }
  if (value.ok !== true || !isRecord(value.remConfig) || !isRecord(value.deepConfig) || !isRecord(value.rem) || !isRecord(value.deep)) {
    throw new Error('doctor.memory.remHarness returned an incomplete success result');
  }
  if (!Array.isArray(value.rem.reflections) || !Array.isArray(value.rem.candidateTruths) || !Array.isArray(value.rem.bodyLines)) {
    throw new Error('doctor.memory.remHarness returned invalid rem preview');
  }
  if (!Array.isArray(value.deep.candidates)) throw new Error('doctor.memory.remHarness returned invalid deep candidates');
  const grounded = parseGrounded(value.grounded);
  return {
    ok: true,
    agentId,
    workspaceDir,
    remConfig: {
      enabled: requiredBoolean(value.remConfig.enabled, 'remConfig.enabled'),
      lookbackDays: requiredNumber(value.remConfig.lookbackDays, 'remConfig.lookbackDays'),
      limit: requiredNumber(value.remConfig.limit, 'remConfig.limit'),
      minPatternStrength: requiredNumber(value.remConfig.minPatternStrength, 'remConfig.minPatternStrength'),
    },
    deepConfig: {
      minScore: requiredNumber(value.deepConfig.minScore, 'deepConfig.minScore'),
      minRecallCount: requiredNumber(value.deepConfig.minRecallCount, 'deepConfig.minRecallCount'),
      minUniqueQueries: requiredNumber(value.deepConfig.minUniqueQueries, 'deepConfig.minUniqueQueries'),
      recencyHalfLifeDays: requiredNumber(value.deepConfig.recencyHalfLifeDays, 'deepConfig.recencyHalfLifeDays'),
      maxAgeDays: optionalNullableNumber(value.deepConfig.maxAgeDays, 'deepConfig.maxAgeDays'),
    },
    rem: {
      skipped: requiredBoolean(value.rem.skipped, 'rem.skipped'),
      sourceEntryCount: requiredNumber(value.rem.sourceEntryCount, 'rem.sourceEntryCount'),
      reflections: value.rem.reflections.map((entry, index) => requiredString(entry, `rem.reflections[${index}]`, true)),
      candidateTruths: value.rem.candidateTruths.map((entry, index) => {
        if (!isRecord(entry)) throw new Error(`doctor.memory.remHarness returned invalid rem.candidateTruths[${index}]`);
        return {
          snippet: requiredString(entry.snippet, `rem.candidateTruths[${index}].snippet`, true),
          confidence: requiredNumber(entry.confidence, `rem.candidateTruths[${index}].confidence`),
        };
      }),
      bodyLines: value.rem.bodyLines.map((entry, index) => requiredString(entry, `rem.bodyLines[${index}]`, true)),
    },
    grounded,
    deep: {
      candidateLimit: requiredNumber(value.deep.candidateLimit, 'deep.candidateLimit'),
      truncated: requiredBoolean(value.deep.truncated, 'deep.truncated'),
      candidates: value.deep.candidates.map((entry, index) => parseDeepCandidate(entry, index)),
    },
  };
}
