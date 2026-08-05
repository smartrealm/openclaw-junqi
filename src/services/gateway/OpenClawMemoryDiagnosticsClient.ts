export const OPENCLAW_MEMORY_STATUS_METHOD = 'doctor.memory.status' as const;
export const OPENCLAW_MEMORY_REM_HARNESS_METHOD = 'doctor.memory.remHarness' as const;
export const OPENCLAW_MEMORY_REM_HARNESS_MAX_LIMIT = 100;

export interface OpenClawMemoryStatusInput {
  readonly agentId?: string;
  readonly probe?: boolean;
  readonly deep?: boolean;
}

export interface OpenClawMemoryEmbeddingStatus {
  readonly ok: boolean;
  readonly error?: string;
  readonly checked?: boolean;
  readonly cached?: boolean;
  readonly checkedAtMs?: number;
  readonly cacheExpiresAtMs?: number;
}

export interface OpenClawMemoryEmbeddingRuntime {
  readonly engine: 'llama.cpp';
  readonly state: 'ready' | 'failed';
  readonly backend?: 'metal' | 'cuda' | 'vulkan' | 'cpu';
  readonly buildType?: 'localBuild' | 'prebuilt';
  readonly deviceNames?: readonly string[];
  readonly memory?: {
    readonly totalBytes: number;
    readonly usedBytes: number;
    readonly freeBytes: number;
    readonly unifiedBytes: number;
    readonly observedAtMs: number;
  };
  readonly offload?: {
    readonly supported: boolean;
    readonly offloadedLayers?: number;
    readonly totalLayers?: number;
  };
  readonly context?: {
    readonly requestedSize: number | 'auto';
  };
  readonly loadError?: string;
}

export interface OpenClawMemoryStatus {
  readonly agentId: string;
  readonly provider?: string;
  readonly embedding: OpenClawMemoryEmbeddingStatus;
  readonly embeddingRuntime?: OpenClawMemoryEmbeddingRuntime;
}

export interface OpenClawMemoryRemHarnessInput {
  readonly grounded?: boolean;
  readonly includePromoted?: boolean;
  readonly limit?: number;
}

export interface OpenClawMemoryRemConfig {
  readonly enabled: boolean;
  readonly lookbackDays: number;
  readonly limit: number;
  readonly minPatternStrength: number;
}

export interface OpenClawMemoryDeepConfig {
  readonly minScore: number;
  readonly minRecallCount: number;
  readonly minUniqueQueries: number;
  readonly recencyHalfLifeDays: number;
  readonly maxAgeDays: number | null;
}

export interface OpenClawMemoryRemCandidateTruth {
  readonly snippet: string;
  readonly confidence: number;
}

export interface OpenClawMemoryRemHarnessCandidate {
  readonly key: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly snippet: string;
  readonly recallCount: number;
  readonly uniqueQueries: number;
  readonly avgScore: number;
  readonly maxScore: number;
  readonly ageDays: number;
  readonly firstRecalledAt: string;
  readonly lastRecalledAt: string;
  readonly promoted: boolean;
  readonly promotedAt?: string;
}

export interface OpenClawMemoryGroundedFile {
  readonly path: string;
  readonly renderedMarkdown: string;
}

export interface OpenClawMemoryRemHarnessSuccess {
  readonly ok: true;
  readonly agentId: string;
  readonly workspaceDir: string;
  readonly remConfig: OpenClawMemoryRemConfig;
  readonly deepConfig: OpenClawMemoryDeepConfig;
  readonly rem: {
    readonly skipped: boolean;
    readonly sourceEntryCount: number;
    readonly reflections: readonly string[];
    readonly candidateTruths: readonly OpenClawMemoryRemCandidateTruth[];
    readonly bodyLines: readonly string[];
  };
  readonly grounded: {
    readonly scannedFiles: number;
    readonly files: readonly OpenClawMemoryGroundedFile[];
  } | null;
  readonly deep: {
    readonly candidateLimit: number;
    readonly truncated: boolean;
    readonly candidates: readonly OpenClawMemoryRemHarnessCandidate[];
  };
}

export interface OpenClawMemoryRemHarnessError {
  readonly ok: false;
  readonly agentId: string;
  readonly workspaceDir: string;
  readonly error: string;
}

export type OpenClawMemoryRemHarness =
  | OpenClawMemoryRemHarnessSuccess
  | OpenClawMemoryRemHarnessError;

export type OpenClawMemoryDiagnosticsRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawMemoryDiagnosticsResponseError extends Error {
  readonly code = 'OPENCLAW_MEMORY_DIAGNOSTICS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid memory diagnostics response');
    this.name = 'OpenClawMemoryDiagnosticsResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OpenClawMemoryDiagnosticsResponseError();
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new OpenClawMemoryDiagnosticsResponseError();
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return booleanValue(value);
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new OpenClawMemoryDiagnosticsResponseError();
  }
  return value;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OpenClawMemoryDiagnosticsResponseError();
  }
  return value;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new OpenClawMemoryDiagnosticsResponseError();
  return value.map(requiredString);
}

function contentString(value: unknown): string {
  if (typeof value !== 'string') throw new OpenClawMemoryDiagnosticsResponseError();
  return value;
}

function contentStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new OpenClawMemoryDiagnosticsResponseError();
  return value.map(contentString);
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new OpenClawMemoryDiagnosticsResponseError();
  }
  return value as T;
}

function parseEmbedding(value: unknown): OpenClawMemoryEmbeddingStatus {
  const source = record(value);
  if (!source) throw new OpenClawMemoryDiagnosticsResponseError();
  const error = optionalString(source.error);
  const checked = optionalBoolean(source.checked);
  const cached = optionalBoolean(source.cached);
  const checkedAtMs = source.checkedAtMs === undefined ? undefined : nonNegativeInteger(source.checkedAtMs);
  const cacheExpiresAtMs = source.cacheExpiresAtMs === undefined
    ? undefined
    : nonNegativeInteger(source.cacheExpiresAtMs);
  return {
    ok: booleanValue(source.ok),
    ...(error ? { error } : {}),
    ...(checked !== undefined ? { checked } : {}),
    ...(cached !== undefined ? { cached } : {}),
    ...(checkedAtMs !== undefined ? { checkedAtMs } : {}),
    ...(cacheExpiresAtMs !== undefined ? { cacheExpiresAtMs } : {}),
  };
}

function parseEmbeddingRuntime(value: unknown): OpenClawMemoryEmbeddingRuntime {
  const source = record(value);
  if (!source) throw new OpenClawMemoryDiagnosticsResponseError();
  const backend = source.backend === undefined
    ? undefined
    : enumValue(source.backend, ['metal', 'cuda', 'vulkan', 'cpu'] as const);
  const buildType = source.buildType === undefined
    ? undefined
    : enumValue(source.buildType, ['localBuild', 'prebuilt'] as const);
  const deviceNames = source.deviceNames === undefined ? undefined : stringArray(source.deviceNames);
  let memory: OpenClawMemoryEmbeddingRuntime['memory'];
  if (source.memory !== undefined) {
    const memorySource = record(source.memory);
    if (!memorySource) throw new OpenClawMemoryDiagnosticsResponseError();
    memory = {
      totalBytes: nonNegativeInteger(memorySource.totalBytes),
      usedBytes: nonNegativeInteger(memorySource.usedBytes),
      freeBytes: nonNegativeInteger(memorySource.freeBytes),
      unifiedBytes: nonNegativeInteger(memorySource.unifiedBytes),
      observedAtMs: nonNegativeInteger(memorySource.observedAtMs),
    };
  }
  let offload: OpenClawMemoryEmbeddingRuntime['offload'];
  if (source.offload !== undefined) {
    const offloadSource = record(source.offload);
    if (!offloadSource) throw new OpenClawMemoryDiagnosticsResponseError();
    const offloadedLayers = offloadSource.offloadedLayers === undefined
      ? undefined
      : nonNegativeInteger(offloadSource.offloadedLayers);
    const totalLayers = offloadSource.totalLayers === undefined
      ? undefined
      : nonNegativeInteger(offloadSource.totalLayers);
    offload = {
      supported: booleanValue(offloadSource.supported),
      ...(offloadedLayers !== undefined ? { offloadedLayers } : {}),
      ...(totalLayers !== undefined ? { totalLayers } : {}),
    };
  }
  let context: OpenClawMemoryEmbeddingRuntime['context'];
  if (source.context !== undefined) {
    const contextSource = record(source.context);
    if (!contextSource) throw new OpenClawMemoryDiagnosticsResponseError();
    const requestedSize = contextSource.requestedSize === 'auto'
      ? 'auto'
      : nonNegativeInteger(contextSource.requestedSize);
    context = { requestedSize };
  }
  const loadError = optionalString(source.loadError);
  return {
    engine: enumValue(source.engine, ['llama.cpp'] as const),
    state: enumValue(source.state, ['ready', 'failed'] as const),
    ...(backend ? { backend } : {}),
    ...(buildType ? { buildType } : {}),
    ...(deviceNames ? { deviceNames } : {}),
    ...(memory ? { memory } : {}),
    ...(offload ? { offload } : {}),
    ...(context ? { context } : {}),
    ...(loadError ? { loadError } : {}),
  };
}

