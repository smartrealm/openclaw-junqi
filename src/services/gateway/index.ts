// ═══════════════════════════════════════════════════════════
// Gateway Service — Public API Facade
// Wires Connection + ChatHandler into a single interface.
// Backward-compatible with: import { gateway } from '@/services/gateway'
// ═══════════════════════════════════════════════════════════

import {
  GatewayConnection,
  GatewayDisconnectedError,
  GatewayRpcError,
  type GatewayCallbacks,
  type GatewayRequestOptions,
  type GatewayConnectionOptions,
  type GatewayOperatorScope,
  type ChatMessage,
  type MediaInfo,
} from './Connection';
import { ChatHandler, type ChatSessionRunObservation } from './ChatHandler';
import { parseOpenClawSessionListSnapshot } from './OpenClawChatRunProjection';
import { OpenClawSessionRunReconciler } from './OpenClawSessionRunResolver';
import {
  OpenClawSessionTranscriptSubscription,
  type OpenClawTranscriptTarget,
} from './SessionTranscriptSubscription';
import {
  GatewayAgentDisplayNameUpdateError,
  OpenClawAgentManagement,
} from './AgentManagement';
import { debugWarn } from '@/utils/debugLog';
import { voiceFileRuntime } from '@/services/chat/voiceFileRuntime';
import type { GatewayAgentCreatePayload } from '@/utils/gatewayAgentFlow';
import { routeGatewayEvent } from './collaborationEventBridge';
import { VoiceWakeGatewayClient } from './VoiceWakeGatewayClient';
import {
  routeVoiceWakeGatewayEvent,
  subscribeVoiceWakeGatewayEvents,
} from './voiceWakeEventBridge';
import { TalkGatewayClient } from './TalkGatewayClient';
import {
  routeTalkGatewayEvent,
  subscribeTalkGatewayEvents,
} from './talkEventBridge';
import type { GatewayAuthorizationIssue } from './messageRouter';
import { sessionCommandCoordinator } from '@/services/chat/sessionCommandCoordinator';
import type { GatewayAttachment } from '@/services/chat/types';
import { SessionSettingsClient } from './SessionSettingsClient';
import { OpenClawSessionOrganizationClient } from './OpenClawSessionOrganizationClient';
import { OpenClawSessionLifecycleClient } from './OpenClawSessionLifecycleClient';
import {
  OpenClawTaskLedgerClient,
  type OpenClawTaskListInput,
} from './OpenClawTaskLedgerClient';
import {
  OpenClawAuditClient,
  type OpenClawAuditListInput,
} from './OpenClawAuditClient';
import {
  OpenClawApprovalClient,
  type OpenClawApproval,
  type OpenClawApprovalDecision,
  type OpenClawApprovalHistoryRequest,
} from './OpenClawApprovalClient';
import { OpenClawSessionSteerClient } from './OpenClawSessionSteerClient';
import { OpenClawSessionCompactionClient } from './OpenClawSessionCompactionClient';
import { OpenClawSessionCompactionCheckpointsClient } from './OpenClawSessionCompactionCheckpointsClient';
import { OpenClawSessionAbortClient } from './OpenClawSessionAbortClient';
import { OpenClawCronRunClient } from './OpenClawCronRunClient';
import { OpenClawCronStatusClient } from './OpenClawCronStatusClient';
import { OpenClawTtsClient } from './OpenClawTtsClient';
import { OpenClawTtsStatusClient } from './OpenClawTtsStatusClient';
import {
  OpenClawCommandsClient,
  type OpenClawCommandsListInput,
} from './OpenClawCommandsClient';
import {
  OpenClawCronManagementClient,
  type OpenClawCronManagedJob,
  type OpenClawCronMutationPatch,
} from './OpenClawCronManagementClient';
import type { CronAgentTurnAddParams } from './cronContract';
import { taskExecutionCoordinator } from '@/task-execution/TaskExecutionCoordinator';

// Re-export types for consumers
export type {
  ChatMessage,
  MediaInfo,
  GatewayCallbacks,
  GatewayConnectionOptions,
  GatewayRequestOptions,
};
export type { OpenClawTranscriptTarget } from './SessionTranscriptSubscription';
export type { OpenClawTtsClip, OpenClawTtsSpeakInput } from './OpenClawTtsClient';
export type { OpenClawTtsStatus } from './OpenClawTtsStatusClient';
export type {
  OpenClawCompactionCheckpoint,
  OpenClawCompactionCheckpointReason,
  OpenClawCompactionTranscriptReference,
} from './OpenClawSessionCompactionCheckpointsClient';
export type {
  OpenClawCommandArgument,
  OpenClawCommandArgumentChoice,
  OpenClawCommandCategory,
  OpenClawCommandEntry,
  OpenClawCommandScope,
  OpenClawCommandSource,
  OpenClawCommandsListInput,
} from './OpenClawCommandsClient';
export type {
  OpenClawTaskCancelResult,
  OpenClawTaskLedgerStatus,
  OpenClawTaskListInput,
  OpenClawTaskListPage,
  OpenClawTaskSummary,
} from './OpenClawTaskLedgerClient';
export type {
  OpenClawCronRunAcknowledgement,
  OpenClawCronRunEntry,
  OpenClawCronRunPage,
  OpenClawCronRunStatus,
} from './OpenClawCronRunClient';
export type { OpenClawCronStatus } from './OpenClawCronStatusClient';
export type {
  OpenClawCronManagedJob,
  OpenClawCronMutationPatch,
} from './OpenClawCronManagementClient';
export type {
  OpenClawApproval,
  OpenClawApprovalDecision,
  OpenClawApprovalListResult,
  OpenClawApprovalKind,
  OpenClawApprovalAvailability,
  OpenClawApprovalHistoryAvailability,
  OpenClawApprovalGetResult,
  OpenClawApprovalHistoryRequest,
  OpenClawApprovalHistoryResult,
  OpenClawApprovalResolveResult,
  OpenClawApprovalSnapshot,
  OpenClawApprovalStatus,
  OpenClawApprovalTerminalReason,
  OpenClawApprovalPresentation,
  OpenClawApprovalExecPresentation,
  OpenClawApprovalPluginPresentation,
  OpenClawApprovalSystemAgentPresentation,
} from './OpenClawApprovalClient';
export {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRequestAbortedError,
  GatewayRpcError,
} from './Connection';

