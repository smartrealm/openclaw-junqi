import { assertVerifiedSessionMutationResult, gateway } from '@/services/gateway';
import {
  collaborationClient,
  CollaborationClientError,
  createCollaborationWriteRequest,
} from './client';
import {
  COLLABORATION_SESSION_MUTATION_POLICIES,
  COLLABORATION_SESSION_MUTATION_STRATEGIES,
  type CollaborationActiveSessionMutation,
  type CollaborationRunReference,
  type CollaborationSessionMutationAction,
  type CollaborationSessionMutationImpactResponse,
  type CollaborationSessionMutationPolicy,
  type CollaborationSessionMutationStatus,
  type CollaborationSessionMutationStrategy,
  type CollaborationWriteMethod,
  type CollaborationWriteRequest,
  type CollaborationWriteResponse,
} from './types';
import {
  CollaborationWireError,
  decodeSessionMutationImpact,
  decodeSessionMutationRunReference,
} from './wire-codec';

export type SessionMutationAction = CollaborationSessionMutationAction;
export type SessionMutationStrategy = CollaborationSessionMutationStrategy;
export type SessionMutationPolicy = CollaborationSessionMutationPolicy;
export type SessionMutationStatus = CollaborationSessionMutationStatus;

export interface SessionMutationRequest {
  collaborationInstanceId: string;
  runtimeId: string;
  sessionKey: string;
  sessionId: string;
  action: SessionMutationAction;
}

export interface SessionMutationExecutionRequest extends SessionMutationRequest {
  /** Reuse this value when retrying an operation so every write keeps the same idempotency key. */
  operationId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export type ActiveSessionMutation = CollaborationActiveSessionMutation;

export type SessionMutationImpact = SessionMutationRequest & CollaborationSessionMutationImpactResponse;

export interface SessionMutationExecutionResult {
  operationId: string;
  action: SessionMutationAction;
  strategy: SessionMutationStrategy;
  status: 'ABORTED' | 'RECOVERED' | 'COMPLETED';
  /** True only when the core RPC and mutation.complete both succeeded. */
  success: boolean;
  mutationId: string | null;
  impact: SessionMutationImpact;
  coreRpcResult?: unknown;
  completion?: CollaborationWriteResponse;
}

export type SessionMutationCoordinatorErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'INSTANCE_MISMATCH'
  | 'SESSION_IDENTITY_MISMATCH'
  | 'UNSUPPORTED_STRATEGY'
  | 'MUTATION_ALREADY_ACTIVE'
  | 'PREPARE_FAILED'
  | 'MUTATION_FENCE_LOST'
  | 'CANCELLATION_FAILED'
  | 'CANCELLATION_TIMEOUT'
  | 'CORE_RPC_NOT_ALLOWED'
  | 'CORE_RPC_FAILED'
  | 'COMPLETION_FAILED';

export class SessionMutationCoordinatorError extends Error {
  constructor(
    public readonly code: SessionMutationCoordinatorErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'SessionMutationCoordinatorError';
  }
}

type SessionMutationCancellationRequest = CollaborationWriteRequest<{
  runId: string;
  actor: string;
}>;

export interface SessionMutationCoordinatorDependencies {
  getCollaborationInstanceId(): Promise<string>;
  readImpact(params: {
    runtimeId: string;
    sessionKey: string;
    sessionId: string;
    action: SessionMutationAction;
  }): Promise<unknown>;
  write<T extends Record<string, unknown>>(
    method: CollaborationWriteMethod,
    request: CollaborationWriteRequest<T>,
  ): Promise<CollaborationWriteResponse>;
  cancelRun(
    run: CollaborationRunReference,
    request: SessionMutationCancellationRequest,
  ): Promise<void | CollaborationWriteResponse>;
  deleteSession(sessionKey: string, deleteTranscript: true, expectedSessionId: string): Promise<unknown>;
  resetSession(sessionKey: string): Promise<unknown>;
  now(): number;
  sleep(ms: number): Promise<void>;
  randomUUID(): string;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const STRATEGIES = new Set<SessionMutationStrategy>(COLLABORATION_SESSION_MUTATION_STRATEGIES);
const POLICIES = new Set<SessionMutationPolicy>(COLLABORATION_SESSION_MUTATION_POLICIES);

function coordinatorError(
  code: SessionMutationCoordinatorErrorCode,
  message: string,
  details: Record<string, unknown> = {},
  originalError?: unknown,
): SessionMutationCoordinatorError {
  return new SessionMutationCoordinatorError(code, message, details, originalError);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw coordinatorError('INVALID_REQUEST', `${field} is required`);
  }
  return value.trim();
}

function responseString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw coordinatorError('INVALID_RESPONSE', `Session mutation response is missing ${field}`);
  }
  return value;
}

