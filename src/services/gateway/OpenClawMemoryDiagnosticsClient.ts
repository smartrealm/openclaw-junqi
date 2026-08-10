export const OPENCLAW_MEMORY_STATUS_METHOD = 'doctor.memory.status' as const;

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

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new OpenClawMemoryDiagnosticsResponseError();
  return value.map(requiredString);
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

/** 只封装 OpenClaw 当前保留的只读记忆诊断 RPC。 */
export class OpenClawMemoryDiagnosticsClient {
  constructor(private readonly request: OpenClawMemoryDiagnosticsRequester) {}

  async status(input: OpenClawMemoryStatusInput = {}): Promise<OpenClawMemoryStatus> {
    return parseOpenClawMemoryStatus(
      await this.request<unknown>(OPENCLAW_MEMORY_STATUS_METHOD, buildStatusParams(input)),
    );
  }
}
