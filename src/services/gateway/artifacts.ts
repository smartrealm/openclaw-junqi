export type ArtifactDownloadMode = 'bytes' | 'url' | 'unsupported';

export interface ArtifactQueryParams {
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  agentId?: string;
}

export interface ArtifactSummary {
  id: string;
  type: string;
  title: string;
  mimeType?: string;
  sizeBytes?: number;
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  messageSeq?: number;
  source?: string;
  download: {
    mode: ArtifactDownloadMode;
  };
}

export interface ArtifactsListResult {
  artifacts: ArtifactSummary[];
}

export interface ArtifactGetResult {
  artifact: ArtifactSummary;
}

export type ArtifactDownloadResult =
  | {
      artifact: ArtifactSummary;
      encoding: 'base64';
      data: string;
    }
  | {
      artifact: ArtifactSummary;
      url: string;
    };

const DOWNLOAD_MODES: readonly ArtifactDownloadMode[] = ['bytes', 'url', 'unsupported'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, method: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, method: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field, method);
}

function optionalNonNegativeInteger(value: unknown, field: string, method: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  return value as number;
}

function optionalPositiveInteger(value: unknown, field: string, method: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  return value as number;
}

function normalizeSelector(value: string | undefined, field: string, method: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field, method);
}

function normalizedQuery(query: ArtifactQueryParams, method: string): ArtifactQueryParams {
  const result: ArtifactQueryParams = {
    ...(normalizeSelector(query.sessionKey, 'sessionKey', method)
      ? { sessionKey: normalizeSelector(query.sessionKey, 'sessionKey', method) }
      : {}),
    ...(normalizeSelector(query.runId, 'runId', method)
      ? { runId: normalizeSelector(query.runId, 'runId', method) }
      : {}),
    ...(normalizeSelector(query.taskId, 'taskId', method)
      ? { taskId: normalizeSelector(query.taskId, 'taskId', method) }
      : {}),
    ...(normalizeSelector(query.agentId, 'agentId', method)
      ? { agentId: normalizeSelector(query.agentId, 'agentId', method) }
      : {}),
  };
  if (!result.sessionKey && !result.runId && !result.taskId) {
    throw new Error(`${method} requires sessionKey, runId, or taskId`);
  }
  return result;
}

export function buildArtifactsListParams(query: ArtifactQueryParams): ArtifactQueryParams {
  return normalizedQuery(query, 'artifacts.list');
}

export function buildArtifactsGetParams(
  artifactId: string,
  query: ArtifactQueryParams,
): ArtifactQueryParams & { artifactId: string } {
  return {
    artifactId: requiredString(artifactId, 'artifactId', 'artifacts.get'),
    ...normalizedQuery(query, 'artifacts.get'),
  };
}

export function buildArtifactsDownloadParams(
  artifactId: string,
  query: ArtifactQueryParams,
): ArtifactQueryParams & { artifactId: string } {
  return {
    artifactId: requiredString(artifactId, 'artifactId', 'artifacts.download'),
    ...normalizedQuery(query, 'artifacts.download'),
  };
}