function responseBoolean(record: Record<string, unknown>, field: string): boolean {
  const value = record[field];
  if (typeof value !== 'boolean') {
    throw coordinatorError('INVALID_RESPONSE', `Session mutation response is missing ${field}`);
  }
  return value;
}

function responseInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw coordinatorError('INVALID_RESPONSE', `Session mutation response has an invalid ${field}`);
  }
  return value;
}

function validateAction(value: unknown): SessionMutationAction {
  if (value !== 'reset' && value !== 'delete') {
    throw coordinatorError('INVALID_REQUEST', 'action must be reset or delete');
  }
  return value;
}

function normalizeRequest<T extends SessionMutationRequest>(request: T): T {
  return {
    ...request,
    collaborationInstanceId: requiredString(request.collaborationInstanceId, 'collaborationInstanceId'),
    runtimeId: requiredString(request.runtimeId, 'runtimeId'),
    sessionKey: requiredString(request.sessionKey, 'sessionKey'),
    sessionId: requiredString(request.sessionId, 'sessionId'),
    action: validateAction(request.action),
  };
}

function sameScope(
  actual: Pick<SessionMutationRequest, 'runtimeId' | 'sessionKey' | 'sessionId' | 'action'>,
  expected: SessionMutationRequest,
): boolean {
  return actual.runtimeId === expected.runtimeId
    && actual.sessionKey === expected.sessionKey
    && actual.sessionId === expected.sessionId
    && actual.action === expected.action;
}

function assertRunScope(run: CollaborationRunReference, expected: SessionMutationRequest): void {
  if (
    run.origin.runtimeId !== expected.runtimeId
    || run.origin.sessionKey !== expected.sessionKey
    || run.origin.sessionId !== expected.sessionId
  ) {
    throw coordinatorError(
      'SESSION_IDENTITY_MISMATCH',
      `Active collaboration ${run.runId} does not belong to the requested runtime session`,
      { runId: run.runId },
    );
  }
}

function impactIdentityErrorPath(path: string): boolean {
  return path === 'response.runtimeId'
    || path === 'response.sessionKey'
    || path === 'response.sessionId'
    || path === 'response.action'
    || path === 'response.runtimeMatches'
    || /^response\.activeRuns\[\d+\]\.origin(?:\.|$)/.test(path)
    || path === 'response.activeMutation';
}

function rethrowImpactReadError(error: unknown): never {
  const path = error instanceof CollaborationWireError
    ? error.path
    : error instanceof CollaborationClientError
      && error.code === 'INVALID_RESPONSE'
      && typeof error.details?.path === 'string'
      ? error.details.path
      : null;
  if (path === null) throw error;
  if (impactIdentityErrorPath(path)) {
    throw coordinatorError(
      'SESSION_IDENTITY_MISMATCH',
      'The active collaboration belongs to another runtime or session identity',
      { path },
      error,
    );
  }
  throw coordinatorError(
    'INVALID_RESPONSE',
    `mutationImpact returned an invalid response at ${path}`,
    { path },
    error,
  );
}

function normalizeImpact(raw: unknown, expected: SessionMutationRequest): SessionMutationImpact {
  let decoded: CollaborationSessionMutationImpactResponse;
  try {
    decoded = decodeSessionMutationImpact(raw, {
      runtimeId: expected.runtimeId,
      sessionKey: expected.sessionKey,
      sessionId: expected.sessionId,
      action: expected.action,
    });
  } catch (error) {
    return rethrowImpactReadError(error);
  }
  const identity = {
    runtimeId: decoded.runtimeId,
    sessionKey: decoded.sessionKey,
    sessionId: decoded.sessionId,
    action: decoded.action,
  };
  if (!sameScope(identity, expected)) {
    throw coordinatorError(
      'SESSION_IDENTITY_MISMATCH',
      'mutationImpact returned a different runtime or session identity',
      { expected, actual: identity },
    );
  }
  for (const run of decoded.activeRuns) assertRunScope(run, expected);
  if (decoded.activeMutation && !sameScope(decoded.activeMutation, expected)) {
    throw coordinatorError(
      'SESSION_IDENTITY_MISMATCH',
      'The active mutation belongs to another runtime or session identity',
      { mutationId: decoded.activeMutation.mutationId },
    );
  }
  return { ...expected, ...decoded };
}