export class GatewaySessionMutationRejectedError extends Error {
  readonly code = 'SESSION_MUTATION_REJECTED';

  constructor(message: string) {
    super(message);
    this.name = 'GatewaySessionMutationRejectedError';
  }
}

/**
 * A remote Stop is permitted only after its local Task checkpoint is durable.
 * The caller owns both operations; this helper only preserves their ordering.
 */
export async function abortAfterTaskCheckpoint<T>(
  checkpointStop: () => Promise<void>,
  abort: () => Promise<T>,
): Promise<T> {
  await checkpointStop();
  return abort();
}

export interface GatewayAgentCreateParams {
  name: string;
  workspace: string;
  model?: string;
  emoji?: string;
  avatar?: string;
}

export interface GatewayChatSendDeliveryUncertain {
  deliveryUncertain: true;
  runId: string;
}

interface GatewayChatSendDeliveryObserved {
  deliveryObserved: true;
  runId: string;
}

export function isGatewayChatSendDeliveryUncertain(
  value: unknown,
): value is GatewayChatSendDeliveryUncertain {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).deliveryUncertain === true
    && typeof (value as Record<string, unknown>).runId === 'string',
  );
}

export interface GatewayAgentCreateResult {
  ok: true;
  agentId: string;
  name: string;
  workspace: string;
  model?: string;
}

export interface GatewayAgentUpdateParams {
  name?: string;
  workspace?: string;
  model?: string;
  emoji?: string;
  avatar?: string;
}

export interface GatewayHistoryOptions {
  offset?: number;
  maxChars?: number;
}

function historyTaskObservation(response: unknown): {
  sessionId: string | null;
  hasActiveRun: boolean;
  activeRunIds: string[];
} | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const record = response as Record<string, unknown>;
  const sessionInfo = record.sessionInfo;
  if (!sessionInfo || typeof sessionInfo !== 'object' || Array.isArray(sessionInfo)) return null;
  const info = sessionInfo as Record<string, unknown>;
  if (typeof info.hasActiveRun !== 'boolean') return null;
  const activeRunIds = Array.isArray(info.activeRunIds)
    ? info.activeRunIds.flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim()] : [])
    : [];
  const inFlight = record.inFlightRun;
  if (inFlight && typeof inFlight === 'object' && !Array.isArray(inFlight)) {
    const runId = (inFlight as Record<string, unknown>).runId;
    if (typeof runId === 'string' && runId.trim() && !activeRunIds.includes(runId.trim())) {
      activeRunIds.push(runId.trim());
    }
  }
  return {
    sessionId: typeof record.sessionId === 'string' && record.sessionId.trim() ? record.sessionId.trim() : null,
    hasActiveRun: info.hasActiveRun,
    activeRunIds,
  };
}

// ── Create instances ──
const connection = new GatewayConnection();
const chatHandler = new ChatHandler(connection);
const transcriptSubscription = new OpenClawSessionTranscriptSubscription(connection);
const auditClient = new OpenClawAuditClient(
  (method, params) => connection.request(method, params),
  (method) => connection.hasAdvertisedMethod(method),
);
const SESSION_ARTIFACT_CLEANUP_TIMEOUT_MS = 5_000;
const RUN_STATE_LOOKUP_TIMEOUT_MS = 5_000;

export const voiceWakeGatewayClient = new VoiceWakeGatewayClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
  subscribe: subscribeVoiceWakeGatewayEvents,
});

export const openClawTtsClient = new OpenClawTtsClient(
  (method, params, options) => connection.request(method, params, options),
);

export const openClawTtsStatusClient = new OpenClawTtsStatusClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  hasAdvertisedMethod: (method) => connection.hasAdvertisedMethod(method),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawCommandsClient = new OpenClawCommandsClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  hasAdvertisedMethod: (method) => connection.hasAdvertisedMethod(method),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const talkGatewayClient = new TalkGatewayClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
  subscribe: subscribeTalkGatewayEvents,
});

export { GatewayAgentDisplayNameUpdateError };

