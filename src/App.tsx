import { Suspense, useEffect, useCallback, useState, useRef, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/app-store';
import { useTheme } from '@/theme/useTheme';
import { useAgentWorkspacePersistence } from '@/hooks/useAgentWorkspacePersistence';
import { useAgentWorkspaceTaskEvents } from '@/hooks/useAgentWorkspaceTaskEvents';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useWorkbenchSessionPersistence } from '@/workbench/session/useWorkbenchSessionPersistence';
import { projectChatNotification } from '@/services/gateway/chatNotificationProjection';

const AppRoutes = lazy(() => import('@/AppRoutes'));
const PetRuntime = lazy(() => import('@/pet/PetRuntime'));
const SetupPage = lazy(() => import('@/pages/SetupPage').then(m => ({ default: m.SetupPage })));
const PairingScreen = lazy(() => import('@/components/PairingScreen').then(m => ({ default: m.PairingScreen })));
const GatewayErrorScreen = lazy(() => import('@/pages/GatewayErrorScreen').then(m => ({ default: m.GatewayErrorScreen })));
const DragDropRuntime = lazy(() => import('@/runtime/DragDropRuntime'));
const DynamicIslandRuntime = lazy(() => import('@/dynamic-island/DynamicIslandRuntime'));
const OpenClawSessionViewerPresenceRuntime = lazy(() => import('@/runtime/OpenClawSessionViewerPresenceRuntime'));
const NotificationPreferencesRuntime = lazy(() => import('@/runtime/NotificationPreferencesRuntime'));
import { useChatStore } from '@/stores/chatStore';
import { configureChatGatewayOperations } from '@/stores/chatGatewayOperations';
import { useCollaborationStore } from '@/stores/collaborationStore';
import { usePetStore } from '@/stores/petStore';
import { useBootSequenceStore } from '@/stores/bootSequenceStore';
import {
  refreshGroup,
  startPolling,
  stopPolling,
  useGatewayDataStore,
} from '@/stores/gatewayDataStore';
import {
  hasCurrentWorkspaceBootstrapData,
  hasCurrentWorkspaceBootstrapFailure,
} from '@/services/gateway/workspaceBootstrapReadiness';
import {
  gateway,
  GatewayRequestTimeoutError,
  GatewayRpcError,
  openClawGatewayDataRequester,
  subscribePrivilegedAuthorizationIssues,
  subscribePrivilegedAuthorizationResolved,
} from '@/services/gateway';
import { parseOpenClawSessionListSnapshot } from '@/services/gateway/OpenClawChatRunProjection';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { gatewayLifecycle } from '@/runtime/gatewayLifecycle';
import { openSelectedGatewayControlUi } from '@/services/gateway/GatewayControlUi';
import { formatGatewayLogs } from '@/services/gateway/gatewayLogFormatting';
import {
  resolveGatewayConnectionTarget,
  storeGatewayConnectionDeviceCredential,
} from '@/services/gateway/GatewayConnectionTargetResolver';
import {
  loadGatewayProcessLogs,
  observeSelectedGatewayProcess,
} from '@/services/gateway/gatewayProcessObservation';
import {
  gatewayProgress,
  type GatewayRecoveryProgress,
} from '@/services/gateway/recoveryProgress';
import { resolveGatewaySessionModelId } from '@/services/gateway/modelIdentity';
import {
  OPENCLAW_UPDATE_MAINTENANCE_FINISHED,
  OPENCLAW_UPDATE_MAINTENANCE_STARTED,
} from '@/services/openclawUpdateLifecycle';
import { subscribeSessionIdentityTransitions } from '@/services/chat/sessionIdentityTransition';
import { sessionTranscriptFence } from '@/services/chat/sessionTranscriptFence';
import { applyConfirmedSessionDeletion } from '@/utils/sessionDelete';
import {
  createLatestRequestGate,
  isSessionDeleted,
  subscribeNativeSessionCommit,
} from '@/utils/sessionLifecycle';
import {
  classifySessionListLoadFailure,
  sessionListMutationFence,
} from '@/utils/sessionListMutationFence';
import { startRecoverableTask } from '@/utils/recoverableTask';
import { debugLog, debugWarn } from '@/utils/debugLog';
import { isGatewayOptionalPath, routePathFromLocation } from '@/utils/gatewayOptionalRoutes';
import { hasTauriEventBridge } from '@/utils/tauriEvents';
import { voiceRuntime } from '@/runtime/VoiceRuntime';
import { taskExecutionCoordinator } from '@/task-execution/TaskExecutionCoordinator';
import type { GatewayAuthorizationIssue } from '@/services/gateway/messageRouter';
import { validateCachedSetupInstallation } from '@/services/setupInstallationHealth';
import { approveSelectedGatewayDevice } from '@/api/tauri-commands';
import { AppLoadingFallback } from '@/components/shared/AppLoadingFallback';
import { JarvisVoiceRuntime } from '@/runtime/JarvisVoiceRuntime';
import { projectOpenClawSessionForChat } from '@/utils/openClawSessionProjection';
import {
  createWorkspaceBootstrapReadiness,
  shouldReleaseWorkspaceAfterGatewayRetryExhaustion,
} from '@/runtime/workspaceBootstrapReadiness';

configureChatGatewayOperations(gateway);

function ThemeRuntime() {
  useTheme();
  return null;
}

function LazyPetRuntimeHost() {
  const shouldRun = usePetStore((s) => s.enabled || s.pomodoro.enabled);
  if (!shouldRun) return null;
  return (
    <Suspense fallback={null}>
      <PetRuntime />
    </Suspense>
  );
}

async function notifyLazy(options: {
  type: 'message' | 'task_complete' | 'info' | 'error';
  title: string;
  body: string;
  dedupeKey?: string;
  url?: string | null;
}) {
  const mod = await import('@/runtime/notifications');
  mod.notifications.notify(options);
}

async function addToastLazy(type: 'message' | 'task_complete' | 'info' | 'error', title: string, body: string) {
  const mod = await import('@/stores/notificationStore');
  mod.useNotificationStore.getState().addToast(type, title, body);
}

const VERIFIED_GATEWAY_HANDOFF_TIMEOUT_MS = 12_000;
type SessionLoadResult = 'loaded' | 'failed' | 'superseded';

// ═══════════════════════════════════════════════════════════
// OpenClaw Desktop — Mission Control
// ═══════════════════════════════════════════════════════════

