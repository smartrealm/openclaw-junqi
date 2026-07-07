import { Suspense, useEffect, useCallback, useState, useRef, lazy } from 'react';
import { AnimatePresence } from 'framer-motion';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
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
import { playPetSfx } from '@/pet/petSounds';

// Lazy-loaded pages
const DashboardPage = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const ChatPage = lazy(() => import('@/pages/ChatPage').then(m => ({ default: m.ChatPage })));
const QuickChatPage = lazy(() => import('@/pages/QuickChatPage').then(m => ({ default: m.QuickChatPage })));
const WorkshopPage = lazy(() => import('@/pages/Workshop').then(m => ({ default: m.WorkshopPage })));
const FullAnalyticsPage = lazy(() => import('@/pages/FullAnalytics').then(m => ({ default: m.FullAnalyticsPage })));
const CronMonitorPage = lazy(() => import('@/pages/CronMonitor').then(m => ({ default: m.CronMonitorPage })));
const AgentHubPage = lazy(() => import('@/pages/AgentHub').then(m => ({ default: m.AgentHubPage })));
const ChannelsCenterPage = lazy(() => import('@/pages/ChannelsCenter').then(m => ({ default: m.ChannelsCenterPage })));
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
import { useChatStore, primeSessionLabelCache, getSessionLabelPref } from '@/stores/chatStore';
import { usePetStore } from '@/stores/petStore';
import { useBootSequenceStore } from '@/stores/bootSequenceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { gateway } from '@/services/gateway';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { ModelLoaderChain, ConfigGetLoader, FileReadLoader, AgentsSessionLoader, type ModelEntry, type ModelLoadContext } from '@/services/gateway/modelLoaders';
import { notifications } from '@/services/notifications';
import { useNotificationStore } from '@/stores/notificationStore';
import { changeLanguage } from '@/i18n';
import { usePetStateEmitter } from '@/pet/usePetStateEmitter';
import { usePomodoro } from '@/pet/usePomodoro';
import { usePetActions } from '@/pet/usePetActions';
import { usePetShortcuts } from '@/pet/usePetShortcuts';
import { combineUnlisteners, subscribeTauriEvent } from '@/utils/tauriEvents';