async function cleanupSessionArtifacts(sessionKey: string): Promise<void> {
  const operations: Array<{ label: string; task: Promise<unknown> | undefined }> = [
    { label: 'voice', task: voiceFileRuntime.cleanupSession(sessionKey) },
  ];

  await Promise.all(operations.map(async ({ label, task }) => {
    if (!task) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${label} cleanup timed out`)),
            SESSION_ARTIFACT_CLEANUP_TIMEOUT_MS,
          );
        }),
      ]);
      if ((result as { success?: boolean } | null)?.success === false) {
        throw new Error(`${label} cleanup was rejected`);
      }
    } catch (error) {
      debugWarn('app', `[gateway] Session ${label} cleanup failed for ${sessionKey}:`, error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }));
}

type PrivilegedSourceConnection = Pick<
  GatewayConnection,
  'isConnected' | 'getAttestedConnectionId' | 'url' | 'token' | 'deviceToken'
>;
type TransientGatewayConnection = Pick<
  GatewayConnection,
  'connect' | 'disconnect' | 'request' | 'setCallbacks'
>;
type PrivilegedConnectionFactory = (
  options: GatewayConnectionOptions,
) => TransientGatewayConnection;
export interface PrivilegedRequester {
  <T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number | null,
  ): Promise<T>;
  cancelActiveRequest(): void;
  cancelPairingRetry(): void;
}

export interface PrivilegedRequesterOptions {
  scopes?: readonly GatewayOperatorScope[];
  pairingRetryMs?: number;
  pairingTimeoutMs?: number;
}

const DEFAULT_PRIVILEGED_OPERATOR_SCOPES: readonly GatewayOperatorScope[] = ['operator.admin'];

type PrivilegedAuthorizationIssueListener = (issue: GatewayAuthorizationIssue) => void;
const privilegedAuthorizationIssueListeners = new Set<PrivilegedAuthorizationIssueListener>();
type PrivilegedAuthorizationResolvedListener = () => void;
const privilegedAuthorizationResolvedListeners = new Set<PrivilegedAuthorizationResolvedListener>();

export function subscribePrivilegedAuthorizationIssues(
  listener: PrivilegedAuthorizationIssueListener,
): () => void {
  privilegedAuthorizationIssueListeners.add(listener);
  return () => privilegedAuthorizationIssueListeners.delete(listener);
}

function emitPrivilegedAuthorizationIssue(issue: GatewayAuthorizationIssue): void {
  for (const listener of [...privilegedAuthorizationIssueListeners]) {
    try {
      listener(issue);
    } catch (error) {
      debugWarn('gateway', '[GW] Privileged authorization listener failed:', error);
    }
  }
}

export function subscribePrivilegedAuthorizationResolved(
  listener: PrivilegedAuthorizationResolvedListener,
): () => void {
  privilegedAuthorizationResolvedListeners.add(listener);
  return () => privilegedAuthorizationResolvedListeners.delete(listener);
}

function emitPrivilegedAuthorizationResolved(): void {
  for (const listener of [...privilegedAuthorizationResolvedListeners]) {
    try {
      listener();
    } catch (error) {
      debugWarn('gateway', '[GW] Privileged authorization resolved listener failed:', error);
    }
  }
}

export class GatewayPrivilegedAuthorizationError extends Error {
  readonly code = 'GATEWAY_PRIVILEGED_AUTHORIZATION_FAILED';
  readonly issue: GatewayAuthorizationIssue;

  constructor(issue: GatewayAuthorizationIssue) {
    const approval = issue.requestId
      ? ` Run: openclaw devices approve ${issue.requestId}.`
      : '';
    const scope = issue.missingScope
      ? ` Missing scope: ${issue.missingScope}.`
      : issue.requiredScopes?.length
        ? ` Required scopes: ${issue.requiredScopes.join(', ')}.`
        : '';
    super(`Gateway authorization failed (${issue.code}): ${issue.message}.${scope}${approval}`);
    this.name = 'GatewayPrivilegedAuthorizationError';
    this.issue = issue;
  }
}

export class GatewayPrivilegedSourceChangedError extends Error {
  readonly code = 'GATEWAY_PRIVILEGED_SOURCE_CHANGED';

  constructor() {
    super('The verified Gateway connection changed while privileged authorization was pending');
    this.name = 'GatewayPrivilegedSourceChangedError';
  }
}

export function assertVerifiedSessionMutationResult(
  result: unknown,
  action: 'delete' | 'reset',
  expectedSessionKey?: string,
): asserts result is Record<string, unknown> {
  const response = result !== null && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : null;
  if (response?.ok !== true && response?.success !== true) {
    const detail = typeof response?.error === 'string'
      ? response.error
      : typeof response?.message === 'string'
        ? response.message
        : `OpenClaw returned an unverifiable response for session ${action}`;
    throw new GatewaySessionMutationRejectedError(detail);
  }
  if (expectedSessionKey !== undefined) {
    const returnedKey = typeof response?.key === 'string' ? response.key.trim() : '';
    if (!returnedKey || returnedKey !== expectedSessionKey) {
      throw new GatewaySessionMutationRejectedError(`OpenClaw returned a different session key for ${action}`);
    }
  }
  if (action === 'delete' && response.deleted !== true) {
    throw new GatewaySessionMutationRejectedError('OpenClaw did not confirm that the session was deleted');
  }
  if (action === 'reset') {
    const entry = response.entry !== null && typeof response.entry === 'object' && !Array.isArray(response.entry)
      ? response.entry as Record<string, unknown>
      : null;
    if (typeof entry?.sessionId !== 'string' || !entry.sessionId.trim()) {
      throw new GatewaySessionMutationRejectedError('OpenClaw did not return the reset session identity');
    }
  }
  return;
}

function errorValue(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Build a serialized transient scope lane whose elevated socket exists for one RPC only. */
export function createPrivilegedRequester(
  source: PrivilegedSourceConnection,
  createConnection: PrivilegedConnectionFactory = (options) => new GatewayConnection(options),
  options: PrivilegedRequesterOptions = {},
): PrivilegedRequester {
  let lane: Promise<void> = Promise.resolve();
  let cancelActivePairingRetry: (() => void) | null = null;
  const scopes = [...new Set(options.scopes ?? DEFAULT_PRIVILEGED_OPERATOR_SCOPES)];
  if (scopes.length === 0) {
    throw new Error('A transient Gateway requester requires at least one operator scope');
  }
  const pairingRetryMs = options.pairingRetryMs ?? 5_000;
  const pairingTimeoutMs = options.pairingTimeoutMs ?? 5 * 60_000;

  type AttemptResult<T> =
    | { kind: 'success'; value: T }
    | { kind: 'pairing'; issue: GatewayAuthorizationIssue }
    | { kind: 'failure'; error: Error };

  const requestTimeoutError = (timeoutMs: number) => (
    new Error(`Request timeout (${timeoutMs}ms) while waiting for privileged Gateway operation`)
  );

  const attempt = <T>(
    target: { url: string; token: string; deviceToken: string },
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number | null,
    registerCancel: (cancel: () => void) => void,
    onConnected: () => void,
  ): Promise<AttemptResult<T>> => {
    const transient = createConnection({ scopes, transient: true });
    return new Promise<AttemptResult<T>>((resolve) => {
      let settled = false;
      let requestStarted = false;
      const timer = timeoutMs === null
        ? null
        : window.setTimeout(() => {
          finish({ kind: 'failure', error: requestTimeoutError(timeoutMs) });
        }, timeoutMs);
      const finish = (result: AttemptResult<T>) => {
        if (settled) return;
        settled = true;
        if (timer !== null) window.clearTimeout(timer);
        transient.disconnect();
        resolve(result);
      };
      registerCancel(() => finish({
        kind: 'failure',
        error: new Error('Privileged Gateway authorization was cancelled'),
      }));
      transient.setCallbacks({
        onMessage() {},
        onStreamChunk() {},
        onStreamEnd() {},
        onStatusChange(status) {
          if (settled || requestStarted) return;
          if (status.error) {
            finish({ kind: 'failure', error: new Error(status.error) });
            return;
          }
          if (!status.connected) return;
          requestStarted = true;
          onConnected();
          void transient.request(method, params, { timeoutMs })
            .then((value) => finish({ kind: 'success', value: value as T }))
            .catch((error) => finish({ kind: 'failure', error: errorValue(error) }));
        },
        onAuthorizationIssue(issue) {
          if (issue.kind === 'pairing_required') {
            finish({ kind: 'pairing', issue });
            return;
          }
          finish({ kind: 'failure', error: new GatewayPrivilegedAuthorizationError(issue) });
        },
        onScopeError(error) {
          finish({ kind: 'failure', error: errorValue(error) });
        },
      });
      transient.connect(target.url, target.token, target.deviceToken);
    });
  };

  const execute = async <T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number | null = 30_000,
    enqueuedAt = Date.now(),
  ): Promise<T> => {
    const normalizedTimeoutMs = timeoutMs === null ? null : Math.max(1_000, timeoutMs);
    const requestDeadline = normalizedTimeoutMs === null ? null : enqueuedAt + normalizedTimeoutMs;
    const remainingBudget = () => requestDeadline === null
      ? null
      : Math.max(0, requestDeadline - Date.now());
    const requireRemainingBudget = () => {
      const remaining = remainingBudget();
      if (remaining !== null && remaining <= 0) throw requestTimeoutError(normalizedTimeoutMs!);
      return remaining;
    };
    const sourceConnectionId = source.getAttestedConnectionId();
    if (!source.isConnected()
      || !sourceConnectionId
      || !source.url
      || (!source.token && !source.deviceToken)) {
      throw new Error('A verified Gateway connection is required for this management action');
    }
    const target = { url: source.url, token: source.token, deviceToken: source.deviceToken };
    const sourceIsCurrent = () => (
      source.isConnected()
      && source.getAttestedConnectionId() === sourceConnectionId
      && source.url === target.url
      && source.token === target.token
      && source.deviceToken === target.deviceToken
    );
    const assertSourceCurrent = () => {
      if (!sourceIsCurrent()) throw new GatewayPrivilegedSourceChangedError();
    };
    const pairingDeadline = Math.min(
      Date.now() + pairingTimeoutMs,
      requestDeadline ?? Number.POSITIVE_INFINITY,
    );
    let pairingObserved = false;
    let pairingResolvedEmitted = false;

    try {
      for (;;) {
        const attemptTimeoutMs = requireRemainingBudget();
        assertSourceCurrent();
        const result = await attempt<T>(
          target,
          method,
          params,
          attemptTimeoutMs,
          (cancel) => { cancelActivePairingRetry = cancel; },
          () => {
            if (!sourceIsCurrent()) return;
            if (!pairingObserved || pairingResolvedEmitted) return;
            pairingResolvedEmitted = true;
            emitPrivilegedAuthorizationResolved();
          },
        );
        cancelActivePairingRetry = null;
        assertSourceCurrent();
        if (result.kind === 'success') {
          return result.value;
        }
        if (result.kind === 'failure') throw result.error;

        pairingObserved = true;
        emitPrivilegedAuthorizationIssue(result.issue);
        if (Date.now() + pairingRetryMs > pairingDeadline) {
          throw new GatewayPrivilegedAuthorizationError(result.issue);
        }
        if (pairingRetryMs === 0) {
          await Promise.resolve();
        } else {
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, pairingRetryMs);
            cancelActivePairingRetry = () => {
              window.clearTimeout(timer);
              reject(new Error('Privileged Gateway authorization was cancelled'));
            };
          });
        }
        cancelActivePairingRetry = null;
        assertSourceCurrent();
      }
    } finally {
      cancelActivePairingRetry = null;
    }
  };

  const request = (<T>(method: string, params: Record<string, unknown>, timeoutMs?: number | null) => {
    const enqueuedAt = Date.now();
    const normalizedTimeoutMs = timeoutMs === null
      ? null
      : Math.max(1_000, timeoutMs ?? 30_000);
    let expiredInQueue = false;
    const execution = lane.then(() => {
      if (expiredInQueue && normalizedTimeoutMs !== null) {
        throw requestTimeoutError(normalizedTimeoutMs);
      }
      return execute<T>(method, params, normalizedTimeoutMs, enqueuedAt);
    });
    lane = execution.then(() => undefined, () => undefined);
    if (normalizedTimeoutMs === null) return execution;

    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        expiredInQueue = true;
        reject(requestTimeoutError(normalizedTimeoutMs));
      }, normalizedTimeoutMs);
      void execution.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }) as PrivilegedRequester;
  request.cancelActiveRequest = () => cancelActivePairingRetry?.();
  request.cancelPairingRetry = () => cancelActivePairingRetry?.();
  return request;
}

const APPROVAL_OPERATOR_SCOPES: readonly GatewayOperatorScope[] = ['operator.approvals'];

/** Build a transient requester for the official OpenClaw approval scope only. */
export function createApprovalRequester(
  source: PrivilegedSourceConnection,
  createConnection: PrivilegedConnectionFactory = (options) => new GatewayConnection(options),
  options: Omit<PrivilegedRequesterOptions, 'scopes'> = {},
): PrivilegedRequester {
  return createPrivilegedRequester(source, createConnection, {
    ...options,
    scopes: APPROVAL_OPERATOR_SCOPES,
  });
}

const requestPrivileged = createPrivilegedRequester(connection);
const requestApprovals = createApprovalRequester(connection);
const approvalClient = new OpenClawApprovalClient(
  (method, params) => requestApprovals(method, params),
  (method) => connection.hasAdvertisedMethod(method),
);
const sessionSettings = new SessionSettingsClient({
  runMutation: (sessionKey, operation) => sessionCommandCoordinator.runMutation(sessionKey, operation),
  request: (method, params) => connection.request(method, params),
  requestPrivileged: (method, params) => requestPrivileged(method, params),
});
const sessionOrganization = new OpenClawSessionOrganizationClient({
  runMutation: (sessionKey, operation) => sessionCommandCoordinator.runMutation(sessionKey, operation),
  request: (method, params) => connection.request(method, params),
});
const sessionLifecycle = new OpenClawSessionLifecycleClient(
  (method, params) => connection.request(method, params),
);
const taskLedger = new OpenClawTaskLedgerClient(
  (method, params) => connection.request(method, params),
  (method) => connection.hasAdvertisedMethod(method),
);
const cronRunClient = new OpenClawCronRunClient(
  (method, params) => connection.request(method, params),
  (method) => connection.hasAdvertisedMethod(method),
);
const cronStatusClient = new OpenClawCronStatusClient(
  (method, params) => connection.request(method, params),
  (method) => connection.hasAdvertisedMethod(method),
);
const cronManagementClient = new OpenClawCronManagementClient(
  (method, params) => requestPrivileged(method, { ...params }),
  (method) => connection.hasAdvertisedMethod(method),
);
const sessionSteer = new OpenClawSessionSteerClient(
  (method, params) => connection.request(method, params),
);
const sessionAbort = new OpenClawSessionAbortClient(
  (method, params) => connection.request(method, params),
);
const sessionCompaction = new OpenClawSessionCompactionClient(
  (method, params) => requestPrivileged(method, params),
);
const sessionCompactionCheckpoints = new OpenClawSessionCompactionCheckpointsClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  hasAdvertisedMethod: (method) => connection.hasAdvertisedMethod(method),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});
const agentManagement = new OpenClawAgentManagement({
  request: (method, params) => requestPrivileged(method, params),
});
const sessionRunReconciler = new OpenClawSessionRunReconciler({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, connectionId) => connection.requestFenced(
    method,
    params,
    connectionId,
    { timeoutMs: RUN_STATE_LOOKUP_TIMEOUT_MS },
  ),
  captureObservation: (sessionKey) => chatHandler.captureSessionRunObservation(sessionKey),
  isObservationCurrent: (observation) => (
    chatHandler.isSessionRunObservationCurrent(observation as ChatSessionRunObservation)
  ),
  applyMissing: (sessionKey) => chatHandler.settleMissingSession(sessionKey),
  applyHistory: (sessionKey, response, observation) => {
    chatHandler.reconcileHistoryRunState(
      sessionKey,
      response,
      observation as ChatSessionRunObservation,
    );
  },
  onError: (sessionKey, error) => {
    debugWarn('gateway', `[gateway] Could not reconcile run state for ${sessionKey}:`, error);
  },
});

// Collaboration plugin streams are refresh hints, not chat/agent activity.
// Route them through the typed bridge before the generic ChatHandler path.
connection.onEvent = (msg: unknown) => routeTalkGatewayEvent(
  msg,
  (talkRemainder) => routeVoiceWakeGatewayEvent(
    talkRemainder,
    (event) => routeGatewayEvent(event, (chatEvent) => chatHandler.handleEvent(chatEvent)),
  ),
);

// ── Public API (matches original gateway.ts exactly) ──
export const gateway = {
  // Setup
  setCallbacks(cb: GatewayCallbacks) { connection.setCallbacks(cb); },
  /** Replays the current socket state after a new UI host takes ownership. */
  refreshConnectionStatus() { connection.emitStatus(); },

  // Live chat projection
  invalidateChatSession(sessionKey: string) { chatHandler.invalidateSession(sessionKey); },
  clearChatTransportProjection() { chatHandler.clearTransportProjection(); },
  capturePendingChatSessionRunObservations() {
    return chatHandler.capturePendingSessionRunObservations();
  },
  reconcileChatSessionRuns(
    response: unknown,
    observations?: readonly ChatSessionRunObservation[],
  ) {
    const snapshot = parseOpenClawSessionListSnapshot(response);
    const unresolved = chatHandler.reconcileSessionRuns(
      snapshot.sessions,
      { settleMissing: snapshot.complete },
      observations,
    );
    if (unresolved.length > 0) {
      void Promise.all(unresolved.map((sessionKey) => sessionRunReconciler.reconcile(sessionKey)));
    }
  },
  observeActiveChatSessionRuns(sessions: unknown[]) { chatHandler.observeActiveSessionRuns(sessions); },
  captureChatSessionRunObservation(sessionKey: string) {
    return chatHandler.captureSessionRunObservation(sessionKey);
  },
  reconcileChatSessionRun(sessionKey: string) {
    return sessionRunReconciler.reconcile(sessionKey);
  },
  reconcileChatHistoryRunState(
    sessionKey: string,
    response: unknown,
    observation?: ChatSessionRunObservation,
  ) {
    chatHandler.reconcileHistoryRunState(sessionKey, response, observation);
    const history = historyTaskObservation(response);
    if (!history) return;
    void taskExecutionCoordinator.reconcileHistory({ sessionKey, ...history }).catch((error) => {
      taskExecutionCoordinator.reportPersistenceFailure('history reconciliation', error);
    });
  },
  async synchronizeSessionTranscript(target: OpenClawTranscriptTarget | null) {
    if (!connection.isConnected()) return;
    await transcriptSubscription.synchronize(target);
  },
  resetSessionTranscriptTransport() { transcriptSubscription.resetTransport(); },
  forgetSessionTranscript() { transcriptSubscription.forget(); },

  // Connection
  connect(url: string, token: string, deviceToken = '') { connection.connect(url, token, deviceToken); },
  disconnect() {
    transcriptSubscription.resetTransport();
    connection.disconnect();
  },
  getStatus() { return connection.getStatus(); },
  hasAdvertisedMethod(method: string) { return connection.hasAdvertisedMethod(method); },
  getLastError() { return connection.getLastError(); },
  captureConnectionId() { return connection.getAttestedConnectionId(); },
  isConnectionCurrent(connectionId: string) {
    return connection.isConnected() && connection.getAttestedConnectionId() === connectionId;
  },

  // Messaging
  async sendMessage(
    message: string,
    attachments?: GatewayAttachment[],
    sessionKey = 'agent:main:main',
    identity: {
      clientMessageId?: string;
      sessionId?: string;
      delivery?: 'send' | 'steer';
      supersededRunId?: string;
    } = {},
  ) {
    const gwAttachments = attachments?.map((att) => {
      let rawBase64 = att.content || '';
      if (rawBase64.startsWith('data:')) {
        rawBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      }
      return {
        type: att.mimeType?.startsWith('image/') ? 'image' : 'file',
        mimeType: att.mimeType,
        content: rawBase64,
        fileName: att.fileName || 'file',
      };
    });

    const clientMessageId = identity.clientMessageId ?? `junqi-${crypto.randomUUID()}`;
    const isSteer = identity.delivery === 'steer';
    chatHandler.beginPendingSend(sessionKey, clientMessageId);
    let requestDispatched = false;
    try {
      const dispatch = async () => {
        // The renderer owns the only visible, cancellable retry queue. Keeping a
        // second transport queue would acknowledge work that the UI cannot inspect.
        if (!connection.isConnected()) throw new GatewayDisconnectedError();

        // Enable reasoning stream lazily only when the user actually sends a message.
        await connection.ensureReasoningStream(sessionKey);
        if (!connection.isConnected()) throw new GatewayDisconnectedError();
        requestDispatched = true;
        if (isSteer) {
          return sessionSteer.steer({
            key: sessionKey,
            message,
            idempotencyKey: clientMessageId,
            ...(gwAttachments?.length ? { attachments: gwAttachments } : {}),
          });
        }
        return connection.request('chat.send', {
          sessionKey,
          ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
          message,
          idempotencyKey: clientMessageId,
          ...(gwAttachments?.length ? { attachments: gwAttachments } : {}),
        });
      };
      // sessions.steer is itself the OpenClaw interrupt-and-send control
      // operation. It must not wait behind a long chat.send transport promise.
      const dispatched = isSteer
        ? await dispatch()
        : await sessionCommandCoordinator.runMutation(sessionKey, dispatch);
      const result = isSteer
        ? (dispatched as Awaited<ReturnType<OpenClawSessionSteerClient['steer']>>).response
        : dispatched;
      const acknowledgement = chatHandler.reconcileSendAcknowledgement(
        sessionKey,
        clientMessageId,
        result,
      );
      if (
        isSteer
        && identity.supersededRunId
        && (dispatched as Awaited<ReturnType<OpenClawSessionSteerClient['steer']>>).interruptedActiveRun === true
      ) {
        await taskExecutionCoordinator.settleRun({
          sessionKey,
          sessionId: identity.sessionId,
          runId: identity.supersededRunId,
          terminalReason: 'aborted',
        }).catch((error) => taskExecutionCoordinator.reportPersistenceFailure('settle steered Run checkpoint', error));
      }
      if (acknowledgement !== 'unknown') return result;
      if (chatHandler.markPendingSendUncertain(sessionKey, clientMessageId)) {
        return { deliveryUncertain: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryUncertain;
      }
      return { deliveryObserved: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryObserved;
    } catch (error) {
      // sessions.steer can fail after its native admission has attempted to
      // interrupt the active Run. An RPC error alone cannot distinguish that
      // case from a rejected request, so defer to the fenced history resolver.
      if (isSteer && requestDispatched) {
        void sessionRunReconciler.reconcile(sessionKey);
      }
      if (chatHandler.isSendObserved(sessionKey, clientMessageId)) {
        return { deliveryObserved: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryObserved;
      }
      if (requestDispatched && !(error instanceof GatewayRpcError)) {
        if (chatHandler.markPendingSendUncertain(sessionKey, clientMessageId)) {
          return { deliveryUncertain: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryUncertain;
        }
        return { deliveryObserved: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryObserved;
      }
      chatHandler.failPendingSend(sessionKey, clientMessageId);
      throw error;
    }
  },

  // Sessions & Agents
  async getSessions() { return connection.request('sessions.list', {}); },
  async createSession(input: { agentId: string; label?: string; parentSessionKey?: string }) {
    return sessionLifecycle.create(input);
  },
  async describeSession(sessionKey: string) {
    return connection.request('sessions.describe', { key: sessionKey });
  },
  async getAgents() { return connection.request('agents.list', {}); },
  async listCommands(input: OpenClawCommandsListInput = {}) { return openClawCommandsClient.list(input); },
  async listTasks(input: OpenClawTaskListInput = {}) { return taskLedger.list(input); },
  async getTask(taskId: string) { return taskLedger.get(taskId); },
  async cancelTask(taskId: string, reason?: string) { return taskLedger.cancel(taskId, reason); },
  async enqueueCronRun(jobId: string) { return cronRunClient.enqueue(jobId); },
  async listCronRuns(jobId: string, runId?: string) { return cronRunClient.list(jobId, runId); },
  async findTerminalCronRun(jobId: string, runId: string) { return cronRunClient.findTerminal(jobId, runId); },
  async getCronStatus() { return cronStatusClient.get(); },
  async addCronAgentTurn(params: CronAgentTurnAddParams): Promise<OpenClawCronManagedJob> {
    return cronManagementClient.addAgentTurn(params);
  },
  async updateCronJob(jobId: string, patch: OpenClawCronMutationPatch): Promise<OpenClawCronManagedJob> {
    return cronManagementClient.update(jobId, patch);
  },
  async removeCronJob(jobId: string): Promise<void> {
    return cronManagementClient.remove(jobId);
  },
  async listAuditEvents(input: OpenClawAuditListInput = {}) { return auditClient.list(input); },
  async listPendingApprovals() { return approvalClient.list(); },
  async listApprovalHistory(input: OpenClawApprovalHistoryRequest = {}) {
    return approvalClient.history(input);
  },
  async getApproval(id: string) { return approvalClient.get(id); },
  async resolveApproval(approval: OpenClawApproval, decision: OpenClawApprovalDecision) {
    return approvalClient.resolve(approval, decision);
  },
  async createAgent(agent: GatewayAgentCreatePayload) { return agentManagement.create(agent); },
  async updateAgent(agentId: string, patch: GatewayAgentUpdateParams) {
    return requestPrivileged<{ ok: true; agentId: string }>('agents.update', { agentId, ...patch });
  },
  async deleteAgent(agentId: string) { return requestPrivileged('agents.delete', { agentId }); },

  // History & Abort
  async getHistory(
    sessionKey: string,
    limit = 200,
    timeoutMs = 15_000,
    options: GatewayHistoryOptions = {},
  ) {
    return connection.request('chat.history', {
      sessionKey,
      limit,
      ...(options.offset !== undefined ? { offset: options.offset } : {}),
      ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
    }, { timeoutMs });
  },
  async getMessage(sessionKey: string, messageId: string, agentId?: string) {
    return connection.request('chat.message.get', {
      sessionKey,
      messageId,
      ...(agentId ? { agentId } : {}),
    });
  },
  async abortChat(sessionKey = 'agent:main:main') {
    // Abort is a control-plane request. Waiting behind a long-running
    // chat.send request makes it impossible to stop a response whose send
    // acknowledgement was lost or delayed.
    return abortAfterTaskCheckpoint(
      async () => {
        try {
          await taskExecutionCoordinator.requestStop(sessionKey);
        } catch (error) {
          taskExecutionCoordinator.reportPersistenceFailure('persist Stop checkpoint', error);
          throw error;
        }
      },
      async () => {
        const runId = chatHandler.abortRunId(sessionKey);
        const result = await sessionAbort.abort({
          key: sessionKey,
          ...(runId ? { runId } : {}),
        });
        return chatHandler.reconcileSessionAbortAcknowledgement(sessionKey, result);
      },
    );
  },
  async compactSession(sessionKey = 'agent:main:main') {
    const key = sessionKey.trim();
    if (!key) throw new Error('A session key is required for OpenClaw compaction');
    return sessionCommandCoordinator.runMutation(
      key,
      () => sessionCompaction.compact({ key }),
    );
  },
  async listSessionCompactionCheckpoints(sessionKey: string) {
    return sessionCompactionCheckpoints.list(sessionKey);
  },

  // Session Lifecycle
  async deleteSession(sessionKey: string, deleteTranscript = true, expectedSessionId?: string) {
    return sessionCommandCoordinator.runMutation(
      sessionKey,
      async () => {
        const result = await requestPrivileged<Record<string, unknown>>('sessions.delete', {
          key: sessionKey,
          deleteTranscript,
          ...(expectedSessionId ? { expectedSessionId } : {}),
        });
        assertVerifiedSessionMutationResult(result, 'delete', sessionKey);
        await cleanupSessionArtifacts(sessionKey);
        return result;
      },
    );
  },
  async resetSession(sessionKey: string) {
    return sessionCommandCoordinator.runMutation(
      sessionKey,
      async () => {
        const result = await requestPrivileged<Record<string, unknown>>('sessions.reset', { key: sessionKey });
        assertVerifiedSessionMutationResult(result, 'reset', sessionKey);
        await cleanupSessionArtifacts(sessionKey);
        return result;
      },
    );
  },
  async deleteSessionFenced(
    sessionKey: string,
    deleteTranscript: true,
    expectedSessionId: string,
    expectedConnectionId: string,
  ) {
    return sessionCommandCoordinator.runMutation(
      sessionKey,
      async () => {
        if (connection.getAttestedConnectionId() !== expectedConnectionId) {
          throw new Error('The verified Gateway connection changed before session deletion');
        }
        const result = await requestPrivileged<Record<string, unknown>>('sessions.delete', {
          key: sessionKey,
          deleteTranscript,
          expectedSessionId,
        });
        if (connection.getAttestedConnectionId() !== expectedConnectionId) {
          throw new Error('The verified Gateway connection changed while session deletion was completing');
        }
        assertVerifiedSessionMutationResult(result, 'delete', sessionKey);
        await cleanupSessionArtifacts(sessionKey);
        return result;
      },
    );
  },
  async resetSessionFenced(sessionKey: string, expectedConnectionId: string) {
    return sessionCommandCoordinator.runMutation(
      sessionKey,
      async () => {
        const result = await connection.requestFenced(
          'sessions.reset',
          { key: sessionKey },
          expectedConnectionId,
        );
        assertVerifiedSessionMutationResult(result, 'reset', sessionKey);
        await cleanupSessionArtifacts(sessionKey);
        return result;
      },
    );
  },

  // Session Settings
  async setSessionModel(model: string | null, sessionKey = 'agent:main:main') {
    return sessionSettings.setModel(sessionKey, model);
  },
  async setSessionThinking(level: string | null, sessionKey = 'agent:main:main') {
    return sessionSettings.setThinking(sessionKey, level);
  },
  async setSessionLabel(label: string | null, sessionKey = 'agent:main:main') {
    return sessionSettings.setLabel(sessionKey, label);
  },
  async setSessionPinned(pinned: boolean, sessionKey: string) {
    return sessionOrganization.setPinned(sessionKey, pinned);
  },
  async setSessionUnread(unread: boolean, sessionKey: string) {
    return sessionOrganization.setUnread(sessionKey, unread);
  },
  async setSessionArchived(archived: boolean, sessionKey: string) {
    return sessionOrganization.setArchived(sessionKey, archived);
  },
  async setSessionCategory(category: string | null, sessionKey: string) {
    return sessionOrganization.setCategory(sessionKey, category);
  },
  async listSessionGroups() {
    return sessionOrganization.listGroups();
  },
  async createSessionGroup(label: string) {
    return sessionOrganization.putGroup(label);
  },
  async renameSessionGroup(from: string, to: string) {
    return sessionOrganization.renameGroup(from, to);
  },
  async deleteSessionGroup(label: string) {
    return sessionOrganization.deleteGroup(label);
  },
  async updateAgentParams(agentId: string, params: Record<string, any>) {
    return requestPrivileged('agents.update', { agentId, params });
  },

  // Models & Usage
  async getSessionStatus(_sessionKey = 'agent:main:main') { return connection.request('sessions.list', {}); },
  async getAvailableModels(view: 'default' | 'configured' | 'all' = 'configured') {
    return connection.request('models.list', { view });
  },
  async call(method: string, params: any = {}, options?: GatewayRequestOptions) {
    return connection.request(method, params, options);
  },
  async callFenced(method: string, params: any, expectedConnectionId: string) {
    return connection.requestFenced(method, params, expectedConnectionId);
  },
  async callPrivileged(
    method: string,
    params: Record<string, unknown> = {},
    options?: GatewayRequestOptions,
  ) {
    return requestPrivileged(method, params, options?.timeoutMs);
  },
  // Skills — list installed skills with status (input for the @skill picker)
  async getSkills(agentId?: string) { return connection.request('skills.status', agentId ? { agentId } : {}); },
  async getCostSummary(days = 30) { return connection.request('usage.cost', { days, agentScope: 'all' }); },
  async getSessionsUsage(params: any = {}) {
    const scope = params.agentId || params.key ? {} : { agentScope: 'all' };
    return connection.request('sessions.usage', { limit: 50, ...scope, ...params });
  },
  async getSessionTimeseries(key: string) { return connection.request('sessions.usage.timeseries', { key }); },
  async getSessionLogs(key: string, limit = 200) { return connection.request('sessions.usage.logs', { key, limit }); },

  // Pairing
  getHttpBaseUrl() { return connection.getHttpBaseUrl(); },
  getToken() { return connection.token; },
  getDeviceToken() { return connection.deviceToken; },
  stopPairingRetry() { connection.stopPairingRetry(); },
  cancelActivePrivilegedRequest() { requestPrivileged.cancelActiveRequest(); },
  cancelPrivilegedAuthorizationRetry() { requestPrivileged.cancelPairingRetry(); },
  reconnectWithToken(newToken: string) { connection.reconnectWithToken(newToken); },
};
