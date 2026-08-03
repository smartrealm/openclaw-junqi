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
import { GatewayApprovalEventSubscription } from './approvalEventBridge';
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
import { SessionCompactionClient } from './SessionCompactionClient';
import {
  OpenClawApprovalClient,
  type ApprovalDecision,
  type ApprovalRecord,
  type ApprovalResolveResult,
} from './approvals';
import { buildSessionsCompactParams, parseSessionsCompactResult } from './sessionMaintenance';
import { buildSessionsSteerParams } from './sessionSteering';
import { buildToolsEffectiveParams, parseToolsEffectiveResult, type ToolsEffectiveResult } from './toolsEffective';
import { buildToolsCatalogParams, parseToolsCatalogResult, type ToolsCatalogResult } from './toolsCatalog';
import { buildToolsInvokeParams, parseToolsInvokeResult, type ToolsInvokeParams, type ToolsInvokeResult } from './toolsInvoke';
import {
  buildSessionsCompactionListParams,
  buildSessionsPreviewParams,
  buildSessionsResolveParams,
  parseSessionsCompactionListResult,
  parseSessionsPreviewResult,
  parseSessionsResolveResult,
  requireSessionPreview,
  type SessionCompactionCheckpoint,
  type SessionPreview,
  type SessionsPreviewParams,
  type SessionsResolveResult,
} from './sessionInspection';
import {
  buildArtifactsDownloadParams,
  buildArtifactsGetParams,
  buildArtifactsListParams,
  parseArtifactDownloadResult,
  parseArtifactGetResult,
  parseArtifactsListResult,
  type ArtifactDownloadResult,
  type ArtifactSummary,
} from './artifacts';
import {
  buildMemoryRemHarnessParams,
  buildMemoryStatusParams,
  parseMemoryRemHarnessResult,
  parseMemoryStatusResult,
  type MemoryRemHarnessParams,
  type MemoryRemHarnessResult,
  type MemoryStatusResult,
} from './memoryDoctor';
import {
  enqueueCronRun,
  getCronJob,
  listCronRuns,
  waitForCronRun,
  type CronRunEnqueueResult,
  type CronRunLogEntry,
  type CronRunWaitOptions,
  type CronRunsPage,
  type OpenClawCronJobDetails,
  type CronRunsParams,
} from './cronRuns';

// Re-export types for consumers
export type {
  ChatMessage,
  MediaInfo,
  GatewayCallbacks,
  GatewayConnectionOptions,
  GatewayRequestOptions,
};
export type { OpenClawTranscriptTarget } from './SessionTranscriptSubscription';
export { GatewayConnectionFenceError, GatewayDisconnectedError, GatewayRpcError } from './Connection';

export class GatewaySessionMutationRejectedError extends Error {
  readonly code = 'SESSION_MUTATION_REJECTED';

