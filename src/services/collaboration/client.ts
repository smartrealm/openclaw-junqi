import { gateway } from '@/services/gateway';
import {
  COLLABORATION_PLUGIN_BUNDLE,
  type CollaborationPluginBundleMetadata,
} from './bundledPlugin';
import { collaborationCapabilityIssue } from './capabilityContract';
import {
  CollaborationWireError,
  createCollaborationReadBoundary,
  decodeCapabilities,
  decodeCollaborationReadResponse,
  decodeEventsPage,
  decodeRunGetResponse,
  decodeRunListResponse,
  decodeWriteResponse,
  type DecodeRunListOptions,
} from './wire-codec';
import type {
  CollaborationCapabilities,
  CollaborationDeletePreview,
  CollaborationDeletionJob,
  CollaborationEventsPage,
  CollaborationExportArtifact,
  CollaborationExportJob,
  CollaborationPartialPreview,
  CollaborationReadMethod,
  CollaborationReadParams,
  CollaborationReadResponse,
  CollaborationRunGetResponse,
  CollaborationRunListResponse,
  CollaborationSessionRef,
  CollaborationSessionMutationImpactResponse,
  CollaborationTombstone,
  CollaborationTombstoneListResponse,
  CollaborationWriteEnvelope,
  CollaborationWriteMethod,
  CollaborationWriteRequest,
  CollaborationWriteResponse,
  CollaborationErrorCode,
} from './types';
import { isCollaborationErrorCode } from './types';

export type CollaborationRpcCall = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

export type CollaborationClientErrorCode = CollaborationErrorCode | 'METHOD_NOT_FOUND';

export class CollaborationClientError extends Error {
  constructor(
    public readonly code: CollaborationClientErrorCode,
    message: string,
    public readonly method: string,
    public readonly details?: Record<string, unknown>,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'CollaborationClientError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireRecord(value: unknown, method: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) {
    throw new CollaborationClientError('INVALID_RESPONSE', `${method} returned a non-object response`, method);
  }
  return record;
}

function requireInstanceId(record: Record<string, unknown>, method: string): string {
  const value = record.collaborationInstanceId;
  if (typeof value !== 'string' || !value.trim()) {
    throw new CollaborationClientError(
      'INVALID_RESPONSE',
      `${method} response is missing collaborationInstanceId`,
      method,
    );
  }
  return value;
}

function errorCodeFrom(value: unknown): CollaborationErrorCode {
  return isCollaborationErrorCode(value) ? value : 'RPC_FAILED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactUnknownMethodMessage(message: unknown, method: string): boolean {
  return typeof message === 'string'
    && /^(?:unknown method:?\s+|no handler for\s+)/i.test(message.trim())
    && message.trim().replace(/^(?:unknown method:?\s+|no handler for\s+)/i, '').trim().toLowerCase()
      === method.toLowerCase();
}

function methodFromMissingMessage(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const match = message.trim().match(/^(?:unknown method:?\s+|no handler for\s+)(\S+)$/i);
  return match?.[1] ?? null;
}

/** Normalize OpenClaw's transport-specific missing-method response safely. */
function isUnknownCollaborationMethodRecord(
  value: unknown,
  expectedMethods: readonly string[],
  depth = 0,
): boolean {
  if (depth > 4 || !isRecord(value)) return false;
  const code = value.code;
  const method = typeof value.method === 'string' ? value.method : null;
  const message = value.message;
  const messageMethod = methodFromMissingMessage(message);
  if (method && messageMethod && method !== messageMethod) return false;
  const candidateMethods = method
    ? [method]
    : messageMethod
      ? [messageMethod]
      : [];
  if (candidateMethods.some((candidate) => expectedMethods.includes(candidate))) {
    if (code === 'METHOD_NOT_FOUND') return true;
    if (code === 'INVALID_REQUEST' && candidateMethods.some((candidate) => hasExactUnknownMethodMessage(message, candidate))) {
      return true;
    }
  }
  return ['error', 'originalError', 'cause', 'details'].some((key) => (
    isUnknownCollaborationMethodRecord(value[key], expectedMethods, depth + 1)
  ));
}

export function isCollaborationMethodUnavailable(
  error: unknown,
  expectedMethods: readonly string[] = ['junqi.collab.capabilities', 'junqi.collab.maintenance.status'],
): boolean {
  if (error instanceof CollaborationClientError) {
    return error.code === 'METHOD_NOT_FOUND' && expectedMethods.includes(error.method);
  }
  return isUnknownCollaborationMethodRecord(error, expectedMethods);
}

function decodeWire<T>(method: string, decode: () => T): T {
  try {
    return decode();
  } catch (error) {
    if (error instanceof CollaborationWireError) {
      throw new CollaborationClientError(
        'INVALID_RESPONSE',
        `${method} returned an invalid response at ${error.path}`,
        method,
        { path: error.path },
        error,
      );
    }
    throw error;
  }
}

