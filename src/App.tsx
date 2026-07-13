import { Suspense, useEffect, useCallback, useState, useRef, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/app-store';
import { useTheme } from '@/theme/useTheme';
import { useAgentWorkspacePersistence } from '@/hooks/useAgentWorkspacePersistence';
import { useAgentWorkspaceTaskEvents } from '@/hooks/useAgentWorkspaceTaskEvents';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const AppRoutes = lazy(() => import('@/AppRoutes'));
const PetRuntime = lazy(() => import('@/pet/PetRuntime'));
const SetupPage = lazy(() => import('@/pages/SetupPage').then(m => ({ default: m.SetupPage })));
const PairingScreen = lazy(() => import('@/components/PairingScreen').then(m => ({ default: m.PairingScreen })));
const GatewayErrorScreen = lazy(() => import('@/components/GatewayErrorScreen').then(m => ({ default: m.GatewayErrorScreen })));
const BootTimelineOverlay = lazy(() => import('@/components/BootTimelineOverlay').then(m => ({ default: m.BootTimelineOverlay })));
const DragDropRuntime = lazy(() => import('@/runtime/DragDropRuntime'));
import { useChatStore } from '@/stores/chatStore';
import { usePetStore } from '@/stores/petStore';
import { useBootSequenceStore } from '@/stores/bootSequenceStore';
import { gateway } from '@/services/gateway';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { formatGatewayLogs } from '@/services/gateway/gatewayLogFormatting';
import type { GatewayRecoveryStatus } from '@/services/gateway/recoveryProgress';
import type { ModelEntry } from '@/services/gateway/modelLoaders';
import { changeLanguage } from '@/i18n';
import { getSessionModelPref, setSessionModelPref } from '@/utils/sessionModelPrefs';
import { migrateLegacySessionLabelsOnce } from '@/utils/sessionLabelMigration';
import { debugLog, debugWarn } from '@/utils/debugLog';
import { isGatewayOptionalPath, routePathFromLocation } from '@/utils/gatewayOptionalRoutes';

function RouteLoadingFallback() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0c1015' }}>
      <div style={{ width: 32, height: 32, border: '2px solid rgba(14,165,233,0.3)', borderTopColor: '#0ea5e9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, fontFamily: 'system-ui,sans-serif' }}>Loading workspace...</span>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

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

async function notifyLazy(options: { type: 'message' | 'task_complete' | 'info' | 'error'; title: string; body: string }) {
  const mod = await import('@/services/notifications');
  mod.notifications.notify(options);
}

async function addToastLazy(type: 'message' | 'task_complete' | 'info' | 'error', title: string, body: string) {
  const mod = await import('@/stores/notificationStore');
  mod.useNotificationStore.getState().addToast(type, title, body);
}

// ═══════════════════════════════════════════════════════════
// OpenClaw Desktop — Mission Control
// ═══════════════════════════════════════════════════════════

export default function App() {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  useAgentWorkspacePersistence(workspaces);
  useAgentWorkspaceTaskEvents();

  const {
    addMessage,
    updateStreamingMessage,
    finalizeStreamingMessage,
    setConnectionStatus,
    setIsTyping,
    incrementSessionUnread,
    markSessionCompleted,
    setSessions,
    setAvailableModels,
    setSessionModel: setLocalSessionModel,
  } = useChatStore();

  // ── Auto-Pairing State ──
  const [needsPairing, setNeedsPairing] = useState(false);
  const [scopeError, setScopeError] = useState<string>('');
  const [gatewayHttpUrl, setGatewayHttpUrl] = useState('http://127.0.0.1:18789');
  const pairingTriggeredRef = useRef(false);
  const deferredModelSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Gateway process boot error state ──
  // Tracks whether the gateway *process* failed to start (distinct from WebSocket connection issues).
  // When set, the GatewayErrorScreen overlay is shown so users can diagnose and recover.
  const [gatewayBootError, setGatewayBootError] = useState<string | null>(null);
  const [gatewayBootLogs, setGatewayBootLogs] = useState<{ stdout: string; stderr: string } | undefined>();
  const [gatewayRetrying, setGatewayRetrying] = useState(false);
  const connected = useChatStore((s) => s.connected);
  const setupComplete = useAppStore((s) => s.setupComplete);
  const [routePath, setRoutePath] = useState(() => routePathFromLocation(window.location));
  const gatewayOptionalRoute = isGatewayOptionalPath(routePath);
  const [bootOverlayVisible, setBootOverlayVisible] = useState(true);
  const bootOverlayStartedAtRef = useRef(Date.now());
  const bootOverlayDismissedRef = useRef(false);
  const lastGatewayToastKeyRef = useRef<string | null>(null);
  const lastGatewayErrorToastRef = useRef<string | null>(null);
  const bootRecoveryStartedRef = useRef(false);
  const manualGatewayRecoveryInFlightRef = useRef(false);
  const openControlUiAfterRecoveryRef = useRef(false);
  const [bootRecoveryAttempt, setBootRecoveryAttempt] = useState(0);
  const [bootRecoveryReady, setBootRecoveryReady] = useState(false);
  const [bootRecoveryRestarting, setBootRecoveryRestarting] = useState(false);
  const [bootRecoveryLogs, setBootRecoveryLogs] = useState<string[]>([]);

  useEffect(() => {
    const updateRoutePath = () => setRoutePath(routePathFromLocation(window.location));
    window.addEventListener('hashchange', updateRoutePath);
    window.addEventListener('popstate', updateRoutePath);
    return () => {
      window.removeEventListener('hashchange', updateRoutePath);
      window.removeEventListener('popstate', updateRoutePath);
    };
  }, []);

  // ── Load Sessions from Gateway (also updates per-session model/thinking/token data) ──
  // This is the single polling call for all session metadata. The store's setSessions
  // synchronously applies the active session's data to the TitleBar state — no separate
  // loadTokenUsage needed.
  const loadSessions = useCallback(async () => {
    try {
      // Compatibility only: prior Desktop builds wrote labels to a local JSON
      // file. Copy confirmed entries to OpenClaw before this read, then let
      // Gateway labels remain the sole source of truth.
      await migrateLegacySessionLabelsOnce();
      const result = await gateway.getSessions();
      const rawSessions = Array.isArray(result?.sessions) ? result.sessions : [];
      // Gateway-level defaults (configured model, context window)
      const defaults = result?.defaults
        ? { model: result.defaults.model ?? null, contextTokens: result.defaults.contextTokens ?? null }
        : undefined;
      const sessions = rawSessions.map((s: any) => {
        const key = s.key || s.sessionKey || 'unknown';
        const persistedModel = getSessionModelPref(key);
        const resolvedModel = s.model ?? persistedModel ?? null;
        if (typeof s.model === 'string' && s.model.trim().length > 0) {
          setSessionModelPref(key, s.model);
        }
        return {
          key,
          label: typeof s.label === 'string'
            ? s.label
            : (typeof s.name === 'string' ? s.name : ''),
          topic: typeof s.topic === 'string' ? s.topic : undefined,
          lastMessage: s.lastMessage?.content?.substring?.(0, 60),
          lastTimestamp: s.lastMessage?.timestamp || s.updatedAt,
          kind: s.kind,
          channel: typeof s.channel === 'string' ? s.channel : (typeof s.lastChannel === 'string' ? s.lastChannel : null),
          lastChannel: typeof s.lastChannel === 'string' ? s.lastChannel : null,
          // Per-session metadata for TitleBar
          model: resolvedModel,
          thinkingLevel: s.thinkingLevel ?? null,
          totalTokens: s.totalTokens,
          contextTokens: s.contextTokens,
          compactionCount: s.compactionCount,
          running: s.running ?? false,
        };
      });
      // Always sync sessions/defaults, even when the session list is currently empty.
      // This keeps TitleBar model in sync from gateway defaults after config changes.
      setSessions(sessions, defaults);
    } catch { /* silent */ }
  }, [setSessions]);

  // ── Load Available Models from Gateway ──
  // Uses Chain of Responsibility: config.get(WS) → openclaw.json(file) → agents+sessions.
  // Each strategy returns models or null (delegate to next).
  const loadAvailableModels = useCallback(async () => {
    const applyModels = async (models: ModelEntry[]) => {
      const state = useChatStore.getState();
      const sessionKey = state.activeSessionKey || 'agent:main:main';
      const activeSession = state.sessions.find((s) => s.key === sessionKey);
      const persistedModel = activeSession?.model ?? getSessionModelPref(sessionKey) ?? state.currentModel;
      const persistedStillAvailable = persistedModel ? models.some((m) => m.id === persistedModel) : false;

      setAvailableModels(models);

      const shouldAutoSelect = models.length > 0 && (!persistedModel || (!!persistedModel && !persistedStillAvailable));
      if (!shouldAutoSelect) return;
      const targetModel = persistedStillAvailable ? persistedModel! : models[0].id;
      if (targetModel === persistedModel) return;

      try {
        await gateway.setSessionModel(targetModel, sessionKey);
        state.setSessionModel(sessionKey, targetModel);
        state.setManualModelOverride(targetModel);
        setSessionModelPref(sessionKey, targetModel);
        setTimeout(() => void loadSessions(), 500);
      } catch (err) { debugWarn('models', '[Models] Failed to auto-select model:', err); }
    };

    const [
      { ModelLoaderChain, ConfigGetLoader, FileReadLoader, AgentsSessionLoader },
      { extractAvailableModelsFromConfig, hasConfiguredModelProviders },
    ] = await Promise.all([
      import('@/services/gateway/modelLoaders'),
      import('@/services/gateway/modelCatalog'),
    ]);

    const ctx = {
      hasProviders: hasConfiguredModelProviders,
      extractModels: extractAvailableModelsFromConfig,
    };

    // Chain: WS config.get → file read → agents+sessions
    const chain = new ModelLoaderChain([
      new ConfigGetLoader((m, p) => gateway.call(m, p)),
      new FileReadLoader(async () => {
        if (!window.aegis?.config?.read) return null;
        const { data } = await window.aegis.config.read('');
        return { data };
      }),
      new AgentsSessionLoader(() => gateway.getSessions(), () => gateway.getAgents()),
    ]);

    const models = await chain.load(ctx);
    try {
      if (window.aegis?.config?.read) {
        const { data } = await window.aegis.config.read('');
        const profiles = Object.keys(data?.auth?.profiles ?? {}).length;
        const providers = Object.keys(data?.models?.providers ?? {}).length;
        const modelDefs = Object.keys(data?.agents?.defaults?.models ?? {}).length;
        localStorage.setItem('aegis-provider-health', JSON.stringify({ profiles, providers, modelDefs, loadedModels: models.length }));
      }
    } catch {}
    await applyModels(models);
  }, [setAvailableModels, loadSessions]);

  // ── Request notification permission (Web Notification API) ──
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void import('@/services/notifications').then((mod) => mod.notifications.requestPermission());
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  // ── Cold-start boot overlay: keep visible until WebSocket is really connected
  // and show it for a minimum duration to avoid a flash/jump effect.
  // Close boot overlay as soon as we're connected. A minimum 2s display prevents
  // a jarring flash for fast local boots — the previous 4s was too long when
  // users were waiting through a real failure and caused the 'still connecting'
  // perception. The ref guard prevents re-opening on transient disconnects.
  useEffect(() => {
    if (bootOverlayDismissedRef.current) return;
    if (!connected) { setBootOverlayVisible(true); return; }
    const elapsed = Date.now() - bootOverlayStartedAtRef.current;
    const delay = Math.max(0, 2000 - elapsed);
    const timer = setTimeout(() => {
      bootOverlayDismissedRef.current = true;
      setBootOverlayVisible(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [connected]);

  const addBootRecoveryLog = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString();
    setBootRecoveryLogs((prev) => [...prev.slice(-24), `[${ts}] ${line}`]);
  }, []);

  /**
   * Emit a step="gateway" setup-progress event for StatusBar (and any
   * other listener) to consume. Same shape Rust emits via setup-progress,
   * just synthesized in-process so non-install flows (manual reconnect,
   * boot recovery) still show granular progress text inline.
   */
  const emitGatewayProgress = useCallback((
    message: string,
    progress: number,
    key?: string,
    params?: Record<string, unknown>,
    status: GatewayRecoveryStatus = 'running',
  ) => {
    window.dispatchEvent(new CustomEvent('aegis:gateway-progress', {
      detail: { step: 'gateway', message, progress, key, params, status },
    }));
  }, []);

  const triggerGatewayReconnect = useCallback((label = 'manual', minimumProgress = 0.30) => {
    addBootRecoveryLog(`Reconnect requested (${label})`);
    setBootRecoveryAttempt(0);
    setBootRecoveryReady(false);
    const reconnectProgress = Math.min(0.96, Math.max(0.30, minimumProgress));
    const syncingProgress = Math.min(0.98, Math.max(0.65, reconnectProgress + 0.03));
    emitGatewayProgress('Reconnecting to OpenClaw Gateway…', reconnectProgress, 'gateway.progress.reconnect');
    // Allow the auto-recovery effect to re-arm if the user clicks "reconnect"
    // stays true after the first recovery attempt and blocks all subsequent retries.
    bootRecoveryStartedRef.current = false;
    emitGatewayProgress('Detecting, connecting, and syncing runtime state…', syncingProgress, 'gateway.progress.detectConnectSync');
    // Use reconnect() instead of reset() — triggers an immediate status probe
    // so we don't wait up to 2s for the periodic poller to drive the FSM.
    try { gatewayManager.reconnect(); } catch {}
  }, [addBootRecoveryLog, emitGatewayProgress]);

  const restartGatewayFromBoot = useCallback(async () => {
    if (!window.aegis?.gateway?.retry) {
      const message = 'Gateway restart is unavailable in this runtime.';
      emitGatewayProgress(message, 1, 'gateway.progress.restartUnavailable', undefined, 'failed');
      setGatewayBootError(message);
      openControlUiAfterRecoveryRef.current = false;
      return false;
    }
    setBootRecoveryRestarting(true);
    setBootRecoveryReady(true);
    addBootRecoveryLog('Restarting Gateway service…');
    emitGatewayProgress('Restarting OpenClaw Gateway…', 0.15, 'gateway.progress.restart');
    try {
      const result = await gatewayManager.restart();
      if (result?.superseded) return false;
      if (result?.success === false) {
        throw new Error(result.error || 'Gateway restart failed');
      }
      addBootRecoveryLog('Gateway restart command completed');
      emitGatewayProgress('Gateway service restarted, reconnecting…', 0.94, 'gateway.progress.restartDone');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addBootRecoveryLog(`Gateway restart failed: ${message}`);
      emitGatewayProgress(
        `Restart failed: ${message}`,
        1.0,
        'gateway.progress.restartFailed',
        { error: message },
        'failed',
      );
      setGatewayBootError(message);
      openControlUiAfterRecoveryRef.current = false;
      const logs = await window.aegis.gateway.getLogs?.(80);
      if (logs) {
        setGatewayBootLogs(formatGatewayLogs(logs));
      }
      return false;
    } finally {
      setBootRecoveryRestarting(false);
    }
  }, [addBootRecoveryLog, emitGatewayProgress]);

  const openBootLogs = useCallback(() => {
    try { window.location.hash = '#/logs'; } catch {}
  }, []);

  // During boot, separate two different failures:
  // 1. Gateway process is running, but the WebSocket handshake is late.
  // 2. Gateway process is not running, so WebSocket retries cannot succeed.
  // The second case starts recovery immediately instead of waiting through
  // handshake retry timers.
  useEffect(() => {
    if (setupComplete !== true) return;
    if (connected) {
      bootRecoveryStartedRef.current = false;
      setBootRecoveryAttempt(0);
      setBootRecoveryReady(false);
      setBootRecoveryRestarting(false);
      return;
    }
    if (!bootOverlayVisible || bootOverlayDismissedRef.current || bootRecoveryStartedRef.current) return;
    if (!window.aegis?.gateway?.retry) return; // not under Tauri — nothing to restart
    bootRecoveryStartedRef.current = true;
    setBootRecoveryLogs([]);

    let cancelled = false;
    const startGatewayRecovery = async (reason: string) => {
      setBootRecoveryAttempt(0);
      setBootRecoveryReady(false);
      setBootRecoveryRestarting(true);
      addBootRecoveryLog(`Starting Gateway recovery immediately (${reason})…`);
      emitGatewayProgress('Starting OpenClaw Gateway…', 0.20, 'gateway.progress.starting');
      try {
        const result = await gatewayManager.ensureRunning();
        if (cancelled || useChatStore.getState().connected) return;
        if (result?.superseded) return;
        if (result?.healthy) {
          addBootRecoveryLog(`Gateway healthy (${result.mode ?? 'native'}); reconnecting WebSocket`);
          emitGatewayProgress(
            `Gateway healthy (${result.mode ?? 'native'}), reconnecting…`,
            0.75,
            'gateway.progress.gatewayHealthy',
          );
          return;
        }
        addBootRecoveryLog(`ensure_gateway_running returned unhealthy: ${result?.error ?? 'unknown error'}`);
        emitGatewayProgress(
          'Gateway did not become healthy, attempting restart…',
          0.45,
          'gateway.progress.ensureUnhealthy',
        );
        await restartGatewayFromBoot();
      } catch (err) {
        if (cancelled || useChatStore.getState().connected) return;
        addBootRecoveryLog(`ensure_gateway_running exception: ${String(err)}`);
        emitGatewayProgress('Gateway recovery failed, attempting restart…', 0.45, 'gateway.progress.ensureFailed');
        await restartGatewayFromBoot();
      } finally {
        if (!cancelled) setBootRecoveryRestarting(false);
      }
    };

    void (async () => {
      if (useChatStore.getState().connected) return;
      addBootRecoveryLog('Checking local Gateway status before recovery…');
      try {
        const status = await window.aegis?.gateway?.getStatus?.();
        if (cancelled || useChatStore.getState().connected) return;
        if (status?.running && !status.error) {
          addBootRecoveryLog('Gateway process is running; reconnecting WebSocket quietly…');
          emitGatewayProgress(
            'Gateway process is running, reconnecting…',
            0.72,
            'gateway.progress.gatewayHealthy',
          );
          try { gatewayManager.reconnect(); } catch {}
          return;
        }
        addBootRecoveryLog(`Gateway status is not ready: ${status?.error ?? 'not running'}`);
        await startGatewayRecovery(status?.error ?? 'not running');
        return;
      } catch (err) {
        if (cancelled || useChatStore.getState().connected) return;
        addBootRecoveryLog(`Gateway status check failed: ${String(err)}`);
      }
      await startGatewayRecovery('status check failed');
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, bootOverlayVisible, setupComplete, addBootRecoveryLog, emitGatewayProgress, restartGatewayFromBoot]);

  // ── uiScale is applied via the TopBar inverse-zoom + native
  // webview zoom (set by settingsStore.setUiScale). No CSS transform
  // or zoom on #app-root — both break fixed positioning and scroll.

  // ── Auto-drain the message queue when an AI reply completes ──
  // Fires once per response (on the typing true→false transition) for any session,
  // covering both streaming (finalizeStreamingMessage) and non-streaming (onMessage)
  // completion paths — both set typingBySession[key]=false. drainQueue re-arms typing
  // so the next completion drains the next item, until the queue is empty.
  useEffect(() => {
    return useChatStore.subscribe((state, prev) => {
      const cur = state.typingBySession;
      const old = prev.typingBySession;
      if (cur === old) return;
      for (const key of Object.keys(cur)) {
        if (cur[key] === false && old[key] === true && (state.messageQueue[key] || []).length > 0) {
          void useChatStore.getState().drainQueue(key);
        }
      }
    });
  }, []);

  useEffect(() => {
    const handleSessionInactive = (event: Event) => {
      const sessionKey = (event as CustomEvent<{ sessionKey?: string }>).detail?.sessionKey;
      if (!sessionKey) return;
      useChatStore.getState().setIsTyping(false, sessionKey);
    };
    window.addEventListener('aegis:session-inactive', handleSessionInactive);
    return () => window.removeEventListener('aegis:session-inactive', handleSessionInactive);
  }, []);

  // ── Gateway Setup ──
  useEffect(() => {
    if (setupComplete !== true) return;

    gateway.setCallbacks({
      onMessage: (msg) => {
        const rawSk = (msg as { sessionKey?: string }).sessionKey;
        const sessionKey =
          typeof rawSk === 'string' && rawSk.trim() ? rawSk : useChatStore.getState().activeSessionKey;
        const { activeSessionKey: currentSessionKey } = useChatStore.getState();
        addMessage(msg, sessionKey);
        if (sessionKey !== currentSessionKey) {
          incrementSessionUnread(sessionKey);
        }
        // Notify when app is minimized/background OR user is on a different page
        const isOnChat = window.location.hash === '#/chat' || window.location.hash.startsWith('#/chat?');
        if (!document.hasFocus() || !isOnChat) {
          void notifyLazy({
            type: 'message',
            title: t('notifications.newMessage'),
            body: msg.content.substring(0, 120),
          });
        }
      },
      onStreamChunk: (sessionKey, messageId, content, media, runId) => {
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
        setIsTyping(false, sessionKey);
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
        const { activeSessionKey: currentSessionKey, historyLoader } = useChatStore.getState();
        if (sessionKey !== currentSessionKey) {
          markSessionCompleted(sessionKey);
        }
        if (meta?.refreshHistory && historyLoader) {
          void historyLoader(sessionKey === currentSessionKey ? undefined : sessionKey, {
            force: true,
            background: sessionKey !== currentSessionKey,
          });
        }
        // Refresh session metadata (token usage, model) after a stream completes.
        void loadSessions();
        // Notify (sound + toast) when app is minimized/background OR user is on a different page
        const isOnChat = window.location.hash === '#/chat' || window.location.hash.startsWith('#/chat?');
        if (!document.hasFocus() || !isOnChat) {
          void notifyLazy({
            type: 'task_complete',
            title: t('notifications.replyComplete'),
            body: content.substring(0, 120),
          });
        }
      },
      onRetryState: (retry) => {
        if (bootOverlayDismissedRef.current) return;
        if (retry.phase === 'attempting') {
          setBootRecoveryAttempt(retry.attempt);
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
          setBootRecoveryAttempt(retry.maxAttempts);
          setBootRecoveryReady(true);
          addBootRecoveryLog(`All ${retry.maxAttempts} connection attempts failed; self-rescue is ready`);
        }
      },
      onStatusChange: (status) => {
        setConnectionStatus(status);
        // Feed WS lifecycle events into the state machine
        if (status.connected) {
          gatewayManager.notifyWsOpen();
        } else if (!status.connecting) {
          gatewayManager.notifyWsClose();
          // Clear all per-session active flags on disconnect so the pet does not
          // stay "working/typing/thinking" indefinitely if the stream was cut off
          // before onStreamEnd fired (network drop, gateway crash, etc.).
          const cs = useChatStore.getState();
          const typingKeys = Object.keys(cs.typingBySession).filter((k) => cs.typingBySession[k]);
          typingKeys.forEach((k) => cs.setIsTyping(false, k));
          const thinkingKeys = Object.keys(cs.thinkingBySession).filter(
            (k) => (cs.thinkingBySession[k]?.text?.length ?? 0) > 0,
          );
          thinkingKeys.forEach((k) => cs.clearThinking(k));
          if (typingKeys.length || thinkingKeys.length) {
            debugLog('app', '[App] 🧹 Cleared stale typing/thinking on disconnect');
          }
        }
        if (status.connected) {
          // Successfully connected — dismiss pairing screen if showing
          if (needsPairing) {
            setNeedsPairing(false);
            pairingTriggeredRef.current = false;
          }
          const boot = useBootSequenceStore.getState();
          boot.markStageCompleted('connection', 'WebSocket handshake complete');
          boot.markStageRunning('config', 'Loading sessions');
          void loadSessions().then(() => {
            boot.markStageCompleted('config', 'Sessions ready');
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
              const errText = String(err);
              const isHistoryUnavailableDuringStartup =
                /chat\.history/i.test(errText) &&
                /(unavailable|not available|not ready|warming|startup)/i.test(errText);
              if (isHistoryUnavailableDuringStartup || errText.includes('Request timeout')) {
                useBootSequenceStore.getState().markStageCompleted(
                  'conversation',
                  'Recent conversation is syncing in the background.',
                );
                return;
              }
              useBootSequenceStore.getState().markStageCompleted(
                'conversation',
                'Recent conversation will load after startup.',
              );
            });

            boot.markStageRunning('background', 'Models will sync in the background');
            if (deferredModelSyncTimerRef.current) {
              clearTimeout(deferredModelSyncTimerRef.current);
            }
            deferredModelSyncTimerRef.current = setTimeout(() => {
              deferredModelSyncTimerRef.current = null;
              void loadAvailableModels().finally(() => {
                useBootSequenceStore.getState().markStageCompleted('background', 'Models synced');
              });
            }, 1_500);
          }).catch(() => {
            boot.markStageError('config', 'Session load failed');
          });
        }
      },
      onScopeError: (error) => {
        debugWarn('app', '[App] 🔑 Scope error — triggering pairing flow:', error);
        // Only trigger pairing once per connection attempt
        if (!pairingTriggeredRef.current) {
          pairingTriggeredRef.current = true;
          setScopeError(error);
          setNeedsPairing(true);
        }
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
      setGatewayBootLogs(snap.logs);
      if (snap.logs?.stdout || snap.logs?.stderr) {
        const incoming = [snap.logs.stdout, snap.logs.stderr]
          .filter(Boolean)
          .flatMap((block) => block.split('\n'))
          .filter(Boolean);
        setBootRecoveryLogs((prev) => {
          const seen = new Set(prev);
          return [...prev, ...incoming.filter((line) => !seen.has(line))].slice(-80);
        });
      }
      setGatewayRetrying(snap.retrying);

      const toastKey = `${snap.state}|${snap.connected}|${snap.connecting}|${snap.retrying}|${snap.error ?? ''}`;
      const previousToastKey = lastGatewayToastKeyRef.current;
      const previousError = lastGatewayErrorToastRef.current;
      lastGatewayToastKeyRef.current = toastKey;
      // Normal reconnect/connecting/connected transitions are too noisy.
      // Notify only when a real error appears, and once when that error recovers.
      if (bootOverlayDismissedRef.current) {
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
        if (openControlUiAfterRecoveryRef.current) {
          openControlUiAfterRecoveryRef.current = false;
          const openingControlUi = window.aegis?.consoleUi?.open();
          if (openingControlUi) {
            void openingControlUi.then((result) => {
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
      }
    });
    gatewayManager.init();

    // Listen for model changes → refresh session metadata (contextTokens for new model)
    const handleModelChanged = () => void loadSessions();
    window.addEventListener('aegis:model-changed', handleModelChanged);

    // Listen for config saved (e.g. from Config Manager) → refresh available
    // models after a short delay so the gateway can restart/reload. When the
    // user switched Provider (env vars / base URL / models.providers), the
    // existing WebSocket is still using the old auth material — disconnect
    // and let ensureRunning re-handshake so the new credentials take effect.
    const handleConfigSaved = (event: Event) => {
      const detail = (event as CustomEvent)?.detail ?? {};
      const primaryModel = detail.primaryModel;
      const providerChanged = detail.providerChanged === true;
      if (typeof primaryModel === 'string' && primaryModel.trim()) {
        const st = useChatStore.getState();
        const key = st.activeSessionKey || 'agent:main:main';
        const model = primaryModel.trim();
        void gateway.setSessionModel(model, key)
          .then(() => {
            st.setManualModelOverride(model);
            setLocalSessionModel(key, model);
            setSessionModelPref(key, model);
          })
          .catch((err) => {
            debugWarn('models', '[Models] Failed to apply saved primary model to active session:', err);
          });
      }
      if (providerChanged) {
        void gatewayManager.ensureRunning()
          .catch(() => { /* handled by status poller */ });
      }
      setTimeout(() => loadAvailableModels(), 1500);
    };
    window.addEventListener('aegis:config-saved', handleConfigSaved);

    // Listen for session reset → re-fetch sessions so token counts reflect cleared state
    const handleSessionReset = () => {
      // Short delay to allow gateway to complete the reset before we poll
      setTimeout(() => void loadSessions(), 400);
    };
    window.addEventListener('aegis:session-reset', handleSessionReset);

    const handleSessionsChanged = () => {
      setTimeout(() => void loadSessions(), 250);
    };
    window.addEventListener('aegis:sessions-changed', handleSessionsChanged);

    // Every visible recovery entry point dispatches this event. App owns the
    // process lifecycle so the OfflineOverlay and StatusBar cannot race each
    // other with separate ensure/restart sequences.
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
          if (action === 'restart') {
            await restartGatewayFromBoot();
            return;
          }

          emitGatewayProgress('Reconnecting to OpenClaw Gateway…', 0.10, 'gateway.progress.reconnect');
          emitGatewayProgress('Detecting, connecting, and syncing runtime state…', 0.45, 'gateway.progress.detectConnectSync');
          const result = await gatewayManager.ensureRunning();
          if (result?.superseded) return;
          addBootRecoveryLog(result?.healthy
            ? `Gateway healthy (${result.mode ?? 'native'}) — reconnecting`
            : 'ensure_gateway_running returned unhealthy — restarting');
          emitGatewayProgress(
            result?.healthy
              ? `Gateway healthy (${result.mode ?? 'native'}), reconnecting…`
              : 'ensure_gateway_running status abnormal, restarting…',
            result?.healthy ? 0.75 : 0.45,
            result?.healthy ? 'gateway.progress.gatewayHealthy' : 'gateway.progress.ensureUnhealthy',
          );
          if (!result?.healthy) {
            await restartGatewayFromBoot();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          addBootRecoveryLog(`ensure_gateway_running failed: ${message}`);
          emitGatewayProgress('ensure_gateway_running call failed, restarting…', 0.45, 'gateway.progress.ensureFailed');
          await restartGatewayFromBoot();
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
      window.removeEventListener('aegis:model-changed', handleModelChanged);
      window.removeEventListener('aegis:config-saved', handleConfigSaved);
      window.removeEventListener('aegis:session-reset', handleSessionReset);
      window.removeEventListener('aegis:sessions-changed', handleSessionsChanged);
      window.removeEventListener('aegis:manual-reconnect', handleManualReconnect);
      gatewayManager.destroy();
    };
  }, [loadAvailableModels, setupComplete, restartGatewayFromBoot, emitGatewayProgress, addBootRecoveryLog, triggerGatewayReconnect]);


  // ── Pairing Handlers ──
  const handlePairingComplete = useCallback(async (token: string) => {
    debugLog('gateway', '[App] 🔑 Pairing complete — reconnecting with new token');
    // Save token to config via IPC
    if (window.aegis?.pairing?.saveToken) {
      await window.aegis.pairing.saveToken(token);
    }
    // Also update config via the existing config:save IPC
    if (window.aegis?.config?.save) {
      await window.aegis.config.save({ gatewayToken: token });
    }
    // Reconnect gateway with new token
    gatewayManager.reconnectWithToken(token);
    setNeedsPairing(false);
    pairingTriggeredRef.current = false;
  }, []);

  const handlePairingCancel = useCallback(() => {
    debugLog('gateway', '[App] Pairing cancelled by user');
    setNeedsPairing(false);
    pairingTriggeredRef.current = false;
    // Stop gateway pairing retry loop — user chose to dismiss
    gateway.stopPairingRetry();
  }, []);

  const handleGatewayRetry = useCallback(() => {
    setGatewayRetrying(true);
    void gatewayManager.restart();
  }, []);

  const handleGatewayRecovered = useCallback(() => {
    setGatewayBootError(null);
    setGatewayBootLogs(undefined);
    setGatewayRetrying(false);
    // Probe immediately instead of waiting for the periodic poller
    gatewayManager.reconnect();
  }, []);

  if (!setupComplete) {
    return (
      <>
        <ThemeRuntime />
        <LazyPetRuntimeHost />
        <Suspense fallback={<RouteLoadingFallback />}>
          <SetupPage />
        </Suspense>
      </>
    );
  }

  return (
    <>
      <ThemeRuntime />
      <LazyPetRuntimeHost />

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

      {bootOverlayVisible && !gatewayOptionalRoute && !gatewayBootError && !needsPairing && (
        <Suspense fallback={null}>
          <BootTimelineOverlay
            recovery={{
              attempt: bootRecoveryAttempt,
              showRestart: bootRecoveryReady,
              restarting: bootRecoveryRestarting,
              logs: bootRecoveryLogs,
              onReconnect: () => triggerGatewayReconnect('button'),
              onRestart: () => void restartGatewayFromBoot(),
              onOpenLogs: openBootLogs,
            }}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <DragDropRuntime />
      </Suspense>

      {/* Pairing overlay — shown when Gateway rejects due to missing scopes */}
      {needsPairing && !gatewayOptionalRoute && !gatewayBootError && (
        <Suspense fallback={null}>
          <PairingScreen
            gatewayHttpUrl={gatewayHttpUrl}
            onPaired={handlePairingComplete}
            onCancel={handlePairingCancel}
            errorMessage={scopeError}
          />
        </Suspense>
      )}

      <Suspense fallback={<RouteLoadingFallback />}>
        <AppRoutes />
      </Suspense>
    </>
  );
}
