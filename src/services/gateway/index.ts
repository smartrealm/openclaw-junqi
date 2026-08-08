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
  type GatewayRequestParams,
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
import type { GatewayHelloObservation } from '@/types/gatewayRuntime';
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
  subscribeTalkRelayEvents,
} from './talkEventBridge';
import type { GatewayAuthorizationIssue } from './messageRouter';
import { sessionCommandCoordinator } from '@/services/chat/sessionCommandCoordinator';
import type { GatewayAttachment } from '@/services/chat/types';
import { SessionSettingsClient } from './SessionSettingsClient';
import { requireOpenClawSessionTarget } from './OpenClawSessionTarget';
import { OpenClawSessionOrganizationClient } from './OpenClawSessionOrganizationClient';
import { OpenClawSessionGroupsClient } from './OpenClawSessionGroupsClient';
import { OpenClawSessionLifecycleClient } from './OpenClawSessionLifecycleClient';
import { listAllOpenClawSessions } from './OpenClawSessionListClient';
import { parseOpenClawDescribedSession } from './OpenClawSessionProjection';
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
import { SessionTranscriptHistoryClient } from './SessionTranscriptHistoryClient';
import { OpenClawSessionObserverClient } from './OpenClawSessionObserverClient';
import { OpenClawSessionViewerPresenceClient } from './OpenClawSessionViewerPresenceClient';
import {
  openClawSessionObserverStream,
  routeOpenClawSessionObserverEvent,
} from './sessionObserverEventBridge';
import { OpenClawCronRunClient } from './OpenClawCronRunClient';
import { OpenClawCronStatusClient } from './OpenClawCronStatusClient';
import { OpenClawTtsClient } from './OpenClawTtsClient';
import { OpenClawTtsStatusClient } from './OpenClawTtsStatusClient';
import { OpenClawTtsPreferencesClient } from './OpenClawTtsPreferencesClient';
import { OpenClawDiagnosticStabilityClient } from './OpenClawDiagnosticStabilityClient';
import { OpenClawHooksStatusClient } from './OpenClawHooksStatusClient';
import { OpenClawSessionUsageLogsClient } from './OpenClawSessionUsageLogsClient';
import { OpenClawModelAuthStatusClient } from './OpenClawModelAuthStatusClient';
import { OpenClawModelAuthLogoutClient } from './OpenClawModelAuthLogoutClient';
import { OpenClawModelProbeClient } from './OpenClawModelProbeClient';
import { OpenClawSetupVerificationClient } from './OpenClawSetupVerificationClient';
import { OpenClawRuntimeConfigClient } from './OpenClawRuntimeConfigClient';
import { OpenClawProviderUsageClient } from './OpenClawProviderUsageClient';
import { OpenClawAgentIdentityClient } from './OpenClawAgentIdentityClient';
import { OpenClawAgentFilesClient } from './OpenClawAgentFilesClient';
import {
  OpenClawAgentsWorkspaceClient,
  type OpenClawAgentsWorkspaceListInput,
} from './OpenClawAgentsWorkspaceClient';
import { OpenClawAgentWaitClient } from './OpenClawAgentWaitClient';
import { OpenClawBrowserClient } from './OpenClawBrowserClient';
import { OpenClawPendingRunWaitReconciler } from './OpenClawPendingRunWaitReconciler';
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
import { SessionCompactionClient } from './SessionCompactionClient';
import { buildToolsEffectiveParams, parseToolsEffectiveResult, type ToolsEffectiveResult } from './toolsEffective';
import { buildToolsCatalogParams, parseToolsCatalogResult, type ToolsCatalogResult } from './toolsCatalog';
import { buildToolsInvokeParams, parseToolsInvokeResult, type ToolsInvokeParams, type ToolsInvokeResult } from './toolsInvoke';
import {
  buildSessionsPreviewParams,
  buildSessionsResolveParams,
  parseSessionsPreviewResult,
  parseSessionsResolveResult,
  requireSessionPreview,
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
  getCronJob,
  type OpenClawCronJobDetails,
} from './cronRuns';
import type {
  GatewayCapabilityEvidence,
  GatewayCapabilitySnapshot,
} from './GatewayCapabilityRegistry';

