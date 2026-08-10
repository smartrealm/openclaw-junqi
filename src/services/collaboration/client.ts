import { gateway } from '@/services/gateway';
import { isOpenClawUnknownMethodError } from '@/services/gateway/GatewayProtocolEvidence';
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
  CollaborationWorkflowTemplateListResponse,
  CollaborationWriteEnvelope,
  CollaborationWriteMethod,
  CollaborationWriteRequest,
  CollaborationWriteResponse,
  CollaborationErrorCode,
} from '@/types/collaboration';
import { isCollaborationErrorCode } from '@/types/collaboration';

export type CollaborationRpcCall = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

export type CollaborationClientErrorCode = CollaborationErrorCode | 'METHOD_UNAVAILABLE';

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

export function isCollaborationMethodUnavailable(
  error: unknown,
  expectedMethods: readonly string[] = ['junqi.collab.capabilities', 'junqi.collab.maintenance.status'],
): boolean {
  if (error instanceof CollaborationClientError) {
    return error.code === 'METHOD_UNAVAILABLE' && expectedMethods.includes(error.method);
  }
  return expectedMethods.some((method) => isOpenClawUnknownMethodError(error, method));
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
  const code = isOpenClawUnknownMethodError(error, method)
    ? 'METHOD_UNAVAILABLE'
    : errorCodeFrom(transportCode);
  const details = asRecord(record?.details ?? nested?.details) ?? undefined;
  return new CollaborationClientError(code, message, method, details, error);
}

function readString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
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

function readRequiredTombstoneField(
  record: Record<string, unknown>,
  field: string,
  method: string,
): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, field)) invalidTombstoneField(method, field);
  return record[field];
}

function readRequiredNullableTombstoneString(
  record: Record<string, unknown>,
  field: string,
  method: string,
): string | null {
  const value = readRequiredTombstoneField(record, field, method);
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) invalidTombstoneField(method, field);
  return value.trim();
}

function readRequiredNullableTombstoneInteger(
  record: Record<string, unknown>,
  field: string,
  method: string,
): number | null {
  const value = readRequiredTombstoneField(record, field, method);
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalidTombstoneField(method, field);
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

const TOMBSTONE_WIRE_FIELDS = new Set([
  'id',
  'runId',
  'actor',
  'contentDigest',
  'deletedAt',
  'cleanupStatus',
  'cleanupError',
  'cleanupUpdatedAt',
  'deletionJobId',
  'deletionJobStatus',
  'flowReconciliationCommandId',
  'openclawFlowId',
  'openclawFlowRevision',
  'flowReconciliationDiagnostic',
  'flowReconciliationAbandonedAt',
  'flowReconciliationAbandonReason',
]);

function normalizeTombstone(value: unknown, method: string): CollaborationTombstone {
  const record = asRecord(value);
  if (record && Object.keys(record).some((field) => !TOMBSTONE_WIRE_FIELDS.has(field))) {
    throw new CollaborationClientError('INVALID_RESPONSE', `${method} returned an invalid tombstone`, method);
  }
  const id = record ? readString(record, 'id')?.trim() : undefined;
  const runId = record ? readString(record, 'runId')?.trim() : undefined;
  const actor = record ? readString(record, 'actor')?.trim() : undefined;
  const contentDigest = record ? readString(record, 'contentDigest')?.trim() : undefined;
  const deletedAt = record ? readNumber(record, 'deletedAt') : undefined;
  const cleanupStatus = record ? readString(record, 'cleanupStatus') : undefined;
  const cleanupErrorValue = record
    ? readRequiredTombstoneField(record, 'cleanupError', method)
    : undefined;
  const cleanupUpdatedAt = record ? readNumber(record, 'cleanupUpdatedAt') : undefined;
  const deletionJobIdValue = record
    ? readRequiredTombstoneField(record, 'deletionJobId', method)
    : undefined;
  const deletionJobStatusValue = record
    ? readRequiredTombstoneField(record, 'deletionJobStatus', method)
    : undefined;
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
    || (actor !== 'retention-policy' && deletionJobId === null)
  ) {
    throw new CollaborationClientError('INVALID_RESPONSE', `${method} returned an invalid tombstone`, method);
  }
  const flowReconciliationAudit = {
    flowReconciliationCommandId: readRequiredNullableTombstoneString(
      record,
      'flowReconciliationCommandId',
      method,
    ),
    openclawFlowId: readRequiredNullableTombstoneString(
      record,
      'openclawFlowId',
      method,
    ),
    openclawFlowRevision: readRequiredNullableTombstoneInteger(
      record,
      'openclawFlowRevision',
      method,
    ),
    flowReconciliationDiagnostic: readRequiredNullableTombstoneString(
      record,
      'flowReconciliationDiagnostic',
      method,
    ),
    flowReconciliationAbandonedAt: readRequiredNullableTombstoneInteger(
      record,
      'flowReconciliationAbandonedAt',
      method,
    ),
    flowReconciliationAbandonReason: readRequiredNullableTombstoneString(
      record,
      'flowReconciliationAbandonReason',
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

  async listWorkflowTemplates(
    params: CollaborationReadParams<'junqi.collab.workflow.template.list'> = {},
  ): Promise<CollaborationWorkflowTemplateListResponse> {
    return this.readContract('junqi.collab.workflow.template.list', params);
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
