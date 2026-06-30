import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { useTranslation } from 'react-i18next';
import { PanelLeftOpen, PanelLeftClose, PanelLeft, Bell } from 'lucide-react';
import clsx from 'clsx';

import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { notifications } from '@/services/notifications';
import { NotificationPanel } from '@/components/Layout/NotificationPanel';
import { APP_PLATFORM } from '@/components/Terminal/_nezha-platform';

type AiStatus = 'disconnected' | 'connecting' | 'working' | 'idle';

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
export function TopBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMac = APP_PLATFORM === 'macos';

  // ── Sidebar collapse (three-stage cycle: expanded → mini → hidden) ──
  const sidebarMode = useSettingsStore((s) => s.sidebarMode);
  const cycleSidebar = useSettingsStore((s) => s.cycleSidebar);
  const collapseIcon = sidebarMode === 'expanded'
    ? <PanelLeftClose size={16} />
    : sidebarMode === 'mini'
      ? <PanelLeft size={16} />
      : <PanelLeftOpen size={16} />;
  const collapseTitle = sidebarMode === 'expanded'
    ? t('nav.sidebarToMini', 'Collapse to icons')
    : sidebarMode === 'mini'
      ? t('nav.sidebarHide', 'Hide sidebar')
      : t('nav.sidebarExpand', 'Expand sidebar');

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
      try { gatewayManager.reset(); } catch {}
      try { void window.aegis?.gateway?.retry?.(); } catch {}
    }
  }, [status, navigate]);

  const statusClickable = status === 'working' || status === 'disconnected';

  // ── Notifications ──
  const history = useNotificationStore((s) => s.history);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clearHistory = useNotificationStore((s) => s.clearHistory);
  const dndMode = useSettingsStore((s) => s.dndMode);
  const setDndMode = useSettingsStore((s) => s.setDndMode);
  const unread = history.reduce((n, h) => (h.read ? n : n + 1), 0);

  const toggleDnd = useCallback(() => {
    const next = !dndMode;
    setDndMode(next);
    notifications.setDndMode(next);
  }, [dndMode, setDndMode]);

  const [panelOpen, setPanelOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

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
      {/* Left — collapse toggle (kooky: 28x28, cornerRadius 5, icon 12pt) */}
      <button
        type="button"
        onClick={() => cycleSidebar()}
        title={collapseTitle}
        aria-label={collapseTitle}
        className="w-[28px] h-[28px] flex items-center justify-center rounded-[5px] text-aegis-text-secondary hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.12)] transition-colors shrink-0"
      >
        {collapseIcon}
      </button>

      {/* Center — AI status */}
      <button
        type="button"
        onClick={statusClickable ? onStatusClick : undefined}
        disabled={!statusClickable}
        title={statusText}
        className={clsx(
          'absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] border transition-colors max-w-[50%]',
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

      {/* Right — notifications (kooky: 28x28, cornerRadius 5, icon 12pt) */}
      <div ref={notifRef} className="ml-auto relative shrink-0">
        <button
          type="button"
          onClick={() => setPanelOpen((o) => !o)}
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
          <NotificationPanel
            items={history}
            dndMode={dndMode}
            onToggleDnd={toggleDnd}
            onMarkAllRead={markAllRead}
            onClear={clearHistory}
            onItemClick={(id) => markRead(id)}
          />
        )}
      </div>
    </div>
  );
}
