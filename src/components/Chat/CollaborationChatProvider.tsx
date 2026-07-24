import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { GitFork, History, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModalFocusScope } from '@/hooks/useModalFocusScope';
import {
  CollaborationCard,
  CollaborationActionDialog,
  CollaborationDetails,
  CollaborationHistoryDrawer,
  CollaborationRunStatusIcon,
  collaborationRunStatusLabel,
  type CollaborationActionContext,
  type CollaborationSetupReason,
} from '@/components/Collaboration';
import {
  collaborationClient,
  CollaborationClientError,
  createCollaborationWriteRequest,
} from '@/services/collaboration/client';
import { COLLABORATION_PLUGIN_BUNDLE } from '@/services/collaboration/bundledPlugin';
import { collaborationCapabilityIssue } from '@/services/collaboration/capabilityContract';
import {
  completeCollaborationDeletion,
  executeRunAction,
  completeCollaborationExport,
  CollaborationRunActionError,
  isCollaborationRunAction,
  previewRunAction,
  runActionRequiresDialog,
  type CollaborationRunAction,
  type CollaborationRunActionPreview,
  type CollaborationRunActionSubmission,
} from '@/services/collaboration/runActions';
import {
  collaborationSessionIdentityKey,
  isTerminalCollaborationRun,
  type CollaborationRunSummary,
  type CollaborationTombstone,
  type CollaborationWorkflowTemplate,
  type CollaborationWriteRequest,
  type CollaborationWriteResponse,
} from '@/services/collaboration/types';
import {
  bindCollaborationRuntimeIdentity,
  getCurrentRuntimeIdentity,
  subscribeRuntimeIdentity,
} from '@/services/gateway/runtimeIdentity';
import { bindGatewayCredentialToInstance } from '@/services/gateway/credentialProvider';
import { useChatStore, type ChatMessage } from '@/stores/chatStore';
import {
  useCollaborationStore,
  type CollaborationSessionSyncState,
} from '@/stores/collaborationStore';
import { COLLABORATION_SETUP_REQUESTED_EVENT } from '@/stores/collaborationSetupStore';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';

type MessageCollaborationAction = {
  state: 'confirming' | 'ready' | 'active';
  onClick?: () => void;
};

interface CollaborationChatContextValue {
  available: boolean;
  runs: CollaborationRunSummary[];
  sessionSync: CollaborationSessionSyncState | null;
  getMessageAction: (message: ChatMessage | undefined) => MessageCollaborationAction | undefined;
  openRun: (runId: string) => void;
  openHistory: () => void;
  pendingAction: string | null;
  handleRunAction: (context: CollaborationActionContext) => void;
  refreshRun: (runId: string) => void;
  retrySessionSync: () => void;
}

const CollaborationChatContext = createContext<CollaborationChatContextValue | null>(null);

type CollaborationSetupEventTarget = Pick<EventTarget, 'dispatchEvent'>;

function collaborationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type CollaborationActionPreviewRecovery = 'KEEP' | 'INVALIDATE_AND_REFRESH';

/**
 * Pure recovery policy for server-bound confirmation previews. Revision races
 * invalidate every destructive preview; a newly failed Flow reconciliation
 * additionally invalidates deletion previews even when the Run revision did
 * not change.
 */
export function collaborationActionPreviewRecovery(
  action: CollaborationRunActionSubmission['action'],
  error: unknown,
): CollaborationActionPreviewRecovery {
  if (error instanceof CollaborationRunActionError
    && error.code === 'INVALID_ACTION_RESPONSE'
    && (action === 'PARTIAL' || action === 'DELETE')) {
    return 'INVALIDATE_AND_REFRESH';
  }
  if (!(error instanceof CollaborationClientError)) return 'KEEP';
  if (error.code === 'REVISION_CONFLICT' && (action === 'PARTIAL' || action === 'DELETE')) {
    return 'INVALIDATE_AND_REFRESH';
  }
  if (error.code === 'FLOW_RECONCILIATION_REQUIRED' && action === 'DELETE') {
    return 'INVALIDATE_AND_REFRESH';
  }
  return 'KEEP';
}

export async function runCollaborationUiOperation<T>(
  operation: () => Promise<T>,
  setError: (error: string | null) => void,
): Promise<T> {
  setError(null);
  try {
    const result = await operation();
    setError(null);
    return result;
  } catch (error) {
    setError(collaborationErrorMessage(error));
    throw error;
  }
}

export function requestCollaborationRuntimeSetup(
  reason: CollaborationSetupReason,
  target: CollaborationSetupEventTarget = window,
): void {
  target.dispatchEvent(new CustomEvent(COLLABORATION_SETUP_REQUESTED_EVENT, {
    detail: { reason },
  }));
}

export function isCollaborationProjectionCurrent(
  connected: boolean,
  identity: RuntimeIdentity | null,
  projectionConnectionId: string | null,
  collaborationInstanceId: string | null,
): boolean {
  return Boolean(
    connected
    && identity?.verified
    && identity.connectionId === projectionConnectionId
    && identity.runtimeId
    && identity.runtimeId === collaborationInstanceId,
  );
}

export function collaborationConnectionToBootstrap(
  connected: boolean,
  identity: RuntimeIdentity | null,
  projectionConnectionId: string | null,
  collaborationInstanceId: string | null,
): string | null {
  if (!connected || !identity?.verified) return null;
  if (identity.connectionId !== projectionConnectionId) return identity.connectionId;
  if (
    collaborationInstanceId
    && identity.runtimeId !== collaborationInstanceId
  ) {
    return identity.connectionId;
  }
  return null;
}

function sessionAgentId(sessionKey: string, explicit?: string): string | null {
  if (explicit?.trim()) return explicit.trim();
  const match = /^agent:([^:]+):/.exec(sessionKey);
  return match?.[1] ?? null;
}