const SESSION_MODEL_PREFS_KEY = 'aegis:session-model-prefs';
// User-renamed session labels live in localStorage under
// 'aegis:session-label-prefs'. The chatStore reads them at sessions.list
// merge time so renames survive an app restart even when the openclaw
// gateway has discarded the `label` field. Writer: src/utils/sessionRename.ts.

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

  // Prime the session-label override cache from disk before the first
  // Eagerly prime the persisted label cache so any subsequent
  // setSessions merge can see user renames. The prime is fire-and-forget
  // — the merge logic in chatStore safely falls through to the server
  // label when the cache hasn't loaded yet, and any later setSessions
  // call picks up the override once the prime resolves.
  useEffect(() => {
    void primeSessionLabelCache();
  }, []);

  // ── Global drag-drop bridge ────────────────────────────────────────────
  // Rust forwards OS drag-drop events from any webview as `aegis:file-dropped`.
  // We spawn a compact QuickChatWindow seeded with those paths, then ping
  // the pet so it plays the "swallow" emotion — closes the loop on the
  // "drop file → pet eats it → standalone chat opens" interaction.
  const [draggingOver, setDraggingOver] = useState(false);
  const [draggedPaths, setDraggedPaths] = useState<string[]>([]);
  // Hold the stop() handle for the sustained "drag hum" so we can cancel it
  // when the user leaves the window or releases the payload.
  const dragSfxStop = useRef<null | (() => void)>(null);
  useEffect(() => {
    const unlisten = combineUnlisteners([
      subscribeTauriEvent<string[]>('aegis:file-dropped', async (e) => {
        console.log('[aegis] file-dropped', e.payload);
        const paths = e.payload ?? [];
        if (paths.length === 0) return;
        // Spawn a brand-new chat session scoped to the main agent, attach
        // the dropped paths as the initial context, then navigate. The pet
        // swallows the payload visually; ChatPage drains pendingFiles on
        // mount and renders them as the first user-message attachment.
        const cs = useChatStore.getState();
        const newKey = `agent:main:s-${Date.now().toString(36).slice(-5)}`;
        cs.addLocalSession({
          key: newKey,
          label: paths.length === 1
            ? `📎 ${paths[0].split(/[\\/]/).pop()}`
            : `📎 ${paths.length} 个文件`,
          agentId: 'main',
          createdAt: Date.now(),
        } as any);
        cs.setActiveSession(newKey);
        cs.setPendingFiles(paths);
        // Notify ChatPage (if mounted) so the attachment bar updates immediately.
        window.dispatchEvent(new CustomEvent('aegis:files-dropped', { detail: { paths, sessionKey: newKey } }));
        // Navigate to the chat route — the new session becomes the active tab.
        // Using replaceState keeps the browser back stack clean.
        const url = new URL(window.location.href);
        url.hash = `#/chat?session=${encodeURIComponent(newKey)}`;
        window.history.replaceState({}, '', url.toString());
        // Trigger a soft re-render of the router by dispatching popstate —
        // HashRouter listens for this and re-evaluates the route.
        window.dispatchEvent(new PopStateEvent('popstate'));
        // Cancel the drag pad (if still playing) before the drop click.
        dragSfxStop.current?.();
        dragSfxStop.current = null;
        const soundOn = useSettingsStore.getState().soundEnabled;
        playPetSfx('drop', soundOn);
        playPetSfx('munch', soundOn);
        // Pet reaction.
        window.dispatchEvent(new CustomEvent('aegis:pet-swallow', {
          detail: { count: paths.length },
        }));
        usePetStore.getState().bumpSwallowTick();
        usePetStore.getState().setDragActive(false);
        setDraggingOver(false);
      }),
      subscribeTauriEvent<string[]>('aegis:drag-active', (e) => {
        console.log('[aegis] drag-active', e.payload);
        const paths = e.payload ?? [];
        setDraggingOver(true);
        setDraggedPaths(paths);
        usePetStore.getState().setDragActive(true, paths);
        // Start the sustained "hum" while the user is hovering with a payload.
        // playPetSfx returns a stop() handle we keep so leave/inactive can
        // tear it down cleanly.
        dragSfxStop.current?.();
        dragSfxStop.current = playPetSfx('drag', useSettingsStore.getState().soundEnabled) ?? null;
      }),
      subscribeTauriEvent('aegis:drag-inactive', () => {
        console.log('[aegis] drag-inactive');
        setDraggingOver(false);
        setDraggedPaths([]);
        usePetStore.getState().setDragActive(false);
        usePetStore.getState().setDragOver(false);
        dragSfxStop.current?.();
        dragSfxStop.current = null;
      }),
      // Cursor is hovering directly over the pet during the drag — flip it into
      // "overdrag" (mouth opens, cheeks blush). Rust emits the boolean on every
      // Over event, so moving off the pet falls back to plain `drag`.
      subscribeTauriEvent<boolean>('aegis:drag-over-main', (e) => {
        usePetStore.getState().setDragOver(e.payload ?? false);
      }),
    ]);
    return () => {
      unlisten();
      dragSfxStop.current?.();
      dragSfxStop.current = null;
    };
  }, []);
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
  const [bootOverlayVisible, setBootOverlayVisible] = useState(true);
  const bootOverlayStartedAtRef = useRef(Date.now());
  const bootOverlayDismissedRef = useRef(false);
  const lastGatewayToastKeyRef = useRef<string | null>(null);
  const lastGatewayErrorToastRef = useRef<string | null>(null);
  const bootRecoveryStartedRef = useRef(false);
  const bootRecoveryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [bootRecoveryAttempt, setBootRecoveryAttempt] = useState(0);
  const [bootRecoveryReady, setBootRecoveryReady] = useState(false);
  const [bootRecoveryRestarting, setBootRecoveryRestarting] = useState(false);
  const [bootRecoveryLogs, setBootRecoveryLogs] = useState<string[]>([]);

  // ── Load Sessions from Gateway (also updates per-session model/thinking/token data) ──
  // This is the single polling call for all session metadata. The store's setSessions
  // synchronously applies the active session's data to the TitleBar state — no separate
  // loadTokenUsage needed.
  const loadSessions = useCallback(async () => {
    // No gate: we don't need labelsReady to be true here. setSessions's
    // merge logic already consults getSessionLabelPref(key), which safely
    // returns undefined if the cache hasn't been primed yet. The merge
    // then falls through to the server's label. Once the prime promise
    // resolves, a later setSessions call (e.g. on the next gateway
    // handshake) will pick up the override.
    try {
      const result = await gateway.getSessions();
      const rawSessions = Array.isArray(result?.sessions) ? result.sessions : [];
      // Gateway-level defaults (configured model, context window)
      const defaults = result?.defaults
        ? { model: result.defaults.model ?? null, contextTokens: result.defaults.contextTokens ?? null }
        : undefined;
      // Read the label cache synchronously — it's a module-level Map
      // populated by primeSessionLabelCache() at boot. The first loadSessions
      // call after mount waits for the prime to settle, so by the time we
      // touch this helper the cache is ready. If the user renamed this
      // session on a previous run, the override is here.
      const sessions = rawSessions.map((s: any) => {
        const key = s.key || s.sessionKey || 'unknown';
        // Priority: persisted user rename → server-provided label →
        // gateway-default fallback. The persisted label wins because the
        // gateway often strips the `label` field on its own.
        const persistedLabel = getSessionLabelPref(key);
        let label = persistedLabel || s.label || s.name || key;
        if (!persistedLabel) {
          if (key === 'agent:main:main') label = t('dashboard.mainSession');
          else if (key.startsWith('agent:main:')) label = key.split(':').pop() || key;
        }
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

      try {
        await gateway.setSessionModel(targetModel, sessionKey);
        state.setSessionModel(sessionKey, targetModel);
        state.setManualModelOverride(targetModel);
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
  const emitGatewayProgress = useCallback((message: string, progress: number, key?: string) => {
    window.dispatchEvent(new CustomEvent('aegis:gateway-progress', {
      detail: { step: 'gateway', message, progress, key },
    }));
  }, []);

  const triggerGatewayReconnect = useCallback((label = 'manual') => {
    addBootRecoveryLog(`Reconnect requested (${label})`);
    emitGatewayProgress('Reconnecting to OpenClaw Gateway…', 0.30, 'gateway.progress.reconnect');
    // Allow the auto-recovery effect to re-arm if the user clicks "reconnect"
    // stays true after the first recovery attempt and blocks all subsequent retries.
    bootRecoveryStartedRef.current = false;
    try { gateway.disconnect(); } catch {}
    emitGatewayProgress('Detecting, connecting, and syncing runtime state…', 0.65, 'gateway.progress.detectConnectSync');
    // Use reconnect() instead of reset() — triggers an immediate status probe
    // so we don't wait up to 2s for the periodic poller to drive the FSM.
    try { gatewayManager.reconnect(); } catch {}
  }, [addBootRecoveryLog, emitGatewayProgress]);

  const restartGatewayFromBoot = useCallback(async () => {
    if (!window.aegis?.gateway?.retry) return;
    setBootRecoveryRestarting(true);
    setBootRecoveryReady(true);
    addBootRecoveryLog('Restarting Gateway service…');
    emitGatewayProgress('Restarting OpenClaw Gateway…', 0.15, 'gateway.progress.restart');
    try {
      const result = await window.aegis.gateway.retry();
      addBootRecoveryLog(result?.success === false ? `Gateway restart failed: ${result.error || 'unknown error'}` : 'Gateway restart command completed');
      emitGatewayProgress('Gateway service restarted, reconnecting…', 0.60, 'gateway.progress.restartDone');
      triggerGatewayReconnect('after-restart');
    } catch (err) {
      addBootRecoveryLog(`Gateway restart exception: ${String(err)}`);
      emitGatewayProgress(`Restart failed: ${String(err)}`, 1.0, 'gateway.progress.restartFailed');
    } finally {
      setBootRecoveryRestarting(false);
    }
  }, [addBootRecoveryLog, emitGatewayProgress, triggerGatewayReconnect]);

  const openBootLogs = useCallback(() => {
    try { window.location.hash = '#/logs'; } catch {}
  }, []);

  // If the gateway process is running but the WS handshake is stuck during
  // cold boot, prefer cheap reconnect probes. Restarting OpenClaw is expensive
  // and can turn a short token/port-cache delay into a 20s+ boot, so automatic
  // recovery never restarts the service. The manual "Restart Gateway" button
  // remains available once lightweight retries have failed.
  useEffect(() => {
    if (setupComplete !== true) return;
    if (connected) {
      bootRecoveryTimersRef.current.forEach(clearTimeout);
      bootRecoveryTimersRef.current = [];
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
    addBootRecoveryLog('Waiting for Gateway WebSocket handshake…');
    const delays = [2500, 6000, 10000];
    bootRecoveryTimersRef.current = delays.map((delay, idx) => setTimeout(() => {
      if (useChatStore.getState().connected) return;
      const attempt = idx + 1;
      setBootRecoveryAttempt(attempt);
      addBootRecoveryLog(`Connection retry ${attempt}/3 (WebSocket reconnect)`);
      try { gateway.disconnect(); } catch {}
      try { gatewayManager.reconnect(); } catch {}
      if (attempt === 3) {
        setBootRecoveryReady(true);
        addBootRecoveryLog('Connection retries did not finish. Manual restart is available.');
      }
    }, delay));
    return () => {
      bootRecoveryTimersRef.current.forEach(clearTimeout);
      bootRecoveryTimersRef.current = [];
    };
  }, [connected, bootOverlayVisible, setupComplete, addBootRecoveryLog]);

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
            console.log('[App] 🧹 Cleared stale typing/thinking on disconnect');
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
      if (snap.logs?.stdout) setBootRecoveryLogs((prev) => [...prev.slice(-24), snap.logs!.stdout]);
      if (snap.logs?.stderr) setBootRecoveryLogs((prev) => [...prev.slice(-24), snap.logs!.stderr]);
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
          useNotificationStore.getState().addToast(
            'error',
            t('gateway.statusChanged', 'Gateway status changed'),
            t('gateway.statusError', { error: snap.error, defaultValue: `Error: ${snap.error}` }),
          );
        } else if (!snap.error && previousError && snap.connected && previousToastKey !== toastKey) {
          lastGatewayErrorToastRef.current = null;
          useNotificationStore.getState().addToast(
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
            console.warn('[Models] Failed to apply saved primary model to active session:', err);
          });
      }
      if (providerChanged) {
        try { gateway.disconnect(); } catch {}
        void window.aegis?.gateway?.ensureRunning?.()
          .then((r: any) => {
            if (r?.healthy) {
              try { gatewayManager.reconnect(); } catch {}
            }
          })
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

    // StatusBar Gateway action fires this event. Connected state requests a
    // real Gateway restart; disconnected state only ensures the process is
    // healthy before reconnecting the WebSocket.
    const handleManualReconnect = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action === 'restart'
        ? 'restart'
        : 'reconnect';
      bootRecoveryStartedRef.current = false;
      try { gateway.disconnect(); } catch {}
      if (action === 'restart') {
        void restartGatewayFromBoot();
        return;
      }
      emitGatewayProgress('Reconnecting to OpenClaw Gateway…', 0.10, 'gateway.progress.reconnect');
      emitGatewayProgress('Detecting, connecting, and syncing runtime state…', 0.45, 'gateway.progress.detectConnectSync');
      void window.aegis?.gateway?.ensureRunning?.().then((r: any) => {
        addBootRecoveryLog(r?.healthy
          ? `Gateway healthy (${r.mode ?? 'native'}) — reconnecting`
          : `ensure_gateway_running returned unhealthy — restarting`);
        emitGatewayProgress(r?.healthy
          ? `Gateway healthy (${r.mode ?? 'native'}), reconnecting…`
          : `ensure_gateway_running status abnormal, restarting…`,
          0.75,
          r?.healthy ? 'gateway.progress.gatewayHealthy' : 'gateway.progress.ensureUnhealthy',
        );
        if (r?.healthy) {
          try { gatewayManager.reconnect(); } catch {}
        } else {
          void restartGatewayFromBoot();
        }
      }).catch(() => {
        emitGatewayProgress('ensure_gateway_running call failed, restarting…', 0.40, 'gateway.progress.ensureFailed');
        void restartGatewayFromBoot();
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
      window.removeEventListener('aegis:manual-reconnect', handleManualReconnect);
      gateway.disconnect();
    };
  }, [loadAvailableModels, setupComplete, restartGatewayFromBoot, emitGatewayProgress, addBootRecoveryLog]);


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
    // Probe immediately instead of waiting for the periodic poller
    gatewayManager.reconnect();
  }, []);

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

      <AnimatePresence mode="wait">
        {bootOverlayVisible && !gatewayBootError && !needsPairing && (
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
        )}
      </AnimatePresence>

      {/* File-drop overlay — soft tinted scrim + label + file preview chips.
          Active whenever Rust reports `aegis:drag-active` (OS-level drag
          entering the window). Pure visual cue; the actual spawn happens on
          drop. pointer-events-none so the overlay never intercepts the drop. */}
      {draggingOver && (
        <div
          className="fixed inset-0 z-[9998] pointer-events-none flex items-center justify-center"
          style={{ animation: 'fadeIn 120ms ease-out' }}
        >
          <div className="absolute inset-3 rounded-2xl border-2 border-dashed border-aegis-primary/60
                          bg-aegis-primary/[0.06] backdrop-blur-sm" />
          <div className="relative flex flex-col items-center gap-2 px-6 py-4 rounded-xl bg-black/40 border border-aegis-primary/30">
            <div className="text-aegis-primary text-[14px] font-semibold tracking-wide">
              拖入到 JunQi Quick Chat
            </div>
            <div className="text-aegis-text-dim text-[11px]">
              {draggedPaths.length} 项，松开会单独打开会话
            </div>
            <div className="flex flex-wrap gap-1.5 max-w-[420px] mt-1 justify-center">
              {draggedPaths.slice(0, 6).map((p, i) => (
                <span key={i} className="px-2 py-0.5 rounded bg-white/10 border border-white/10 text-[10.5px] truncate max-w-[180px]">
                  {p.split('/').pop() || p}
                </span>
              ))}
              {draggedPaths.length > 6 && (
                <span className="px-2 py-0.5 rounded bg-white/10 border border-white/10 text-[10.5px]">
                  +{draggedPaths.length - 6}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

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
                {/* /quickchat is the compact 1-session window spawned when the user
                    drops a file onto the main window or pet. Independent route so
                    it can be hosted in its own WebviewWindow with no NavSidebar,
                    no workbench — just the focused chat surface. */}
                <Route path="/quickchat" element={<QuickChatPage />} />
                <Route path="/workshop" element={<FeatureRoute feature="workshop"><WorkshopPage /></FeatureRoute>} />
                <Route path="/analytics" element={<FeatureRoute feature="analytics"><FullAnalyticsPage /></FeatureRoute>} />
                <Route path="/cron" element={<FeatureRoute feature="cron"><CronMonitorPage /></FeatureRoute>} />
                <Route path="/agents" element={<FeatureRoute feature="agents"><AgentHubPage /></FeatureRoute>} />
                <Route path="/channels" element={<FeatureRoute feature="configManager"><ChannelsCenterPage /></FeatureRoute>} />
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
