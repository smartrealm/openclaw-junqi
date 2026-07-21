import { lazy, Suspense, useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, ExternalLink, FolderOpen, PanelLeftOpen, PanelLeftClose, PanelLeft, PanelRightOpen, Bell, Search } from 'lucide-react';
import clsx from 'clsx';
import { invoke } from '@tauri-apps/api/core';

import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { NotificationType } from '@/stores/notificationStore';
import type { NotificationPanelItem } from '@/components/Layout/NotificationPanel';
import {
  usePersistentNotifications,
  type PersistentNotificationItem,
} from '@/hooks/usePersistentNotifications';
import { APP_PLATFORM } from '@/components/Terminal/platform';
import {
  readTerminalSidebarMode,
  requestTerminalSidebarToggle,
  TERMINAL_SIDEBAR_MODE_EVENT,
} from '@/components/Terminal/terminalSidebarEvents';
import {
  requestTerminalAgentPanelToggle,
  requestTerminalCommandPalette,
} from '@/components/Terminal/terminalChromeEvents';
import {
  cycleTerminalKeepAwakeMode,
  getTerminalKeepAwakeSnapshot,
  subscribeTerminalKeepAwake,
} from '@/components/Terminal/terminalKeepAwake';
import type { TerminalSidebarMode } from '@/components/Terminal/terminalWorkspaceTree';
import { resolveNotificationTarget } from '@/utils/notificationTarget';
import {
  AGENT_WORKSPACE_SIDEBAR_MODE_EVENT,
  readAgentWorkspaceSidebarMode,
  requestAgentWorkspaceSidebarToggle,
} from './agentWorkspaceSidebarEvents';
import { isWorkspaceSidebarMode, type WorkspaceSidebarMode } from './workspaceSidebarChannel';

const NotificationPanel = lazy(() => import('@/components/Layout/NotificationPanel').then(m => ({ default: m.NotificationPanel })));

type AiStatus = 'disconnected' | 'connecting' | 'working' | 'idle';

function persistentNotificationType(level: string): NotificationType {
  return level === 'error' || level === 'warning' ? 'error' : 'info';
}

interface TerminalOpenInApp {
  id: string;
  label: string;
}

/** Kooky-style split Open In control backed by fixed, locally detected apps. */
function TerminalOpenInControl({ directory }: { directory: string }) {
  const { t } = useTranslation();
  const [apps, setApps] = useState<TerminalOpenInApp[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const storageKey = 'junqi:terminal-open-in-app';
  const preferredId = (() => {
    try { return localStorage.getItem(storageKey) ?? ''; } catch { return ''; }
  })();
  const primary = apps.find((app) => app.id === preferredId) ?? apps[0] ?? null;
  const canOpen = Boolean(directory && primary);

  useEffect(() => {
    let cancelled = false;
    void invoke<TerminalOpenInApp[]>('list_terminal_open_in_apps')
      .then((available) => {
        if (!cancelled) setApps(available ?? []);
      })
      .catch(() => {
        if (!cancelled) setApps([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [menuOpen]);

  const openIn = useCallback(async (app: TerminalOpenInApp) => {
    if (!directory) return;
    try {
      await invoke('open_terminal_workspace_in_app', { appId: app.id, path: directory });
      try { localStorage.setItem(storageKey, app.id); } catch {}
      setError('');
      setMenuOpen(false);
    } catch {
      setError(t('terminal.openInFailed', 'The selected application could not open this workspace.'));
      setMenuOpen(true);
    }
  }, [directory, t]);

  return (
    <div ref={wrapRef} className="relative flex h-[28px] shrink-0 items-center" style={{ opacity: apps.length > 0 ? 1 : 0.45 }}>
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => { if (primary) void openIn(primary); }}
        title={primary ? t('terminal.openInPrimary', { app: primary.label, defaultValue: `Open in ${primary.label}` }) : t('terminal.openIn', 'Open in...')}
        aria-label={primary ? t('terminal.openInPrimary', { app: primary.label, defaultValue: `Open in ${primary.label}` }) : t('terminal.openIn', 'Open in...')}
        className="flex h-[28px] w-[24px] items-center justify-center rounded-[5px] text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.12)] hover:text-aegis-text disabled:cursor-default disabled:hover:bg-transparent"
      >
        {primary?.id === 'file-manager' ? <FolderOpen size={14} /> : <ExternalLink size={13} />}
      </button>
      <button
        type="button"
        disabled={apps.length === 0}
        onClick={() => setMenuOpen((open) => !open)}
        title={t('terminal.openIn', 'Open in...')}
        aria-label={t('terminal.openIn', 'Open in...')}
        className="flex h-[28px] w-[15px] items-center justify-center rounded-[5px] text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.12)] hover:text-aegis-text disabled:cursor-default disabled:hover:bg-transparent"
      >
        <ChevronDown size={10} />
      </button>
      {menuOpen && (
        <div className="absolute end-0 top-[32px] z-[100] w-[220px] overflow-hidden rounded-[6px] border border-aegis-border/70 bg-aegis-elevated p-1 shadow-[0_10px_28px_rgb(0_0_0_/_0.35)]">
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => void openIn(app)}
              className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[11px] text-aegis-text transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)]"
            >
              {app.id === 'file-manager' ? <FolderOpen size={13} /> : <ExternalLink size={12} />}
              <span className="min-w-0 flex-1 truncate">{app.label}</span>
              {app.id === primary?.id && <span className="h-1.5 w-1.5 rounded-full bg-aegis-primary" />}
            </button>
          ))}
          {error && <div className="px-2 py-1.5 text-[10px] leading-4 text-aegis-danger">{error}</div>}
        </div>
      )}
    </div>
  );
}

