import { Suspense, useEffect, useCallback, useState, useRef, lazy } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/Layout/AppLayout';
import { GlobalAlertDialog } from '@/components/shared/AlertDialog';
import { SetupPage } from '@/pages/SetupPage';
import { useAppStore } from '@/stores/app-store';
import { PairingScreen } from '@/components/PairingScreen';
import { GatewayErrorScreen } from '@/components/GatewayErrorScreen';
import { ToastContainer } from '@/components/Toast/ToastContainer';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BootTimelineOverlay } from '@/components/BootTimelineOverlay';
import { useTheme } from '@/theme';

// Lazy-loaded pages
const DashboardPage = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const ChatPage = lazy(() => import('@/pages/ChatPage').then(m => ({ default: m.ChatPage })));
const WorkshopPage = lazy(() => import('@/pages/Workshop').then(m => ({ default: m.WorkshopPage })));
const FullAnalyticsPage = lazy(() => import('@/pages/FullAnalytics').then(m => ({ default: m.FullAnalyticsPage })));
const CronMonitorPage = lazy(() => import('@/pages/CronMonitor').then(m => ({ default: m.CronMonitorPage })));
const AgentHubPage = lazy(() => import('@/pages/AgentHub').then(m => ({ default: m.AgentHubPage })));
const MemoryExplorerPage = lazy(() => import('@/pages/MemoryExplorer').then(m => ({ default: m.MemoryExplorerPage })));
const SkillsPageFull = lazy(() => import('@/pages/SkillsPage').then(m => ({ default: m.SkillsPage })));
const SkillHubManagerPage = lazy(() => import('@/pages/SkillHubManager').then(m => ({ default: m.SkillHubManager })));
const TimelinePage = lazy(() => import('@/pages/TimelinePage').then(m => ({ default: m.TimelinePage })));
const WelcomePageView = lazy(() => import('@/pages/WelcomePageView').then(m => ({ default: m.default })));
const AgentRunView = lazy(() => import('@/pages/AgentRunView').then(m => ({ default: m.default })));
const WorkspaceView = lazy(() => import('@/components/Workspace/WorkspaceView').then(m => ({ default: m.WorkspaceView })));
const SessionViewPage = lazy(() => import('@/pages/SessionViewPage').then(m => ({ default: m.default })));
const TerminalPage = lazy(() => import('@/pages/TerminalPage').then(m => ({ default: m.TerminalPage })));
const SettingsPageFull = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPageFull })));
const ConfigManagerPage = lazy(() => import('@/pages/ConfigManager').then(m => ({ default: m.ConfigManagerPage })));
const SessionManagerPage = lazy(() => import('@/pages/SessionManager').then(m => ({ default: m.SessionManagerPage })));
const LogsViewerPage = lazy(() => import('@/pages/LogsViewer').then(m => ({ default: m.LogsViewerPage })));
const MultiAgentViewPage = lazy(() => import('@/pages/MultiAgentView').then(m => ({ default: m.MultiAgentViewPage })));
const FileManagerPage = lazy(() => import('@/pages/FileManager').then(m => ({ default: m.FileManagerPage })));
const CalendarPage = lazy(() => import('@/pages/Calendar'));
const CodeInterpreterPage = lazy(() => import('@/pages/CodeInterpreter').then(m => ({ default: m.CodeInterpreterPage })));
const McpToolsPage = lazy(() => import('@/pages/McpTools').then(m => ({ default: m.McpToolsPage })));
const PerformancePage = lazy(() => import('@/pages/Performance').then(m => ({ default: m.Performance })));
const KanbanPage = lazy(() => import('@/pages/Kanban').then(m => ({ default: m.Kanban })));
const GitPage = lazy(() => import('@/pages/GitPage'));
const UIShowcase = lazy(() => import('@/pages/UIShowcase'));
import { FeatureRoute } from '@/components/FeatureRoute';
import { useChatStore } from '@/stores/chatStore';
import { useBootSequenceStore } from '@/stores/bootSequenceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { gateway } from '@/services/gateway';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { ModelLoaderChain, ConfigGetLoader, FileReadLoader, AgentsSessionLoader, type ModelEntry, type ModelLoadContext } from '@/services/gateway/modelLoaders';
import { notifications } from '@/services/notifications';
import { changeLanguage } from '@/i18n';
import { usePetStateEmitter } from '@/pet/usePetStateEmitter';
import { usePomodoro } from '@/pet/usePomodoro';
import { usePetActions } from '@/pet/usePetActions';
import { usePetShortcuts } from '@/pet/usePetShortcuts';