function normalizeRpcError(error: unknown, method: string): CollaborationClientError {
  if (error instanceof CollaborationClientError) return error;
  const record = asRecord(error);
  const nested = asRecord(record?.error);
  const message =
    (typeof record?.message === 'string' && record.message) ||
    (typeof nested?.message === 'string' && nested.message) ||
    (typeof error === 'string' && error) ||
    `Collaboration RPC failed: ${method}`;
  const transportCode = record?.code ?? nested?.code;
  const code = transportCode === 'METHOD_NOT_FOUND'
    || (transportCode === 'INVALID_REQUEST' && hasExactUnknownMethodMessage(message, method))
    ? 'METHOD_NOT_FOUND'
    : errorCodeFrom(transportCode);
  const details = asRecord(record?.details ?? nested?.details) ?? undefined;
  return new CollaborationClientError(code, message, method, details, error);
}

function readString(record: Record<string, unknown>, camel: string, snake = camel): string | undefined {
  const value = record[camel] ?? record[snake];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: Record<string, unknown>, camel: string, snake = camel): number | undefined {
  const value = record[camel] ?? record[snake];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function invalidTombstoneField(method: string, field: string): never {
  throw new CollaborationClientError(
    'INVALID_RESPONSE',
    `${method} returned an invalid tombstone field: ${field}`,
    method,
    { field },
  );
}

function readOptionalAliasedTombstoneField(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
  method: string,
): unknown {
  const hasCamel = Object.prototype.hasOwnProperty.call(record, camel);
  const hasSnake = Object.prototype.hasOwnProperty.call(record, snake);
  if (hasCamel && hasSnake && !Object.is(record[camel], record[snake])) {
    invalidTombstoneField(method, camel);
  }
  return hasCamel ? record[camel] : hasSnake ? record[snake] : undefined;
}

function readOptionalNullableTombstoneString(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
  method: string,
): string | null {
  const value = readOptionalAliasedTombstoneField(record, camel, snake, method);
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim()) invalidTombstoneField(method, camel);
  return value.trim();
}

function readOptionalNullableTombstoneInteger(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
  method: string,
): number | null {
  const value = readOptionalAliasedTombstoneField(record, camel, snake, method);
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidTombstoneField(method, camel);
  return Number(value);
}

function assertFlowReconciliationAuditEvidence(
  tombstone: Pick<
    CollaborationTombstone,
    | 'flowReconciliationCommandId'
    | 'openclawFlowId'
    | 'openclawFlowRevision'
    | 'flowReconciliationDiagnostic'
    | 'flowReconciliationAbandonedAt'
    | 'flowReconciliationAbandonReason'
  >,
  method: string,
): void {
  const hasAbandonment = tombstone.flowReconciliationCommandId !== null
    || tombstone.flowReconciliationAbandonedAt !== null
    || tombstone.flowReconciliationAbandonReason !== null;
  const hasSupportingEvidence = tombstone.openclawFlowId !== null
    || tombstone.openclawFlowRevision !== null
    || tombstone.flowReconciliationDiagnostic !== null;
  const hasCompleteAbandonment = tombstone.flowReconciliationCommandId !== null
    && tombstone.flowReconciliationAbandonedAt !== null
    && tombstone.flowReconciliationAbandonReason !== null;

  if ((!hasAbandonment && hasSupportingEvidence) || (hasAbandonment && !hasCompleteAbandonment)) {
    invalidTombstoneField(method, 'flowReconciliationAbandonment');
  }
}