/** Decode the official read-only doctor.memory.status response. */
export function parseOpenClawMemoryStatus(value: unknown): OpenClawMemoryStatus {
  const source = record(value);
  if (!source) throw new OpenClawMemoryDiagnosticsResponseError();
  const provider = optionalString(source.provider);
  const embeddingRuntime = source.embeddingRuntime === undefined
    ? undefined
    : parseEmbeddingRuntime(source.embeddingRuntime);
  return {
    agentId: requiredString(source.agentId),
    ...(provider ? { provider } : {}),
    embedding: parseEmbedding(source.embedding),
    ...(embeddingRuntime ? { embeddingRuntime } : {}),
  };
}

function parseRemConfig(value: unknown): OpenClawMemoryRemConfig {
  const source = record(value);
  if (!source) throw new OpenClawMemoryDiagnosticsResponseError();
  return {
    enabled: booleanValue(source.enabled),
    lookbackDays: nonNegativeInteger(source.lookbackDays),
    limit: nonNegativeInteger(source.limit),
    minPatternStrength: finiteNumber(source.minPatternStrength),
  };
}

function parseDeepConfig(value: unknown): OpenClawMemoryDeepConfig {
  const source = record(value);
  if (!source) throw new OpenClawMemoryDiagnosticsResponseError();
  const maxAgeDays = source.maxAgeDays;
  if (maxAgeDays === undefined || (maxAgeDays !== null && typeof maxAgeDays !== 'number')) {
    throw new OpenClawMemoryDiagnosticsResponseError();
  }
  return {
    minScore: finiteNumber(source.minScore),
    minRecallCount: nonNegativeInteger(source.minRecallCount),
    minUniqueQueries: nonNegativeInteger(source.minUniqueQueries),
    recencyHalfLifeDays: finiteNumber(source.recencyHalfLifeDays),
    maxAgeDays,
  };
}

function parseCandidateTruth(value: unknown): OpenClawMemoryRemCandidateTruth {
  const source = record(value);
  if (!source) throw new OpenClawMemoryDiagnosticsResponseError();
  return {
    snippet: contentString(source.snippet),
    confidence: finiteNumber(source.confidence),
  };
}

function parseGroundedFile(value: unknown): OpenClawMemoryGroundedFile {
  const source = record(value);
  if (!source) throw new OpenClawMemoryDiagnosticsResponseError();
  return {
    path: requiredString(source.path),
    renderedMarkdown: contentString(source.renderedMarkdown),
  };
}

function parseCandidate(value: unknown): OpenClawMemoryRemHarnessCandidate {
  const source = record(value);
  if (!source) throw new OpenClawMemoryDiagnosticsResponseError();
  const promotedAt = optionalString(source.promotedAt);
  return {
    key: requiredString(source.key),
    path: requiredString(source.path),
    startLine: nonNegativeInteger(source.startLine),
    endLine: nonNegativeInteger(source.endLine),
    snippet: contentString(source.snippet),
    recallCount: nonNegativeInteger(source.recallCount),
    uniqueQueries: nonNegativeInteger(source.uniqueQueries),
    avgScore: finiteNumber(source.avgScore),
    maxScore: finiteNumber(source.maxScore),
    ageDays: finiteNumber(source.ageDays),
    firstRecalledAt: requiredString(source.firstRecalledAt),
    lastRecalledAt: requiredString(source.lastRecalledAt),
    promoted: booleanValue(source.promoted),
    ...(promotedAt ? { promotedAt } : {}),
  };
}