/** Kooky-style hardware-light control, backed by a real native sleep lease. */
function TerminalKeepAwakeControl() {
  const { t } = useTranslation();
  const keepAwake = useSyncExternalStore(
    subscribeTerminalKeepAwake,
    getTerminalKeepAwakeSnapshot,
    getTerminalKeepAwakeSnapshot,
  );
  const title = keepAwake.error
    ? t('terminal.keepAwakeError', 'Keep-awake could not be updated. Click to retry.')
    : keepAwake.mode === 'always'
      ? t('terminal.keepAwakeAlways', 'Always awake - click to turn off')
      : keepAwake.mode === 'auto'
        ? keepAwake.keepingAwake
          ? t('terminal.keepAwakeActive', 'Keeping this computer awake while a terminal agent or SSH session is active - click for always')
          : t('terminal.keepAwakeAuto', 'Keep awake: auto - holds while terminal agents or SSH sessions work - click for always')
        : t('terminal.keepAwakeOff', 'Keep awake: off - click for auto');
  const enabled = keepAwake.mode !== 'off';

  return (
    <button
      type="button"
      onClick={cycleTerminalKeepAwakeMode}
      title={title}
      aria-label={title}
      className="relative flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[5px] transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.12)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
    >
      {enabled && (
        <span
          aria-hidden="true"
          className="absolute h-[13px] w-[13px] rounded-full border border-[#4de873]/55 transition-opacity"
          style={{ opacity: keepAwake.mode === 'always' ? 1 : 0 }}
        />
      )}
      <span
        aria-hidden="true"
        className="h-[7px] w-[7px] rounded-full"
        style={{
          background: enabled ? '#4de873' : 'rgb(var(--aegis-text-dim) / 0.45)',
          boxShadow: enabled ? '0 0 5px rgb(77 232 115 / 0.7)' : 'none',
          opacity: keepAwake.pending ? 0.58 : 1,
          animation: enabled ? 'aegis-pulse 1.5s ease-in-out infinite' : 'none',
        }}
      />
    </button>
  );
}

