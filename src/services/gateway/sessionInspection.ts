export type SessionPreviewRole = 'user' | 'assistant' | 'system' | 'tool' | 'other';
export type SessionPreviewStatus = 'ok' | 'empty' | 'missing' | 'error';
export type SessionCompactionCheckpointReason = 'manual' | 'auto-threshold' | 'overflow-retry' | 'timeout-retry';

export interface SessionsPreviewParams {
  keys: string[];
  limit?: number;
  maxChars?: number;
}

export interface SessionPreviewItem {
  role: SessionPreviewRole;
  text: string;
}

export interface SessionPreview {
  key: string;
  status: SessionPreviewStatus;
  items: SessionPreviewItem[];
}

export interface SessionsPreviewResult {
  ts: number;
  previews: SessionPreview[];
}

export interface SessionsResolveParams {
  key?: string;
  sessionId?: string;
  label?: string;
  agentId?: string;
  spawnedBy?: string;
  includeGlobal?: boolean;
  includeUnknown?: boolean;
  allowMissing?: boolean;
}

export type SessionsResolveResult =
  | { ok: false }
  | { ok: true; key: string };

export interface SessionTranscriptReference {
  sessionId: string;
  sessionFile?: string;
  leafId?: string;
  entryId?: string;
}

export interface SessionCompactionCheckpoint {
  checkpointId: string;
  sessionKey: string;
  sessionId: string;
  createdAt: number;
  reason: SessionCompactionCheckpointReason;
  tokensBefore?: number;
  tokensAfter?: number;
  summary?: string;
  firstKeptEntryId?: string;
  preCompaction: SessionTranscriptReference;
  postCompaction: SessionTranscriptReference;
}

export interface SessionsCompactionListResult {
  ok: true;
  key: string;
  checkpoints: SessionCompactionCheckpoint[];
}

export interface SessionsCompactionCheckpointParams {
  key: string;
  agentId?: string;
  checkpointId: string;
}

export interface SessionCompactionEntryMetadata {
  sessionId: string;
  updatedAt: number;
  [key: string]: unknown;
}

export interface SessionsCompactionBranchResult {
  ok: true;
  sourceKey: string;
  key: string;
  sessionId: string;
  checkpoint: SessionCompactionCheckpoint;
  entry: SessionCompactionEntryMetadata;
}

export interface SessionsCompactionRestoreResult {
  ok: true;
  key: string;
  sessionId: string;
  checkpoint: SessionCompactionCheckpoint;
  entry: SessionCompactionEntryMetadata;
}

const PREVIEW_ROLES: readonly SessionPreviewRole[] = ['user', 'assistant', 'system', 'tool', 'other'];
const PREVIEW_STATUSES: readonly SessionPreviewStatus[] = ['ok', 'empty', 'missing', 'error'];
const CHECKPOINT_REASONS: readonly SessionCompactionCheckpointReason[] = [
  'manual',
  'auto-threshold',
  'overflow-retry',
  'timeout-retry',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, method: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  return value.trim();
}

function text(value: unknown, field: string, method: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  return value;
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

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string, method: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  return value as T;
}

function requiredKey(value: string, method: string): string {
  return requiredString(value, 'session key', method);
}

export function buildSessionsPreviewParams(
  keys: string[],
  options: Pick<SessionsPreviewParams, 'limit' | 'maxChars'> = {},
): SessionsPreviewParams {
  const normalizedKeys = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (normalizedKeys.length === 0) throw new Error('sessions.preview requires at least one session key');
  const limit = options.limit === undefined ? undefined : Math.floor(options.limit);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error('sessions.preview limit must be a positive integer');
  }
  const maxChars = options.maxChars === undefined ? undefined : Math.floor(options.maxChars);
  if (maxChars !== undefined && (!Number.isSafeInteger(maxChars) || maxChars < 20)) {
    throw new Error('sessions.preview maxChars must be at least 20');
  }
  return {
    keys: normalizedKeys,
    ...(limit !== undefined ? { limit } : {}),
    ...(maxChars !== undefined ? { maxChars } : {}),
  };
}