function normalizeTombstone(value: unknown, method: string): CollaborationTombstone {
  const record = asRecord(value);
  const id = record ? readString(record, 'id')?.trim() : undefined;
  const runId = record ? readString(record, 'runId', 'run_id')?.trim() : undefined;
  const actor = record ? readString(record, 'actor')?.trim() : undefined;
  const contentDigest = record ? readString(record, 'contentDigest', 'content_digest')?.trim() : undefined;
  const deletedAt = record ? readNumber(record, 'deletedAt', 'deleted_at') : undefined;
  const cleanupStatus = record ? readString(record, 'cleanupStatus', 'cleanup_status') : undefined;
  const cleanupErrorValue = record?.cleanupError ?? record?.cleanup_error ?? null;
  const cleanupUpdatedAt = record ? readNumber(record, 'cleanupUpdatedAt', 'cleanup_updated_at') : undefined;
  const deletionJobIdValue = record?.deletionJobId ?? record?.deletion_job_id ?? null;
  const deletionJobStatusValue = record?.deletionJobStatus ?? record?.deletion_job_status ?? null;
  const deletionJobId = typeof deletionJobIdValue === 'string' ? deletionJobIdValue.trim() : deletionJobIdValue;
  if (
    !record
    || !id
    || !runId
    || !actor
    || !contentDigest
    || deletedAt === undefined
    || !Number.isSafeInteger(deletedAt)
    || deletedAt < 0
    || !['COMPLETED', 'PENDING', 'PARTIAL'].includes(cleanupStatus ?? '')
    || (cleanupErrorValue !== null && typeof cleanupErrorValue !== 'string')
    || cleanupUpdatedAt === undefined
    || !Number.isSafeInteger(cleanupUpdatedAt)
    || cleanupUpdatedAt < 0
    || (deletionJobId !== null && (typeof deletionJobId !== 'string' || !deletionJobId))
    || (deletionJobStatusValue !== null
      && !['PENDING', 'FAILED', 'PARTIAL', 'COMPLETED'].includes(String(deletionJobStatusValue)))
    || ((deletionJobId === null) !== (deletionJobStatusValue === null))
  ) {
    throw new CollaborationClientError('INVALID_RESPONSE', `${method} returned an invalid tombstone`, method);
  }
  const flowReconciliationAudit = {
    flowReconciliationCommandId: readOptionalNullableTombstoneString(
      record,
      'flowReconciliationCommandId',
      'flow_reconciliation_command_id',
      method,
    ),
    openclawFlowId: readOptionalNullableTombstoneString(
      record,
      'openclawFlowId',
      'openclaw_flow_id',
      method,
    ),
    openclawFlowRevision: readOptionalNullableTombstoneInteger(
      record,
      'openclawFlowRevision',
      'openclaw_flow_revision',
      method,
    ),
    flowReconciliationDiagnostic: readOptionalNullableTombstoneString(
      record,
      'flowReconciliationDiagnostic',
      'flow_reconciliation_diagnostic',
      method,
    ),
    flowReconciliationAbandonedAt: readOptionalNullableTombstoneInteger(
      record,
      'flowReconciliationAbandonedAt',
      'flow_reconciliation_abandoned_at',
      method,
    ),
    flowReconciliationAbandonReason: readOptionalNullableTombstoneString(
      record,
      'flowReconciliationAbandonReason',
      'flow_reconciliation_abandon_reason',
      method,
    ),
  } satisfies Pick<
    CollaborationTombstone,
    | 'flowReconciliationCommandId'
    | 'openclawFlowId'
    | 'openclawFlowRevision'
    | 'flowReconciliationDiagnostic'
    | 'flowReconciliationAbandonedAt'
    | 'flowReconciliationAbandonReason'
  >;
  assertFlowReconciliationAuditEvidence(flowReconciliationAudit, method);

  return {
    id,
    runId,
    actor,
    contentDigest,
    deletedAt,
    cleanupStatus: cleanupStatus as CollaborationTombstone['cleanupStatus'],
    cleanupError: cleanupErrorValue,
    cleanupUpdatedAt,
    deletionJobId,
    deletionJobStatus: deletionJobStatusValue as CollaborationTombstone['deletionJobStatus'],
    ...flowReconciliationAudit,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'undefined' : encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

export async function hashCollaborationPayload(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required to hash collaboration commands');
  }
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createCollaborationWriteRequest<T extends Record<string, unknown>>(
  payload: T,
  preconditions: Omit<CollaborationWriteEnvelope, 'commandId' | 'payloadHash'>,
  commandId: string = globalThis.crypto.randomUUID(),
): Promise<CollaborationWriteRequest<T>> {
  const expectedCollaborationInstanceId = preconditions.expectedCollaborationInstanceId.trim();
  if (
    !expectedCollaborationInstanceId
    || expectedCollaborationInstanceId.length > 512
    || /[\u0000-\u001f\u007f]/.test(expectedCollaborationInstanceId)
  ) {
    throw new Error('expectedCollaborationInstanceId must be a valid non-empty instance id');
  }
  const withoutEnvelope = {
    ...payload,
    ...preconditions,
    expectedCollaborationInstanceId,
  };
  return {
    ...withoutEnvelope,
    commandId,
    payloadHash: await hashCollaborationPayload(withoutEnvelope),
  } as CollaborationWriteRequest<T>;
}

export class CollaborationClient {
  constructor(
    private readonly callRpc: CollaborationRpcCall,
    private readonly writeContract?: CollaborationPluginBundleMetadata,
  ) {}

  private async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    try {
      return await this.callRpc(method, params);
    } catch (error) {
      throw normalizeRpcError(error, method);
    }
  }

  private async readDecoded<T>(
    method: string,
    params: Record<string, unknown>,
    decode: (value: unknown) => T,
  ): Promise<T> {
    const response = await this.call(method, params);
    return decodeWire(method, () => decode(response));
  }

  async readContract<Method extends CollaborationReadMethod>(
    method: Method,
    params: CollaborationReadParams<Method>,
  ): Promise<CollaborationReadResponse<Method>> {
    const boundary = createCollaborationReadBoundary(params);
    return this.readDecoded(
      method,
      boundary.transportParams as unknown as Record<string, unknown>,
      (response) => decodeCollaborationReadResponse(method, response, boundary.expectation),
    );
  }

  async previewPartialRun(
    params: CollaborationReadParams<'junqi.collab.run.partial.preview'>,
  ): Promise<CollaborationPartialPreview> {
    return this.readContract('junqi.collab.run.partial.preview', params);
  }

  async previewRunDeletion(
    params: CollaborationReadParams<'junqi.collab.run.delete.preview'>,
  ): Promise<CollaborationDeletePreview> {
    return this.readContract('junqi.collab.run.delete.preview', params);
  }

  async getRunDeletionJob(
    params: CollaborationReadParams<'junqi.collab.run.delete.get'>,
  ): Promise<CollaborationDeletionJob> {
    return this.readContract('junqi.collab.run.delete.get', params);
  }

  async getExportJob(
    params: CollaborationReadParams<'junqi.collab.export.get'>,
  ): Promise<CollaborationExportJob> {
    return this.readContract('junqi.collab.export.get', params);
  }

  async downloadExport(
    params: CollaborationReadParams<'junqi.collab.export.download'>,
  ): Promise<CollaborationExportArtifact> {
    return this.readContract('junqi.collab.export.download', params);
  }

  async getSessionMutationImpact(
    params: CollaborationReadParams<'junqi.collab.session.mutationImpact'>,
  ): Promise<CollaborationSessionMutationImpactResponse> {
    return this.readContract('junqi.collab.session.mutationImpact', params);
  }

  async capabilities(): Promise<CollaborationCapabilities> {
    const method = 'junqi.collab.capabilities';
    const response = await this.call(method);
    return decodeWire(method, () => decodeCapabilities(response));
  }

  async getRun(runId: string): Promise<CollaborationRunGetResponse> {
    const method = 'junqi.collab.run.get';
    const response = await this.call(method, { runId });
    return decodeWire(method, () => decodeRunGetResponse(response, runId));
  }

  async listRuns(params: {
    activeOnly?: boolean;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
  } = {}): Promise<CollaborationRunListResponse> {
    return this.readRunList('junqi.collab.run.list', params, { paginated: true });
  }

  async listRunsBySession(
    session: CollaborationSessionRef,
    options: { includeArchived?: boolean } = {},
  ): Promise<CollaborationRunListResponse> {
    return this.readRunList(
      'junqi.collab.run.listBySession',
      { ...session, ...options },
      { paginated: false, expectedSession: session },
    );
  }

  private async readRunList(
    method: string,
    params: Record<string, unknown>,
    options: DecodeRunListOptions,
  ): Promise<CollaborationRunListResponse> {
    const response = await this.call(method, params);
    return decodeWire(method, () => decodeRunListResponse(response, options));
  }

  async listTombstones(params: { limit?: number } = {}): Promise<CollaborationTombstoneListResponse> {
    const method = 'junqi.collab.tombstone.list';
    const response = requireRecord(await this.call(method, params), method);
    if (!Array.isArray(response.tombstones)) {
      throw new CollaborationClientError('INVALID_RESPONSE', `${method} response is missing tombstones`, method);
    }
    return {
      collaborationInstanceId: requireInstanceId(response, method),
      tombstones: response.tombstones.map((tombstone) => normalizeTombstone(tombstone, method)),
    };
  }

  async listEvents(params: {
    runId: string;
    afterSequence: number;
    limit?: number;
  }): Promise<CollaborationEventsPage> {
    const method = 'junqi.collab.events.list';
    const response = await this.call(method, params);
    return decodeWire(method, () => decodeEventsPage(response, params));
  }

  async write<T extends Record<string, unknown>>(
    method: CollaborationWriteMethod,
    request: CollaborationWriteRequest<T>,
  ): Promise<CollaborationWriteResponse> {
    if (this.writeContract) {
      const issue = collaborationCapabilityIssue(await this.capabilities(), this.writeContract);
      if (issue) {
        throw new CollaborationClientError(
          'VERSION_INCOMPATIBLE',
          issue.message,
          method,
          { contractCode: issue.code, ...issue.details },
        );
      }
    }
    const response = await this.call(method, request);
    return decodeWire(method, () => decodeWriteResponse(
      response,
      request.commandId,
      request.expectedCollaborationInstanceId,
    ));
  }
}

export const collaborationClient = new CollaborationClient(
  (method, params) => gateway.call(method, params),
  COLLABORATION_PLUGIN_BUNDLE,
);