export function existingCollaborationRunId(error: unknown): string | null {
  return error instanceof CollaborationClientError
    && error.code === 'ACTIVE_RUN_EXISTS'
    && typeof error.details?.runId === 'string'
    && error.details.runId.trim()
    ? error.details.runId.trim()
    : null;
}

export async function loadCollaborationRunTrace(
  runId: string,
  refreshRun: (runId: string) => Promise<unknown>,
  syncRunEvents: (runId: string) => Promise<void>,
): Promise<void> {
  await refreshRun(runId);
  await syncRunEvents(runId);
}

type CollaborationDeletionRetryExecutor = (
  method: 'junqi.collab.run.delete.retry',
  request: CollaborationWriteRequest<{ jobId: string; expectedRunId: string }>,
) => Promise<CollaborationWriteResponse>;

/** Retry managed-file cleanup and refresh only the deletion audit record. */
export async function retryCollaborationDeletionCleanup(
  deletionJobId: string,
  runId: string,
  expectedCollaborationInstanceId: string,
  executeRetry: CollaborationDeletionRetryExecutor,
  syncTombstones: () => Promise<unknown>,
  waitForDeletion: typeof completeCollaborationDeletion = completeCollaborationDeletion,
): Promise<void> {
  const jobId = deletionJobId.trim();
  if (!jobId) throw new Error('Deletion cleanup job id is required.');
  const request = await createCollaborationWriteRequest(
    { jobId, expectedRunId: runId },
    { expectedCollaborationInstanceId },
  );
  let operationFailed = false;
  let operationError: unknown;
  try {
    const response = await executeRetry('junqi.collab.run.delete.retry', request);
    const returnedJobId = typeof response.deletionJobId === 'string'
      ? response.deletionJobId.trim()
      : '';
    if (returnedJobId !== jobId) {
      throw new CollaborationClientError(
        'INVALID_RESPONSE',
        `junqi.collab.run.delete.retry returned a different deletion job: expected ${jobId}`,
        'junqi.collab.run.delete.retry',
        { expectedJobId: jobId, returnedJobId: returnedJobId || null },
      );
    }
    const result = await waitForDeletion({
      ...response,
      deletionJobId: returnedJobId,
    }, runId);
    if (result.status !== 'COMPLETED') {
      throw new Error(result.lastError || `Deletion cleanup ended with ${result.status}.`);
    }
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  try {
    await syncTombstones();
  } catch (syncError) {
    if (!operationFailed) throw syncError;
  }
  if (operationFailed) throw operationError;
}

function isRuntimeEligible(
  identity: ReturnType<typeof getCurrentRuntimeIdentity>,
): identity is NonNullable<ReturnType<typeof getCurrentRuntimeIdentity>> & { runtimeId: string } {
  return Boolean(identity?.verified && identity.runtimeId && identity.deploymentKind !== 'managed_child');
}

/** Prefer live work so the session dock remains useful after a chat scroll. */
export function selectSessionCollaborationDockRun(
  runs: readonly CollaborationRunSummary[],
): CollaborationRunSummary | null {
  if (runs.length === 0) return null;
  return [...runs]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .find((run) => !isTerminalCollaborationRun(run.status))
    ?? [...runs].sort((left, right) => right.updatedAt - left.updatedAt)[0]
    ?? null;
}

export interface CollaborationSessionDockViewProps {
  runs: readonly CollaborationRunSummary[];
  snapshotsByRunId: Readonly<Record<string, { workItems?: Array<{ status: string }> }>>;
  text: (key: string, fallback: string, values?: Record<string, string | number>) => string;
  onOpenRun: (runId: string) => void;
  onOpenHistory: () => void;
}

/**
 * Persistent session-level context for a collaboration. Individual Run cards
 * remain in the transcript at their originating message; this dock gives the
 * operator one stable way back to live work and durable history.
 */
export function CollaborationSessionDockView({
  runs,
  snapshotsByRunId,
  text,
  onOpenRun,
  onOpenHistory,
}: CollaborationSessionDockViewProps) {
  const focusedRun = selectSessionCollaborationDockRun(runs);
  if (!focusedRun) return null;

  const activeCount = runs.filter((run) => !isTerminalCollaborationRun(run.status)).length;
  const workItems = snapshotsByRunId[focusedRun.runId]?.workItems ?? [];
  const completed = workItems.filter((item) => item.status === 'SUCCEEDED' || item.status === 'WAIVED').length;
  const isActive = !isTerminalCollaborationRun(focusedRun.status);

  return (
    <section
      data-collaboration-session-dock
      aria-label={text('collaboration.chat.sessionDock', 'Session collaboration')}
      className="shrink-0 border-b border-aegis-primary/15 bg-aegis-primary/[0.035] px-3 py-2 sm:px-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenRun(focusedRun.runId)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-start transition-colors hover:bg-aegis-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-aegis-primary/[0.09] text-aegis-primary">
            <GitFork size={14} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-medium text-aegis-text-muted">
              {isActive
                ? text('collaboration.chat.activeSessionRun', 'Active collaboration')
                : text('collaboration.chat.latestSessionRun', 'Latest collaboration')}
            </span>
            <span className="block truncate text-[11.5px] font-semibold text-aegis-text-secondary">
              {focusedRun.goal || text('collaboration.card.untitled', 'Untitled collaboration')}
            </span>
          </span>
        </button>

        <span className="hidden shrink-0 items-center gap-1.5 rounded-md bg-[rgb(var(--aegis-overlay)/0.035)] px-2 py-1 text-[10px] text-aegis-text-muted sm:inline-flex">
          <CollaborationRunStatusIcon status={focusedRun.status} size={12} />
          <span>{collaborationRunStatusLabel(focusedRun.status, text)}</span>
        </span>

        {workItems.length > 0 && (
          <span className="hidden shrink-0 font-mono text-[10.5px] tabular-nums text-aegis-text-dim sm:inline">
            {text('collaboration.chat.workItemProgress', '{{completed}}/{{total}}', {
              completed,
              total: workItems.length,
            })}
          </span>
        )}

        {activeCount > 1 && (
          <span className="shrink-0 rounded-md bg-aegis-primary/[0.09] px-1.5 py-1 font-mono text-[10px] tabular-nums text-aegis-primary">
            {text('collaboration.chat.activeRunCount', '{{count}} active', { count: activeCount })}
          </span>
        )}

        <button
          type="button"
          onClick={onOpenHistory}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[10.5px] font-medium text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50"
          title={text('collaboration.drawer.title', 'Collaboration runs')}
        >
          <History size={13} aria-hidden />
          <span className="hidden sm:inline">{text('collaboration.chat.history', 'Runs')}</span>
        </button>
      </div>
    </section>
  );
}

export function CollaborationChatProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const connected = useChatStore((state) => state.connected);
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const activeSession = useChatStore((state) => state.sessions.find((session) => session.key === state.activeSessionKey));
  const messages = useChatStore((state) => state.messages);

  const capabilities = useCollaborationStore((state) => state.capabilities);
  const instanceId = useCollaborationStore((state) => state.collaborationInstanceId);
  const runsById = useCollaborationStore((state) => state.runsById);
  const runIdsBySession = useCollaborationStore((state) => state.runIdsBySession);
  const snapshotsByRunId = useCollaborationStore((state) => state.snapshotsByRunId);
  const eventsByRunId = useCollaborationStore((state) => state.eventsByRunId);
  const cursorsByRunId = useCollaborationStore((state) => state.cursorsByRunId);
  const tombstones = useCollaborationStore((state) => state.tombstones);
  const sessionSyncByIdentity = useCollaborationStore((state) => state.sessionSync);
  const globalError = useCollaborationStore((state) => state.globalError);
  const bootstrap = useCollaborationStore((state) => state.bootstrap);
  const syncSession = useCollaborationStore((state) => state.syncSession);
  const syncGlobalRuns = useCollaborationStore((state) => state.syncGlobalRuns);
  const syncTombstones = useCollaborationStore((state) => state.syncTombstones);
  const refreshRun = useCollaborationStore((state) => state.refreshRun);
  const syncRunEvents = useCollaborationStore((state) => state.syncRunEvents);
  const startSessionPolling = useCollaborationStore((state) => state.startSessionPolling);
  const startChangedHintSubscription = useCollaborationStore((state) => state.startChangedHintSubscription);
  const executeCommand = useCollaborationStore((state) => state.executeCommand);
  const resetCollaboration = useCollaborationStore((state) => state.reset);

  const [runtimeIdentity, setRuntimeIdentity] = useState(getCurrentRuntimeIdentity);
  const [projectionConnectionId, setProjectionConnectionId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [workflowTemplates, setWorkflowTemplates] = useState<CollaborationWorkflowTemplate[]>([]);
  const [instantiatingTemplateId, setInstantiatingTemplateId] = useState<string | null>(null);
  const [retryingDeletionJobId, setRetryingDeletionJobId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [dialogAction, setDialogAction] = useState<CollaborationRunAction | null>(null);
  const [dialogRunId, setDialogRunId] = useState<string | null>(null);
  const [actionPreview, setActionPreview] = useState<CollaborationRunActionPreview | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionPreviewing, setActionPreviewing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const capabilityCheckGeneration = useRef(0);
  const capabilityCheckInFlight = useRef(false);
  const disconnectedProjectionInvalidated = useRef(false);
  const closeSelectedRun = useCallback(() => setSelectedRunId(null), []);

  useEffect(() => subscribeRuntimeIdentity(setRuntimeIdentity), []);

  const sessionRef = useMemo(() => activeSession?.sessionId
    ? { sessionKey: activeSessionKey, sessionId: activeSession.sessionId }
    : null, [activeSession?.sessionId, activeSessionKey]);
  const templateOriginMessage = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'user' && Boolean(message.nativeMessageId)) ?? null,
    [messages],
  );

  const projectionCurrent = isCollaborationProjectionCurrent(
    connected,
    runtimeIdentity,
    projectionConnectionId,
    instanceId,
  );
  const detailsDialogRef = useModalFocusScope<HTMLElement>({
    active: Boolean(projectionCurrent && selectedRunId),
    onEscape: closeSelectedRun,
    initialFocus: 'container',
    layer: 10,
  });

  const runs = useMemo(() => {
    if (!projectionCurrent || !sessionRef || !instanceId) return [];
    const key = collaborationSessionIdentityKey(instanceId, sessionRef);
    return (runIdsBySession[key] ?? [])
      .map((runId) => runsById[runId])
      .filter((run): run is CollaborationRunSummary => Boolean(run));
  }, [instanceId, projectionCurrent, runIdsBySession, runsById, sessionRef]);

  const sessionSync = useMemo(() => {
    if (!projectionCurrent || !sessionRef || !instanceId) return null;
    return sessionSyncByIdentity[collaborationSessionIdentityKey(instanceId, sessionRef)] ?? null;
  }, [instanceId, projectionCurrent, sessionRef, sessionSyncByIdentity]);

  const capabilitiesCompatible = useMemo(
    () => Boolean(
      projectionCurrent
      && capabilities
      && !collaborationCapabilityIssue(capabilities, COLLABORATION_PLUGIN_BUNDLE)
    ),
    [capabilities, projectionCurrent],
  );

  const allRuns = useMemo(
    () => projectionCurrent
      ? Object.values(runsById).sort((left, right) => right.updatedAt - left.updatedAt)
      : [],
    [projectionCurrent, runsById],
  );

  const checkCapabilities = useCallback(async (
    force = false,
    expectedConnectionId = runtimeIdentity?.connectionId,
  ) => {
    if (!connected || !expectedConnectionId) return null;
    const generation = ++capabilityCheckGeneration.current;
    capabilityCheckInFlight.current = true;
    setLocalError(null);
    try {
      const currentCapabilities = await bootstrap(force);
      const liveIdentity = getCurrentRuntimeIdentity();
      if (
        !liveIdentity?.verified
        || liveIdentity.connectionId !== expectedConnectionId
        || generation !== capabilityCheckGeneration.current
      ) {
        return null;
      }
      const boundIdentity = bindCollaborationRuntimeIdentity(
        currentCapabilities.collaborationInstanceId,
        expectedConnectionId,
      );
      if (
        !boundIdentity?.verified
        || boundIdentity.connectionId !== expectedConnectionId
        || boundIdentity.runtimeId !== currentCapabilities.collaborationInstanceId
      ) {
        return null;
      }
      if (boundIdentity?.endpoint) {
        try {
          const adapterBinding = window.aegis?.pairing?.bindTokenToInstance;
          if (adapterBinding) {
            const result = await adapterBinding(
              boundIdentity.endpoint,
              currentCapabilities.collaborationInstanceId,
              expectedConnectionId,
            );
            if (!result.success) {
              throw new Error('Gateway identity changed before credential binding completed');
            }
          } else {
            // Compatibility for non-Tauri/test adapters. The desktop adapter
            // supplies the selected-runtime source slot and identity fence.
            await bindGatewayCredentialToInstance(
              boundIdentity.endpoint,
              currentCapabilities.collaborationInstanceId,
              {
                isCurrent: () => {
                  const identity = getCurrentRuntimeIdentity();
                  return Boolean(
                    identity?.verified
                    && identity.connectionId === expectedConnectionId
                    && identity.runtimeId === currentCapabilities.collaborationInstanceId,
                  );
                },
              },
            );
          }
        } catch (error) {
          if (generation === capabilityCheckGeneration.current) {
            setLocalError(collaborationErrorMessage(error));
          }
        }
      }
      if (generation === capabilityCheckGeneration.current) {
        setProjectionConnectionId(expectedConnectionId);
      }
      return currentCapabilities;
    } catch (error) {
      const liveIdentity = getCurrentRuntimeIdentity();
      if (
        generation === capabilityCheckGeneration.current
        && liveIdentity?.connectionId === expectedConnectionId
      ) {
        setLocalError(collaborationErrorMessage(error));
      }
      return null;
    } finally {
      if (generation === capabilityCheckGeneration.current) {
        capabilityCheckInFlight.current = false;
      }
    }
  }, [bootstrap, connected, runtimeIdentity?.connectionId]);

  const clearConnectionScopedUi = useCallback(() => {
    setLocalError(null);
    setHistoryOpen(false);
    setHistoryLoading(false);
    setWorkflowTemplates([]);
    setInstantiatingTemplateId(null);
    setRetryingDeletionJobId(null);
    setSelectedRunId(null);
    setPendingAction(null);
    setDialogAction(null);
    setDialogRunId(null);
    setActionPreview(null);
    setActionSubmitting(false);
    setActionPreviewing(false);
    setActionError(null);
  }, []);

  useEffect(() => {
    if (!connected || !runtimeIdentity?.verified) {
      capabilityCheckGeneration.current += 1;
      capabilityCheckInFlight.current = false;
      setProjectionConnectionId(null);
      clearConnectionScopedUi();
      if (!disconnectedProjectionInvalidated.current) {
        disconnectedProjectionInvalidated.current = true;
        resetCollaboration();
      }
      return;
    }
    disconnectedProjectionInvalidated.current = false;
    if (capabilityCheckInFlight.current) return;
    const connectionId = collaborationConnectionToBootstrap(
      connected,
      runtimeIdentity,
      projectionConnectionId,
      instanceId,
    );
    if (!connectionId) return;

    setProjectionConnectionId(null);
    clearConnectionScopedUi();
    resetCollaboration();
    void checkCapabilities(true, connectionId);
  }, [
    checkCapabilities,
    clearConnectionScopedUi,
    connected,
    instanceId,
    projectionConnectionId,
    resetCollaboration,
    runtimeIdentity?.connectionId,
    runtimeIdentity?.runtimeId,
    runtimeIdentity?.verified,
  ]);

  useEffect(() => {
    if (!connected || !projectionCurrent || !capabilitiesCompatible) return;
    return startChangedHintSubscription();
  }, [capabilitiesCompatible, connected, projectionCurrent, startChangedHintSubscription]);

  useEffect(() => {
    if (!connected || !projectionCurrent || !sessionRef || !capabilitiesCompatible) return;
    return startSessionPolling(sessionRef);
  }, [capabilitiesCompatible, connected, projectionCurrent, sessionRef, startSessionPolling]);

  useEffect(() => {
    for (const run of runs) {
      if (!snapshotsByRunId[run.runId] || snapshotsByRunId[run.runId]!.revision < run.revision) {
        void refreshRun(run.runId).catch(() => undefined);
      }
    }
  }, [refreshRun, runs, snapshotsByRunId]);

  const refreshRunTrace = useCallback(async (runId: string) => {
    await runCollaborationUiOperation(
      () => loadCollaborationRunTrace(runId, refreshRun, syncRunEvents),
      setLocalError,
    );
  }, [refreshRun, syncRunEvents]);

  const refreshWorkflowTemplates = useCallback(async () => {
    const expectedInstanceId = useCollaborationStore.getState().collaborationInstanceId;
    if (!expectedInstanceId) return;
    const response = await collaborationClient.listWorkflowTemplates();
    if (
      response.collaborationInstanceId !== expectedInstanceId
      || useCollaborationStore.getState().collaborationInstanceId !== expectedInstanceId
    ) {
      throw new CollaborationClientError(
        'INVALID_RESPONSE',
        'Workflow templates were returned by a different collaboration instance.',
        'junqi.collab.workflow.template.list',
        { expectedInstanceId, actualInstanceId: response.collaborationInstanceId },
      );
    }
    setWorkflowTemplates(response.templates);
  }, []);

  const openRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    setHistoryOpen(false);
    void refreshRunTrace(runId).catch(() => undefined);
  }, [refreshRunTrace]);

  const showSetup = useCallback((reason?: CollaborationSetupReason) => {
    requestCollaborationRuntimeSetup(reason ?? 'error');
  }, []);

  const startRun = useCallback(async (message: ChatMessage) => {
    if (!sessionRef || !message.nativeMessageId) {
      showSetup('error');
      setLocalError(t('collaboration.chat.originNotReady', 'The original message identity is not confirmed yet.'));
      return;
    }
    const currentCapabilities = projectionCurrent && capabilities
      ? capabilities
      : await checkCapabilities(true);
    if (!currentCapabilities) {
      showSetup('plugin-missing');
      return;
    }
    const capabilityIssue = collaborationCapabilityIssue(
      currentCapabilities,
      COLLABORATION_PLUGIN_BUNDLE,
    );
    if (capabilityIssue) {
      showSetup('version-incompatible');
      setLocalError(capabilityIssue.message);
      return;
    }
    if (currentCapabilities.configured === false) {
      showSetup('plugin-not-configured');
      return;
    }
    const liveRuntimeIdentity = getCurrentRuntimeIdentity();
    if (
      !currentCapabilities.durableRuntime
      || !isRuntimeEligible(liveRuntimeIdentity)
      || liveRuntimeIdentity?.runtimeId !== currentCapabilities.collaborationInstanceId
    ) {
      showSetup('runtime-not-durable');
      return;
    }
    const agentId = sessionAgentId(activeSessionKey, activeSession?.agentId);
    if (!agentId) {
      showSetup('error');
      setLocalError(t('collaboration.chat.agentUnknown', 'The origin agent identity is unavailable.'));
      return;
    }

    setPendingAction('PLAN_CREATE');
    setLocalError(null);
    try {
      const origin = {
        runtimeId: currentCapabilities.collaborationInstanceId,
        agentId,
        sessionKey: sessionRef.sessionKey,
        sessionId: sessionRef.sessionId,
        nativeMessageId: message.nativeMessageId,
        ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
        ...(activeSession?.channel ? { channel: activeSession.channel } : {}),
      };
      const request = await createCollaborationWriteRequest({
        origin,
        goal: message.content.trim() || t('collaboration.card.untitled', 'Untitled collaboration'),
        capabilitySnapshot: {
          capturedAt: Date.now(),
          desktopObservedFacts: {
            targetFingerprint: liveRuntimeIdentity.targetFingerprint,
            deploymentKind: liveRuntimeIdentity.deploymentKind,
            persistence: liveRuntimeIdentity.persistence,
            gatewayVersion: liveRuntimeIdentity.gatewayVersion,
          },
        },
      }, { expectedCollaborationInstanceId: currentCapabilities.collaborationInstanceId });
      const response = await executeCommand('junqi.collab.plan.create', request);
      await syncSession(sessionRef);
      if (response.runId) openRun(response.runId);
    } catch (error) {
      const existingRunId = existingCollaborationRunId(error);
      if (existingRunId) {
        await syncSession(sessionRef).catch(() => undefined);
        openRun(existingRunId);
        return;
      }
      setLocalError(error instanceof Error ? error.message : String(error));
      showSetup('error');
    } finally {
      setPendingAction(null);
    }
  }, [
    activeSession?.agentId,
    activeSession?.channel,
    activeSessionKey,
    capabilities,
    checkCapabilities,
    executeCommand,
    openRun,
    projectionCurrent,
    runtimeIdentity,
    sessionRef,
    showSetup,
    syncSession,
    t,
  ]);

  const instantiateWorkflowTemplate = useCallback(async (template: CollaborationWorkflowTemplate) => {
    if (!sessionRef || !templateOriginMessage?.nativeMessageId) {
      setLocalError(t('collaboration.chat.originNotReady', 'The original message identity is not confirmed yet.'));
      return;
    }
    const currentCapabilities = projectionCurrent && capabilities
      ? capabilities
      : await checkCapabilities(true);
    if (!currentCapabilities) {
      showSetup('plugin-missing');
      return;
    }
    const capabilityIssue = collaborationCapabilityIssue(
      currentCapabilities,
      COLLABORATION_PLUGIN_BUNDLE,
    );
    if (capabilityIssue) {
      showSetup('version-incompatible');
      setLocalError(capabilityIssue.message);
      return;
    }
    if (currentCapabilities.configured === false) {
      showSetup('plugin-not-configured');
      return;
    }
    const liveRuntimeIdentity = getCurrentRuntimeIdentity();
    if (
      !currentCapabilities.durableRuntime
      || !isRuntimeEligible(liveRuntimeIdentity)
      || liveRuntimeIdentity?.runtimeId !== currentCapabilities.collaborationInstanceId
    ) {
      showSetup('runtime-not-durable');
      return;
    }
    const agentId = sessionAgentId(activeSessionKey, activeSession?.agentId);
    if (!agentId) {
      showSetup('error');
      setLocalError(t('collaboration.chat.agentUnknown', 'The origin agent identity is unavailable.'));
      return;
    }

    setInstantiatingTemplateId(template.id);
    setPendingAction('WORKFLOW_TEMPLATE_INSTANTIATE');
    setLocalError(null);
    try {
      const origin = {
        runtimeId: currentCapabilities.collaborationInstanceId,
        agentId,
        sessionKey: sessionRef.sessionKey,
        sessionId: sessionRef.sessionId,
        nativeMessageId: templateOriginMessage.nativeMessageId,
        ...(templateOriginMessage.clientMessageId ? { clientMessageId: templateOriginMessage.clientMessageId } : {}),
        ...(activeSession?.channel ? { channel: activeSession.channel } : {}),
      };
      const request = await createCollaborationWriteRequest({
        templateId: template.id,
        origin,
        goal: templateOriginMessage.content.trim() || template.currentVersion.definition.goal,
        capabilitySnapshot: {
          capturedAt: Date.now(),
          desktopObservedFacts: {
            targetFingerprint: liveRuntimeIdentity.targetFingerprint,
            deploymentKind: liveRuntimeIdentity.deploymentKind,
            persistence: liveRuntimeIdentity.persistence,
            gatewayVersion: liveRuntimeIdentity.gatewayVersion,
          },
        },
      }, { expectedCollaborationInstanceId: currentCapabilities.collaborationInstanceId });
      const response = await executeCommand('junqi.collab.workflow.template.instantiate', request);
      await syncSession(sessionRef);
      if (response.runId) openRun(response.runId);
    } catch (error) {
      const existingRunId = existingCollaborationRunId(error);
      if (existingRunId) {
        await syncSession(sessionRef).catch(() => undefined);
        openRun(existingRunId);
        return;
      }
      setLocalError(collaborationErrorMessage(error));
      showSetup('error');
    } finally {
      setInstantiatingTemplateId(null);
      setPendingAction(null);
    }
  }, [
    activeSession?.agentId,
    activeSession?.channel,
    activeSessionKey,
    capabilities,
    checkCapabilities,
    executeCommand,
    openRun,
    projectionCurrent,
    sessionRef,
    showSetup,
    syncSession,
    t,
    templateOriginMessage,
  ]);

  const getMessageAction = useCallback((message: ChatMessage | undefined): MessageCollaborationAction | undefined => {
    if (!message || message.role !== 'user') return undefined;
    const ownRun = runs.find((run) =>
      (message.nativeMessageId && run.origin.nativeMessageId === message.nativeMessageId)
      || (message.clientMessageId && run.origin.clientMessageId === message.clientMessageId));
    if (ownRun) return { state: 'active', onClick: () => openRun(ownRun.runId) };
    const activeRun = runs.find((run) => !isTerminalCollaborationRun(run.status));
    if (activeRun) return { state: 'active', onClick: () => openRun(activeRun.runId) };
    if (!message.nativeMessageId || !sessionRef) return { state: 'confirming' };
    return { state: 'ready', onClick: () => void startRun(message) };
  }, [openRun, runs, sessionRef, startRun]);

  const runActionClient = useMemo(() => ({
    write: (method: Parameters<typeof executeCommand>[0], request: Parameters<typeof executeCommand>[1]) =>
      executeCommand(method, request),
  }), [executeCommand]);

  const executeSubmission = useCallback(async (
    runId: string,
    submission: CollaborationRunActionSubmission,
  ) => {
    const snapshot = useCollaborationStore.getState().snapshotsByRunId[runId];
    if (!snapshot) throw new Error(t('collaboration.chat.snapshotUnavailable', 'The current run snapshot is unavailable.'));
    const expectedCollaborationInstanceId = useCollaborationStore.getState().collaborationInstanceId;
    if (!expectedCollaborationInstanceId) {
      throw new Error(t('collaboration.chat.snapshotUnavailable', 'The current run snapshot is unavailable.'));
    }
    setPendingAction(submission.action);
    setActionSubmitting(true);
    setActionError(null);
    try {
      await runCollaborationUiOperation(async () => {
        const response = await executeRunAction(snapshot, submission, {
          expectedCollaborationInstanceId,
          client: runActionClient,
        });
        if (submission.action === 'EXPORT') {
          await completeCollaborationExport(response, runId);
        }
        const deleted = submission.action === 'DELETE';
        if (deleted) {
          const result = await completeCollaborationDeletion(response, runId);
          await syncTombstones();
          if (result.status !== 'COMPLETED') {
            throw new Error(result.lastError || `Deletion ended with ${result.status}.`);
          }
          setSelectedRunId((current) => current === runId ? null : current);
        }
        if (submission.action === 'CREATE_TEMPLATE') {
          await refreshWorkflowTemplates();
        }
        setDialogAction(null);
        setDialogRunId(null);
        setActionPreview(null);
        await Promise.allSettled([
          deleted ? Promise.resolve() : refreshRun(runId),
          sessionRef ? syncSession(sessionRef) : Promise.resolve(),
        ]);
      }, setLocalError);
    } catch (error) {
      const message = collaborationErrorMessage(error);
      if (error instanceof CollaborationClientError && error.code === 'VERSION_INCOMPATIBLE') {
        showSetup('version-incompatible');
      }
      if (collaborationActionPreviewRecovery(submission.action, error) === 'INVALIDATE_AND_REFRESH') {
        setActionPreview(null);
        try {
          await refreshRun(runId);
        } catch {
          // Preserve the original actionable conflict. The user can retry the
          // authoritative refresh through the existing run controls.
        }
      }
      setActionError(message);
      throw error;
    } finally {
      setActionSubmitting(false);
      setPendingAction(null);
    }
  }, [refreshRun, refreshWorkflowTemplates, runActionClient, sessionRef, showSetup, syncSession, syncTombstones, t]);

  const directSubmission = useCallback((action: CollaborationRunAction): CollaborationRunActionSubmission | null => {
    switch (action) {
      case 'DISPATCH_STOP':
      case 'DISPATCH_RESUME':
      case 'RECONCILE':
      case 'EXPORT':
      case 'ARCHIVE':
      case 'UNARCHIVE':
        return { action };
      default:
        return null;
    }
  }, []);

  const handleRunAction = useCallback((context: CollaborationActionContext) => {
    if (!isCollaborationRunAction(context.action)) return;
    const action = context.action;
    void (async () => {
      setSelectedRunId(context.runId);
      setActionError(null);
      setLocalError(null);
      let snapshot = useCollaborationStore.getState().snapshotsByRunId[context.runId];
      if (!snapshot || snapshot.revision < context.run.revision) {
        try {
          snapshot = await runCollaborationUiOperation(
            () => refreshRun(context.runId),
            setLocalError,
          );
        } catch {
          return;
        }
      }
      if (runActionRequiresDialog(action)) {
        setActionPreview(null);
        setDialogRunId(context.runId);
        setDialogAction(action);
        return;
      }
      const submission = directSubmission(action);
      if (submission) await executeSubmission(context.runId, submission).catch(() => undefined);
    })();
  }, [directSubmission, executeSubmission, refreshRun]);

  const submitDialogAction = useCallback(async (submission: CollaborationRunActionSubmission) => {
    if (!dialogRunId) return;
    const snapshot = useCollaborationStore.getState().snapshotsByRunId[dialogRunId];
    if (!snapshot) {
      setActionError(t('collaboration.chat.snapshotUnavailable', 'The current run snapshot is unavailable.'));
      return;
    }
    if ((submission.action === 'PARTIAL' || submission.action === 'DELETE') && !submission.preview) {
      setActionPreviewing(true);
      setActionError(null);
      try {
        const preview = await runCollaborationUiOperation(
          () => previewRunAction(snapshot, submission),
          setLocalError,
        );
        setActionPreview(preview);
      } catch (error) {
        setActionError(collaborationErrorMessage(error));
      } finally {
        setActionPreviewing(false);
      }
      return;
    }
    await executeSubmission(dialogRunId, submission).catch(() => undefined);
  }, [dialogRunId, executeSubmission, t]);

  const openHistory = useCallback(async () => {
    if (!projectionCurrent) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      await runCollaborationUiOperation(
        () => Promise.all([
          syncGlobalRuns({ includeArchived: true }),
          syncTombstones(),
          refreshWorkflowTemplates(),
        ]),
        setLocalError,
      );
    } catch {
      // The operation runner retains the actionable error for the drawer.
    } finally {
      setHistoryLoading(false);
    }
  }, [projectionCurrent, refreshWorkflowTemplates, syncGlobalRuns, syncTombstones]);

  const retrySessionSync = useCallback(() => {
    if (!projectionCurrent || !sessionRef) return;
    void syncSession(sessionRef).catch(() => undefined);
  }, [projectionCurrent, sessionRef, syncSession]);

  const retryDeletionCleanup = useCallback(async (tombstone: CollaborationTombstone) => {
    if (tombstone.cleanupStatus !== 'PARTIAL' || !tombstone.deletionJobId || !instanceId) return;
    setRetryingDeletionJobId(tombstone.deletionJobId);
    setLocalError(null);
    try {
      await retryCollaborationDeletionCleanup(
        tombstone.deletionJobId,
        tombstone.runId,
        instanceId,
        (method, request) => executeCommand(method, request),
        syncTombstones,
      );
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setRetryingDeletionJobId(null);
    }
  }, [executeCommand, instanceId, syncTombstones]);

  const context = useMemo<CollaborationChatContextValue>(() => ({
    available: projectionCurrent,
    runs,
    sessionSync,
    getMessageAction,
    openRun,
    openHistory: () => void openHistory(),
    pendingAction,
    handleRunAction,
    refreshRun: (runId) => void refreshRunTrace(runId).catch(() => undefined),
    retrySessionSync,
  }), [
    getMessageAction,
    handleRunAction,
    openHistory,
    openRun,
    pendingAction,
    refreshRunTrace,
    retrySessionSync,
    runs,
    sessionSync,
    projectionCurrent,
  ]);

  const selectedSnapshot = projectionCurrent && selectedRunId
    ? snapshotsByRunId[selectedRunId]
    : undefined;
  const selectedCursor = projectionCurrent && selectedRunId
    ? cursorsByRunId[selectedRunId]
    : undefined;
  const actionSnapshot = projectionCurrent && dialogRunId
    ? snapshotsByRunId[dialogRunId]
    : undefined;
  return (
    <CollaborationChatContext.Provider value={context}>
      {children}

      <CollaborationHistoryDrawer
        open={projectionCurrent && historyOpen}
        runs={allRuns}
        tombstones={projectionCurrent ? tombstones : []}
        templates={projectionCurrent ? workflowTemplates : []}
        loading={historyLoading}
        error={projectionCurrent ? (localError || globalError) : null}
        selectedRunId={projectionCurrent ? selectedRunId : null}
        retryingDeletionJobId={retryingDeletionJobId}
        locale={i18n.language}
        onClose={() => setHistoryOpen(false)}
        onSelectRun={openRun}
        onRetry={() => void openHistory()}
        onRetryCleanup={(tombstone) => void retryDeletionCleanup(tombstone)}
        onInstantiateTemplate={projectionCurrent && templateOriginMessage
          ? (template) => void instantiateWorkflowTemplate(template)
          : undefined}
        instantiatingTemplateId={instantiatingTemplateId}
      />

      {projectionCurrent && selectedRunId && (
        <div
          className="fixed inset-0 z-[2147480900] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSelectedRun();
          }}
        >
          <section
            ref={detailsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('collaboration.details.title', 'Collaboration details')}
            tabIndex={-1}
            className="flex max-h-[92vh] w-[min(1040px,96vw)] min-w-0 flex-col overflow-hidden rounded-lg border border-aegis-border bg-aegis-bg-solid shadow-float outline-none"
          >
            <div className="flex h-10 shrink-0 items-center justify-end border-b border-aegis-border px-2">
              <button
                type="button"
                onClick={closeSelectedRun}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
                title={t('collaboration.common.close', 'Close')}
                aria-label={t('collaboration.common.close', 'Close')}
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto">
              <CollaborationDetails
                snapshot={selectedSnapshot}
                events={eventsByRunId[selectedRunId] ?? []}
                loading={!selectedSnapshot || selectedCursor?.syncing}
                error={selectedCursor?.error || localError}
                eventTimelineComplete={selectedCursor?.complete}
                eventTimelineIncompleteReason={selectedCursor?.incompleteReason}
                pendingAction={pendingAction}
                locale={i18n.language}
                onAction={handleRunAction}
                onRetry={() => void refreshRunTrace(selectedRunId).catch(() => undefined)}
              />
            </div>
          </section>
        </div>
      )}

      {projectionCurrent && dialogAction && actionSnapshot && (
        <CollaborationActionDialog
          open
          action={dialogAction}
          snapshot={actionSnapshot}
          preview={actionPreview}
          submitting={actionSubmitting}
          previewing={actionPreviewing}
          error={actionError}
          onClose={() => {
            if (actionSubmitting || actionPreviewing) return;
            setDialogAction(null);
            setDialogRunId(null);
            setActionPreview(null);
            setActionError(null);
          }}
          onSubmit={submitDialogAction}
        />
      )}

    </CollaborationChatContext.Provider>
  );
}