export default function App() {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  useAgentWorkspacePersistence(workspaces);
  useAgentWorkspaceTaskEvents();
  useWorkbenchSessionPersistence();

  const {
    addMessage,
    updateStreamingMessage,
    finalizeStreamingMessage,
    setConnectionStatus,
    settleSessionRunUi,
    incrementSessionUnread,
    markSessionCompleted,
    setSessions,
    setAvailableModels,
    setDefaultMainSessionKey,
  } = useChatStore();
  const officialMainSessionKey = useGatewayDataStore((state) => state.mainSessionKey);

  // ── Auto-Pairing State ──
  const [pairingIssue, setPairingIssue] = useState<GatewayAuthorizationIssue | null>(null);
  const pairingTriggeredRef = useRef(false);
  const deferredModelSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribeIssue = subscribePrivilegedAuthorizationIssues((issue) => {
      debugWarn('app', '[App] Privileged Gateway authorization issue:', issue.code);
      if (issue.kind !== 'pairing_required') return;
      pairingTriggeredRef.current = true;
      setPairingIssue(issue);
    });
    const unsubscribeResolved = subscribePrivilegedAuthorizationResolved(() => {
      debugLog('gateway', '[App] Privileged Gateway authorization approved');
      pairingTriggeredRef.current = false;
      setPairingIssue(null);
    });
    return () => {
      unsubscribeIssue();
      unsubscribeResolved();
    };
  }, []);

  // ── Gateway process boot error state ──
  // Tracks whether the gateway *process* failed to start (distinct from WebSocket connection issues).
  // When set, the GatewayErrorScreen overlay is shown so users can diagnose and recover.
  const [gatewayBootError, setGatewayBootError] = useState<string | null>(null);
  const [gatewayBootLogs, setGatewayBootLogs] = useState<{ stdout: string; stderr: string } | undefined>();
  const [gatewayRetrying, setGatewayRetrying] = useState(false);
  const connected = useChatStore((s) => s.connected);
  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const activeSessionAgentId = useChatStore(
    (s) => s.sessions.find((session) => session.key === s.activeSessionKey)?.agentId,
  );
  const setupComplete = useAppStore((s) => s.setupComplete);
  const workspaceStartupMode = useAppStore((s) => s.workspaceStartupMode);
  const setWorkspaceStartupMode = useAppStore((s) => s.setWorkspaceStartupMode);
  const [cachedSetupValidationPending, setCachedSetupValidationPending] = useState(
    () => setupComplete === true && hasTauriEventBridge(),
  );
  const [workspaceDataReady, setWorkspaceDataReady] = useState(false);
  const [workspaceStartupFailed, setWorkspaceStartupFailed] = useState(false);
  const workspaceBootstrapReadinessRef = useRef(createWorkspaceBootstrapReadiness());
  const initialSessionSnapshotSettledRef = useRef(false);
  const gatewayBootstrapDataReady = useGatewayDataStore(hasCurrentWorkspaceBootstrapData);
  const gatewayBootstrapDataFailed = useGatewayDataStore(hasCurrentWorkspaceBootstrapFailure);
  const [routePath, setRoutePath] = useState(() => routePathFromLocation(window.location));
  const gatewayOptionalRoute = isGatewayOptionalPath(routePath);
  const [coldStartRecoveryActive, setColdStartRecoveryActive] = useState(true);
  const [openclawUpdateActive, setOpenclawUpdateActive] = useState(false);
  const coldStartRecoveryCompletedRef = useRef(false);
  const lastGatewayToastKeyRef = useRef<string | null>(null);
  const lastGatewayErrorToastRef = useRef<string | null>(null);
  const gatewayBootErrorRef = useRef<string | null>(null);
  const bootRecoveryStartedRef = useRef(false);
  const verifiedGatewayHandoffRef = useRef(false);
  const manualGatewayRecoveryInFlightRef = useRef(false);
  const gatewayRecoveryProgressActiveRef = useRef(false);
  const previousVoiceSessionRef = useRef(activeSessionKey);

  useEffect(() => {
    const previous = previousVoiceSessionRef.current;
    if (previous && previous !== activeSessionKey) {
      voiceRuntime.interrupt(previous);
    }
    previousVoiceSessionRef.current = activeSessionKey;
  }, [activeSessionKey]);
  const openControlUiAfterRecoveryRef = useRef(false);

  useEffect(() => {
    if (officialMainSessionKey) setDefaultMainSessionKey(officialMainSessionKey);
  }, [officialMainSessionKey, setDefaultMainSessionKey]);

  // The local marker is only a cache. Validate the durable installation before
  // entering the workspace, but leave process readiness to cold-start recovery.
  useEffect(() => {
    if (!cachedSetupValidationPending || setupComplete !== true) return;
    let cancelled = false;

    const returnToSetup = () => {
      if (cancelled) return;
      setCachedSetupValidationPending(false);
      const store = useAppStore.getState();
      store.setSetupComplete(null);
      store.navigateSetup('detecting', 'replace');
    };

    void validateCachedSetupInstallation()
      .then((valid) => {
        if (cancelled) return;
        if (!valid) {
          returnToSetup();
          return;
        }
        setCachedSetupValidationPending(false);
      })
      .catch(() => {
        returnToSetup();
      });

    return () => {
      cancelled = true;
    };
  }, [cachedSetupValidationPending, setupComplete]);

  useEffect(() => {
    if (setupComplete !== true) {
      workspaceBootstrapReadinessRef.current.reset();
      initialSessionSnapshotSettledRef.current = false;
      setWorkspaceDataReady(false);
      setWorkspaceStartupFailed(false);
      return;
    }
    if (!cachedSetupValidationPending && !workspaceBootstrapReadinessRef.current.isWorkspaceDataReady()) {
      setWorkspaceDataReady(false);
    }
  }, [cachedSetupValidationPending, setupComplete]);

  const markInitialWorkspaceDataReady = useCallback((allowIncompleteData = false) => {
    if (workspaceBootstrapReadinessRef.current.markInitialWorkspaceDataReady(allowIncompleteData)) {
      setWorkspaceStartupFailed(false);
      setWorkspaceDataReady(true);
    }
  }, []);

  useEffect(() => {
    workspaceBootstrapReadinessRef.current.updateGatewayDataReady(gatewayBootstrapDataReady);
    if (!initialSessionSnapshotSettledRef.current) return;
    markInitialWorkspaceDataReady();
    if (gatewayBootstrapDataFailed) setWorkspaceStartupFailed(true);
  }, [gatewayBootstrapDataFailed, gatewayBootstrapDataReady, markInitialWorkspaceDataReady]);

  useEffect(() => {
    const updateRoutePath = () => setRoutePath(routePathFromLocation(window.location));
    window.addEventListener('hashchange', updateRoutePath);
    window.addEventListener('popstate', updateRoutePath);
    return () => {
      window.removeEventListener('hashchange', updateRoutePath);
      window.removeEventListener('popstate', updateRoutePath);
    };
  }, []);

  useEffect(() => {
    const handleUpdateMaintenanceStarted = () => {
      setOpenclawUpdateActive(true);
      coldStartRecoveryCompletedRef.current = false;
      bootRecoveryStartedRef.current = false;
      useBootSequenceStore.getState().reset();
      if (!useChatStore.getState().connected) {
        setColdStartRecoveryActive(true);
      }
    };
    const handleUpdateMaintenanceFinished = () => {
      setOpenclawUpdateActive(false);
      if (useChatStore.getState().connected) {
        coldStartRecoveryCompletedRef.current = true;
        setColdStartRecoveryActive(false);
      }
    };

    window.addEventListener(OPENCLAW_UPDATE_MAINTENANCE_STARTED, handleUpdateMaintenanceStarted);
    window.addEventListener(OPENCLAW_UPDATE_MAINTENANCE_FINISHED, handleUpdateMaintenanceFinished);
    return () => {
      window.removeEventListener(OPENCLAW_UPDATE_MAINTENANCE_STARTED, handleUpdateMaintenanceStarted);
      window.removeEventListener(OPENCLAW_UPDATE_MAINTENANCE_FINISHED, handleUpdateMaintenanceFinished);
    };
  }, []);

  const sessionListRequestGateRef = useRef(createLatestRequestGate());

  // ── Load Sessions from Gateway (also updates per-session model/thinking/token data) ──
  // This is the single polling call for all session metadata. The store's setSessions
  // synchronously applies the active session's data to the TitleBar state — no separate
  // loadTokenUsage needed.
  const loadSessions = useCallback(async (
    options: { reconcileChatRuns?: boolean } = {},
  ): Promise<SessionLoadResult> => {
    const requestGate = sessionListRequestGateRef.current;
    const requestId = requestGate.begin();
    const sourceProjectionRevision = useChatStore.getState().sessionProjectionRevision;
    const mutationRevision = sessionListMutationFence.capture();
    try {
      const runObservations = options.reconcileChatRuns
        ? gateway.capturePendingChatSessionRunObservations()
        : undefined;
      const result = await gateway.getSessions();
      if (!requestGate.isCurrent(requestId)) return 'superseded';
      const sessionListSnapshot = parseOpenClawSessionListSnapshot(result);
      const rawSessions = sessionListSnapshot.sessions;
      // Gateway 下发的默认模型与上下文窗口。
      const defaults = result?.defaults
        ? {
            model: resolveGatewaySessionModelId(
              result.defaults.modelProvider,
              result.defaults.model,
            ),
            contextTokens: result.defaults.contextTokens ?? null,
          }
        : undefined;
      const sessions = rawSessions.map(projectOpenClawSessionForChat);
      // 即使会话列表为空也同步会话与默认值，保证配置变化后标题栏模型保持一致。
      setSessions(sessions, defaults, {
        completeSnapshot: sessionListSnapshot.complete,
        sourceProjectionRevision,
      });
      if (options.reconcileChatRuns) {
        gateway.reconcileChatSessionRuns(result, runObservations);
      } else {
        gateway.observeActiveChatSessionRuns(rawSessions);
      }
      return 'loaded';
    } catch {
      return classifySessionListLoadFailure(
        requestGate.isCurrent(requestId),
        sessionListMutationFence.isCurrent(mutationRevision),
      );
    }
  }, [setSessions]);

  useEffect(() => subscribeNativeSessionCommit(() => {
    // A sessions.list request issued before sessions.create can return after
    // the create commit. It cannot authoritatively remove the new session.
    sessionListRequestGateRef.current.invalidate();
    void loadSessions();
  }), [loadSessions]);

  // ── Load Available Models from Gateway ──
  // The configured Gateway view is the only authority for selectable models.
  const loadAvailableModels = useCallback(async () => {
    const [
      { loadConfiguredGatewayModels },
      {
        extractAvailableModelsFromGatewayResult,
      },
    ] = await Promise.all([
      import('@/services/gateway/modelLoaders'),
      import('@/services/gateway/modelCatalog'),
    ]);

    const models = await loadConfiguredGatewayModels(
      (method, params) => gateway.call(method, params),
      extractAvailableModelsFromGatewayResult,
    );
    setAvailableModels(models);
  }, [setAvailableModels]);

  const startInitialWorkspaceLoad = useCallback(() => {
    const boot = useBootSequenceStore.getState();
    setWorkspaceStartupFailed(false);
    boot.markStageRunning('config', 'Loading sessions');
    void loadSessions({ reconcileChatRuns: true }).then((sessionLoadResult) => {
      if (sessionLoadResult === 'superseded') return;
      if (sessionLoadResult === 'failed') {
        boot.markStageError('config', 'Session load failed');
        setWorkspaceStartupFailed(true);
        return;
      }
      queueMicrotask(() => {
        const chat = useChatStore.getState();
        for (const [sessionKey, queue] of Object.entries(chat.messageQueue)) {
          if (queue.length > 0 && !chat.typingBySession[sessionKey]) {
            void chat.drainQueue(sessionKey).catch(() => undefined);
          }
        }
      });
      boot.markStageCompleted('config', 'Sessions ready');
      initialSessionSnapshotSettledRef.current = true;
      // 会话请求已经取得 OpenClaw 的权威首屏快照；智能体列表由后台轮询补齐，
      // 不得让它的独立失败阻塞工作区进入。
      markInitialWorkspaceDataReady(true);
      boot.markStageRunning('conversation', 'Warming recent conversation');
      const sessionKey = useChatStore.getState().activeSessionKey || 'agent:main:main';
      void gateway.getHistory(sessionKey, 20, 8_000).then((result) => {
        const stage = useBootSequenceStore.getState().stages.conversation;
        if (stage.status !== 'pending' && stage.status !== 'running') return;
        const messages = Array.isArray(result?.messages) ? result.messages : [];
        useBootSequenceStore.getState().markStageCompleted(
          'conversation',
          messages.length > 0
            ? `Recent conversation warmed (${messages.length} messages)`
            : 'Recent conversation warmed',
        );
      }).catch((err) => {
        const stage = useBootSequenceStore.getState().stages.conversation;
        if (stage.status !== 'pending' && stage.status !== 'running') return;
        const isHistoryUnavailableDuringStartup = err instanceof GatewayRpcError
          && err.code === 'UNAVAILABLE';
        useBootSequenceStore.getState().markStageCompleted(
          'conversation',
          isHistoryUnavailableDuringStartup || err instanceof GatewayRequestTimeoutError
            ? 'Recent conversation is syncing in the background.'
            : 'Recent conversation will load after startup.',
        );
      });
      boot.markStageRunning('background', 'Models will sync in the background');
      if (deferredModelSyncTimerRef.current) clearTimeout(deferredModelSyncTimerRef.current);
      deferredModelSyncTimerRef.current = setTimeout(() => {
        deferredModelSyncTimerRef.current = null;
        void loadAvailableModels().catch(() => undefined).finally(() => {
          useBootSequenceStore.getState().markStageCompleted('background', 'Models synced');
        });
      }, 1_500);
    }).catch(() => {
      boot.markStageError('config', 'Session load failed');
      setWorkspaceStartupFailed(true);
    });
  }, [loadAvailableModels, loadSessions, markInitialWorkspaceDataReady]);

  const retryWorkspaceStartup = useCallback(() => {
    workspaceBootstrapReadinessRef.current.reset();
    initialSessionSnapshotSettledRef.current = false;
    setWorkspaceDataReady(false);
    setWorkspaceStartupFailed(false);
    void Promise.allSettled([refreshGroup('sessions'), refreshGroup('agents')]);
    startInitialWorkspaceLoad();
  }, [startInitialWorkspaceLoad]);
  // OpenClaw exposes durable transcript updates through a subscription scoped
  // to one session. Keep the selected conversation attached to that official
  // stream; the service serializes unsubscribe/subscribe transitions.
  useEffect(() => {
    const target = setupComplete && connected && activeSessionKey
      ? {
          sessionKey: activeSessionKey,
          ...(activeSessionAgentId ? { agentId: activeSessionAgentId } : {}),
        }
      : null;
    void gateway.synchronizeSessionTranscript(target)
      .catch((error) => debugWarn('gateway', '[App] Unable to subscribe to selected session transcript:', error));
  }, [activeSessionAgentId, activeSessionKey, connected, setupComplete]);

  const surfaceVerifiedGatewayHandoffFailure = useCallback(() => {
    if (!verifiedGatewayHandoffRef.current) return;
    verifiedGatewayHandoffRef.current = false;
    coldStartRecoveryCompletedRef.current = false;
    setWorkspaceStartupMode('cold');
    setColdStartRecoveryActive(true);
  }, [setWorkspaceStartupMode]);

  // Setup has already completed an authenticated Gateway and model probe. Keep
  // that connection alive across the route transition and only surface recovery
  // when the handoff truly fails instead of replaying the cold-start timeline.
  useEffect(() => {
    if (workspaceStartupMode !== 'verified-gateway-handoff') return;
    verifiedGatewayHandoffRef.current = true;
    coldStartRecoveryCompletedRef.current = true;
    setColdStartRecoveryActive(false);
    const timeout = window.setTimeout(() => {
      if (!useChatStore.getState().connected) {
        surfaceVerifiedGatewayHandoffFailure();
      }
    }, VERIFIED_GATEWAY_HANDOFF_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [surfaceVerifiedGatewayHandoffFailure, workspaceStartupMode]);

  useEffect(() => {
    if (workspaceStartupMode !== 'verified-gateway-handoff' || !connected) return;
    verifiedGatewayHandoffRef.current = false;
    setWorkspaceStartupMode('cold');
  }, [connected, setWorkspaceStartupMode, workspaceStartupMode]);

  // Cold-start recovery is lifecycle state, not a rendering gate. The
  // workbench remains available while the Gateway connects in the background.
  useEffect(() => {
    if (!connected || coldStartRecoveryCompletedRef.current) return;
    coldStartRecoveryCompletedRef.current = true;
    setColdStartRecoveryActive(false);
  }, [connected]);

  const addBootRecoveryLog = useCallback((line: string) => {
    debugLog('gateway', `[recovery] ${line}`);
  }, []);

  /**
   * Emit a step="gateway" setup-progress event for StatusBar (and any
   * other listener) to consume. Same shape Rust emits via setup-progress,
   * just synthesized in-process so non-install flows (manual reconnect,
   * boot recovery) still show granular progress text inline.
   */
  const emitGatewayProgress = useCallback((detail: GatewayRecoveryProgress) => {
    gatewayRecoveryProgressActiveRef.current = detail.status === 'running';
    window.dispatchEvent(new CustomEvent('aegis:gateway-progress', {
      detail,
    }));
  }, []);

  const cancelGatewayMigrationRetry = useCallback(() => {
    return gatewayLifecycle.cancelMigrationWait();
  }, []);

  const restartGatewayFromBoot = useCallback(async (diagnostic?: string, source = 'app-recovery') => {
    if (!hasTauriEventBridge()) {
      const message = 'Gateway restart is unavailable in this runtime.';
      emitGatewayProgress(gatewayProgress.restartUnavailable());
      setGatewayBootError(message);
      openControlUiAfterRecoveryRef.current = false;
      return false;
    }
    addBootRecoveryLog('Restarting Gateway service…');
    try {
      const result = await gatewayLifecycle.restart(source, diagnostic);
      if (result.superseded) return false;
      if (!result.success) {
        throw new Error(result.error || 'Gateway restart failed');
      }
      addBootRecoveryLog('Gateway restart command completed');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addBootRecoveryLog(`Gateway restart failed: ${message}`);
      emitGatewayProgress(gatewayProgress.restartFailed(message));
      setGatewayBootError(message);
      openControlUiAfterRecoveryRef.current = false;
      const logs = await loadGatewayProcessLogs(80);
      setGatewayBootLogs(formatGatewayLogs(logs));
      return false;
    }
  }, [addBootRecoveryLog, emitGatewayProgress]);

  // During boot, separate two different failures:
  // 1. Gateway process is running, but the WebSocket handshake is late.
  // 2. Gateway process is not running, so WebSocket retries cannot succeed.
  // The second case starts recovery immediately instead of waiting through
  // handshake retry timers.
  useEffect(() => {
    // Setup owns this connection until the authenticated handoff either
    // succeeds or times out. Starting a cold recovery here would restart a
    // healthy Gateway and replay stale lifecycle diagnostics in the workspace.
    if (workspaceStartupMode === 'verified-gateway-handoff') return;
    if (setupComplete !== true) return;
    if (cachedSetupValidationPending) return;
    if (openclawUpdateActive) return;
    if (connected) {
      cancelGatewayMigrationRetry();
      bootRecoveryStartedRef.current = false;
      return;
    }
    if (!coldStartRecoveryActive || coldStartRecoveryCompletedRef.current || bootRecoveryStartedRef.current) return;
    if (!hasTauriEventBridge()) return; // Browser previews do not own a Gateway runtime.
    bootRecoveryStartedRef.current = true;

    let cancelled = false;
    const startGatewayRecovery = async (reason: string) => {
      addBootRecoveryLog(`Starting Gateway recovery immediately (${reason})…`);
      emitGatewayProgress(gatewayProgress.starting());
      try {
        const result = await gatewayManager.ensureRunning();
        if (cancelled || useChatStore.getState().connected) return;
        if (result?.superseded) return;
        if (result?.healthy) {
          cancelGatewayMigrationRetry();
          addBootRecoveryLog(`Gateway runtime ready (${result.mode ?? 'native'}); establishing authenticated WebSocket`);
          emitGatewayProgress(gatewayProgress.runtimeReady(result.mode));
          return;
        }
        addBootRecoveryLog(`ensure_gateway_running returned unhealthy: ${result?.error ?? 'unknown error'}`);
        emitGatewayProgress(gatewayProgress.ensureUnhealthy());
        await restartGatewayFromBoot(result?.error ?? reason);
      } catch (err) {
        if (cancelled || useChatStore.getState().connected) return;
        addBootRecoveryLog(`ensure_gateway_running exception: ${String(err)}`);
        emitGatewayProgress(gatewayProgress.ensureFailed());
        await restartGatewayFromBoot(String(err));
      }
    };

    void (async () => {
      if (useChatStore.getState().connected) return;
      addBootRecoveryLog('Checking local Gateway status before recovery…');
      try {
        const status = await observeSelectedGatewayProcess();
        if (cancelled || useChatStore.getState().connected) return;
        if (status.ready) {
          cancelGatewayMigrationRetry();
          addBootRecoveryLog('Gateway process is running; reconnecting WebSocket quietly…');
          emitGatewayProgress(gatewayProgress.processDetected());
          try { gatewayManager.reconnect(); } catch {}
          return;
        }
        addBootRecoveryLog(`Gateway status is not ready: ${status.error ?? 'not running'}`);
        await startGatewayRecovery(status.error ?? 'not running');
        return;
      } catch (err) {
        if (cancelled || useChatStore.getState().connected) return;
        addBootRecoveryLog(`Gateway status check failed: ${String(err)}`);
      }
      await startGatewayRecovery('status check failed');
    })();

    return () => {
      cancelled = true;
      cancelGatewayMigrationRetry();
    };
  }, [connected, coldStartRecoveryActive, cachedSetupValidationPending, openclawUpdateActive, setupComplete, workspaceStartupMode, addBootRecoveryLog, emitGatewayProgress, restartGatewayFromBoot, cancelGatewayMigrationRetry]);

  // ── uiScale is applied via the TopBar inverse-zoom + native
  // webview zoom (set by settingsStore.setUiScale). No CSS transform
  // or zoom on #app-root — both break fixed positioning and scroll.

  // ── Auto-drain the message queue when an AI reply completes ──
  // Fires once per response (on the typing true→false transition) for any session,
  // covering stream terminals and authoritative run reconciliation. Both
  // settle typingBySession[key]; drainQueue re-arms typing
  // so the next completion drains the next item, until the queue is empty.
  useEffect(() => {
    return subscribeSessionIdentityTransitions((transition) => {
      sessionTranscriptFence.invalidate(transition.sessionKey);
      gateway.invalidateChatSession(transition.sessionKey);
      useCollaborationStore.getState().clearSessionProjection({
        sessionKey: transition.sessionKey,
        sessionId: transition.previousSessionId,
      });
    });
  }, []);

  useEffect(() => {
    return useChatStore.subscribe((state, prev) => {
      const cur = state.typingBySession;
      const old = prev.typingBySession;
      if (cur === old) return;
      for (const key of Object.keys(cur)) {
        if (cur[key] === false && old[key] === true && (state.messageQueue[key] || []).length > 0) {
          void useChatStore.getState().drainQueue(key).catch(() => undefined);
        }
      }
    });
  }, []);

  // ── Gateway Setup ──
  useEffect(() => {
    if (setupComplete !== true) return;
    if (cachedSetupValidationPending) return;

    const refreshDurableTranscript = (sessionKey: string) => {
      if (isSessionDeleted(sessionKey)) return;
      const { activeSessionKey, historyLoader } = useChatStore.getState();
      if (!historyLoader) return;
      startRecoverableTask(
        () => historyLoader(sessionKey === activeSessionKey ? undefined : sessionKey, {
          force: true,
          background: sessionKey !== activeSessionKey,
        }),
        (error) => debugWarn('gateway', `[App] Transcript refresh failed for ${sessionKey}:`, error),
      );
    };

    gateway.setCallbacks({
      onMessage: (msg) => {
        const rawSk = (msg as { sessionKey?: string }).sessionKey;
        const sessionKey = typeof rawSk === 'string' ? rawSk.trim() : '';
        if (!sessionKey) {
          debugWarn('gateway', '[App] Ignoring unscoped Gateway message');
          return;
        }
        const { activeSessionKey: currentSessionKey } = useChatStore.getState();
        addMessage(msg, sessionKey);
        if (msg.role === 'assistant' && sessionKey === useChatStore.getState().activeSessionKey) {
          voiceRuntime.speakMessage(sessionKey, msg.content, (msg as any).mediaUrl);
        }
        if (sessionKey !== currentSessionKey) {
          incrementSessionUnread(sessionKey);
        }
        // This generic callback can mirror either an active stream or durable
        // transcript. It updates chat state only; notification publication is
        // restricted to the identity-bearing stream/transcript projections.
      },
      onStreamChunk: (sessionKey, messageId, content, media, runId) => {
        if (sessionKey === useChatStore.getState().activeSessionKey) {
          voiceRuntime.consumeStream(sessionKey, content, messageId, media?.mediaUrl);
        }
        updateStreamingMessage(
          messageId,
          content,
          {
            ...(media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : {}),
            ...(runId ? { runId } : {}),
            responseState: 'streaming',
          },
          sessionKey,
        );
      },
      onStreamEnd: (sessionKey, messageId, content, media, meta) => {
        void taskExecutionCoordinator.settleRun({
          sessionKey,
          runId: meta?.runId,
          terminalReason: meta?.state === 'aborted'
            ? 'aborted'
            : meta?.state === 'error'
              ? 'error'
              : 'final',
        }).catch((error) => taskExecutionCoordinator.reportPersistenceFailure('settle Run checkpoint', error));
        if (sessionKey === useChatStore.getState().activeSessionKey) {
          voiceRuntime.finishStream(sessionKey, content, meta?.state ?? 'final', messageId, media?.mediaUrl);
        }
        finalizeStreamingMessage(
          messageId,
          content,
          {
            ...(media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : {}),
            ...(meta?.runId ? { runId: meta.runId } : {}),
            responseState: meta?.state ?? 'final',
            ...(meta?.fileRefs ? { fileRefs: meta.fileRefs } : {}),
            ...(meta?.decisionOptions ? { decisionOptions: meta.decisionOptions } : {}),
            ...(meta?.workshopEvents ? { workshopEvents: meta.workshopEvents } : {}),
            ...(meta?.sessionEvents ? { sessionEvents: meta.sessionEvents } : {}),
            ...(meta?.usage ? { usage: meta.usage } : {}),
            ...(meta?.model ? { model: meta.model } : {}),
          },
          sessionKey,
        );
        // Finalize the message before atomically releasing every transient run
        // indicator; the typing transition then drains the next queued turn.
        settleSessionRunUi(sessionKey);
        const { activeSessionKey: currentSessionKey, historyLoader } = useChatStore.getState();
        if (sessionKey !== currentSessionKey) {
          markSessionCompleted(sessionKey);
        }
        if (meta?.refreshHistory && historyLoader) refreshDurableTranscript(sessionKey);
        // Refresh session metadata (token usage, model) after a stream completes.
        void loadSessions();
        // Notify when app is minimized/background OR user is on a different page.
        const isOnChat = window.location.hash === '#/chat' || window.location.hash.startsWith('#/chat?');
        const notification = projectChatNotification({
          sessionKey,
          role: 'assistant',
          text: content,
          runId: meta?.runId,
        });
        if ((!document.hasFocus() || !isOnChat) && notification) {
          void notifyLazy({
            type: notification.kind,
            title: notification.kind === 'task_complete'
              ? t('notifications.replyComplete')
              : t('notifications.newMessage'),
            body: notification.body,
            dedupeKey: notification.dedupeKey,
            url: notification.url,
          });
        }
      },
      onSessionRunReconciliation: ({ sessionKey, state }) => {
        if (isSessionDeleted(sessionKey)) return;
        const chat = useChatStore.getState();
        if (state === 'active') {
          chat.setIsTyping(true, sessionKey);
          return;
        }
        // The run projection owns terminal state. End the visible activity
        // immediately; durable history reconciliation may continue in the
        // background without keeping dots, timers or the stop action alive.
        chat.settleSessionRunUi(sessionKey);
        const { historyLoader } = chat;
        if (!historyLoader) return;
        refreshDurableTranscript(sessionKey);
      },
      onStreamReconciliationNeeded: (sessionKey) => {
        refreshDurableTranscript(sessionKey);
        void gateway.reconcileChatSessionRun(sessionKey).catch(() => undefined);
      },
      onSessionRunReconciliationNeeded: (sessionKey) => {
        void gateway.reconcileChatSessionRun(sessionKey).catch(() => undefined);
      },
      onTranscriptChanged: (sessionKey) => {
        refreshDurableTranscript(sessionKey);
      },
      onTranscriptMessage: (notice) => {
        if (isSessionDeleted(notice.sessionKey)) return;
        const currentSessionKey = useChatStore.getState().activeSessionKey;
        if (notice.sessionKey !== currentSessionKey) {
          incrementSessionUnread(notice.sessionKey);
          if (notice.role === 'assistant') markSessionCompleted(notice.sessionKey);
        }
      },
      onRetryState: (retry) => {
        if (retry.phase === 'exhausted' && gatewayRecoveryProgressActiveRef.current) {
          emitGatewayProgress(gatewayProgress.connectionFailed());
        }
        if (retry.phase === 'exhausted') {
          surfaceVerifiedGatewayHandoffFailure();
          if (shouldReleaseWorkspaceAfterGatewayRetryExhaustion(
            setupComplete,
            cachedSetupValidationPending,
          )) {
            useBootSequenceStore.getState().markStageError(
              'connection',
              'Gateway connection attempts exhausted',
            );
            markInitialWorkspaceDataReady(true);
          }
        }
        if (coldStartRecoveryCompletedRef.current) return;
        if (retry.phase === 'attempting') {
          addBootRecoveryLog(`WebSocket connection attempt ${retry.attempt}/${retry.maxAttempts} started`);
          return;
        }
        if (retry.phase === 'backoff') {
          addBootRecoveryLog(
            `Connection attempt failed; retry ${retry.attempt}/${retry.maxAttempts} in ${retry.delayMs ?? 0}ms`,
          );
          return;
        }
        if (retry.phase === 'exhausted') {
          addBootRecoveryLog(`All ${retry.maxAttempts} connection attempts failed; self-rescue is ready`);
        }
      },
      onStatusChange: (status) => {
        setConnectionStatus(status);
        if (status.connected) {
          startPolling(openClawGatewayDataRequester);
        } else if (!status.connecting) {
          stopPolling();
        }
        // 将 WebSocket 生命周期交给连接状态机统一收敛。
        if (status.connected) {
          gatewayManager.notifyWsOpen();
          if (verifiedGatewayHandoffRef.current) {
            verifiedGatewayHandoffRef.current = false;
            setWorkspaceStartupMode('cold');
          }
        } else if (!status.connecting) {
          voiceRuntime.interruptAll();
          gatewayManager.notifyWsClose();
          // Do not release a queued turn from a transport failure. OpenClaw's
          // sessions.list active-run snapshot decides it after reconnect.
          gateway.clearChatTransportProjection();
          gateway.resetSessionTranscriptTransport();
          const cs = useChatStore.getState();
          const thinkingKeys = Object.keys(cs.thinkingBySession).filter(
            (k) => (cs.thinkingBySession[k]?.text?.length ?? 0) > 0,
          );
          thinkingKeys.forEach((k) => cs.clearThinking(k));
          if (thinkingKeys.length) {
            debugLog('app', '[App] [cleanup] Cleared live thinking on disconnect; pending turns await Gateway reconciliation');
          }
        }
        if (status.connected) {
          cancelGatewayMigrationRetry();
          // The callback is installed once, so it must not rely on a captured
          // pairing flag. Any successful handshake closes the approval surface.
          setPairingIssue(null);
          pairingTriggeredRef.current = false;
          const boot = useBootSequenceStore.getState();
          boot.markStageCompleted('connection', 'WebSocket handshake complete');
          startInitialWorkspaceLoad();
        }
      },
      onAuthorizationIssue: (issue) => {
        debugWarn('app', '[App] Gateway authorization issue:', issue.code);
        if (issue.kind !== 'pairing_required') return;
        pairingTriggeredRef.current = true;
        setPairingIssue(issue);
      },
    });

    // ── Check gateway boot status (main-process gateway *process* health) ──
    // Must run before initConnection so we know whether to attempt a WS connection
    // or immediately show the recovery UI.
    // ── Gateway connection lifecycle managed by GatewayConnectionManager ──
    // State machine handles: detect → start → connect → connected → error.
    // App.tsx only subscribes to state changes and syncs UI state accordingly.
    const managerUnsub = gatewayManager.onStateChange((snap) => {
      setConnectionStatus({ connected: snap.connected, connecting: snap.connecting, error: snap.error ?? undefined });
      setGatewayBootError(snap.error);
      gatewayBootErrorRef.current = snap.error;
      setGatewayBootLogs(snap.logs);
      setGatewayRetrying(snap.retrying);

      // `selectedGatewayReady` is backed by probe_selected_gateway, which
      // authenticates the selected state/config pair. Once it is true an old
      // startup-migration timer must never issue a competing restart.
      if (snap.selectedGatewayReady) {
        cancelGatewayMigrationRetry();
      }

      const toastKey = `${snap.state}|${snap.connected}|${snap.connecting}|${snap.retrying}|${snap.error ?? ''}`;
      const previousToastKey = lastGatewayToastKeyRef.current;
      const previousError = lastGatewayErrorToastRef.current;
      lastGatewayToastKeyRef.current = toastKey;
      // Normal reconnect/connecting/connected transitions are too noisy.
      // Notify only when a real error appears, and once when that error recovers.
      if (coldStartRecoveryCompletedRef.current) {
        if (snap.error && snap.error !== previousError) {
          lastGatewayErrorToastRef.current = snap.error;
          void addToastLazy(
            'error',
            t('gateway.statusChanged', 'Gateway status changed'),
            t('gateway.statusError', { error: snap.error, defaultValue: `Error: ${snap.error}` }),
          );
        } else if (!snap.error && previousError && snap.connected && previousToastKey !== toastKey) {
          lastGatewayErrorToastRef.current = null;
          void addToastLazy(
            'info',
            t('gateway.statusChanged', 'Gateway status changed'),
            t('gateway.statusConnected', 'Connected'),
          );
        }
      }

      if (snap.connected) {
        if (gatewayRecoveryProgressActiveRef.current) {
          emitGatewayProgress(gatewayProgress.recoveryComplete());
        }
        setGatewayBootError(null);
        setGatewayBootLogs(undefined);
        if (openControlUiAfterRecoveryRef.current) {
          openControlUiAfterRecoveryRef.current = false;
          void openSelectedGatewayControlUi().then((result) => {
            if (!result.success) {
              void addToastLazy(
                'error',
                t('settings.controlUi', 'Control UI'),
                t('offline.controlUiUnavailable', '暂时无法打开 Control UI，请完成 Gateway 恢复后重试。'),
              );
            }
          });
        }
      }
    });
    gatewayManager.init();
    // Setup owns the socket before App mounts its callbacks. Replay the current
    // state after the manager is ready so a verified handoff is not mistaken for
    // an unconnected cold start.
    gateway.refreshConnectionStatus();

    // Configuration and session selection are separate domains. The config
    // manager already owns the restart; this listener only reloads its model view.
    const handleConfigSaved = () => {
      setTimeout(() => loadAvailableModels(), 1500);
    };
    window.addEventListener('aegis:config-saved', handleConfigSaved);

    // Listen for session reset → re-fetch sessions so token counts reflect cleared state
    const handleSessionReset = () => {
      // Short delay to allow gateway to complete the reset before we poll
      setTimeout(() => void loadSessions(), 400);
    };
    window.addEventListener('aegis:session-reset', handleSessionReset);

    const handleSessionsChanged = (event: Event) => {
      sessionListRequestGateRef.current.invalidate();
      const detail = (event as CustomEvent<{ reason?: string; sessionKey?: string }>).detail;
      if (
        (detail?.reason === 'delete' || detail?.reason === 'deleted')
        && typeof detail.sessionKey === 'string'
      ) {
        applyConfirmedSessionDeletion(detail.sessionKey);
      }
      setTimeout(() => void loadSessions({ reconcileChatRuns: true }), 250);
    };
    window.addEventListener('aegis:sessions-changed', handleSessionsChanged);

    // Compatibility bridge for extensions or older surfaces that still emit
    // the former command event. First-party callers use gatewayLifecycle.
    const handleManualReconnect = (event: Event) => {
      const detail = (event as CustomEvent<{
        action?: string;
        source?: string;
        openControlUi?: boolean;
      }>).detail;
      if (detail?.openControlUi) openControlUiAfterRecoveryRef.current = true;
      if (manualGatewayRecoveryInFlightRef.current) return;
      const action = detail?.action === 'restart'
        ? 'restart'
        : 'reconnect';
      const source = detail?.source || 'manual';
      manualGatewayRecoveryInFlightRef.current = true;
      void (async () => {
        bootRecoveryStartedRef.current = false;
        addBootRecoveryLog(`Gateway recovery requested (${source}, ${action})`);
        try {
          const result = action === 'restart'
            ? await gatewayLifecycle.restart(source, gatewayBootErrorRef.current ?? undefined)
            : await gatewayLifecycle.recover(source, gatewayBootErrorRef.current ?? undefined);
          if (result.superseded) return;
          if (!result.success) throw new Error(result.error || 'Gateway recovery failed');
          cancelGatewayMigrationRetry();
          addBootRecoveryLog(result.mode
            ? `Gateway runtime ready (${result.mode}) — establishing authenticated connection`
            : 'Gateway restart command completed');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          addBootRecoveryLog(`Gateway recovery failed: ${message}`);
          emitGatewayProgress(gatewayProgress.restartFailed(message));
          setGatewayBootError(message);
        }
      })().finally(() => {
        manualGatewayRecoveryInFlightRef.current = false;
      });
    };
    window.addEventListener('aegis:manual-reconnect', handleManualReconnect);

    // Cleanup — prevent orphan WebSocket connections on remount
    return () => {
      managerUnsub();
      if (deferredModelSyncTimerRef.current) {
        clearTimeout(deferredModelSyncTimerRef.current);
        deferredModelSyncTimerRef.current = null;
      }
      window.removeEventListener('aegis:config-saved', handleConfigSaved);
      window.removeEventListener('aegis:session-reset', handleSessionReset);
      window.removeEventListener('aegis:sessions-changed', handleSessionsChanged);
      window.removeEventListener('aegis:manual-reconnect', handleManualReconnect);
      gateway.forgetSessionTranscript();
      gateway.forgetSessionViewerPresence();
      gatewayManager.destroy();
    };
  }, [setupComplete, cachedSetupValidationPending, restartGatewayFromBoot, emitGatewayProgress, addBootRecoveryLog, cancelGatewayMigrationRetry, setWorkspaceStartupMode, surfaceVerifiedGatewayHandoffFailure, startInitialWorkspaceLoad]);


  // ── Pairing Handlers ──
  const handlePairingComplete = useCallback(async (token: string) => {
    debugLog('gateway', '[App] [pairing] Pairing complete - reconnecting with new token');
    const target = await resolveGatewayConnectionTarget();
    await storeGatewayConnectionDeviceCredential(target.wsUrl, token);
    // Reconnect gateway with new token
    gatewayManager.reconnectWithToken(token);
    setPairingIssue(null);
    pairingTriggeredRef.current = false;
  }, []);

  const handlePairingApprove = useCallback(async (requestId: string) => {
    await approveSelectedGatewayDevice(requestId);
    // The selected OpenClaw runtime has confirmed the exact request. Wake the
    // existing privileged operation immediately instead of making the user
    // wait for its next scheduled authorization probe.
    gateway.retryPrivilegedAuthorizationNow();
  }, []);

  const handlePairingCancel = useCallback(() => {
    debugLog('gateway', '[App] Pairing cancelled by user');
    setPairingIssue(null);
    pairingTriggeredRef.current = false;
    // Stop gateway pairing retry loop — user chose to dismiss
    gateway.stopPairingRetry();
    gateway.cancelPrivilegedAuthorizationRetry();
    gateway.cancelApprovalAuthorizationRetry();
  }, []);

  const handleGatewayRetry = useCallback(() => {
    setGatewayRetrying(true);
    void restartGatewayFromBoot(gatewayBootErrorRef.current ?? undefined, 'gateway-error-screen');
  }, [restartGatewayFromBoot]);

  const handleGatewayRecovered = useCallback(() => {
    setGatewayBootError(null);
    setGatewayBootLogs(undefined);
    setGatewayRetrying(false);
    // Probe immediately instead of waiting for the periodic poller
    gatewayManager.reconnect();
  }, []);

  if (setupComplete === true && cachedSetupValidationPending) {
    return (
      <>
        <ThemeRuntime />
        <AppLoadingFallback />
      </>
    );
  }

  if (!setupComplete) {
    return (
      <>
        <ThemeRuntime />
        <Suspense fallback={null}>
          <NotificationPreferencesRuntime />
        </Suspense>
        <LazyPetRuntimeHost />
        <Suspense fallback={<AppLoadingFallback />}>
          <SetupPage />
        </Suspense>
        {pairingIssue && (
          <Suspense fallback={null}>
            <PairingScreen
              issue={pairingIssue}
              onApprove={handlePairingApprove}
              onPaired={handlePairingComplete}
              onCancel={handlePairingCancel}
            />
          </Suspense>
        )}
      </>
    );
  }

  if (!workspaceDataReady && !gatewayOptionalRoute) {
    return (
      <>
        <ThemeRuntime />
        <AppLoadingFallback
          label={t('app.loadingWorkspace')}
          errorLabel={workspaceStartupFailed ? t('app.workspaceLoadFailed') : undefined}
          retryLabel={workspaceStartupFailed ? t('app.retry') : undefined}
          onRetry={workspaceStartupFailed ? retryWorkspaceStartup : undefined}
        />
      </>
    );
  }

  return (
    <>
      <JarvisVoiceRuntime>
        <ThemeRuntime />
        <Suspense fallback={null}>
          <NotificationPreferencesRuntime />
        </Suspense>
        <LazyPetRuntimeHost />
        {hasTauriEventBridge() && (
          <Suspense fallback={null}>
            <OpenClawSessionViewerPresenceRuntime setupComplete={setupComplete === true} />
          </Suspense>
        )}
        {hasTauriEventBridge() && (
          <Suspense fallback={null}>
            <DynamicIslandRuntime />
          </Suspense>
        )}

      {/* Gateway process error overlay — shown when the gateway failed to start.
          Takes priority over everything; user must recover before using the app. */}
        {gatewayBootError && !gatewayOptionalRoute && (
        <Suspense fallback={null}>
          <GatewayErrorScreen
            error={gatewayBootError}
            logs={gatewayBootLogs}
            retrying={gatewayRetrying}
            onRetry={handleGatewayRetry}
            onRecovered={handleGatewayRecovered}
          />
        </Suspense>
        )}

        <Suspense fallback={null}>
          <DragDropRuntime />
        </Suspense>

      {/* Pairing overlay — shown when Gateway rejects due to missing scopes */}
        {pairingIssue && !gatewayOptionalRoute && !gatewayBootError && (
        <Suspense fallback={null}>
          <PairingScreen
            issue={pairingIssue}
            onApprove={handlePairingApprove}
            onPaired={handlePairingComplete}
            onCancel={handlePairingCancel}
          />
        </Suspense>
        )}

        <Suspense fallback={<AppLoadingFallback />}>
          <AppRoutes />
        </Suspense>
      </JarvisVoiceRuntime>
    </>
  );
}