/** Decode the official read-only doctor.memory.remHarness response. */
export function parseOpenClawMemoryRemHarness(value: unknown): OpenClawMemoryRemHarness {
  const source = record(value);
  if (!source) throw new OpenClawMemoryDiagnosticsResponseError();
  const agentId = requiredString(source.agentId);
  const workspaceDir = requiredString(source.workspaceDir);
  if (source.ok === false) {
    return {
      ok: false,
      agentId,
      workspaceDir,
      error: requiredString(source.error),
    };
  }
  if (source.ok !== true) throw new OpenClawMemoryDiagnosticsResponseError();
  const remSource = record(source.rem);
  const groundedSource = source.grounded;
  const deepSource = record(source.deep);
  if (!remSource || !deepSource || (groundedSource !== null && !record(groundedSource))) {
    throw new OpenClawMemoryDiagnosticsResponseError();
  }
  const grounded = groundedSource === null
    ? null
    : (() => {
        const groundedRecord = record(groundedSource);
        if (!groundedRecord || !Array.isArray(groundedRecord.files)) {
          throw new OpenClawMemoryDiagnosticsResponseError();
        }
        return {
          scannedFiles: nonNegativeInteger(groundedRecord.scannedFiles),
          files: groundedRecord.files.map(parseGroundedFile),
        };
      })();
  if (!Array.isArray(remSource.reflections) || !Array.isArray(remSource.candidateTruths) || !Array.isArray(remSource.bodyLines)) {
    throw new OpenClawMemoryDiagnosticsResponseError();
  }
  if (!Array.isArray(deepSource.candidates)) throw new OpenClawMemoryDiagnosticsResponseError();
  return {
    ok: true,
    agentId,
    workspaceDir,
    remConfig: parseRemConfig(source.remConfig),
    deepConfig: parseDeepConfig(source.deepConfig),
    rem: {
      skipped: booleanValue(remSource.skipped),
      sourceEntryCount: nonNegativeInteger(remSource.sourceEntryCount),
      reflections: contentStringArray(remSource.reflections),
      candidateTruths: remSource.candidateTruths.map(parseCandidateTruth),
      bodyLines: contentStringArray(remSource.bodyLines),
    },
    grounded,
    deep: {
      candidateLimit: nonNegativeInteger(deepSource.candidateLimit),
      truncated: booleanValue(deepSource.truncated),
      candidates: deepSource.candidates.map(parseCandidate),
    },
  };
}

function buildStatusParams(input: OpenClawMemoryStatusInput): Record<string, unknown> {
  const agentId = input.agentId === undefined
    ? undefined
    : typeof input.agentId === 'string' && input.agentId.trim()
      ? input.agentId.trim()
      : (() => { throw new Error('Invalid OpenClaw memory status agentId'); })();
  if (input.probe !== undefined && typeof input.probe !== 'boolean') {
    throw new Error('Invalid OpenClaw memory status probe flag');
  }
  if (input.deep !== undefined && typeof input.deep !== 'boolean') {
    throw new Error('Invalid OpenClaw memory status deep flag');
  }
  return {
    ...(agentId ? { agentId } : {}),
    ...(input.probe !== undefined ? { probe: input.probe } : {}),
    ...(input.deep !== undefined ? { deep: input.deep } : {}),
  };
}

function buildRemHarnessParams(input: OpenClawMemoryRemHarnessInput): Record<string, unknown> {
  if (input.grounded !== undefined && typeof input.grounded !== 'boolean') {
    throw new Error('Invalid OpenClaw REM harness grounded flag');
  }
  if (input.includePromoted !== undefined && typeof input.includePromoted !== 'boolean') {
    throw new Error('Invalid OpenClaw REM harness promoted flag');
  }
  if (input.limit !== undefined && (
    !Number.isInteger(input.limit)
    || input.limit < 1
    || input.limit > OPENCLAW_MEMORY_REM_HARNESS_MAX_LIMIT
  )) {
    throw new Error('Invalid OpenClaw REM harness limit');
  }
  return {
    ...(input.grounded !== undefined ? { grounded: input.grounded } : {}),
    ...(input.includePromoted !== undefined ? { includePromoted: input.includePromoted } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };
}

/** Narrow client for OpenClaw's read-only memory diagnostics RPCs. */
export class OpenClawMemoryDiagnosticsClient {
  constructor(private readonly request: OpenClawMemoryDiagnosticsRequester) {}

  async status(input: OpenClawMemoryStatusInput = {}): Promise<OpenClawMemoryStatus> {
    return parseOpenClawMemoryStatus(
      await this.request<unknown>(OPENCLAW_MEMORY_STATUS_METHOD, buildStatusParams(input)),
    );
  }

  async remHarness(input: OpenClawMemoryRemHarnessInput = {}): Promise<OpenClawMemoryRemHarness> {
    return parseOpenClawMemoryRemHarness(
      await this.request<unknown>(OPENCLAW_MEMORY_REM_HARNESS_METHOD, buildRemHarnessParams(input)),
    );
  }
}