export function useCollaborationChat(): CollaborationChatContextValue {
  const context = useContext(CollaborationChatContext);
  if (!context) throw new Error('useCollaborationChat must be used within CollaborationChatProvider');
  return context;
}

/** Chat chrome may render before collaboration capability hydration. */
export function useOptionalCollaborationChat(): CollaborationChatContextValue | null {
  return useContext(CollaborationChatContext);
}

export function CollaborationSessionDock() {
  const { t } = useTranslation();
  const context = useCollaborationChat();
  const snapshotsByRunId = useCollaborationStore((state) => state.snapshotsByRunId);
  return (
    <CollaborationSessionDockView
      runs={context.runs}
      snapshotsByRunId={snapshotsByRunId}
      text={(key, fallback, values = {}) => String(t(key, { defaultValue: fallback, ...values }))}
      onOpenRun={context.openRun}
      onOpenHistory={context.openHistory}
    />
  );
}

export function CollaborationRunAnchor({ runId }: { runId: string }) {
  const context = useCollaborationChat();
  const run = context.runs.find((candidate) => candidate.runId === runId);
  const snapshot = useCollaborationStore((state) => state.snapshotsByRunId[runId]);
  const cursor = useCollaborationStore((state) => state.cursorsByRunId[runId]);
  if (!run) return null;
  return (
    <div className="px-5 pb-3 pt-1 sm:ps-[46px]">
      <CollaborationCard
        run={run}
        snapshot={snapshot}
        loading={!snapshot || cursor?.syncing}
        error={cursor?.error}
        pendingAction={context.pendingAction}
        onAction={context.handleRunAction}
        onOpenDetails={context.openRun}
        onRetry={context.refreshRun}
      />
    </div>
  );
}

