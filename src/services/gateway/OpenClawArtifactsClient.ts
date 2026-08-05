export const OPENCLAW_ARTIFACTS_LIST_METHOD = 'artifacts.list' as const;
export const OPENCLAW_ARTIFACTS_GET_METHOD = 'artifacts.get' as const;
export const OPENCLAW_ARTIFACTS_DOWNLOAD_METHOD = 'artifacts.download' as const;

export type OpenClawArtifactDownloadMode = 'bytes' | 'url' | 'unsupported';

export interface OpenClawArtifactScopeInput {
  readonly sessionKey?: string;
  readonly runId?: string;
  readonly taskId?: string;
  readonly agentId?: string;
}

export interface OpenClawArtifactInput extends OpenClawArtifactScopeInput {
  readonly artifactId: string;
}

export interface OpenClawArtifactDownloadDescriptor {
  readonly mode: OpenClawArtifactDownloadMode;
}

export interface OpenClawArtifactSummary {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly sessionKey?: string;
  readonly runId?: string;
  readonly taskId?: string;
  readonly messageSeq?: number;
  readonly source?: string;
  readonly download: OpenClawArtifactDownloadDescriptor;
}

export interface OpenClawArtifactsListResult {
  readonly artifacts: readonly OpenClawArtifactSummary[];
}

export interface OpenClawArtifactsGetResult {
  readonly artifact: OpenClawArtifactSummary;
}

export interface OpenClawArtifactsDownloadResult {
  readonly artifact: OpenClawArtifactSummary;
  readonly encoding?: 'base64';
  readonly data?: string;
  readonly url?: string;
  readonly expiresAt?: string;
}

export type OpenClawArtifactsRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawArtifactsResponseError extends Error {
  readonly code = 'OPENCLAW_ARTIFACTS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid artifacts response');
    this.name = 'OpenClawArtifactsResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = nonEmptyString(value);
  if (!normalized) throw new OpenClawArtifactsResponseError();
  return normalized;
}

function optionalInteger(value: unknown, minimum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new OpenClawArtifactsResponseError();
  }
  return value as number;
}

const DOWNLOAD_MODES: readonly OpenClawArtifactDownloadMode[] = ['bytes', 'url', 'unsupported'];

function parseDownloadDescriptor(value: unknown): OpenClawArtifactDownloadDescriptor {
  const source = record(value);
  if (!source || !DOWNLOAD_MODES.includes(source.mode as OpenClawArtifactDownloadMode)) {
    throw new OpenClawArtifactsResponseError();
  }
  return { mode: source.mode as OpenClawArtifactDownloadMode };
}