function positiveInteger(value: number | undefined, fallback: number, field: string, allowZero = false): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < (allowZero ? 0 : 1)) {
    throw coordinatorError('INVALID_REQUEST', `${field} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return normalized;
}

function commandId(operationId: string, phase: string, entityId?: string): string {
  return `session-mutation:${operationId}:${phase}${entityId ? `:${entityId}` : ''}`;
}

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function errorDiagnostic(error: unknown, fallbackCode: string): Record<string, unknown> {
  if (error instanceof SessionMutationCoordinatorError) {
    return {
      code: error.code,
      message: error.message,
      details: jsonSafe(error.details),
    };
  }
  if (error instanceof Error) {
    const record = error as Error & { code?: unknown; details?: unknown };
    return {
      code: typeof record.code === 'string' ? record.code : fallbackCode,
      name: error.name,
      message: error.message,
      ...(record.details !== undefined ? { details: jsonSafe(record.details) } : {}),
    };
  }
  const record = asRecord(error);
  return {
    code: typeof record?.code === 'string' ? record.code : fallbackCode,
    message: typeof record?.message === 'string' ? record.message : String(error),
    ...(record?.details !== undefined ? { details: jsonSafe(record.details) } : {}),
  };
}

function coreRpcFailure(
  result: unknown,
  action: SessionMutationAction,
  sessionKey: string,
): Error | null {
  try {
    assertVerifiedSessionMutationResult(result, action, sessionKey);
    return null;
  } catch (cause) {
    const record = asRecord(result);
    const message = cause instanceof Error
      ? cause.message
      : typeof record?.error === 'string'
        ? record.error
        : typeof record?.message === 'string'
          ? record.message
          : 'OpenClaw core rejected the session mutation';
    const error = new Error(message) as Error & { code: string; details: unknown; cause?: unknown };
    error.cause = cause;
    error.name = 'CoreSessionMutationError';
    error.code = 'CORE_RPC_REJECTED';
    error.details = jsonSafe(result);
    return error;
  }
}

function validateWriteResponse(
  response: CollaborationWriteResponse,
  expectedCommandId: string,
  phase: 'prepare' | 'cancel' | 'complete',
): Record<string, unknown> {
  const record = asRecord(response);
  if (
    !record
    || record.accepted !== true
    || typeof record.replayed !== 'boolean'
    || record.commandId !== expectedCommandId
  ) {
    throw coordinatorError('INVALID_RESPONSE', `session mutation ${phase} returned an invalid command response`);
  }
  return record;
}

interface PreparedMutation {
  mutationId: string;
  activeRuns: CollaborationRunReference[];
}

/**
 * Coordinates OpenClaw session lifecycle RPCs with the collaboration plugin's
 * durable mutation fence. Local chat cleanup remains the gateway facade's job
 * and therefore only runs after the corresponding core RPC succeeds.
 */
export class SessionMutationCoordinator {
  constructor(private readonly dependencies: SessionMutationCoordinatorDependencies) {}

  async inspectImpact(request: SessionMutationRequest): Promise<SessionMutationImpact> {
    const normalized = normalizeRequest(request);
    const actualInstanceValue = await this.dependencies.getCollaborationInstanceId();
    if (typeof actualInstanceValue !== 'string' || !actualInstanceValue.trim()) {
      throw coordinatorError(
        'INVALID_RESPONSE',
        'The collaboration capability response is missing collaborationInstanceId',
      );
    }
    const actualInstanceId = actualInstanceValue.trim();
    if (actualInstanceId !== normalized.collaborationInstanceId) {
      throw coordinatorError(
        'INSTANCE_MISMATCH',
        'The collaboration plugin instance changed before the session mutation',
        {
          expectedCollaborationInstanceId: normalized.collaborationInstanceId,
          actualCollaborationInstanceId: actualInstanceId,
        },
      );
    }
    let response: unknown;
    try {
      response = await this.dependencies.readImpact({
        runtimeId: normalized.runtimeId,
        sessionKey: normalized.sessionKey,
        sessionId: normalized.sessionId,
        action: normalized.action,
      });
    } catch (error) {
      return rethrowImpactReadError(error);
    }
    return normalizeImpact(response, normalized);
  }

  async execute(
    requestInput: SessionMutationExecutionRequest,
    strategy: SessionMutationStrategy,
  ): Promise<SessionMutationExecutionResult> {
    if (!STRATEGIES.has(strategy)) {
      throw coordinatorError('UNSUPPORTED_STRATEGY', `Unsupported session mutation strategy: ${String(strategy)}`);
    }
    const request = normalizeRequest(requestInput);
    const operationId = request.operationId?.trim() || `operation-${this.dependencies.randomUUID()}`;
    const timeoutMs = positiveInteger(request.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs', true);
    const pollIntervalMs = positiveInteger(request.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 'pollIntervalMs');
    const impact = await this.inspectImpact(request);
    if (!impact.strategies.includes(strategy)) {
      throw coordinatorError(
        'UNSUPPORTED_STRATEGY',
        `${strategy} is not supported for the current session mutation impact`,
        { supportedStrategies: impact.strategies },
      );
    }

    if (strategy === 'ABORT') {
      return {
        operationId,
        action: request.action,
        strategy,
        status: 'ABORTED',
        success: false,
        mutationId: null,
        impact,
      };
    }

    if (strategy === 'RECOVER') {
      return this.recoverExpiredMutation(request, impact, operationId);
    }

    if (impact.activeMutation) {
      throw coordinatorError(
        'MUTATION_ALREADY_ACTIVE',
        'A session mutation fence is already active and must be completed or recovered first',
        { operationId, mutationId: impact.activeMutation.mutationId, status: impact.activeMutation.status },
      );
    }

    let prepared: PreparedMutation;
    try {
      prepared = await this.prepare(request, strategy, operationId);
    } catch (error) {
      throw coordinatorError(
        'PREPARE_FAILED',
        'The collaboration plugin did not confirm the durable session mutation fence',
        { operationId, prepareError: errorDiagnostic(error, 'MUTATION_PREPARE_FAILED') },
        error,
      );
    }
    let readyImpact: SessionMutationImpact;
    if (strategy === 'CANCEL_AND_WAIT') {
      await this.cancelRuns(request, prepared.activeRuns, operationId, prepared.mutationId);
      readyImpact = await this.waitUntilCoreRpcAllowed(
        request,
        prepared.mutationId,
        operationId,
        timeoutMs,
        pollIntervalMs,
      );
    } else {
      readyImpact = await this.inspectImpact(request);
      this.assertPreparedFence(readyImpact, prepared.mutationId, operationId);
      if (!readyImpact.coreRpcAllowed || (strategy === 'PROCEED' && readyImpact.activeRuns.length > 0)) {
        throw coordinatorError(
          'CORE_RPC_NOT_ALLOWED',
          'The collaboration plugin did not authorize the core session mutation',
          {
            operationId,
            mutationId: prepared.mutationId,
            activeRunIds: readyImpact.activeRuns.map((run) => run.runId),
          },
        );
      }
    }

    return this.executeCoreRpc(request, strategy, operationId, prepared.mutationId, readyImpact);
  }

  private async prepare(
    request: SessionMutationExecutionRequest,
    policy: SessionMutationPolicy,
    operationId: string,
  ): Promise<PreparedMutation> {
    const id = commandId(operationId, 'prepare');
    const writeRequest = await createCollaborationWriteRequest({
      runtimeId: request.runtimeId,
      sessionKey: request.sessionKey,
      sessionId: request.sessionId,
      action: request.action,
      policy,
    }, { expectedCollaborationInstanceId: request.collaborationInstanceId }, id);
    const response = await this.dependencies.write('junqi.collab.session.mutation.prepare', writeRequest);
    const record = validateWriteResponse(response, id, 'prepare');
    if (record.status !== 'PREPARED') {
      throw coordinatorError('INVALID_RESPONSE', 'session mutation prepare did not establish a PREPARED fence');
    }
    if (!Array.isArray(record.activeRuns)) {
      throw coordinatorError('INVALID_RESPONSE', 'session mutation prepare response is missing activeRuns');
    }
    const activeRuns = record.activeRuns.map((run, index) => {
      try {
        return decodeSessionMutationRunReference(run, index);
      } catch (error) {
        if (error instanceof CollaborationWireError) {
          throw coordinatorError(
            'INVALID_RESPONSE',
            `session mutation prepare returned an invalid active run at ${error.path}`,
            { path: error.path },
            error,
          );
        }
        throw error;
      }
    });
    const runIds = new Set<string>();
    for (const run of activeRuns) {
      if (runIds.has(run.runId)) {
        throw coordinatorError('INVALID_RESPONSE', `session mutation prepare contains duplicate run ${run.runId}`);
      }
      runIds.add(run.runId);
      assertRunScope(run, request);
    }
    responseInteger(record, 'expiresAt');
    responseBoolean(record, 'coreRpcAllowed');
    return {
      mutationId: responseString(record, 'mutationId'),
      activeRuns,
    };
  }

  private async cancelRuns(
    session: SessionMutationRequest,
    runs: CollaborationRunReference[],
    operationId: string,
    mutationId: string,
  ): Promise<void> {
    const cancellations: Array<{
      run: CollaborationRunReference;
      commandId: string;
      request: CollaborationWriteRequest<{ runId: string; actor: string }>;
    }> = [];
    for (const run of runs) {
      const id = commandId(operationId, 'cancel', run.runId);
      const request = await createCollaborationWriteRequest(
        { runId: run.runId, actor: 'session-mutation-coordinator' },
        {
          expectedCollaborationInstanceId: session.collaborationInstanceId,
          expectedRunRevision: run.revision,
        },
        id,
      );
      cancellations.push({ run, commandId: id, request });
    }

    const settled = await Promise.allSettled(cancellations.map(async (cancellation) => {
      const response = await this.dependencies.cancelRun(cancellation.run, cancellation.request);
      if (response) validateWriteResponse(response, cancellation.commandId, 'cancel');
    }));
    const failures = settled.flatMap((result, index) => result.status === 'rejected'
      ? [{
          runId: cancellations[index]?.run.runId,
          error: errorDiagnostic(result.reason, 'RUN_CANCEL_FAILED'),
        }]
      : []);
    if (failures.length > 0) {
      throw coordinatorError(
        'CANCELLATION_FAILED',
        'One or more collaboration runs could not be cancelled; the session mutation fence remains active',
        { operationId, mutationId, failures },
      );
    }
  }

  private async waitUntilCoreRpcAllowed(
    request: SessionMutationExecutionRequest,
    mutationId: string,
    operationId: string,
    timeoutMs: number,
    pollIntervalMs: number,
  ): Promise<SessionMutationImpact> {
    const deadline = this.dependencies.now() + timeoutMs;
    while (true) {
      const impact = await this.inspectImpact(request);
      this.assertPreparedFence(impact, mutationId, operationId);
      if (impact.activeRuns.length === 0 && impact.coreRpcAllowed) return impact;
      const remaining = deadline - this.dependencies.now();
      if (remaining <= 0) {
        throw coordinatorError(
          'CANCELLATION_TIMEOUT',
          'Timed out waiting for collaboration runs to terminate; the session mutation fence remains active',
          {
            operationId,
            mutationId,
            activeRunIds: impact.activeRuns.map((run) => run.runId),
          },
        );
      }
      await this.dependencies.sleep(Math.min(pollIntervalMs, remaining));
    }
  }

  private assertPreparedFence(
    impact: SessionMutationImpact,
    mutationId: string,
    operationId?: string,
  ): void {
    if (!impact.activeMutation || impact.activeMutation.mutationId !== mutationId) {
      throw coordinatorError(
        'MUTATION_FENCE_LOST',
        'The prepared session mutation fence is no longer authoritative',
        {
          mutationId,
          operationId,
          actualMutationId: impact.activeMutation?.mutationId ?? null,
        },
      );
    }
    if (impact.activeMutation.status !== 'PREPARED') {
      throw coordinatorError(
        'MUTATION_FENCE_LOST',
        'The prepared session mutation fence expired before the core RPC',
        {
          operationId,
          mutationId,
          status: impact.activeMutation.status,
          recoveryRequired: impact.recoveryRequired,
        },
      );
    }
  }

  private async executeCoreRpc(
    request: SessionMutationExecutionRequest,
    strategy: SessionMutationPolicy,
    operationId: string,
    mutationId: string,
    impact: SessionMutationImpact,
  ): Promise<SessionMutationExecutionResult> {
    let coreRpcResult: unknown;
    let coreError: unknown = null;
    try {
      coreRpcResult = request.action === 'delete'
        ? await this.dependencies.deleteSession(request.sessionKey, true, request.sessionId)
        : await this.dependencies.resetSession(request.sessionKey);
      coreError = coreRpcFailure(coreRpcResult, request.action, request.sessionKey);
    } catch (error) {
      coreError = error;
    }

    const succeeded = coreError === null;
    const diagnostic = succeeded ? null : errorDiagnostic(coreError, 'CORE_RPC_FAILED');
    let completion: CollaborationWriteResponse;
    try {
      completion = await this.completeMutation(request, mutationId, succeeded, diagnostic, operationId);
    } catch (error) {
      throw coordinatorError(
        'COMPLETION_FAILED',
        'The core session mutation finished, but its durable collaboration record could not be completed',
        {
          mutationId,
          operationId,
          coreRpcSucceeded: succeeded,
          coreError: diagnostic,
          completionError: errorDiagnostic(error, 'MUTATION_COMPLETE_FAILED'),
        },
        error,
      );
    }

    if (!succeeded) {
      throw coordinatorError(
        'CORE_RPC_FAILED',
        'The OpenClaw core session mutation failed; the failure was recorded and the fence was released',
        { operationId, mutationId, coreError: diagnostic, completion },
        coreError,
      );
    }

    return {
      operationId,
      action: request.action,
      strategy,
      status: 'COMPLETED',
      success: true,
      mutationId,
      impact,
      coreRpcResult,
      completion,
    };
  }

  private async recoverExpiredMutation(
    request: SessionMutationExecutionRequest,
    impact: SessionMutationImpact,
    operationId: string,
  ): Promise<SessionMutationExecutionResult> {
    const mutation = impact.activeMutation;
    if (!impact.recoveryRequired || mutation?.status !== 'EXPIRED') {
      throw coordinatorError('UNSUPPORTED_STRATEGY', 'RECOVER requires an expired session mutation fence');
    }
    let completion: CollaborationWriteResponse;
    try {
      completion = await this.completeMutation(request, mutation.mutationId, false, {
        code: 'CORE_RPC_OUTCOME_UNKNOWN',
        message: 'The mutation lease expired before JunQi could prove the core RPC result',
        recoveredBy: 'session-mutation-coordinator',
      }, operationId);
    } catch (error) {
      throw coordinatorError(
        'COMPLETION_FAILED',
        'The expired session mutation fence could not be recovered',
        {
          mutationId: mutation.mutationId,
          operationId,
          completionError: errorDiagnostic(error, 'MUTATION_RECOVERY_FAILED'),
        },
        error,
      );
    }
    return {
      operationId,
      action: request.action,
      strategy: 'RECOVER',
      status: 'RECOVERED',
      success: false,
      mutationId: mutation.mutationId,
      impact,
      completion,
    };
  }

  private async completeMutation(
    session: SessionMutationRequest,
    mutationId: string,
    success: boolean,
    error: Record<string, unknown> | null,
    operationId: string,
  ): Promise<CollaborationWriteResponse> {
    const id = commandId(operationId, 'complete');
    const request = await createCollaborationWriteRequest(
      { runtimeId: session.runtimeId, mutationId, success, error },
      { expectedCollaborationInstanceId: session.collaborationInstanceId },
      id,
    );
    const response = await this.dependencies.write('junqi.collab.session.mutation.complete', request);
    const record = validateWriteResponse(response, id, 'complete');
    if (record.mutationId !== mutationId || record.success !== success) {
      throw coordinatorError('INVALID_RESPONSE', 'session mutation complete returned a mismatched result');
    }
    const expectedStatus = success ? 'COMPLETED' : 'FAILED';
    if (record.status !== expectedStatus) {
      throw coordinatorError('INVALID_RESPONSE', `session mutation complete did not enter ${expectedStatus}`);
    }
    return response;
  }
}

const defaultDependencies: SessionMutationCoordinatorDependencies = {
  getCollaborationInstanceId: async () => (await collaborationClient.capabilities()).collaborationInstanceId,
  readImpact: (params) => collaborationClient.getSessionMutationImpact(params),
  write: (method, request) => collaborationClient.write(method, request),
  cancelRun: (_run, request) => collaborationClient.write('junqi.collab.run.cancel', request),
  deleteSession: (sessionKey, deleteTranscript, expectedSessionId) => (
    gateway.deleteSession(sessionKey, deleteTranscript, expectedSessionId)
  ),
  resetSession: (sessionKey) => gateway.resetSession(sessionKey),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  randomUUID: () => globalThis.crypto.randomUUID(),
};

export const sessionMutationCoordinator = new SessionMutationCoordinator(defaultDependencies);