export function CollaborationSessionSyncNotice({
  error,
  onRetry,
}: {
  error?: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div role="alert" className="shrink-0 border-b border-aegis-warning/20 bg-aegis-warning/[0.06] px-4 py-2">
      <div className="flex min-w-0 items-start gap-2 text-[10.5px] text-aegis-warning">
        <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {t('collaboration.chat.sessionSyncFailed', 'Collaboration data could not be synchronized. Last known data may be stale.')}
          </div>
          <div className="mt-0.5 break-words text-aegis-text-muted">{error}</div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium hover:bg-aegis-warning/[0.09]"
        >
          <RefreshCw size={11} aria-hidden />
          {t('collaboration.common.retry', 'Retry')}
        </button>
      </div>
    </div>
  );
}

export function CollaborationUnanchoredBanner({ anchoredRunIds }: { anchoredRunIds: ReadonlySet<string> }) {
  const { t } = useTranslation();
  const context = useCollaborationChat();
  const runs = context.runs.filter((run) => !anchoredRunIds.has(run.runId));
  const syncError = context.sessionSync?.error;
  if (runs.length === 0 && !syncError) return null;
  const active = runs.filter((run) => !isTerminalCollaborationRun(run.status));
  return (
    <>
      <CollaborationSessionSyncNotice error={syncError} onRetry={context.retrySessionSync} />
      {runs.length > 0 && (
        <div className="shrink-0 border-b border-aegis-primary/15 bg-aegis-primary/[0.045] px-4 py-2">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => context.openRun((active[0] ?? runs[0]).runId)}
              className="flex min-w-0 items-center gap-2 text-start text-[11px] text-aegis-text-muted hover:text-aegis-text"
            >
              <GitFork size={14} className="shrink-0 text-aegis-primary" />
              <span className="truncate">
                {active.length > 0
                  ? t('collaboration.chat.activeElsewhere', '{{count}} active collaboration run(s)', { count: active.length })
                  : t('collaboration.chat.unanchoredHistory', '{{count}} collaboration record(s)', { count: runs.length })}
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