function parseArtifactSummary(value: unknown, field: string, method: string): ArtifactSummary {
  if (!isRecord(value) || !isRecord(value.download)) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  const mode = value.download.mode;
  if (typeof mode !== 'string' || !DOWNLOAD_MODES.includes(mode as ArtifactDownloadMode)) {
    throw new Error(`${method} returned an invalid ${field}.download.mode`);
  }
  const summary: ArtifactSummary = {
    id: requiredString(value.id, `${field}.id`, method),
    type: requiredString(value.type, `${field}.type`, method),
    title: requiredString(value.title, `${field}.title`, method),
    download: { mode: mode as ArtifactDownloadMode },
  };
  const mimeType = optionalString(value.mimeType, `${field}.mimeType`, method);
  const sizeBytes = optionalNonNegativeInteger(value.sizeBytes, `${field}.sizeBytes`, method);
  const sessionKey = optionalString(value.sessionKey, `${field}.sessionKey`, method);
  const runId = optionalString(value.runId, `${field}.runId`, method);
  const taskId = optionalString(value.taskId, `${field}.taskId`, method);
  const messageSeq = optionalPositiveInteger(value.messageSeq, `${field}.messageSeq`, method);
  const source = optionalString(value.source, `${field}.source`, method);
  if (mimeType) summary.mimeType = mimeType;
  if (sizeBytes !== undefined) summary.sizeBytes = sizeBytes;
  if (sessionKey) summary.sessionKey = sessionKey;
  if (runId) summary.runId = runId;
  if (taskId) summary.taskId = taskId;
  if (messageSeq !== undefined) summary.messageSeq = messageSeq;
  if (source) summary.source = source;
  return summary;
}

function assertSessionScope(summary: ArtifactSummary, expectedSessionKey: string | undefined, method: string): void {
  if (!expectedSessionKey || !summary.sessionKey) return;
  const normalizedExpected = requiredString(expectedSessionKey, 'sessionKey', method);
  if (summary.sessionKey !== normalizedExpected) {
    throw new Error(`${method} returned an artifact outside the requested session`);
  }
}

export function parseArtifactsListResult(
  value: unknown,
  expectedSessionKey?: string,
): ArtifactsListResult {
  if (!isRecord(value) || !Array.isArray(value.artifacts)) {
    throw new Error('artifacts.list returned an invalid result');
  }
  return {
    artifacts: value.artifacts.map((artifact, index) => {
      const summary = parseArtifactSummary(artifact, `artifacts[${index}]`, 'artifacts.list');
      assertSessionScope(summary, expectedSessionKey, 'artifacts.list');
      return summary;
    }),
  };
}

export function parseArtifactGetResult(
  value: unknown,
  expectedArtifactId: string,
  expectedSessionKey?: string,
): ArtifactGetResult {
  if (!isRecord(value)) throw new Error('artifacts.get returned an invalid result');
  const artifactId = requiredString(expectedArtifactId, 'artifactId', 'artifacts.get');
  const artifact = parseArtifactSummary(value.artifact, 'artifact', 'artifacts.get');
  if (artifact.id !== artifactId) throw new Error('artifacts.get returned a different artifact');
  assertSessionScope(artifact, expectedSessionKey, 'artifacts.get');
  return { artifact };
}

function isSafeArtifactUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || (value.startsWith('/api/') && !value.startsWith('//'));
}

function validateBase64(value: unknown, method: string): string {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    throw new Error(`${method} returned invalid base64 artifact data`);
  }
  return value;
}

export function parseArtifactDownloadResult(
  value: unknown,
  expectedArtifactId: string,
  expectedSessionKey?: string,
): ArtifactDownloadResult {
  if (!isRecord(value)) throw new Error('artifacts.download returned an invalid result');
  const artifactId = requiredString(expectedArtifactId, 'artifactId', 'artifacts.download');
  const artifact = parseArtifactSummary(value.artifact, 'artifact', 'artifacts.download');
  if (artifact.id !== artifactId) {
    throw new Error('artifacts.download returned a different artifact');
  }
  assertSessionScope(artifact, expectedSessionKey, 'artifacts.download');

  if (artifact.download.mode === 'bytes') {
    if (value.encoding !== 'base64') {
      throw new Error('artifacts.download returned bytes without base64 encoding');
    }
    return {
      artifact,
      encoding: 'base64',
      data: validateBase64(value.data, 'artifacts.download'),
    };
  }
  if (artifact.download.mode === 'url') {
    if (typeof value.url !== 'string' || !isSafeArtifactUrl(value.url)) {
      throw new Error('artifacts.download returned an unsafe URL');
    }
    return { artifact, url: value.url };
  }
  throw new Error('artifacts.download returned an unsupported artifact');
}