// Re-export types for consumers
export type {
  ChatMessage,
  MediaInfo,
  GatewayCallbacks,
  GatewayConnectionOptions,
  GatewayRequestOptions,
};
export type {
  GatewayCapabilityEvidence,
  GatewayCapabilitySnapshot,
  GatewayCapabilityState,
  GatewayCapabilityEvidenceSource,
} from './GatewayCapabilityRegistry';
export type { OpenClawTranscriptTarget } from './SessionTranscriptSubscription';
export type { OpenClawTtsClip, OpenClawTtsSpeakInput } from './OpenClawTtsClient';
export type { OpenClawTtsStatus } from './OpenClawTtsStatusClient';
export type { OpenClawTtsPreferenceMutation } from './OpenClawTtsPreferencesClient';
export type {
  OpenClawDiagnosticStabilityEvent,
  OpenClawDiagnosticStabilitySnapshot,
} from './OpenClawDiagnosticStabilityClient';
export type {
  OpenClawHookBlockedReason,
  OpenClawHookStatusEntry,
  OpenClawHooksStatusSnapshot,
} from './OpenClawHooksStatusClient';
export type {
  OpenClawSessionUsageLogEntry,
  OpenClawSessionUsageLogRole,
} from './OpenClawSessionUsageLogsClient';
export type {
  SessionTranscriptBranch as OpenClawSessionBranch,
  SessionTranscriptForkResult as OpenClawSessionForkResult,
  SessionTranscriptRewindResult as OpenClawSessionRewindResult,
} from './SessionTranscriptHistoryClient';
export type { OpenClawSessionViewerPresenceResult } from './OpenClawSessionViewerPresenceClient';
export type { OpenClawModelAuthStatusSnapshot } from './OpenClawModelAuthStatusClient';
export type { OpenClawModelAuthLogoutResult } from './OpenClawModelAuthLogoutClient';
export type { OpenClawModelProbeResult } from './OpenClawModelProbeClient';
export type { OpenClawProviderUsageSnapshot } from './OpenClawProviderUsageClient';
export type {
  OpenClawAgentAvatarStatus,
  OpenClawAgentIdentity,
  OpenClawAgentIdentityInput,
} from './OpenClawAgentIdentityClient';
export type {
  OpenClawAgentBootstrapFile,
  OpenClawAgentBootstrapFileGet,
  OpenClawAgentBootstrapFilesList,
} from './OpenClawAgentFilesClient';
export type {
  OpenClawAgentWorkspaceEntry,
  OpenClawAgentWorkspaceFile,
  OpenClawAgentWorkspaceList,
  OpenClawAgentsWorkspaceListInput,
} from './OpenClawAgentsWorkspaceClient';
export type {
  OpenClawAgentWaitResult,
  OpenClawAgentWaitStatus,
} from './OpenClawAgentWaitClient';
export type {
  OpenClawSessionObserverDigest,
  OpenClawSessionObserverHealth,
} from './sessionObserverEventBridge';
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
  workspace?: string;
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

export interface GatewayChatMessageDispatchInput {
  message: string;
  attachments?: readonly unknown[];
  sessionKey: string;
  clientMessageId: string;
  sessionId?: string;
  expectedLeafEntryId?: string | null;
  delivery?: 'send' | 'steer';
}

export interface GatewayChatDispatchTransport {
  isConnected(): boolean;
  request(method: string, params: GatewayRequestParams): Promise<unknown>;
}

export async function dispatchGatewayChatMessage(
  transport: GatewayChatDispatchTransport,
  steerClient: Pick<OpenClawSessionSteerClient, 'steer'>,
  input: GatewayChatMessageDispatchInput,
): Promise<unknown> {
  if (!transport.isConnected()) throw new GatewayDisconnectedError();
  if (input.delivery === 'steer') {
    return steerClient.steer({
      key: input.sessionKey,
      message: input.message,
      idempotencyKey: input.clientMessageId,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    });
  }
  return transport.request('chat.send', {
    sessionKey: input.sessionKey,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.expectedLeafEntryId !== undefined
      ? { expectedLeafEntryId: input.expectedLeafEntryId }
      : {}),
    message: input.message,
    idempotencyKey: input.clientMessageId,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  });
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