function parseSummary(value: unknown): OpenClawArtifactSummary {
  const source = record(value);
  const id = source ? nonEmptyString(source.id) : null;
  const type = source ? nonEmptyString(source.type) : null;
  const title = source ? nonEmptyString(source.title) : null;
  if (!source || !id || !type || !title || source.download === undefined) {
    throw new OpenClawArtifactsResponseError();
  }
  const mimeType = optionalString(source.mimeType);
  const sessionKey = optionalString(source.sessionKey);
  const runId = optionalString(source.runId);
  const taskId = optionalString(source.taskId);
  const sourceName = optionalString(source.source);
  const sizeBytes = optionalInteger(source.sizeBytes, 0);
  const messageSeq = optionalInteger(source.messageSeq, 1);
  return {
    id,
    type,
    title,
    ...(mimeType ? { mimeType } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(runId ? { runId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(messageSeq !== undefined ? { messageSeq } : {}),
    ...(sourceName ? { source: sourceName } : {}),
    download: parseDownloadDescriptor(source.download),
  };
}

export function parseOpenClawArtifactsListResult(value: unknown): OpenClawArtifactsListResult {
  const source = record(value);
  if (!source || !Array.isArray(source.artifacts)) {
    throw new OpenClawArtifactsResponseError();
  }
  const artifacts = source.artifacts.map(parseSummary);
  const ids = new Set<string>();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) throw new OpenClawArtifactsResponseError();
    ids.add(artifact.id);
  }
  return { artifacts };
}

export function parseOpenClawArtifactsGetResult(value: unknown): OpenClawArtifactsGetResult {
  const source = record(value);
  if (!source || source.artifact === undefined) {
    throw new OpenClawArtifactsResponseError();
  }
  return { artifact: parseSummary(source.artifact) };
}

export function parseOpenClawArtifactsDownloadResult(value: unknown): OpenClawArtifactsDownloadResult {
  const source = record(value);
  if (!source || source.artifact === undefined) {
    throw new OpenClawArtifactsResponseError();
  }
  if (source.encoding !== undefined && source.encoding !== 'base64') {
    throw new OpenClawArtifactsResponseError();
  }
  if (source.data !== undefined && typeof source.data !== 'string') {
    throw new OpenClawArtifactsResponseError();
  }
  const url = source.url === undefined ? undefined : optionalString(source.url);
  const expiresAt = source.expiresAt === undefined ? undefined : optionalString(source.expiresAt);
  return {
    artifact: parseSummary(source.artifact),
    ...(source.encoding !== undefined ? { encoding: 'base64' as const } : {}),
    ...(source.data !== undefined ? { data: source.data } : {}),
    ...(url ? { url } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function buildScope(input: OpenClawArtifactScopeInput): Record<string, unknown> {
  const sessionKey = input.sessionKey === undefined ? undefined : nonEmptyString(input.sessionKey);
  const runId = input.runId === undefined ? undefined : nonEmptyString(input.runId);
  const taskId = input.taskId === undefined ? undefined : nonEmptyString(input.taskId);
  const agentId = input.agentId === undefined ? undefined : nonEmptyString(input.agentId);
  if (input.sessionKey !== undefined && !sessionKey) throw new Error('Invalid OpenClaw artifact sessionKey');
  if (input.runId !== undefined && !runId) throw new Error('Invalid OpenClaw artifact runId');
  if (input.taskId !== undefined && !taskId) throw new Error('Invalid OpenClaw artifact taskId');
  if (input.agentId !== undefined && !agentId) throw new Error('Invalid OpenClaw artifact agentId');
  if (!sessionKey && !runId && !taskId) {
    throw new Error('OpenClaw artifacts requires sessionKey, runId, or taskId');
  }
  return {
    ...(sessionKey ? { sessionKey } : {}),
    ...(runId ? { runId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

function buildArtifactParams(input: OpenClawArtifactInput): Record<string, unknown> {
  const artifactId = nonEmptyString(input.artifactId);
  if (!artifactId) throw new Error('Invalid OpenClaw artifact artifactId');
  return { ...buildScope(input), artifactId };
}

/** Strict read-only client for OpenClaw's transcript artifact RPCs. */
export class OpenClawArtifactsClient {
  constructor(private readonly request: OpenClawArtifactsRequester) {}

  async list(input: OpenClawArtifactScopeInput): Promise<OpenClawArtifactsListResult> {
    return parseOpenClawArtifactsListResult(
      await this.request<unknown>(OPENCLAW_ARTIFACTS_LIST_METHOD, buildScope(input)),
    );
  }

  async get(input: OpenClawArtifactInput): Promise<OpenClawArtifactsGetResult> {
    return parseOpenClawArtifactsGetResult(
      await this.request<unknown>(OPENCLAW_ARTIFACTS_GET_METHOD, buildArtifactParams(input)),
    );
  }

  async download(input: OpenClawArtifactInput): Promise<OpenClawArtifactsDownloadResult> {
    return parseOpenClawArtifactsDownloadResult(
      await this.request<unknown>(OPENCLAW_ARTIFACTS_DOWNLOAD_METHOD, buildArtifactParams(input)),
    );
  }
}