const SESSION_MODEL_PREFS_KEY = 'aegis:session-model-prefs';

function RouteLoadingFallback() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#0c1015' }}>
      <div style={{ width: 32, height: 32, border: '2px solid rgba(14,165,233,0.3)', borderTopColor: '#0ea5e9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, fontFamily: 'system-ui,sans-serif' }}>Loading workspace...</span>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

function readSessionModelPrefs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SESSION_MODEL_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => (
        typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1].trim().length > 0
      )),
    );
  } catch {
    return {};
  }
}

function getSessionModelPref(sessionKey: string): string | null {
  const prefs = readSessionModelPrefs();
  const model = prefs[sessionKey];
  return typeof model === 'string' && model.trim().length > 0 ? model : null;
}

function setSessionModelPref(sessionKey: string, model: string | null): void {
  try {
    const prefs = readSessionModelPrefs();
    if (model && model.trim()) {
      prefs[sessionKey] = model.trim();
    } else {
      delete prefs[sessionKey];
    }
    localStorage.setItem(SESSION_MODEL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore persistence errors
  }
}

// ═══════════════════════════════════════════════════════════
// OpenClaw Desktop — Mission Control
// ═══════════════════════════════════════════════════════════

export default function App() {
  const { t } = useTranslation();
  // ── Theme: resolve setting → concrete theme, apply to <html> + native chrome,
  //         follow OS preference live when set to 'system'. All in one hook. ──
  useTheme();
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
  const [bootOverlayVisible, setBootOverlayVisible] = useState(true);
  const bootOverlayStartedAtRef = useRef(Date.now());
  const bootOverlayDismissedRef = useRef(false);

  // ── Load Sessions from Gateway (also updates per-session model/thinking/token data) ──
  // This is the single polling call for all session metadata. The store's setSessions
  // synchronously applies the active session's data to the TitleBar state — no separate
  // loadTokenUsage needed.
  const loadSessions = useCallback(async () => {
    try {
      const result = await gateway.getSessions();
      const rawSessions = Array.isArray(result?.sessions) ? result.sessions : [];
      // Gateway-level defaults (configured model, context window)
      const defaults = result?.defaults
        ? { model: result.defaults.model ?? null, contextTokens: result.defaults.contextTokens ?? null }
        : undefined;
      const sessions = rawSessions.map((s: any) => {
        const key = s.key || s.sessionKey || 'unknown';
        let label = s.label || s.name || key;
        if (key === 'agent:main:main') label = t('dashboard.mainSession');
        else if (key.startsWith('agent:main:')) label = key.split(':').pop() || key;
        const persistedModel = getSessionModelPref(key);
        const resolvedModel = s.model ?? persistedModel ?? null;
        if (typeof s.model === 'string' && s.model.trim().length > 0) {
          setSessionModelPref(key, s.model);
        }
        return {
          key, label,
          topic: typeof s.topic === 'string' ? s.topic : undefined,
          lastMessage: s.lastMessage?.content?.substring?.(0, 60),
          lastTimestamp: s.lastMessage?.timestamp || s.updatedAt,
          kind: s.kind,
          // Per-session metadata for TitleBar
          model: resolvedModel,
          thinkingLevel: s.thinkingLevel ?? null,
          totalTokens: s.totalTokens,
          contextTokens: s.contextTokens,
          compactionCount: s.compactionCount,
        };
      });
      // Always sync sessions/defaults, even when the session list is currently empty.
      // This keeps TitleBar model in sync from gateway defaults after config changes.
      setSessions(sessions, defaults);
    } catch { /* silent */ }
  }, [setSessions, t]);

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

      state.setManualModelOverride(targetModel);
      try {
        await gateway.setSessionModel(targetModel, sessionKey);
        setSessionModelPref(sessionKey, targetModel);
        setTimeout(() => void loadSessions(), 500);
      } catch (err) { console.warn('[Models] Failed to auto-select model:', err); }
    };

    // Build the chain context (shared extraction logic)
    const ctx: ModelLoadContext = {
      hasProviders: (config: any) => {
        const p = config ?? {};
        return Object.keys(p.auth?.profiles ?? {}).length > 0
            || Object.keys(p.models?.providers ?? {}).length > 0
            || Object.keys(p.env?.vars ?? {}).length > 0;
      },
      extractModels: (config: any) => {
        const modelsSection: Record<string, any> = config?.agents?.defaults?.models ?? {};
        return Object.entries(modelsSection).map(([id, cfg]: [string, any]) => ({
          id, label: id, alias: (cfg?.alias as string) || undefined,
        }));
      },
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


  // ── Desktop pet companion: open window + broadcast state (main window only) ──
  usePetStateEmitter();
  usePomodoro();
  // Pet-window interactions (single-click cycle skin, right-click menu) are
  // forwarded here via the "pet-action" event — execute them in the main window.
  usePetActions();
  usePetShortcuts();

  // ── Request notification permission (Web Notification API) ──
  useEffect(() => { notifications.requestPermission(); }, []);

  // ── Cold-start boot overlay: keep visible until WebSocket is really connected
  // and show it for a minimum duration to avoid a flash/jump effect.
  // Keep it perceptible enough for users to understand the boot steps.
  useEffect(() => {
    if (bootOverlayDismissedRef.current) return;
    if (!connected) { setBootOverlayVisible(true); return; }
    const elapsed = Date.now() - bootOverlayStartedAtRef.current;
    const delay = Math.max(0, 2800 - elapsed);
    const timer = setTimeout(() => {
      bootOverlayDismissedRef.current = true;
      setBootOverlayVisible(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [connected]);

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

  // ── Gateway Setup ──
  useEffect(() => {
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
          notifications.notify({
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
          notifications.notify({
            type: 'task_complete',
            title: t('notifications.replyComplete'),
            body: content.substring(0, 120),
          });
        }
      },
      onStatusChange: (status) => {
        setConnectionStatus(status);
        // Feed WS lifecycle events into the state machine
        if (status.connected) {
          gatewayManager.notifyWsOpen();
        } else if (!status.connecting) {
          gatewayManager.notifyWsClose();
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
        console.warn('[App] 🔑 Scope error — triggering pairing flow:', error);
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
      setGatewayRetrying(snap.retrying);
      if (snap.connected) {
        setGatewayBootError(null);
        setGatewayBootLogs(undefined);
      }
    });
    gatewayManager.init();

    // Listen for model changes → refresh session metadata (contextTokens for new model)
    const handleModelChanged = () => void loadSessions();
    window.addEventListener('aegis:model-changed', handleModelChanged);

    // Listen for config saved (e.g. from Config Manager) → refresh available models after a short delay so gateway can restart/reload
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
      gateway.disconnect();
    };
  }, [loadAvailableModels]);


  // ── Pairing Handlers ──
  const handlePairingComplete = useCallback(async (token: string) => {
    console.log('[App] 🔑 Pairing complete — reconnecting with new token');
    // Save token to config via IPC
    if (window.aegis?.pairing?.saveToken) {
      await window.aegis.pairing.saveToken(token);
    }
    // Also update config via the existing config:save IPC
    if (window.aegis?.config?.save) {
      await window.aegis.config.save({ gatewayToken: token });
    }
    // Reconnect gateway with new token
    gateway.reconnectWithToken(token);
    setNeedsPairing(false);
    pairingTriggeredRef.current = false;
  }, []);

  const handlePairingCancel = useCallback(() => {
    console.log('[App] Pairing cancelled by user');
    setNeedsPairing(false);
    pairingTriggeredRef.current = false;
    // Stop gateway pairing retry loop — user chose to dismiss
    gateway.stopPairingRetry();
  }, []);

  const handleGatewayRetry = useCallback(() => {
    if (!window.aegis?.gateway?.retry) return;
    setGatewayRetrying(true);
    void window.aegis.gateway.retry();
  }, []);

  const handleGatewayRecovered = useCallback(() => {
    setGatewayBootError(null);
    setGatewayBootLogs(undefined);
    setGatewayRetrying(false);
    // Reconnect WebSocket now that the gateway process is up
    gatewayManager.reset();
  }, []);

  const setupComplete = useAppStore((s) => s.setupComplete);

  if (!setupComplete) return <SetupPage />;

  return (
    <>
      {/* Gateway process error overlay — shown when the gateway failed to start.
          Takes priority over everything; user must recover before using the app. */}
      {gatewayBootError && (
        <GatewayErrorScreen
          error={gatewayBootError}
          logs={gatewayBootLogs}
          retrying={gatewayRetrying}
          onRetry={handleGatewayRetry}
          onRecovered={handleGatewayRecovered}
        />
      )}

      {bootOverlayVisible && !gatewayBootError && !needsPairing && <BootTimelineOverlay />}

      {/* Pairing overlay — shown when Gateway rejects due to missing scopes */}
      {needsPairing && !gatewayBootError && (
        <PairingScreen
          gatewayHttpUrl={gatewayHttpUrl}
          onPaired={handlePairingComplete}
          onCancel={handlePairingCancel}
          errorMessage={scopeError}
        />
      )}

      <HashRouter>
        {/* In-app toast notifications — always visible, above all routes */}
        <ToastContainer />
        <ErrorBoundary>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<FeatureRoute feature="dashboard"><DashboardPage /></FeatureRoute>} />
                <Route path="/chat" element={<FeatureRoute feature="chat"><ChatPage /></FeatureRoute>} />
                <Route path="/workshop" element={<FeatureRoute feature="workshop"><WorkshopPage /></FeatureRoute>} />
                <Route path="/costs" element={<FeatureRoute feature="analytics"><FullAnalyticsPage /></FeatureRoute>} />
                <Route path="/analytics" element={<FeatureRoute feature="analytics"><FullAnalyticsPage /></FeatureRoute>} />
                <Route path="/cron" element={<FeatureRoute feature="cron"><CronMonitorPage /></FeatureRoute>} />
                <Route path="/agents" element={<FeatureRoute feature="agents"><AgentHubPage /></FeatureRoute>} />
                <Route path="/skills" element={<FeatureRoute feature="skills"><SkillsPageFull /></FeatureRoute>} />
                <Route path="/skill-hub" element={<FeatureRoute feature="skills"><SkillHubManagerPage /></FeatureRoute>} />
                <Route path="/timeline" element={<FeatureRoute feature="workshop"><TimelinePage /></FeatureRoute>} />
                <Route path="/welcome" element={<FeatureRoute feature="dashboard"><WelcomePageView /></FeatureRoute>} />
                <Route path="/agent-run" element={<FeatureRoute feature="agentRun"><AgentRunView /></FeatureRoute>} />
                <Route path="/session" element={<FeatureRoute feature="dashboard"><SessionViewPage /></FeatureRoute>} />
                <Route path="/terminal" element={<FeatureRoute feature="terminal"><TerminalPage /></FeatureRoute>} />
                <Route path="/memory" element={<FeatureRoute feature="memory"><MemoryExplorerPage /></FeatureRoute>} />
                <Route path="/config" element={<FeatureRoute feature="configManager"><ConfigManagerPage /></FeatureRoute>} />
                <Route path="/sessions" element={<FeatureRoute feature="sessions"><SessionManagerPage /></FeatureRoute>} />
                <Route path="/logs" element={<FeatureRoute feature="logs"><LogsViewerPage /></FeatureRoute>} />
                <Route path="/agents/live" element={<FeatureRoute feature="liveAgents"><MultiAgentViewPage /></FeatureRoute>} />
                <Route path="/files" element={<FeatureRoute feature="files"><FileManagerPage /></FeatureRoute>} />
                <Route path="/git" element={<FeatureRoute feature="git"><GitPage /></FeatureRoute>} />
                <Route path="/calendar" element={<FeatureRoute feature="calendar"><CalendarPage /></FeatureRoute>} />
                <Route path="/sandbox" element={<FeatureRoute feature="sandbox"><CodeInterpreterPage /></FeatureRoute>} />
                <Route path="/tools" element={<FeatureRoute feature="tools"><McpToolsPage /></FeatureRoute>} />
                <Route path="/perf" element={<PerformancePage />} />
                <Route path="/kanban" element={<KanbanPage />} />
                <Route path="/ui-showcase" element={<UIShowcase />} />
                <Route path="/settings" element={<FeatureRoute feature="settings"><SettingsPageFull /></FeatureRoute>} />
              </Route>
            </Routes>
        </Suspense>
        </ErrorBoundary>
        <GlobalAlertDialog />
      </HashRouter>
    </>
  );
}