export interface GatewaySessionDefaults extends Record<string, unknown> {
  modelProvider?: unknown;
  model?: unknown;
  contextTokens?: number;
}

export interface GatewaySessionListResponse extends Record<string, unknown> {
  sessions?: unknown[];
  defaults?: GatewaySessionDefaults;
}

export interface GatewayHistorySessionInfo extends Record<string, unknown> {
  agentId?: unknown;
}

export interface GatewayHistoryResponse extends Record<string, unknown> {
  sessionId?: string;
  messages?: unknown[];
  sessionInfo?: GatewayHistorySessionInfo;
}

export interface GatewayMessageResponse extends Record<string, unknown> {
  ok?: boolean;
  message?: unknown;
  unavailableReason?: string;
}

// ── Create instances ──
const connection = new GatewayConnection();
const chatHandler = new ChatHandler(connection);
const transcriptSubscription = new OpenClawSessionTranscriptSubscription(connection);
export const openClawSessionObserverClient = new OpenClawSessionObserverClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});
const sessionViewerPresence = new OpenClawSessionViewerPresenceClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});
const auditClient = new OpenClawAuditClient(
  (method, params) => connection.request(method, params),
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
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawTtsPreferencesClient = new OpenClawTtsPreferencesClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawDiagnosticStabilityClient = new OpenClawDiagnosticStabilityClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawHooksStatusClient = new OpenClawHooksStatusClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawSessionUsageLogsClient = new OpenClawSessionUsageLogsClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawModelAuthStatusClient = new OpenClawModelAuthStatusClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawModelAuthLogoutClient = new OpenClawModelAuthLogoutClient({
  requestPrivileged: (method, params) => requestPrivileged(method, params),
});

export const openClawModelProbeClient = new OpenClawModelProbeClient({
  requestPrivileged: (method, params) => requestPrivileged(method, params),
});
export const openClawSetupVerificationClient = new OpenClawSetupVerificationClient({
  requestPrivileged: (method, params) => requestPrivileged(method, params),
});
export const openClawRuntimeConfigClient = new OpenClawRuntimeConfigClient({
  call: (method, params) => connection.request(method, params),
  callPrivileged: (method, params) => requestPrivileged(method, params),
});

export const openClawProviderUsageClient = new OpenClawProviderUsageClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
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
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawAgentIdentityClient = new OpenClawAgentIdentityClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawAgentFilesClient = new OpenClawAgentFilesClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawAgentsWorkspaceClient = new OpenClawAgentsWorkspaceClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});

export const openClawAgentWaitClient = new OpenClawAgentWaitClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
    { timeoutMs: RUN_STATE_LOOKUP_TIMEOUT_MS },
  ),
});