export function toNotificationPanelItem(
  item: PersistentNotificationItem,
  language: string,
): NotificationPanelItem {
  return {
    id: item.id,
    type: persistentNotificationType(item.level),
    title: item.title,
    body: language === 'zh' && item.bodyZh ? item.bodyZh : item.body,
    timestamp: item.createdAt,
    read: item.isRead,
    url: item.url,
  };
}

/**
 * TopBar — custom window-chrome strip (macOS Overlay title bar).
 *
 * Layout rationale (verified against macOS Sequoia native title bar):
 *   • The native title bar is 28 pt tall — exactly the height macOS allocates
 *     for the traffic-light cluster.  We match that height so the bar and
 *     the lights share the *same* physical footprint (no "lights look too
 *     small" problem).
 *   • With `items-center`, every child centres vertically at y=14 pt — the
 *     same y‑center macOS uses for the traffic-light buttons.
 *   • `zoom: 100/uiScale` cancels the webview‑wide setZoom so native
 *     traffic lights (outside the webview) and HTML buttons stay in the
 *     same coordinate system.
 *
 * Layout: [traffic-light gap] collapse-toggle · AI status (center) · notifications (right).
 * The bar itself is a Tauri drag region; interactive children are not.
 */
interface TopBarProps {
  hideSidebarToggle?: boolean;
  sidebarTarget?: 'app' | 'terminal' | 'agent-workspace';
  showBack?: boolean;
  backFallback?: string;
}

