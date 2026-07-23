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
import type { GatewayAgentCreatePayload } from '@/utils/gatewayAgentFlow';
import { routeGatewayEvent } from './collaborationEventBridge';
import type { GatewayAuthorizationIssue } from './messageRouter';
import { sessionCommandCoordinator } from '@/services/chat/sessionCommandCoordinator';
import type { GatewayAttachment } from '@/services/chat/types';

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

export { GatewayAgentDisplayNameUpdateError };

async function cleanupSessionArtifacts(sessionKey: string): Promise<void> {
  const operations: Array<{ label: string; task: Promise<unknown> | undefined }> = [
    { label: 'uploads', task: window.aegis?.uploads?.cleanupSession?.({ sessionKey }) },
    { label: 'outputs', task: window.aegis?.managedFiles?.cleanupSessionRefs?.({ sessionKey, kind: 'outputs' }) },
    { label: 'voice', task: window.aegis?.voice?.cleanupSession?.({ sessionKey }) },
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

type PrivilegedSourceConnection = Pick<GatewayConnection, 'isConnected' | 'url' | 'token' | 'deviceToken'>;
type TransientGatewayConnection = Pick<
  GatewayConnection,
  'connect' | 'disconnect' | 'request' | 'setCallbacks'
>;
type PrivilegedConnectionFactory = (
  options: GatewayConnectionOptions,
) => TransientGatewayConnection;
export type PrivilegedRequester = <T>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number | null,
) => Promise<T>;

type PrivilegedAuthorizationIssueListener = (issue: GatewayAuthorizationIssue) => void;
const privilegedAuthorizationIssueListeners = new Set<PrivilegedAuthorizationIssueListener>();

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

export class GatewayPrivilegedAuthorizationError extends Error {
  constructor(public readonly issue: GatewayAuthorizationIssue) {
    const approval = issue.requestId
      ? ` Run: openclaw devices approve ${issue.requestId}.`
      : '';
    super(`Gateway authorization failed (${issue.code}): ${issue.message}.${approval}`);
    this.name = 'GatewayPrivilegedAuthorizationError';
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
): PrivilegedRequester {
  let lane: Promise<void> = Promise.resolve();

  const execute = async <T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number | null = 30_000,
  ): Promise<T> => {
    if (!source.isConnected() || !source.url || (!source.token && !source.deviceToken)) {
      throw new Error('A verified Gateway connection is required for this management action');
    }
    const target = { url: source.url, token: source.token, deviceToken: source.deviceToken };
    const transient = createConnection({ scopes: ['operator.admin'], transient: true });
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let requestStarted = false;
      const timer = timeoutMs === null
        ? null
        : window.setTimeout(() => {
          finish(false, new Error(`Privileged Gateway request timed out (${timeoutMs}ms)`));
        }, timeoutMs);
      const finish = (ok: boolean, value: unknown) => {
        if (settled) return;
        settled = true;
        if (timer !== null) window.clearTimeout(timer);
        transient.disconnect();
        if (ok) resolve(value as T);
        else reject(errorValue(value));
      };
      transient.setCallbacks({
        onMessage() {},
        onStreamChunk() {},
        onStreamEnd() {},
        onStatusChange(status) {
          if (settled || requestStarted) return;
          if (status.error) {
            finish(false, status.error);
            return;
          }
          if (!status.connected) return;
          requestStarted = true;
          void transient.request(method, params, { timeoutMs })
            .then((result) => finish(true, result))
            .catch((error) => finish(false, error));
        },
        onAuthorizationIssue(issue) {
          emitPrivilegedAuthorizationIssue(issue);
          finish(false, new GatewayPrivilegedAuthorizationError(issue));
        },
        onScopeError(error) {
          finish(false, error);
        },
      });
      transient.connect(target.url, target.token, target.deviceToken);
    });
  };

  return <T>(method: string, params: Record<string, unknown>, timeoutMs?: number | null) => {
    const operation = lane.then(() => execute<T>(method, params, timeoutMs));
    lane = operation.then(() => undefined, () => undefined);
    return operation;
  };
}

const requestPrivileged = createPrivilegedRequester(connection);
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
connection.onEvent = (msg: any) => routeGatewayEvent(msg, (event) => chatHandler.handleEvent(event));

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
    transcriptSubscription.resetTransport();
    connection.disconnect();
  },
  getStatus() { return connection.getStatus(); },
  getLastError() { return connection.getLastError(); },

  // Messaging
  async sendMessage(
    message: string,
    attachments?: GatewayAttachment[],
    sessionKey = 'agent:main:main',
    identity: { clientMessageId?: string; sessionId?: string } = {},
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
    chatHandler.beginPendingSend(sessionKey, clientMessageId);
    let requestDispatched = false;
    try {
      const result = await sessionCommandCoordinator.runMutation(sessionKey, async () => {
        // The renderer owns the only visible, cancellable retry queue. Keeping a
        // second transport queue would acknowledge work that the UI cannot inspect.
        if (!connection.isConnected()) throw new GatewayDisconnectedError();

        // Enable reasoning stream lazily only when the user actually sends a message.
        await connection.ensureReasoningStream(sessionKey);
        if (!connection.isConnected()) throw new GatewayDisconnectedError();
        requestDispatched = true;
        return connection.request('chat.send', {
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
  },

  // Sessions & Agents
  async getSessions() { return connection.request('sessions.list', {}); },
  async describeSession(sessionKey: string) {
    return connection.request('sessions.describe', { key: sessionKey });
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
      () => connection.request('chat.send', {
        sessionKey,
        message: '/compact',
        idempotencyKey: `aegis-compact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }),
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
        const result = await connection.request('sessions.reset', { key: sessionKey });
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
  async setSessionModel(model: string, sessionKey = 'agent:main:main') {
    return sessionCommandCoordinator.runMutation(
      sessionKey,
      () => connection.request('sessions.patch', { key: sessionKey, model }),
    );
  },
  async setSessionThinking(level: string | null, sessionKey = 'agent:main:main') {
    return sessionCommandCoordinator.runMutation(
      sessionKey,
      () => connection.request('sessions.patch', { key: sessionKey, thinkingLevel: level }),
    );
  },
  async setSessionLabel(label: string | null, sessionKey = 'agent:main:main') {
    return sessionCommandCoordinator.runMutation(
      sessionKey,
      () => connection.request('sessions.patch', { key: sessionKey, label }),
    );
  },
  async updateAgentParams(agentId: string, params: Record<string, any>) {
    return requestPrivileged('agents.update', { agentId, params });
  },

  // Models & Usage
  async getSessionStatus(sessionKey = 'agent:main:main') { return connection.request('sessions.list', {}); },
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
  reconnectWithToken(newToken: string) { connection.reconnectWithToken(newToken); },
};
