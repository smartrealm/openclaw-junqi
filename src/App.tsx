import { Suspense, useEffect, useCallback, useState, useRef, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { shouldDeferColdGatewayRecovery, useAppStore } from '@/stores/app-store';
import { useTheme } from '@/theme/useTheme';
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
import { formatGatewayLogs } from '@/services/gateway/gatewayLogFormatting';
import { runGatewayErrorScreenRecovery } from '@/services/gateway/gatewayErrorRecovery';
import {
  loadGatewayProcessLogs,
} from '@/services/gateway/gatewayProcessObservation';
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
import type { GatewayAuthorizationIssue } from '@/services/gateway/messageRouter';
import { validateCachedSetupInstallation } from '@/services/setupInstallationHealth';
import { approveSelectedGatewayDevice } from '@/api/tauri-commands';
import { AppLoadingFallback } from '@/components/shared/AppLoadingFallback';
import { useSetupProgress } from '@/hooks/useSetupProgress';
import { OpenClawGuidedSetupClient } from '@/services/gateway/OpenClawGuidedSetupClient';
import { resolveOpenClawSetupCapability } from '@/services/setup/openClawSetupCapability';
import { shouldBlockWorkspaceEntry } from '@/services/setup/setupEntryGate';
import { JarvisVoiceRuntime } from '@/runtime/JarvisVoiceRuntime';
import { projectOpenClawSessionForChat } from '@/utils/openClawSessionProjection';
import {
  createWorkspaceBootstrapReadiness,
  releaseWorkspaceAfterGatewayData,
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
    setSessionAvailableModels,
    setSessionModelsLoading,
    clearSessionAvailableModels,
    setDefaultMainSessionKey,
  } = useChatStore();
  const officialMainSessionKey = useGatewayDataStore((state) => state.mainSessionKey);

  // 自动配对状态。
  const [pairingIssue, setPairingIssue] = useState<GatewayAuthorizationIssue | null>(null);
  const pairingTriggeredRef = useRef(false);
  const deferredModelSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scopedModelCatalogRequestRef = useRef(0);

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
  const [officialSetupValidationPending, setOfficialSetupValidationPending] = useState(
    () => setupComplete === true && hasTauriEventBridge(),
  );
  const [workspaceDataReady, setWorkspaceDataReady] = useState(false);
  const [workspaceStartupFailed, setWorkspaceStartupFailed] = useState(false);
  const workspaceBootstrapReadinessRef = useRef(createWorkspaceBootstrapReadiness());
  const gatewayBootstrapDataReady = useGatewayDataStore(hasCurrentWorkspaceBootstrapData);
  const gatewayBootstrapDataFailed = useGatewayDataStore(hasCurrentWorkspaceBootstrapFailure);
  const gatewayProgress = useSetupProgress('gateway');
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
  const previousVoiceSessionRef = useRef(activeSessionKey);

  useEffect(() => {
    const previous = previousVoiceSessionRef.current;
    if (previous && previous !== activeSessionKey) {
      voiceRuntime.interrupt(previous);
    }
    previousVoiceSessionRef.current = activeSessionKey;
  }, [activeSessionKey]);
  useEffect(() => {
    if (officialMainSessionKey) setDefaultMainSessionKey(officialMainSessionKey);
  }, [officialMainSessionKey, setDefaultMainSessionKey]);

  // 本地标记只是缓存。进入工作台前先核验持久安装，进程就绪仍由冷启动恢复负责。
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

  // 本地完成标记只决定是否尝试恢复；进入工作台前仍由当前 OpenClaw Runtime 确认配置终态。
  useEffect(() => {
    if (setupComplete !== true || !hasTauriEventBridge()) {
      setOfficialSetupValidationPending(false);
      return;
    }
    if (cachedSetupValidationPending || !connected) return;
    let cancelled = false;
    setOfficialSetupValidationPending(true);
    const client = new OpenClawGuidedSetupClient({
      requestPrivileged: (method, params) => gateway.callPrivileged(method, params),
    });
    void resolveOpenClawSetupCapability(() => client.detect())
      .then((capability) => {
        if (cancelled) return;
        // Classic Wizard 没有全局只读完成探针。冷启动时保留先前由官方终态
        // 提交的本地证明，并由当前已认证 Gateway 连接继续约束工作台入口。
        if (capability.mode === 'classic') {
          setOfficialSetupValidationPending(false);
          return;
        }
        if (!capability.detection.setupComplete) {
          const store = useAppStore.getState();
          store.setSetupComplete(null);
          store.navigateSetup('configure-openclaw', 'replace');
          return;
        }
        setOfficialSetupValidationPending(false);
      })
      .catch(() => {
        if (cancelled) return;
        const store = useAppStore.getState();
        store.setSetupComplete(null);
        store.navigateSetup('configure-openclaw', 'replace');
      });
    return () => {
      cancelled = true;
    };
  }, [cachedSetupValidationPending, connected, setupComplete]);

  useEffect(() => {
    if (setupComplete !== true) {
      workspaceBootstrapReadinessRef.current.reset();
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
    const released = releaseWorkspaceAfterGatewayData(
      workspaceBootstrapReadinessRef.current,
      gatewayBootstrapDataReady,
    );
    if (released) {
      setWorkspaceStartupFailed(false);
      setWorkspaceDataReady(true);
    }
    if (gatewayBootstrapDataFailed) setWorkspaceStartupFailed(true);
  }, [gatewayBootstrapDataFailed, gatewayBootstrapDataReady]);

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

  const loadAgentScopedModels = useCallback(async (agentId: string) => {
    const targetAgentId = agentId.trim();
    if (!targetAgentId) return;
    const requestId = ++scopedModelCatalogRequestRef.current;
    setSessionModelsLoading(targetAgentId, true);
    try {
      const [
        { loadAgentScopedGatewayModels },
        { extractAvailableModelsFromGatewayResult },
      ] = await Promise.all([
        import('@/services/gateway/modelLoaders'),
        import('@/services/gateway/modelCatalog'),
      ]);
      const models = await loadAgentScopedGatewayModels(
        targetAgentId,
        (method, params) => gateway.call(method, params),
        extractAvailableModelsFromGatewayResult,
      );
      if (requestId === scopedModelCatalogRequestRef.current) {
        setSessionAvailableModels(targetAgentId, models);
      }
    } catch {
      if (requestId === scopedModelCatalogRequestRef.current) {
        setSessionAvailableModels(targetAgentId, []);
      }
    }
  }, [setSessionAvailableModels, setSessionModelsLoading]);

  useEffect(() => {
    if (connected && activeSessionAgentId) {
      void loadAgentScopedModels(activeSessionAgentId);
      return;
    }
    scopedModelCatalogRequestRef.current += 1;
    clearSessionAvailableModels();
  }, [activeSessionAgentId, clearSessionAvailableModels, connected, loadAgentScopedModels]);

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
      boot.markStageCompleted('config', 'Sessions ready');
      // 会话请求已经取得 OpenClaw 的权威首屏快照；智能体列表由后台轮询补齐，
      // 不得让它的独立失败阻塞工作区进入。
      markInitialWorkspaceDataReady(true);
      boot.markStageRunning('conversation', 'Warming recent conversation');
      const sessionKey = useChatStore.getState().activeSessionKey;
      if (!sessionKey) {
        boot.markStageCompleted('conversation', 'No Gateway-confirmed conversation is selected');
        return;
      }
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

  // 冷启动恢复属于生命周期状态而非渲染门禁，后台连接期间工作台仍保持可用。
  useEffect(() => {
    if (!connected || coldStartRecoveryCompletedRef.current) return;
    coldStartRecoveryCompletedRef.current = true;
    setColdStartRecoveryActive(false);
  }, [connected]);

  const addBootRecoveryLog = useCallback((line: string) => {
    debugLog('gateway', `[recovery] ${line}`);
  }, []);

  const cancelGatewayMigrationRetry = useCallback(() => {
    return gatewayLifecycle.cancelMigrationWait();
  }, []);

  const restartGatewayFromBoot = useCallback(async (diagnostic?: string, source = 'app-recovery') => {
    if (!hasTauriEventBridge()) {
      const message = 'Gateway restart is unavailable in this runtime.';
      setGatewayBootError(message);
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
      setGatewayBootError(message);
      const logs = await loadGatewayProcessLogs(80);
      setGatewayBootLogs(formatGatewayLogs(logs));
      return false;
    }
  }, [addBootRecoveryLog]);

  // 冷启动只提交一次统一恢复意图；进程核验、必要重启与认证连接均由协调器收敛。
  useEffect(() => {
    // Setup 在认证交接成功或超时前拥有该连接，此时不得启动竞争的冷恢复。
    if (shouldDeferColdGatewayRecovery(workspaceStartupMode)) return;
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
    void (async () => {
      if (useChatStore.getState().connected) return;
      addBootRecoveryLog('Starting unified Gateway recovery…');
      const result = await gatewayLifecycle.recover('app-cold-start', gatewayBootErrorRef.current ?? undefined);
      if (cancelled || result.superseded) return;
      if (result.success) {
        cancelGatewayMigrationRetry();
        addBootRecoveryLog(`Gateway recovery completed on connection ${result.connectionId ?? 'unknown'}`);
        return;
      }
      const message = result.error ?? 'Gateway recovery failed';
      addBootRecoveryLog(`Gateway recovery failed: ${message}`);
      setGatewayBootError(message);
      const logs = await loadGatewayProcessLogs(80);
      if (!cancelled) setGatewayBootLogs(formatGatewayLogs(logs));
    })();

    return () => {
      cancelled = true;
      cancelGatewayMigrationRetry();
    };
  }, [connected, coldStartRecoveryActive, cachedSetupValidationPending, openclawUpdateActive, setupComplete, workspaceStartupMode, addBootRecoveryLog, cancelGatewayMigrationRetry]);

  // ── uiScale is applied via the TopBar inverse-zoom + native
  // webview zoom (set by settingsStore.setUiScale). No CSS transform
  // or zoom on #app-root — both break fixed positioning and scroll.

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

    // GatewayConnectionManager 投影连接状态机，App 只订阅状态并同步界面。
    const managerUnsub = gatewayManager.onStateChange((snap) => {
      setConnectionStatus({ connected: snap.connected, connecting: snap.connecting, error: snap.error ?? undefined });
      setGatewayBootError(snap.error);
      gatewayBootErrorRef.current = snap.error;
      setGatewayBootLogs(snap.logs);
      setGatewayRetrying(snap.retrying);

      // selectedGatewayReady 来自所选 state/config 的认证探测；就绪后旧迁移计时器不得竞争重启。
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
        setGatewayBootError(null);
        setGatewayBootLogs(undefined);
      }
    });
    gatewayManager.init();
    // Setup 先于 App 回调拥有 socket；管理器就绪后回放状态，避免把已核验交接误判为冷启动断连。
    gateway.refreshConnectionStatus();

    // 配置与会话选择是独立领域；配置页负责重启，此监听器只刷新模型视图。
    const handleConfigSaved = () => {
      setTimeout(() => {
        void loadAvailableModels();
        const agentId = useChatStore.getState().sessions
          .find((session) => session.key === useChatStore.getState().activeSessionKey)
          ?.agentId;
        if (agentId) void loadAgentScopedModels(agentId);
      }, 1500);
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

    // 卸载时清理订阅与连接，避免重新挂载后残留孤立 WebSocket。
    return () => {
      managerUnsub();
      if (deferredModelSyncTimerRef.current) {
        clearTimeout(deferredModelSyncTimerRef.current);
        deferredModelSyncTimerRef.current = null;
      }
      window.removeEventListener('aegis:config-saved', handleConfigSaved);
      window.removeEventListener('aegis:session-reset', handleSessionReset);
      window.removeEventListener('aegis:sessions-changed', handleSessionsChanged);
      gateway.forgetSessionTranscript();
      gateway.forgetSessionViewerPresence();
      gatewayManager.destroy();
    };
  }, [addBootRecoveryLog, cachedSetupValidationPending, cancelGatewayMigrationRetry, loadAgentScopedModels, loadAvailableModels, restartGatewayFromBoot, setWorkspaceStartupMode, setupComplete, startInitialWorkspaceLoad, surfaceVerifiedGatewayHandoffFailure]);


  // 配对操作统一通过 Gateway 编排边界执行。
  const handlePairingComplete = useCallback(async (token: string) => {
    debugLog('gateway', '[App] [pairing] Pairing complete - reconnecting with new token');
    // 手工输入的是共享 token，只在当前进程用于重连；设备凭据必须由 OpenClaw
    // 握手签发并按设备凭据边界持久化，不能把两类 secret 混存。
    gatewayManager.reconnectWithToken(token);
    setPairingIssue(null);
    pairingTriggeredRef.current = false;
  }, []);

  const handlePairingApprove = useCallback(async (requestId: string) => {
    await approveSelectedGatewayDevice(requestId);
    // 所选 OpenClaw 运行时已经确认准确请求，立即唤醒原特权操作，
    // 不再等待下一次定时授权探测。
    gateway.retryPrivilegedAuthorizationNow();
  }, []);

  const handlePairingCancel = useCallback(() => {
    debugLog('gateway', '[App] Pairing cancelled by user');
    setPairingIssue(null);
    pairingTriggeredRef.current = false;
    gatewayManager.cancelPairing();
    gateway.cancelPrivilegedAuthorizationRetry();
    gateway.cancelApprovalAuthorizationRetry();
  }, []);

  const handleGatewayRetry = useCallback(async () => {
    setGatewayRetrying(true);
    const recovered = await restartGatewayFromBoot(
      gatewayBootErrorRef.current ?? undefined,
      'gateway-error-screen',
    );
    if (recovered) {
      setGatewayBootError(null);
      setGatewayBootLogs(undefined);
    }
    setGatewayRetrying(false);
  }, [restartGatewayFromBoot]);

  const handleGatewayRecovered = useCallback(async () => {
    setGatewayRetrying(true);
    await runGatewayErrorScreenRecovery({
      reconnect: () => gatewayLifecycle.reconnect('gateway-error-screen-recovered'),
      onRecovered: () => {
        setGatewayBootError(null);
        setGatewayBootLogs(undefined);
        setGatewayRetrying(false);
      },
      onFailed: (error) => {
        // 端点就绪不代表认证连接已完成，失败时保留错误页与既有日志。
        setGatewayBootError(error);
        setGatewayRetrying(false);
      },
    });
  }, []);

  if (shouldBlockWorkspaceEntry({
    setupComplete,
    installationValidationPending: cachedSetupValidationPending,
    officialSetupValidationPending,
  })) {
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
    const workspaceLoadingLabel = gatewayProgress?.status === 'running'
      ? gatewayProgress.message
      : t('app.loadingWorkspace');
    return (
      <>
        <ThemeRuntime />
        <AppLoadingFallback
          label={workspaceLoadingLabel}
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