export function TopBar({ hideSidebarToggle = false, sidebarTarget = 'app', showBack = false, backFallback = '/' }: TopBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMac = APP_PLATFORM === 'macos';
  const backLabel = t('topbar.back', '返回');
  const handleBack = useCallback(() => {
    const historyIndex = Number((window.history.state as { idx?: number } | null)?.idx);
    if (Number.isFinite(historyIndex) && historyIndex > 0) navigate(-1);
    else navigate(backFallback);
  }, [backFallback, navigate]);

  // ── Sidebar collapse (three-stage cycle: expanded → mini → hidden) ──
  const sidebarMode = useSettingsStore((s) => s.sidebarMode);
  const cycleSidebar = useSettingsStore((s) => s.cycleSidebar);
  const [terminalSidebarMode, setTerminalSidebarMode] = useState<TerminalSidebarMode>(readTerminalSidebarMode);
  const [agentWorkspaceSidebarMode, setAgentWorkspaceSidebarMode] = useState<WorkspaceSidebarMode>(readAgentWorkspaceSidebarMode);
  useEffect(() => {
    const updateTerminal = (event: Event) => {
      const mode = (event as CustomEvent<TerminalSidebarMode>).detail;
      if (isWorkspaceSidebarMode(mode)) setTerminalSidebarMode(mode);
    };
    const updateAgentWorkspace = (event: Event) => {
      const mode = (event as CustomEvent<WorkspaceSidebarMode>).detail;
      if (isWorkspaceSidebarMode(mode)) setAgentWorkspaceSidebarMode(mode);
    };
    window.addEventListener(TERMINAL_SIDEBAR_MODE_EVENT, updateTerminal);
    window.addEventListener(AGENT_WORKSPACE_SIDEBAR_MODE_EVENT, updateAgentWorkspace);
    return () => {
      window.removeEventListener(TERMINAL_SIDEBAR_MODE_EVENT, updateTerminal);
      window.removeEventListener(AGENT_WORKSPACE_SIDEBAR_MODE_EVENT, updateAgentWorkspace);
    };
  }, []);
  const workspaceSidebarMode = sidebarTarget === 'terminal'
    ? terminalSidebarMode
    : sidebarTarget === 'agent-workspace'
      ? agentWorkspaceSidebarMode
      : null;
  const effectiveSidebarMode = workspaceSidebarMode
    ? workspaceSidebarMode === 'full' ? 'expanded' : workspaceSidebarMode === 'compact' ? 'mini' : 'hidden'
    : sidebarMode;
  const collapseIcon = effectiveSidebarMode === 'expanded'
    ? <PanelLeftClose size={16} />
    : effectiveSidebarMode === 'mini'
      ? <PanelLeft size={16} />
      : <PanelLeftOpen size={16} />;
  const collapseTitle = effectiveSidebarMode === 'expanded'
    ? t('nav.sidebarToMini', 'Collapse to icons')
    : effectiveSidebarMode === 'mini'
      ? t('nav.sidebarHide', 'Hide sidebar')
      : t('nav.sidebarExpand', 'Expand sidebar');
  const handleSidebarToggle = sidebarTarget === 'terminal'
    ? requestTerminalSidebarToggle
    : sidebarTarget === 'agent-workspace'
      ? requestAgentWorkspaceSidebarToggle
      : cycleSidebar;
  const terminalChrome = sidebarTarget === 'terminal';
  const terminalOpenDirectory = useWorkspaceStore((state) => {
    const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    if (!active || active.sshRemoteHost) return '';
    return active.worktreePath || active.projectDirectory || active.workingDirectory;
  });

  // Zoom cancellation: webview setZoom scales everything, but traffic lights
  // are native window chrome → we cancel the zoom on the bar so they stay
  // in the same coordinate system.
  const uiScale = useSettingsStore((s) => s.uiScale);

  // ── AI / connection status ──
  const connected = useChatStore((s) => s.connected);
  const connecting = useChatStore((s) => s.connecting);
  const typingBySession = useChatStore((s) => s.typingBySession);
  const thinkingBySession = useChatStore((s) => s.thinkingBySession);
  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const agents = useGatewayDataStore((s) => s.agents);
  const currentModel = useChatStore((s) => s.currentModel);

  const workingKeys = Object.keys(typingBySession).filter((k) => typingBySession[k]);
  const workingCount = workingKeys.length;
  const activeWorking = !!typingBySession[activeSessionKey];
  const status: AiStatus = !connected && !connecting
    ? 'disconnected'
    : connecting
      ? 'connecting'
      : workingCount > 0
        ? 'working'
        : 'idle';

  // Live elapsed timer while the AI is working.
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (status === 'working') {
      if (startRef.current == null) startRef.current = Date.now();
      const id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
      }, 1000);
      return () => clearInterval(id);
    }
    startRef.current = null;
    setElapsed(0);
    return undefined;
  }, [status]);

  // ── Multi-agent awareness ─────────────────────────────────────────────
  const workingDisplayKey = (() => {
    if (activeWorking) return activeSessionKey;
    if (workingKeys.length === 0) return null;
    const thinkingFresh = workingKeys.find((k) => (thinkingBySession?.[k]?.text?.length ?? 0) > 0);
    return thinkingFresh ?? workingKeys[0];
  })();
  const isBackground = !!workingDisplayKey && workingDisplayKey !== activeSessionKey;

  const displayKey = workingDisplayKey ?? activeSessionKey;
  const displaySession = sessions.find((sx) => sx.key === displayKey);
  const agentId = displayKey.split(':')[1] || 'main';
  const activeAgentId = activeSessionKey.split(':')[1] || 'main';
  const sessionLabel = displaySession?.label || '';
  const displayThinking = (thinkingBySession?.[displayKey]?.text?.length ?? 0) > 0;
  const modelShort = (displaySession?.model || currentModel || '').split('/').pop() || '';
  const elapsedText = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
    : `${elapsed}s`;

  const onStatusClick = useCallback(() => {
    if (status === 'working') navigate('/chat');
    else if (status === 'disconnected') {
      void gatewayManager.restart();
    }
  }, [status, navigate]);

  const statusClickable = status === 'working' || status === 'disconnected';

  // ── Notifications ──
  const language = useSettingsStore((s) => s.language);
  const {
    result: persistentNotifications,
    refresh: refreshNotifications,
    markRead,
    markAllRead,
    clear: clearNotifications,
  } = usePersistentNotifications();
  const history = useMemo(
    () => (persistentNotifications?.notifications ?? []).map((item) => (
      toNotificationPanelItem(item, language)
    )),
    [language, persistentNotifications?.notifications],
  );
  const dndMode = useSettingsStore((s) => s.dndMode);
  const setDndMode = useSettingsStore((s) => s.setDndMode);
  const unread = persistentNotifications?.unreadCount ?? 0;

  const toggleDnd = useCallback(() => {
    const next = !dndMode;
    setDndMode(next);
    void import('@/services/notifications').then((mod) => mod.notifications.setDndMode(next));
  }, [dndMode, setDndMode]);

  const [panelOpen, setPanelOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const openNotification = useCallback((item: NotificationPanelItem) => {
    void markRead(item.id);
    const target = resolveNotificationTarget(item.url);
    if (!target) return;
    setPanelOpen(false);
    if (target?.kind === 'internal') {
      navigate(target.value);
    } else {
      try {
        window.open(target.value, '_blank', 'noopener,noreferrer');
      } catch {
        // External navigation failures must not break notification state.
      }
    }
  }, [markRead, navigate]);

  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanelOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [panelOpen]);

  // ── Working status text ──
  let workingText = '';
  if (status === 'working') {
    const phase = displayThinking
      ? t('topbar.phaseThinking', 'Thinking')
      : t('topbar.phaseGenerating', 'Generating reply');
    // Collect unique agent names from all working sessions
    const workingNames = [...new Set(workingKeys.map((k) => {
      const sid = k.split(':')[1] || 'main';
      const agent = agents.find((a) => a.id === sid);
      return agent?.name || sid;
    }))];
    const head = workingNames.join(', ');
    const agentPart = sessionLabel && sessionLabel !== agentId
      ? `${head} · 「${sessionLabel}」`
      : head;
    const prefix = isBackground
      ? t('topbar.backgroundPrefix', { agent: activeAgentId, defaultValue: 'BG · {{agent}} · ' })
      : '';
    workingText = `${prefix}${agentPart} · ${phase} · ${modelShort} · ${elapsedText}`.replace(/\s·\s$/, '');
  }

  const statusText =
    status === 'disconnected' ? t('topbar.statusDisconnected', 'Disconnected · click to reconnect')
      : status === 'connecting' ? t('topbar.statusConnecting', 'Connecting…')
        : status === 'working' ? workingText
          : t('topbar.statusIdle', 'Ready');

  return (
    <div
      data-tauri-drag-region
      dir="ltr"
      style={{ zoom: uiScale > 0 ? 100 / uiScale : 1 }}
      className={clsx(
        // Matches kooky's ContentView topStrip: 32 pt with an 82 px spacer
        // for the traffic-light cluster, 28×28 icon buttons, items-center so
        // everything (native lights, sidebar toggle, AI pill, bell) shares
        // the same horizontal centre line at y=16.
        'h-[32px] shrink-0 flex items-center gap-1.5 chrome-bg select-none relative z-20 border-b border-aegis-border/30',
        isMac ? 'ps-[82px] pe-3' : 'px-3',
      )}
    >
      {showBack && (
        <button
          type="button"
          onClick={handleBack}
          title={t('topbar.backHint', '返回上一页')}
          aria-label={t('topbar.backHint', '返回上一页')}
          className="flex h-[28px] shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.12)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
        >
          <ArrowLeft size={14} />
          <span>{backLabel}</span>
        </button>
      )}

      {/* Left — collapse toggle (kooky: 28x28, cornerRadius 5, icon 12pt) */}
      {!hideSidebarToggle && (
        <button
          type="button"
          onClick={handleSidebarToggle}
          title={collapseTitle}
          aria-label={collapseTitle}
          className="w-[28px] h-[28px] flex items-center justify-center rounded-[5px] text-aegis-text-secondary hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.12)] transition-colors shrink-0"
        >
          {collapseIcon}
        </button>
      )}

      {terminalChrome ? (
        <button
          type="button"
          onClick={requestTerminalCommandPalette}
          title={t('terminal.commandPalette', 'Search workspace, tab, agent')}
          aria-label={t('terminal.commandPalette', 'Search workspace, tab, agent')}
          className="absolute left-1/2 flex h-[24px] w-[min(340px,calc(100%_-_180px))] -translate-x-1/2 items-center gap-2 rounded-[5px] border border-aegis-border/50 bg-[rgb(var(--aegis-overlay)/0.06)] px-2.5 text-left text-[11px] text-aegis-text-dim transition-colors hover:border-aegis-border hover:bg-[rgb(var(--aegis-overlay)/0.1)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
        >
          <Search size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t('terminal.commandPalette', 'Search workspace, tab, agent')}</span>
          <kbd className="shrink-0 rounded border border-aegis-border/60 px-1 font-mono text-[9px] text-aegis-text-muted">⌘P</kbd>
        </button>
      ) : (
        <button
          type="button"
          onClick={statusClickable ? onStatusClick : undefined}
          disabled={!statusClickable}
          title={statusText}
          className={clsx(
            'absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] border transition-colors',
            showBack ? 'max-w-[calc(50%_-_80px)]' : 'max-w-[50%]',
            status === 'idle' && 'border-transparent text-aegis-text-muted',
            status === 'working' && 'border-aegis-primary/25 text-aegis-primary bg-aegis-primary/[0.06] hover:bg-aegis-primary/[0.12] cursor-pointer',
            status === 'connecting' && 'border-transparent text-aegis-warning',
            status === 'disconnected' && 'border-aegis-danger/25 text-aegis-danger bg-aegis-danger/[0.05] hover:bg-aegis-danger/[0.1] cursor-pointer',
          )}
        >
          <span
            className={clsx(
              'w-[5px] h-[5px] rounded-full shrink-0',
              status === 'idle' && 'bg-aegis-success',
              status === 'working' && 'bg-aegis-primary animate-pulse',
              status === 'connecting' && 'bg-aegis-warning animate-pulse',
              status === 'disconnected' && 'bg-aegis-text-dim',
            )}
          />
          <span className="truncate">{statusText}</span>
        </button>
      )}

      {/* Right — notifications (kooky: 28x28, cornerRadius 5, icon 12pt) */}
      {terminalChrome && (
        <TerminalOpenInControl directory={terminalOpenDirectory} />
      )}
      {terminalChrome && (
        <button
          type="button"
          onClick={requestTerminalAgentPanelToggle}
          title={t('terminal.agentPanelToggle', 'Toggle agent panel')}
          aria-label={t('terminal.agentPanelToggle', 'Toggle agent panel')}
          className="ml-auto flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[5px] text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.12)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
        >
          <PanelRightOpen size={15} />
        </button>
      )}
      <div ref={notifRef} className={clsx('relative shrink-0', !terminalChrome && 'ml-auto')}>
        <button
          type="button"
          onClick={() => setPanelOpen((value) => {
            const next = !value;
            if (next) void refreshNotifications();
            return next;
          })}
          title={t('notifications.title', 'Notifications')}
          aria-label={t('notifications.title', 'Notifications')}
          aria-expanded={panelOpen}
          className={clsx(
            'relative w-[28px] h-[28px] flex items-center justify-center rounded-[5px] transition-colors',
            panelOpen
              ? 'text-aegis-text bg-[rgb(var(--aegis-overlay)/0.12)]'
              : 'text-aegis-text-secondary hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.12)]',
          )}
        >
          <Bell size={16} />
          {unread > 0 && (
            <span className="absolute top-0 end-0 min-w-[12px] h-[12px] px-[2px] flex items-center justify-center rounded-full bg-aegis-danger text-white text-[8px] font-bold leading-none">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        {panelOpen && (
          <Suspense fallback={null}>
            <NotificationPanel
              items={history}
              dndMode={dndMode}
              onToggleDnd={toggleDnd}
              onMarkAllRead={() => void markAllRead()}
              onClear={() => void clearNotifications()}
              onItemClick={openNotification}
            />
          </Suspense>
        )}
      </div>
      {terminalChrome && <TerminalKeepAwakeControl />}
    </div>
  );
}