export const talkGatewayClient = new TalkGatewayClient({
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId, options) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
    options,
  ),
  subscribe: subscribeTalkGatewayEvents,
  subscribeRelay: subscribeTalkRelayEvents,
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
export const openClawBrowserClient = new OpenClawBrowserClient({
  request: (method, params, timeoutMs) => requestPrivileged(method, params, timeoutMs),
});
const approvalClient = new OpenClawApprovalClient(
  (method, params) => requestApprovals(method, params),
);
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
  request: (method, params) => connection.request(method, params),
});
const sessionGroups = new OpenClawSessionGroupsClient(
  (method, params) => connection.request(method, params),
);
const sessionLifecycle = new OpenClawSessionLifecycleClient(
  (method, params) => connection.request(method, params),
);
const taskLedger = new OpenClawTaskLedgerClient({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});
const cronRunClient = new OpenClawCronRunClient({
  request: (method, params) => connection.request(method, params),
  requestPrivileged: (method, params) => requestPrivileged(method, params),
  diagnostics: { recordCapabilityInvalidResponse: (method) => connection.recordCapabilityInvalidResponse(method) },
});
const cronStatusClient = new OpenClawCronStatusClient(
  (method, params) => connection.request(method, params),
);
const cronManagementClient = new OpenClawCronManagementClient(
  (method, params) => requestPrivileged(method, { ...params }),
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
  requestFenced: (method, params, expectedConnectionId) => connection.requestFenced(
    method,
    params,
    expectedConnectionId,
  ),
});
const sessionCompactionOperations = new SessionCompactionClient({
  request: (method, params) => connection.request(method, params),
  requestPrivileged: (method, params) => requestPrivileged(method, params),
  runMutation: (sessionKey, operation) => sessionCommandCoordinator.runMutation(sessionKey, operation),
});
const sessionTranscriptHistory = new SessionTranscriptHistoryClient({
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

const pendingRunWaitReconciler = new OpenClawPendingRunWaitReconciler({
  captureConnectionId: () => connection.getAttestedConnectionId(),
  isConnectionCurrent: (connectionId) => (
    connection.isConnected() && connection.getAttestedConnectionId() === connectionId
  ),
  checkRunForConnection: (runId, connectionId) => openClawAgentWaitClient.checkForConnection(runId, connectionId),
  captureObservation: (sessionKey) => chatHandler.captureSessionRunObservation(sessionKey),
  isObservationCurrent: (observation) => chatHandler.isSessionRunObservationCurrent(observation),
  applyTerminal: (sessionKey, runId, observation) => chatHandler.reconcilePendingRunWaitTerminal(
    sessionKey,
    runId,
    observation,
  ),
  onError: (sessionKey, error) => {
    debugWarn('gateway', `[gateway] Could not resolve uncertain run ${sessionKey} through agent.wait:`, error);
  },
});

async function reconcileOneChatSessionRun(sessionKey: string): Promise<void> {
  const settledByExactRun = await pendingRunWaitReconciler.reconcile(sessionKey);
  if (!settledByExactRun) await sessionRunReconciler.reconcile(sessionKey);
}

// Collaboration plugin streams are refresh hints, not chat/agent activity.
// Route them through the typed bridge before the generic ChatHandler path.
connection.onEvent = (msg: unknown) => routeTalkGatewayEvent(
  msg,
  (talkRemainder) => routeVoiceWakeGatewayEvent(
    talkRemainder,
    (voiceWakeRemainder) => routeOpenClawSessionObserverEvent(
      voiceWakeRemainder,
      (event) => routeGatewayEvent(event, (chatEvent) => chatHandler.handleEvent(chatEvent)),
    ),
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
      void Promise.all(unresolved.map((sessionKey) => reconcileOneChatSessionRun(sessionKey)));
    }
  },
  observeActiveChatSessionRuns(sessions: unknown[]) { chatHandler.observeActiveSessionRuns(sessions); },
  captureChatSessionRunObservation(sessionKey: string) {
    return chatHandler.captureSessionRunObservation(sessionKey);
  },
  reconcileChatSessionRun(sessionKey: string) {
    return reconcileOneChatSessionRun(sessionKey);
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
  async setVisibleSessionKeys(sessionKeys: readonly string[]) {
    return sessionViewerPresence.setVisibleSessions(sessionKeys);
  },
  forgetSessionViewerPresence() { sessionViewerPresence.resetTransport(); },

  // Connection
  connect(url: string, token: string, deviceToken = '') { connection.connect(url, token, deviceToken); },
  disconnect() {
    approvalEventSubscription.stop();
    transcriptSubscription.resetTransport();
    sessionViewerPresence.resetTransport();
    openClawSessionObserverClient.resetTransport();
    openClawSessionObserverStream.clear();
    connection.disconnect();
  },
  acquireGatewayApprovalEvents() { return acquireGatewayApprovalEvents(); },
  getStatus() { return connection.getStatus(); },
  getLastError() { return connection.getLastError(); },
  getHelloObservation() { return connection.getHelloObservation(); },
  getCapabilitySnapshot(): GatewayCapabilitySnapshot { return connection.getCapabilitySnapshot(); },
  getCapabilityEvidence(method: string): GatewayCapabilityEvidence | null {
    return connection.getCapabilityEvidence(method);
  },
  recordCapabilityInvalidResponse(method: string, code?: string) {
    connection.recordCapabilityInvalidResponse(method, code);
  },
  subscribeHello(listener: (observation: GatewayHelloObservation | null) => void) {
    return connection.subscribeHello(listener);
  },
  captureConnectionId() { return connection.getAttestedConnectionId(); },
  isConnectionCurrent(connectionId: string) {
    return connection.isConnected() && connection.getAttestedConnectionId() === connectionId;
  },

  // 消息发送
  async sendMessage(
    message: string,
    attachments: GatewayAttachment[] | undefined,
    sessionKey: string,
    identity: {
      clientMessageId?: string;
      sessionId?: string;
      expectedLeafEntryId?: string | null;
      delivery?: 'send' | 'steer';
      supersededRunId?: string;
    } = {},
  ) {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    const gwAttachments = attachments?.map((att) => {
      let rawBase64 = att.content || '';
      if (rawBase64.startsWith('data:')) {
        rawBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      }
      return {
        type: att.mimeType?.startsWith('image/') ? 'image' : 'file',
        mimeType: att.mimeType,
        content: rawBase64,
        ...(att.fileName ? { fileName: att.fileName } : {}),
      };
    });

    const clientMessageId = identity.clientMessageId ?? `junqi-${crypto.randomUUID()}`;
    const isSteer = identity.delivery === 'steer';
    chatHandler.beginPendingSend(targetSessionKey, clientMessageId);
    let requestDispatched = false;
    try {
      const dispatch = async () => {
        // 渲染层拥有唯一可见、可取消的重试队列，传输层不得另建 UI 无法检查的队列。
        requestDispatched = true;
        return dispatchGatewayChatMessage(connection, sessionSteer, {
          message,
          attachments: gwAttachments,
          sessionKey: targetSessionKey,
          clientMessageId,
          sessionId: identity.sessionId,
          expectedLeafEntryId: identity.expectedLeafEntryId,
          delivery: isSteer ? 'steer' : 'send',
        });
      };
      // sessions.steer 自身即为 OpenClaw 的中断并发送控制操作，不能等待长时间 chat.send 请求。
      const dispatched = isSteer
        ? await dispatch()
        : await sessionCommandCoordinator.runMutation(targetSessionKey, dispatch);
      const result = isSteer
        ? (dispatched as Awaited<ReturnType<OpenClawSessionSteerClient['steer']>>).response
        : dispatched;
      const acknowledgement = chatHandler.reconcileSendAcknowledgement(
        targetSessionKey,
        clientMessageId,
        result,
      );
      if (
        isSteer
        && identity.supersededRunId
        && (dispatched as Awaited<ReturnType<OpenClawSessionSteerClient['steer']>>).interruptedActiveRun === true
      ) {
        await taskExecutionCoordinator.settleRun({
          sessionKey: targetSessionKey,
          sessionId: identity.sessionId,
          runId: identity.supersededRunId,
          terminalReason: 'aborted',
        }).catch((error) => taskExecutionCoordinator.reportPersistenceFailure('settle steered Run checkpoint', error));
      }
      if (acknowledgement !== 'unknown') return result;
      if (chatHandler.markPendingSendUncertain(targetSessionKey, clientMessageId)) {
        return { deliveryUncertain: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryUncertain;
      }
      return { deliveryObserved: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryObserved;
    } catch (error) {
      // sessions.steer 的原生准入可能已经尝试中断活动 Run 后才失败。
      // 单独的 RPC 错误无法区分该情况与请求被拒绝，故交由带围栏的历史解析器确认。
      if (isSteer && requestDispatched) {
        void sessionRunReconciler.reconcile(targetSessionKey);
      }
      if (chatHandler.isSendObserved(targetSessionKey, clientMessageId)) {
        return { deliveryObserved: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryObserved;
      }
      if (requestDispatched && !(error instanceof GatewayRpcError)) {
        if (chatHandler.markPendingSendUncertain(targetSessionKey, clientMessageId)) {
          return { deliveryUncertain: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryUncertain;
        }
        return { deliveryObserved: true, runId: clientMessageId } satisfies GatewayChatSendDeliveryObserved;
      }
      chatHandler.failPendingSend(targetSessionKey, clientMessageId);
      throw error;
    }
  },

  // Sessions & Agents
  async getSessions(): Promise<GatewaySessionListResponse> {
    return listAllOpenClawSessions(
      (method, params) => connection.request(method, params),
    );
  },
  async createSession(input: {
    agentId: string;
    label?: string;
    parentSessionKey?: string;
    fork?: boolean;
  }) {
    return sessionLifecycle.create(input);
  },
  async describeSession(sessionKey: string) {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return parseOpenClawDescribedSession(await connection.request('sessions.describe', {
      key: targetSessionKey,
      includeDerivedTitles: true,
      includeLastMessage: true,
    }));
  },
  async getEffectiveTools(sessionKey: string, agentId?: string): Promise<ToolsEffectiveResult> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return parseToolsEffectiveResult(
      await connection.request('tools.effective', buildToolsEffectiveParams(targetSessionKey, agentId)),
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
    sessionKey: string,
    options: Pick<SessionsPreviewParams, 'limit' | 'maxChars'> = {},
  ): Promise<SessionPreview> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    const result = parseSessionsPreviewResult(
      await connection.request('sessions.preview', buildSessionsPreviewParams([targetSessionKey], options)),
    );
    return requireSessionPreview(result, targetSessionKey);
  },
  async resolveSessionKey(sessionKey: string, agentId?: string): Promise<SessionsResolveResult> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return parseSessionsResolveResult(
      await connection.request(
        'sessions.resolve',
        buildSessionsResolveParams(targetSessionKey, { agentId, allowMissing: true }),
      ),
    );
  },
  async getSessionCompactionCheckpoint(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ) {
    return sessionCompactionOperations.get(sessionKey, checkpointId, agentId);
  },
  async branchSessionCompactionCheckpoint(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ) {
    return sessionCompactionOperations.branch(sessionKey, checkpointId, agentId);
  },
  async restoreSessionCompactionCheckpoint(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ) {
    return sessionCompactionOperations.restore(sessionKey, checkpointId, agentId);
  },
  async listSessionBranches(sessionKey: string, agentId?: string) {
    return sessionTranscriptHistory.listBranches(sessionKey, agentId);
  },
  async switchSessionBranch(sessionKey: string, leafEntryId: string, agentId?: string) {
    await sessionTranscriptHistory.switchBranch(sessionKey, leafEntryId, agentId);
    gateway.invalidateChatSession(sessionKey);
  },
  async rewindSessionAtMessage(sessionKey: string, entryId: string, agentId?: string) {
    const result = await sessionTranscriptHistory.rewindToMessage(sessionKey, entryId, agentId);
    gateway.invalidateChatSession(sessionKey);
    return result;
  },
  async forkSessionAtMessage(sessionKey: string, entryId: string, agentId?: string) {
    return sessionTranscriptHistory.forkAtMessage(sessionKey, entryId, agentId);
  },
  async listAgentWorkspace(input: OpenClawAgentsWorkspaceListInput) {
    return openClawAgentsWorkspaceClient.list(input);
  },
  async getAgentWorkspaceFile(agentId: string, path: string) {
    return openClawAgentsWorkspaceClient.get(agentId, path);
  },
  async listAgentBootstrapFiles(agentId: string) {
    return openClawAgentFilesClient.list(agentId);
  },
  async getAgentBootstrapFile(agentId: string, name: string) {
    return openClawAgentFilesClient.get(agentId, name);
  },
  async listSessionArtifacts(sessionKey: string, agentId?: string): Promise<ArtifactSummary[]> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return parseArtifactsListResult(
      await connection.request(
        'artifacts.list',
        buildArtifactsListParams({ sessionKey: targetSessionKey, agentId }),
      ),
      targetSessionKey,
    ).artifacts;
  },
  async getSessionArtifact(
    artifactId: string,
    sessionKey: string,
    agentId?: string,
  ): Promise<ArtifactSummary> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return parseArtifactGetResult(
      await connection.request(
        'artifacts.get',
        buildArtifactsGetParams(artifactId, { sessionKey: targetSessionKey, agentId }),
      ),
      artifactId,
      targetSessionKey,
    ).artifact;
  },
  async downloadSessionArtifact(
    artifactId: string,
    sessionKey: string,
    agentId?: string,
  ): Promise<ArtifactDownloadResult> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return parseArtifactDownloadResult(
      await connection.request(
        'artifacts.download',
        buildArtifactsDownloadParams(artifactId, { sessionKey: targetSessionKey, agentId }),
      ),
      artifactId,
      targetSessionKey,
    );
  },
  async getCronJob(jobId: string): Promise<OpenClawCronJobDetails> {
    return getCronJob(
      (method, params) => connection.request(method, params),
      jobId,
      (method) => connection.recordCapabilityInvalidResponse(method),
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
  async getAgents() { return connection.request('agents.list', {}); },
  async listCommands(input: OpenClawCommandsListInput = {}) { return openClawCommandsClient.list(input); },
  async listTasks(input: OpenClawTaskListInput = {}) { return taskLedger.list(input); },
  async getTask(taskId: string) { return taskLedger.get(taskId); },
  async cancelTask(taskId: string, reason?: string) { return taskLedger.cancel(taskId, reason); },
  async retryTaskDelivery(taskIds: readonly string[]) { return taskLedger.retry(taskIds); },
  async dismissTaskDelivery(taskIds: readonly string[]) { return taskLedger.dismiss(taskIds); },
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
  ): Promise<GatewayHistoryResponse> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return connection.request<GatewayHistoryResponse>('chat.history', {
      sessionKey: targetSessionKey,
      limit,
      ...(options.offset !== undefined ? { offset: options.offset } : {}),
      ...(options.maxChars !== undefined ? { maxChars: options.maxChars } : {}),
    }, { timeoutMs });
  },
  async getMessage(
    sessionKey: string,
    messageId: string,
    agentId?: string,
  ): Promise<GatewayMessageResponse> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return connection.request<GatewayMessageResponse>('chat.message.get', {
      sessionKey: targetSessionKey,
      messageId,
      ...(agentId ? { agentId } : {}),
    });
  },
  async abortChat(sessionKey: string, sessionId?: string) {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    // 中止属于控制面请求。若等待长时间运行的 chat.send 请求，会无法停止
    // 发送确认已丢失或延迟的响应。
    return abortAfterTaskCheckpoint(
      async () => {
        try {
          await taskExecutionCoordinator.requestStop(targetSessionKey, sessionId);
        } catch (error) {
          taskExecutionCoordinator.reportPersistenceFailure('persist Stop checkpoint', error);
          throw error;
        }
      },
      async () => {
        const runId = chatHandler.abortRunId(targetSessionKey);
        const result = await sessionAbort.abort({
          key: targetSessionKey,
          ...(runId ? { runId } : {}),
        });
        return chatHandler.reconcileSessionAbortAcknowledgement(targetSessionKey, result);
      },
    );
  },
  async compactSession(sessionKey: string) {
    const key = requireOpenClawSessionTarget(sessionKey);
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
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return sessionCommandCoordinator.runMutation(
      targetSessionKey,
      async () => {
        const result = await requestPrivileged<Record<string, unknown>>('sessions.delete', {
          key: targetSessionKey,
          deleteTranscript,
          ...(expectedSessionId ? { expectedSessionId } : {}),
        });
        assertVerifiedSessionMutationResult(result, 'delete', targetSessionKey);
        await cleanupSessionArtifacts(targetSessionKey);
        return result;
      },
    );
  },
  async resetSession(sessionKey: string) {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return sessionCommandCoordinator.runMutation(
      targetSessionKey,
      async () => {
        const result = await requestPrivileged<Record<string, unknown>>('sessions.reset', { key: targetSessionKey });
        assertVerifiedSessionMutationResult(result, 'reset', targetSessionKey);
        await cleanupSessionArtifacts(targetSessionKey);
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
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return sessionCommandCoordinator.runMutation(
      targetSessionKey,
      async () => {
        if (connection.getAttestedConnectionId() !== expectedConnectionId) {
          throw new Error('The verified Gateway connection changed before session deletion');
        }
        const result = await requestPrivileged<Record<string, unknown>>('sessions.delete', {
          key: targetSessionKey,
          deleteTranscript,
          expectedSessionId,
        });
        if (connection.getAttestedConnectionId() !== expectedConnectionId) {
          throw new Error('The verified Gateway connection changed while session deletion was completing');
        }
        assertVerifiedSessionMutationResult(result, 'delete', targetSessionKey);
        await cleanupSessionArtifacts(targetSessionKey);
        return result;
      },
    );
  },
  async resetSessionFenced(sessionKey: string, expectedConnectionId: string) {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return sessionCommandCoordinator.runMutation(
      targetSessionKey,
      async () => {
        const result = await connection.requestFenced(
          'sessions.reset',
          { key: targetSessionKey },
          expectedConnectionId,
        );
        assertVerifiedSessionMutationResult(result, 'reset', targetSessionKey);
        await cleanupSessionArtifacts(targetSessionKey);
        return result;
      },
    );
  },

  // 会话设置
  async setSessionModel(model: string | null, sessionKey: string) {
    return sessionSettings.setModel(sessionKey, model);
  },
  async setSessionThinking(level: string | null, sessionKey: string) {
    return sessionSettings.setThinking(sessionKey, level);
  },
  async setSessionFastMode(mode: boolean | 'auto' | null, sessionKey: string) {
    return sessionSettings.setFastMode(sessionKey, mode);
  },
  async setSessionVerbose(level: 'on' | 'full' | 'off' | null, sessionKey: string) {
    return sessionSettings.setVerbose(sessionKey, level);
  },
  async setSessionTrace(level: 'on' | 'off' | null, sessionKey: string) {
    return sessionSettings.setTrace(sessionKey, level);
  },
  async setSessionResponseUsage(level: 'off' | 'tokens' | 'full' | null, sessionKey: string) {
    return sessionSettings.setResponseUsage(sessionKey, level);
  },
  async setSessionReasoning(level: 'on' | 'off' | 'stream' | null, sessionKey: string) {
    return sessionSettings.setReasoning(sessionKey, level);
  },
  async setSessionLabel(label: string | null, sessionKey: string) {
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
    return sessionGroups.list();
  },
  async ensureSessionGroup(name: string) {
    return sessionGroups.ensure(name);
  },
  async updateAgentParams(agentId: string, params: Record<string, unknown>) {
    return requestPrivileged('agents.update', { agentId, params });
  },

  // Browser control uses the OpenClaw browser.request admin-scoped protocol.
  async getBrowserStatus(profile?: string) { return openClawBrowserClient.status(profile); },
  async getBrowserProfiles() { return openClawBrowserClient.profiles(); },
  async getBrowserTabs(profile?: string) { return openClawBrowserClient.tabs(profile); },
  async startBrowser(profile?: string) { return openClawBrowserClient.start(profile); },
  async stopBrowser(profile?: string) { return openClawBrowserClient.stop(profile); },
  async openBrowserTab(url: string, profile?: string, label?: string) {
    return openClawBrowserClient.openTab(url, profile, label);
  },
  async focusBrowserTab(targetId: string, profile?: string) {
    return openClawBrowserClient.focusTab(targetId, profile);
  },
  async closeBrowserTab(targetId: string, profile?: string) {
    return openClawBrowserClient.closeTab(targetId, profile);
  },
  async captureBrowserSnapshot(profile?: string) { return openClawBrowserClient.snapshot(profile); },

  // Models
  async getAvailableModels(view: 'default' | 'configured' | 'all' = 'configured') {
    return connection.request('models.list', { view });
  },
  async call<T = unknown>(
    method: string,
    params: GatewayRequestParams = {},
    options?: GatewayRequestOptions,
  ): Promise<T> {
    return connection.request<T>(method, params, options);
  },
  async callFenced<T = unknown>(
    method: string,
    params: GatewayRequestParams,
    expectedConnectionId: string,
  ): Promise<T> {
    return connection.requestFenced<T>(method, params, expectedConnectionId);
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