  constructor(message: string) {
    super(message);
    this.name = 'GatewaySessionMutationRejectedError';
  }
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

// ── Create instances ──
const connection = new GatewayConnection();
const chatHandler = new ChatHandler(connection);
const transcriptSubscription = new OpenClawSessionTranscriptSubscription(connection);
const SESSION_ARTIFACT_CLEANUP_TIMEOUT_MS = 5_000;
const RUN_STATE_LOOKUP_TIMEOUT_MS = 5_000;

interface GatewayMessageIdentity {
  clientMessageId?: string;
  sessionId?: string;
}

type GatewayMessageMethod = 'chat.send' | 'sessions.steer';

function gatewayAttachmentPayload(attachments?: GatewayAttachment[]) {
  return attachments?.map((att) => {
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
}

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
  retryPairingNow(): void;
}

interface PrivilegedRequesterOptions {
  pairingRetryMs?: number;
  pairingTimeoutMs?: number;
  scopes?: readonly GatewayOperatorScope[];
}

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

/** Build a serialized admin lane whose elevated socket exists for one RPC only. */
export function createPrivilegedRequester(
  source: PrivilegedSourceConnection,
  createConnection: PrivilegedConnectionFactory = (options) => new GatewayConnection(options),
  options: PrivilegedRequesterOptions = {},
): PrivilegedRequester {
  let lane: Promise<void> = Promise.resolve();
  let cancelActivePairingRetry: (() => void) | null = null;
  let retryActivePairingNow: (() => void) | null = null;
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
    const transient = createConnection({
      scopes: options.scopes?.length ? options.scopes : ['operator.admin'],
      transient: true,
    });
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
    rpcTimeoutMs: number | null = timeoutMs,
  ): Promise<T> => {
    const normalizedTimeoutMs = timeoutMs === null ? null : Math.max(1_000, timeoutMs);
    const normalizedRpcTimeoutMs = rpcTimeoutMs === null ? null : Math.max(1_000, rpcTimeoutMs);
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
        const remainingBudgetMs = requireRemainingBudget();
        const attemptTimeoutMs = remainingBudgetMs === null
          ? normalizedRpcTimeoutMs
          : normalizedRpcTimeoutMs === null
            ? remainingBudgetMs
            : Math.min(remainingBudgetMs, normalizedRpcTimeoutMs);
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
            let settled = false;
            const finish = (outcome: 'retry' | 'cancel') => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              retryActivePairingNow = null;
              if (outcome === 'retry') resolve();
              else reject(new Error('Privileged Gateway authorization was cancelled'));
            };
            const timer = window.setTimeout(() => finish('retry'), pairingRetryMs);
            retryActivePairingNow = () => finish('retry');
            cancelActivePairingRetry = () => finish('cancel');
          });
        }
        cancelActivePairingRetry = null;
        retryActivePairingNow = null;
        assertSourceCurrent();
      }
    } finally {
      cancelActivePairingRetry = null;
      retryActivePairingNow = null;
    }
  };

  const request = (<T>(method: string, params: Record<string, unknown>, timeoutMs?: number | null) => {
    const enqueuedAt = Date.now();
    const rpcTimeoutMs = timeoutMs === null
      ? null
      : Math.max(1_000, timeoutMs ?? 30_000);
    // Normal short queue deadlines remain exact. Interactive/admin operations
    // with a regular request budget reserve an additional pairing window, but
    // every connected RPC attempt still uses only the caller's original budget.
    const normalizedTimeoutMs = rpcTimeoutMs === null
      ? null
      : rpcTimeoutMs >= 30_000
        ? rpcTimeoutMs + pairingTimeoutMs
        : rpcTimeoutMs;
    let expiredInQueue = false;
    const execution = lane.then(() => {
      if (expiredInQueue && normalizedTimeoutMs !== null) {
        throw requestTimeoutError(normalizedTimeoutMs);
      }
      return execute<T>(method, params, normalizedTimeoutMs, enqueuedAt, rpcTimeoutMs);
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
  request.retryPairingNow = () => retryActivePairingNow?.();
  return request;
}

const requestPrivileged = createPrivilegedRequester(connection);
const requestApprovals = createPrivilegedRequester(connection, undefined, {
  scopes: ['operator.approvals'],
});
const approvalClient = new OpenClawApprovalClient({
  requestPrivileged: (method, params) => requestApprovals(method, params),
});
const approvalEventSubscription = new GatewayApprovalEventSubscription({
  source: connection,
});
let approvalEventConsumers = 0;

function acquireGatewayApprovalEvents(): () => void {
  approvalEventConsumers += 1;
  if (approvalEventConsumers === 1) approvalEventSubscription.start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    approvalEventConsumers = Math.max(0, approvalEventConsumers - 1);
    if (approvalEventConsumers === 0) approvalEventSubscription.stop();
  };
}
const sessionSettings = new SessionSettingsClient({
  runMutation: (sessionKey, operation) => sessionCommandCoordinator.runMutation(sessionKey, operation),
  request: (method, params) => connection.request(method, params),
  requestPrivileged: (method, params) => requestPrivileged(method, params),
});
const sessionOrganization = new OpenClawSessionOrganizationClient({
  runMutation: (sessionKey, operation) => sessionCommandCoordinator.runMutation(sessionKey, operation),
  requestPrivileged: (method, params) => requestPrivileged(method, params),
});
const sessionLifecycle = new OpenClawSessionLifecycleClient(
  (method, params) => connection.request(method, params),
);
const sessionCompaction = new SessionCompactionClient({
  request: (method, params) => connection.request(method, params),
  requestPrivileged: (method, params) => requestPrivileged(method, params),
  runMutation: (sessionKey, operation) => sessionCommandCoordinator.runMutation(sessionKey, operation),
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

async function sendGatewayMessage(
  method: GatewayMessageMethod,
  message: string,
  attachments: GatewayAttachment[] | undefined,
  sessionKey: string,
  identity: GatewayMessageIdentity = {},
): Promise<unknown> {
  const gwAttachments = gatewayAttachmentPayload(attachments);
  const clientMessageId = identity.clientMessageId ?? `junqi-${crypto.randomUUID()}`;
  const steerParams = method === 'sessions.steer'
    ? buildSessionsSteerParams(sessionKey, message, {
      attachments: gwAttachments,
      idempotencyKey: clientMessageId,
    })
    : undefined;
  chatHandler.beginPendingSend(sessionKey, clientMessageId);
  let requestDispatched = false;
  try {
    const result = await sessionCommandCoordinator.runMutation(sessionKey, async () => {
      if (!connection.isConnected()) throw new GatewayDisconnectedError();
      await connection.ensureReasoningStream(sessionKey);
      if (!connection.isConnected()) throw new GatewayDisconnectedError();
      requestDispatched = true;
      if (method === 'sessions.steer') {
        return connection.request(method, steerParams);
      }
      return connection.request(method, {
        sessionKey,
        ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
        message,
        idempotencyKey: clientMessageId,
        ...(gwAttachments?.length ? { attachments: gwAttachments } : {}),
      });
    });
    const acknowledgement = chatHandler.reconcileSendAcknowledgement(
      sessionKey,
      clientMessageId,
      result,
    );
    if (acknowledgement !== 'unknown') return result;
    if (chatHandler.markPendingSendUncertain(sessionKey, clientMessageId)) {
      return { deliveryUncertain: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryUncertain;
    }
    return { deliveryObserved: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryObserved;
  } catch (error) {
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
}

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
    approvalEventSubscription.stop();
    transcriptSubscription.resetTransport();
    connection.disconnect();
  },
  acquireGatewayApprovalEvents() { return acquireGatewayApprovalEvents(); },
  getStatus() { return connection.getStatus(); },
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
    identity: GatewayMessageIdentity = {},
  ) {
    return sendGatewayMessage('chat.send', message, attachments, sessionKey, identity);
  },
  async steerMessage(
    message: string,
    attachments?: GatewayAttachment[],
    sessionKey = 'agent:main:main',
    identity: Pick<GatewayMessageIdentity, 'clientMessageId'> = {},
  ) {
    return sendGatewayMessage('sessions.steer', message, attachments, sessionKey, identity);
  },

  // Sessions & Agents
  async getSessions() { return connection.request('sessions.list', {}); },
  async createSession(input: { agentId: string; label?: string; parentSessionKey?: string }) {
    return sessionLifecycle.create(input);
  },
  async describeSession(sessionKey: string) {
    return connection.request('sessions.describe', { key: sessionKey });
  },
  async getEffectiveTools(sessionKey = 'agent:main:main', agentId?: string): Promise<ToolsEffectiveResult> {
    return parseToolsEffectiveResult(
      await connection.request('tools.effective', buildToolsEffectiveParams(sessionKey, agentId)),
    );
  },
  async invokeTool(params: ToolsInvokeParams): Promise<ToolsInvokeResult> {
    return parseToolsInvokeResult(
      await connection.request('tools.invoke', buildToolsInvokeParams(params)),
    );
  },
  async getToolsCatalog(agentId?: string, includePlugins?: boolean): Promise<ToolsCatalogResult> {
    return parseToolsCatalogResult(
      await connection.request('tools.catalog', buildToolsCatalogParams(agentId, includePlugins)),
    );
  },
  async getSessionPreview(
    sessionKey = 'agent:main:main',
    options: Pick<SessionsPreviewParams, 'limit' | 'maxChars'> = {},
  ): Promise<SessionPreview> {
    const result = parseSessionsPreviewResult(
      await connection.request('sessions.preview', buildSessionsPreviewParams([sessionKey], options)),
    );
    return requireSessionPreview(result, sessionKey);
  },
  async resolveSessionKey(sessionKey = 'agent:main:main', agentId?: string): Promise<SessionsResolveResult> {
    return parseSessionsResolveResult(
      await connection.request(
        'sessions.resolve',
        buildSessionsResolveParams(sessionKey, { agentId, allowMissing: true }),
      ),
    );
  },
  async listSessionCompactionCheckpoints(sessionKey = 'agent:main:main', agentId?: string): Promise<SessionCompactionCheckpoint[]> {
    const result = parseSessionsCompactionListResult(
      await connection.request('sessions.compaction.list', buildSessionsCompactionListParams(sessionKey, agentId)),
      sessionKey,
    );
    return result.checkpoints;
  },
  async getSessionCompactionCheckpoint(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ) {
    return sessionCompaction.get(sessionKey, checkpointId, agentId);
  },
  async branchSessionCompactionCheckpoint(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ) {
    return sessionCompaction.branch(sessionKey, checkpointId, agentId);
  },
  async restoreSessionCompactionCheckpoint(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ) {
    return sessionCompaction.restore(sessionKey, checkpointId, agentId);
  },
  async listSessionArtifacts(sessionKey = 'agent:main:main', agentId?: string): Promise<ArtifactSummary[]> {
    return parseArtifactsListResult(
      await connection.request('artifacts.list', buildArtifactsListParams({ sessionKey, agentId })),
      sessionKey,
    ).artifacts;
  },
  async getSessionArtifact(
    artifactId: string,
    sessionKey = 'agent:main:main',
    agentId?: string,
  ): Promise<ArtifactSummary> {
    return parseArtifactGetResult(
      await connection.request('artifacts.get', buildArtifactsGetParams(artifactId, { sessionKey, agentId })),
      artifactId,
      sessionKey,
    ).artifact;
  },
  async downloadSessionArtifact(
    artifactId: string,
    sessionKey = 'agent:main:main',
    agentId?: string,
  ): Promise<ArtifactDownloadResult> {
    return parseArtifactDownloadResult(
      await connection.request(
        'artifacts.download',
        buildArtifactsDownloadParams(artifactId, { sessionKey, agentId }),
      ),
      artifactId,
      sessionKey,
    );
  },
  async getCronJob(jobId: string): Promise<OpenClawCronJobDetails> {
    return getCronJob(
      (method, params) => connection.request(method, params),
      jobId,
    );
  },
  async listCronRuns(params: CronRunsParams): Promise<CronRunsPage> {
    return listCronRuns(
      (method, requestParams) => connection.request(method, requestParams),
      params,
    );
  },
  async enqueueCronRun(jobId: string, mode: 'due' | 'force' = 'force'): Promise<CronRunEnqueueResult> {
    return enqueueCronRun(
      (method, params) => connection.request(method, params),
      jobId,
      mode,
    );
  },
  async waitForCronRun(
    jobId: string,
    runId: string,
    options?: CronRunWaitOptions,
  ): Promise<CronRunLogEntry> {
    return waitForCronRun(
      (method, params) => connection.request(method, params),
      jobId,
      runId,
      options,
    );
  },
  async getMemoryStatus(agentId?: string, deep = false): Promise<MemoryStatusResult> {
    return parseMemoryStatusResult(
      await connection.request('doctor.memory.status', buildMemoryStatusParams(agentId, deep)),
    );
  },
  async getMemoryRemHarness(options: MemoryRemHarnessParams = {}): Promise<MemoryRemHarnessResult> {
    return parseMemoryRemHarnessResult(
      await connection.request('doctor.memory.remHarness', buildMemoryRemHarnessParams(options)),
    );
  },
  async listGatewayApprovals(): Promise<ApprovalRecord[]> {
    return approvalClient.list();
  },
  async resolveGatewayApproval(
    record: ApprovalRecord,
    decision: ApprovalDecision,
  ): Promise<ApprovalResolveResult> {
    return approvalClient.resolve(record, decision);
  },
  async getAgents() { return connection.request('agents.list', {}); },
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
    const runId = chatHandler.abortRunId(sessionKey);
    const result = await connection.request('chat.abort', {
      sessionKey,
      ...(runId ? { runId } : {}),
    });
    return chatHandler.reconcileAbortAcknowledgement(sessionKey, result);
  },
  async compactSession(sessionKey = 'agent:main:main') {
    return sessionCommandCoordinator.runMutation(
      sessionKey,
      async () => parseSessionsCompactResult(
        await connection.request('sessions.compact', buildSessionsCompactParams(sessionKey)),
        sessionKey,
      ),
    );
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
  cancelApprovalAuthorizationRetry() { requestApprovals.cancelPairingRetry(); },
  retryPrivilegedAuthorizationNow() { requestPrivileged.retryPairingNow(); },
  reconnectWithToken(newToken: string) { connection.reconnectWithToken(newToken); },
};