export function parseSessionsPreviewResult(value: unknown): SessionsPreviewResult {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.ts)
    || (value.ts as number) < 0
    || !Array.isArray(value.previews)) {
    throw new Error('sessions.preview returned an invalid result');
  }
  return {
    ts: value.ts as number,
    previews: value.previews.map((preview, index) => {
      if (!isRecord(preview) || !Array.isArray(preview.items)) {
        throw new Error(`sessions.preview returned an invalid preview at index ${index}`);
      }
      return {
        key: requiredString(preview.key, `previews[${index}].key`, 'sessions.preview'),
        status: enumValue(preview.status, PREVIEW_STATUSES, `previews[${index}].status`, 'sessions.preview'),
        items: preview.items.map((item, itemIndex) => {
          if (!isRecord(item)) throw new Error(`sessions.preview returned an invalid item at ${index}:${itemIndex}`);
          return {
            role: enumValue(item.role, PREVIEW_ROLES, `previews[${index}].items[${itemIndex}].role`, 'sessions.preview'),
            text: text(item.text, `previews[${index}].items[${itemIndex}].text`, 'sessions.preview'),
          };
        }),
      };
    }),
  };
}

export function requireSessionPreview(
  result: SessionsPreviewResult,
  expectedKey: string,
): SessionPreview {
  const key = requiredKey(expectedKey, 'sessions.preview');
  const preview = result.previews.find((candidate) => candidate.key === key);
  if (!preview) throw new Error('sessions.preview returned no preview for the requested session');
  return preview;
}

export function buildSessionsResolveParams(
  selector: string,
  options: Pick<SessionsResolveParams, 'agentId' | 'includeGlobal' | 'includeUnknown' | 'allowMissing'> = {},
): SessionsResolveParams {
  const key = requiredKey(selector, 'sessions.resolve');
  const agentId = options.agentId?.trim();
  return {
    key,
    ...(agentId ? { agentId } : {}),
    ...(options.includeGlobal !== undefined ? { includeGlobal: options.includeGlobal } : {}),
    ...(options.includeUnknown !== undefined ? { includeUnknown: options.includeUnknown } : {}),
    ...(options.allowMissing !== undefined ? { allowMissing: options.allowMissing } : {}),
  };
}

export function parseSessionsResolveResult(value: unknown): SessionsResolveResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('sessions.resolve returned an invalid result');
  }
  if (!value.ok) return { ok: false };
  return {
    ok: true,
    key: requiredString(value.key, 'key', 'sessions.resolve'),
  };
}

export function buildSessionsCompactionListParams(key: string, agentId?: string) {
  const normalizedKey = requiredKey(key, 'sessions.compaction.list');
  const normalizedAgentId = agentId?.trim();
  return {
    key: normalizedKey,
    ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
  };
}

function parseTranscriptReference(
  value: unknown,
  field: string,
  method: 'sessions.compaction.list' | 'sessions.compaction.branch' | 'sessions.compaction.restore',
): SessionTranscriptReference {
  if (!isRecord(value)) throw new Error(`${method} returned an invalid ${field}`);
  const reference: SessionTranscriptReference = {
    sessionId: requiredString(value.sessionId, `${field}.sessionId`, method),
  };
  const sessionFile = optionalString(value.sessionFile, `${field}.sessionFile`, method);
  const leafId = optionalString(value.leafId, `${field}.leafId`, method);
  const entryId = optionalString(value.entryId, `${field}.entryId`, method);
  if (sessionFile) reference.sessionFile = sessionFile;
  if (leafId) reference.leafId = leafId;
  if (entryId) reference.entryId = entryId;
  return reference;
}

function parseCheckpoint(
  value: unknown,
  index: number,
  method: 'sessions.compaction.list' | 'sessions.compaction.branch' | 'sessions.compaction.restore',
): SessionCompactionCheckpoint {
  if (!isRecord(value)) throw new Error(`${method} returned an invalid checkpoint at index ${index}`);
  const field = `checkpoints[${index}]`;
  const checkpoint: SessionCompactionCheckpoint = {
    checkpointId: requiredString(value.checkpointId, `${field}.checkpointId`, method),
    sessionKey: requiredString(value.sessionKey, `${field}.sessionKey`, method),
    sessionId: requiredString(value.sessionId, `${field}.sessionId`, method),
    createdAt: optionalNonNegativeInteger(value.createdAt, `${field}.createdAt`, method) ?? (() => {
      throw new Error(`${method} returned an invalid ${field}.createdAt`);
    })(),
    reason: enumValue(value.reason, CHECKPOINT_REASONS, `${field}.reason`, method),
    preCompaction: parseTranscriptReference(value.preCompaction, `${field}.preCompaction`, method),
    postCompaction: parseTranscriptReference(value.postCompaction, `${field}.postCompaction`, method),
  };
  const tokensBefore = optionalNonNegativeInteger(value.tokensBefore, `${field}.tokensBefore`, method);
  const tokensAfter = optionalNonNegativeInteger(value.tokensAfter, `${field}.tokensAfter`, method);
  const summary = optionalString(value.summary, `${field}.summary`, method);
  const firstKeptEntryId = optionalString(value.firstKeptEntryId, `${field}.firstKeptEntryId`, method);
  if (tokensBefore !== undefined) checkpoint.tokensBefore = tokensBefore;
  if (tokensAfter !== undefined) checkpoint.tokensAfter = tokensAfter;
  if (summary !== undefined) checkpoint.summary = summary;
  if (firstKeptEntryId !== undefined) checkpoint.firstKeptEntryId = firstKeptEntryId;
  return checkpoint;
}

export function parseSessionsCompactionListResult(value: unknown, expectedKey?: string): SessionsCompactionListResult {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.checkpoints)) {
    throw new Error('sessions.compaction.list returned an invalid result');
  }
  const key = requiredString(value.key, 'key', 'sessions.compaction.list');
  if (expectedKey !== undefined && key !== requiredKey(expectedKey, 'sessions.compaction.list')) {
    throw new Error('sessions.compaction.list returned a different session key');
  }
  return {
    ok: true,
    key,
    checkpoints: value.checkpoints.map((checkpoint, index) => parseCheckpoint(checkpoint, index, 'sessions.compaction.list')),
  };
}

export function buildSessionsCompactionCheckpointParams(
  key: string,
  checkpointId: string,
  agentId?: string,
): SessionsCompactionCheckpointParams {
  const normalizedKey = requiredKey(key, 'sessions.compaction');
  const normalizedCheckpointId = requiredString(checkpointId, 'checkpointId', 'sessions.compaction');
  const normalizedAgentId = agentId?.trim();
  return {
    key: normalizedKey,
    ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
    checkpointId: normalizedCheckpointId,
  };
}

function parseSessionCompactionEntry(
  value: unknown,
  method: 'sessions.compaction.branch' | 'sessions.compaction.restore',
): SessionCompactionEntryMetadata {
  if (!isRecord(value)) throw new Error(`${method} returned an invalid entry`);
  const sessionId = requiredString(value.sessionId, 'entry.sessionId', method);
  const updatedAt = optionalNonNegativeInteger(value.updatedAt, 'entry.updatedAt', method);
  if (updatedAt === undefined) throw new Error(`${method} returned an invalid entry.updatedAt`);
  return { sessionId, updatedAt };
}

export function parseSessionsCompactionBranchResult(
  value: unknown,
  expectedSourceKey?: string,
): SessionsCompactionBranchResult {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.checkpoint)) {
    throw new Error('sessions.compaction.branch returned an invalid result');
  }
  const sourceKey = requiredString(value.sourceKey, 'sourceKey', 'sessions.compaction.branch');
  if (expectedSourceKey !== undefined && sourceKey !== requiredKey(expectedSourceKey, 'sessions.compaction.branch')) {
    throw new Error('sessions.compaction.branch returned a different source session key');
  }
  const key = requiredString(value.key, 'key', 'sessions.compaction.branch');
  const sessionId = requiredString(value.sessionId, 'sessionId', 'sessions.compaction.branch');
  const entry = parseSessionCompactionEntry(value.entry, 'sessions.compaction.branch');
  if (entry.sessionId !== sessionId) throw new Error('sessions.compaction.branch returned mismatched session identity');
  return {
    ok: true,
    sourceKey,
    key,
    sessionId,
    checkpoint: parseCheckpoint(value.checkpoint, 0, 'sessions.compaction.branch'),
    entry,
  };
}

export function parseSessionsCompactionRestoreResult(
  value: unknown,
  expectedKey?: string,
): SessionsCompactionRestoreResult {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.checkpoint)) {
    throw new Error('sessions.compaction.restore returned an invalid result');
  }
  const key = requiredString(value.key, 'key', 'sessions.compaction.restore');
  if (expectedKey !== undefined && key !== requiredKey(expectedKey, 'sessions.compaction.restore')) {
    throw new Error('sessions.compaction.restore returned a different session key');
  }
  const sessionId = requiredString(value.sessionId, 'sessionId', 'sessions.compaction.restore');
  const entry = parseSessionCompactionEntry(value.entry, 'sessions.compaction.restore');
  if (entry.sessionId !== sessionId) throw new Error('sessions.compaction.restore returned mismatched session identity');
  return {
    ok: true,
    key,
    sessionId,
    checkpoint: parseCheckpoint(value.checkpoint, 0, 'sessions.compaction.restore'),
    entry,
  };
}
