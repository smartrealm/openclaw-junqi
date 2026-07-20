// NavSidebar — Context-sensitive sidebar (4 Panel 组件, Tab 切换整体替换)
// 每个 Panel 是真 React 组件，hooks 各自管理。Registry 按 tab 分发。

import { lazy, Suspense, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, MessageSquare, BookOpenText, Bot, Terminal, Settings, Brain, Folder, Clock, Cpu, FileText, Pencil, Trash2, X, Check, ChevronDown, ChevronRight, LoaderCircle, CheckCircle2, Activity, Moon, RefreshCw, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore, type Session } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { showConfirm } from '@/components/shared/alertStore';
import { resolveTab, type SidebarTab } from './tab-utils';
import {
  bucketSessionsByActivity,
  isEmptyTransientSession,
  sessionActivityTime,
  sessionTitle,
  sortSessionsByActivity,
  type SessionBucketKey,
} from './sidebarUtils';
import { applySessionRename } from '@/utils/sessionRename';
import { deleteSessionEverywhere } from '@/utils/sessionDelete';
import { createAgentSessionKey, isAgentMainSession } from '@/utils/sessionLifecycle';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import {
  agentIdFromSessionKey,
  isSessionExecutionActive,
  parentSessionKeyForSession,
  partitionSessionsForPresentation,
  sessionExecutionState,
  type BackgroundActivityKind,
} from '@/utils/sessionPresentation';
import { filterEnabledNavigationItems, type FeatureLinkedItem } from './navigationVisibility';

const AgentsPanel = lazy(() => import('./NavSidebarPanels').then(m => ({ default: m.AgentsPanel })));
const ToolsPanel = lazy(() => import('./NavSidebarPanels').then(m => ({ default: m.ToolsPanel })));
const CommandsPanel = lazy(() => import('./NavSidebarPanels').then(m => ({ default: m.CommandsPanel })));
const SettingsPanel = lazy(() => import('./NavSidebarPanels').then(m => ({ default: m.SettingsPanel })));

const BACKGROUND_ACTIVITY_ITEMS: ReadonlyArray<{
  kind: BackgroundActivityKind;
  labelKey: string;
  fallback: string;
  Icon: LucideIcon;
}> = [
  { kind: 'dreaming', labelKey: 'sidebar.background.dreaming', fallback: '梦境', Icon: Moon },
  { kind: 'cron', labelKey: 'sidebar.background.cron', fallback: '定时', Icon: Clock },
  { kind: 'subagent', labelKey: 'sidebar.background.subagent', fallback: '子智能体', Icon: Bot },
  { kind: 'system', labelKey: 'sidebar.background.system', fallback: '系统', Icon: Cpu },
];

function sessionAgentId(session: Session, sessionKey: string): string {
  if (session.agentId) return session.agentId;
  const parts = String(sessionKey || '').split(':');
  if (parts[0] !== 'agent') return 'main';
  return parts[1] || 'main';
}

function compactMeta(value: string, max = 22): string {
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

function formatSidebarTime(timestampMs: number): string {
  if (!timestampMs) return '';
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = now.getFullYear() === date.getFullYear()
    && now.getMonth() === date.getMonth()
    && now.getDate() === date.getDate();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

function cleanupEmptyActiveSession(nextSessionKey?: string): boolean {
  const state = useChatStore.getState();
  const key = state.activeSessionKey;
  if (!key || key === nextSessionKey) return false;
  const session = state.sessions.find((s) => s.key === key);
  const messages = state.messagesPerSession[key] ?? (key === state.activeSessionKey ? state.messages : []);
  if (!isEmptyTransientSession(session, messages)) return false;
  state.removeSession(key);
  return true;
}

// ═══════════════════════════════════════════════════════════
// 4 个 Panel — 真正 React 组件，hooks 各组件内独立调用
// ═══════════════════════════════════════════════════════════
function SessionRowItem({ session, sessionKey, currentTitle, isActive }: {
  session: Session;
  sessionKey: string;
  currentTitle: string;
  isActive: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useGatewayDataStore((st) => (st as any).agents) ?? [];
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(currentTitle);
  const [renamingInFlight, setRenamingInFlight] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const agentId = sessionAgentId(session, sessionKey);
  const agentFallbackName = agentId === 'main' ? t('agents.mainAgent', 'Main Agent') : agentId;
  const agentName = getAgentDisplayName(agents.find((agent: any) => agent?.id === agentId), agentFallbackName);
  const agentLabel = compactMeta(agentName, 20);
  const isTyping = useChatStore((st) => Boolean(st.typingBySession[sessionKey]));
  const thinkingState = useChatStore((st) => st.thinkingBySession[sessionKey]);
  const isWorking = session.running === true
    || isTyping
    || Boolean(thinkingState?.runId || thinkingState?.text);
  const hasPendingCompletion = session.hasPendingCompletion === true && !isWorking;
  const timeLabel = formatSidebarTime(sessionActivityTime(session));
  const canDelete = !isAgentMainSession(sessionKey);

  const goSession = () => {
    cleanupEmptyActiveSession(sessionKey);
    useChatStore.getState().openTab(sessionKey);
    navigate('/chat');
  };

  const startRename = useCallback(() => {
    setRenameValue(currentTitle);
    setRenameError(null);
    setRenaming(true);
    // Focus after the row re-renders with the input.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [currentTitle]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
    setRenameValue('');
    setRenameError(null);
  }, []);

  const submitRename = useCallback(async () => {
    if (renamingInFlight) return;
    const requestedLabel = renameValue.trim();
    const nativeLabel = session.label.trim();
    if (requestedLabel === nativeLabel) {
      cancelRename();
      return;
    }
    setRenamingInFlight(true);
    try {
      const result = await applySessionRename(sessionKey, renameValue);
      if (result.ok) cancelRename();
      else setRenameError(result.error);
    } finally {
      setRenamingInFlight(false);
    }
  }, [renameValue, renamingInFlight, cancelRename, session, sessionKey]);

  const handleDelete = useCallback(() => {
    showConfirm(
      t('chat.deleteSession', '删除会话'),
      t('chat.deleteSessionConfirm', '确定删除此会话及其历史记录？此操作不可撤销。'),
      async () => {
        await deleteSessionEverywhere(sessionKey);
      }
    );
  }, [sessionKey, t]);

  if (renaming) {
    return (
      <div className="mx-2 mb-1 flex items-center gap-2 rounded-md border border-aegis-primary/25 bg-aegis-primary/[0.08] px-2 py-2">
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={cancelRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submitRename(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
          }}
          disabled={renamingInFlight}
          className="h-[26px] min-w-0 flex-1 rounded bg-aegis-bg px-2 text-[12.5px] text-aegis-text outline-none ring-1 ring-aegis-primary/35 focus:ring-aegis-primary"
        />
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); void submitRename(); }}
          disabled={renamingInFlight}
          className="flex h-7 w-7 items-center justify-center rounded text-aegis-primary hover:bg-aegis-primary/10 disabled:opacity-50"
          title={t('common.save', '保存')}
          aria-label={t('common.save', '保存')}
        >
          <Check size={12} />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); cancelRename(); }}
          className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover/40 hover:text-aegis-text"
          title={t('common.cancel', '取消')}
        >
          <X size={12} />
        </button>
        {renameError && <span className="sr-only" role="alert">{renameError}</span>}
      </div>
    );
  }

  return (
    <div
      className="group/session relative mx-2 mb-1"
      onDoubleClick={(e) => { e.stopPropagation(); startRename(); }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={goSession}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            goSession();
          }
        }}
        className={clsx(
          'grid w-full cursor-pointer grid-cols-[4px_minmax(0,1fr)] items-center gap-2 rounded-lg border px-1.5 py-2 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/55',
          isActive
            ? 'border-aegis-primary/35 bg-aegis-primary/[0.14] text-aegis-text shadow-[inset_0_0_0_1px_rgb(var(--aegis-primary)/0.14)]'
            : 'border-transparent text-aegis-text-secondary hover:bg-aegis-hover/35',
        )}
        >
        <span
          className={clsx(
            'h-8 w-1 rounded-full',
            isActive ? 'bg-aegis-primary' : isWorking ? 'bg-aegis-success/80' : hasPendingCompletion ? 'bg-aegis-primary/55' : 'bg-aegis-border',
          )}
          aria-hidden="true"
        />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={clsx(
              'min-w-0 flex-1 truncate text-[13px] font-semibold leading-[18px] tracking-normal',
              isActive ? 'text-aegis-text' : 'text-aegis-text-secondary',
            )}>
              {currentTitle}
            </span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-4 text-aegis-text-dim">
            <Bot size={10.5} className="shrink-0 opacity-65" />
            <span className="min-w-0 flex-1 truncate" title={agentName}>{agentLabel}</span>
            {isWorking && (
              <span
                className="inline-flex h-5 w-3 shrink-0 items-center justify-center"
                title={t('chat.sessionWorking', 'Working…')}
                aria-label={t('chat.sessionWorking', 'Working…')}
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-aegis-success shadow-[0_0_7px_rgb(var(--aegis-success)/0.7)]" aria-hidden="true" />
              </span>
            )}
            {hasPendingCompletion && (
              <span
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-aegis-primary"
                title={t('chat.sessionCompleted', 'Reply ready')}
                aria-label={t('chat.sessionCompleted', 'Reply ready')}
              >
                <CheckCircle2 size={11} aria-hidden="true" />
              </span>
            )}
            {timeLabel && (
              <span className="ml-auto shrink-0 pl-1 text-[10.5px] tabular-nums text-aegis-text-dim/70">
                {timeLabel}
              </span>
            )}
          </span>
        </span>
      </div>
      {isWorking && <span className="aegis-session-running-border absolute inset-0 z-10 rounded-lg" aria-hidden="true" />}
      <span className="pointer-events-none absolute end-1 top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-aegis-border/80 bg-aegis-elevated p-0.5 opacity-0 shadow-sm transition-[opacity,background-color] group-hover/session:pointer-events-auto group-hover/session:opacity-100 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); startRename(); }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="flex h-6 w-6 items-center justify-center rounded text-aegis-text-dim transition-colors hover:bg-aegis-hover/55 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/45"
          title={t('chat.renameSession', 'Rename session')}
          aria-label={t('chat.renameSession', 'Rename session')}
        >
          <Pencil size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={!canDelete}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (canDelete) handleDelete(); }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={clsx(
            'flex h-6 w-6 items-center justify-center rounded transition-colors focus-visible:outline-none',
            canDelete
              ? 'text-aegis-text-dim hover:bg-red-500/10 hover:text-red-400 focus-visible:ring-1 focus-visible:ring-red-400/45'
              : 'cursor-not-allowed text-aegis-text-dim/30',
          )}
          title={canDelete
            ? t('chat.deleteSession', 'Delete session')
            : t('chat.mainSessionCannotDelete', 'The main session cannot be deleted')}
          aria-label={canDelete
            ? t('chat.deleteSession', 'Delete session')
            : t('chat.mainSessionCannotDelete', 'The main session cannot be deleted')}
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

function WorkbenchPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sessions = useChatStore((st) => st.sessions) ?? [];
  const cronJobs = useGatewayDataStore((st) => st.cronJobs) ?? [];
  const agents = useGatewayDataStore((st) => st.agents) ?? [];
  const activeKey = useChatStore((st) => st.activeSessionKey) ?? '';
  const [nowMs, setNowMs] = useState(Date.now());
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [refreshingSessions, setRefreshingSessions] = useState(false);
  const [expandedBuckets, setExpandedBuckets] = useState<Record<SessionBucketKey, boolean>>({
    today: true,
    withinWeek: true,
    withinMonth: false,
    older: false,
  });

  // Per-session first user message, keyed for O(1) lookups during render.
  // Without this we'd have to walk messagesPerSession on every session row.
  const messagesPerSession = useChatStore((st) => st.messagesPerSession) ?? {};
  const firstUserByKey = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, msgs] of Object.entries(messagesPerSession)) {
      const first = msgs.find((m: any) => m?.role === 'user' && typeof m.content === 'string' && m.content.trim());
      if (first) out[k] = first.content;
    }
    return out;
  }, [messagesPerSession]);

  const presentation = useMemo(
    () => partitionSessionsForPresentation(
      sessions.filter((session) => !session.archived),
      cronJobs,
    ),
    [cronJobs, sessions],
  );
  const visibleSessions = presentation.conversations;
  const backgroundTotal = Object.values(presentation.background)
    .reduce((total, group) => total + group.length, 0);
  const backgroundRunning = Object.values(presentation.background)
    .some((group) => group.some(isSessionExecutionActive));
  const buckets = useMemo(() => bucketSessionsByActivity(visibleSessions, nowMs), [visibleSessions, nowMs]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleRefreshed = () => setRefreshingSessions(false);
    window.addEventListener('aegis:sessions-refreshed', handleRefreshed);
    return () => window.removeEventListener('aegis:sessions-refreshed', handleRefreshed);
  }, []);

  useEffect(() => {
    if (!refreshingSessions) return;
    const fallback = window.setTimeout(() => setRefreshingSessions(false), 12_000);
    return () => window.clearTimeout(fallback);
  }, [refreshingSessions]);

  const refreshSessions = useCallback(() => {
    if (refreshingSessions) return;
    setRefreshingSessions(true);
    window.dispatchEvent(new CustomEvent('aegis:sessions-changed', {
      detail: { reason: 'manual-refresh' },
    }));
  }, [refreshingSessions]);

  const openBackgroundSession = useCallback((sessionKey: string) => {
    cleanupEmptyActiveSession(sessionKey);
    useChatStore.getState().openTab(sessionKey);
    navigate('/chat');
  }, [navigate]);

  useEffect(() => {
    const activeBucket = buckets.find((bucket) => bucket.sessions.some((session) => session.key === activeKey));
    if (!activeBucket) return;
    setExpandedBuckets((current) => current[activeBucket.key] ? current : { ...current, [activeBucket.key]: true });
  }, [activeKey, buckets]);

  const renderRow = (sx: typeof visibleSessions[number]) => (
    <SessionRowItem key={sx.key} session={sx} sessionKey={sx.key}
      currentTitle={sessionTitle(sx, firstUserByKey[sx.key])} isActive={sx.key === activeKey} />
  );

  const toggleBucket = (key: SessionBucketKey) => {
    setExpandedBuckets((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <>
      {/* Primary "新建对话" — bigger, centered.
          Click creates a fresh local session (main agent, pinned, active)
          and navigates to /chat. The user sees a new row appear in the
          sidebar immediately. After the first real message is sent, the
          gateway's sessions.list reply merges in the canonical record. */}
      <div className="px-4 mb-3 mt-1">
        <button
          type="button"
          onClick={() => {
            const state = useChatStore.getState();
            const current = state.sessions.find((s) => s.key === state.activeSessionKey);
            const currentMessages = state.messagesPerSession[state.activeSessionKey] ?? state.messages;
            if (isEmptyTransientSession(current, currentMessages)) {
              navigate('/chat');
              return;
            }
            if (currentMessages.length === 0 && !current?.lastMessage && (current?.totalTokens ?? 0) <= 0) {
              navigate('/chat');
              return;
            }
            const newKey = createAgentSessionKey('main');
            useChatStore.getState().addLocalSession({
              key: newKey,
              label: '新会话',
              agentId: 'main',
              createdAt: Date.now(),
            } as any);
            navigate('/chat');
          }}
          className="w-full h-11 bg-aegis-primary text-white rounded-xl font-semibold text-[14px] flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all shadow-sm shadow-aegis-primary/20"
        >
          <Plus size={16} />
          <span>{t('sidebar.newChat', '新建对话')}</span>
        </button>
      </div>

      {/* Four flat navigation rows with leading icon.
          Left-aligned, no + / 新增 / 添加 prefix on the labels — just
          the noun and the icon. Active route gets primary tint. */}
      <div className="px-4 mb-4 flex flex-col gap-1">
        {[
          { key: 'agents',  to: '/agents',                  label: t('sidebar.nav.agents',  '智能体'),   icon: <Bot size={14} /> },
          { key: 'models',  to: '/config?tab=providers',    label: t('sidebar.nav.models',  '模型服务'), icon: <Cpu size={14} /> },
          { key: 'channels', to: '/channels',              label: t('sidebar.nav.channels', '通道'),     icon: <MessageSquare size={14} /> },
          { key: 'cron',    to: '/cron',                    label: t('sidebar.nav.cron',    '定时任务'), icon: <Clock size={14} /> },
        ].map((it) => {
          const active = location.pathname === it.to.split('?')[0] && (
            (it.to.includes('tab=providers') && location.search.includes('tab=providers')) ||
            (it.to === '/channels' && location.pathname.startsWith('/channels')) ||
            (it.to === '/agents' && location.pathname.startsWith('/agents')) ||
            (it.to === '/cron' && location.pathname.startsWith('/cron'))
          );
          const rowClassName = clsx(
            'h-8 rounded-md text-[13px] text-left flex items-center gap-2.5 transition-colors',
            active
              ? 'text-aegis-primary bg-aegis-primary/[0.08] font-semibold'
              : 'text-aegis-text-secondary hover:text-aegis-text hover:bg-aegis-hover/30',
          );
          const rowContent = (
            <>
              <span className={clsx('shrink-0', active ? 'text-aegis-primary' : 'text-aegis-text-dim')}>
                {it.icon}
              </span>
              <span className="flex-1 truncate">{it.label}</span>
            </>
          );

          return (
            <button
              key={it.key}
              type="button"
              onClick={() => navigate(it.to)}
              className={clsx(rowClassName, 'px-2 -mx-2')}
            >
              {rowContent}
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-2 px-4 pb-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-aegis-text-dim">
          {t('sidebar.userSessions', '用户会话')}
        </span>
        <span className="font-mono text-[10.5px] text-aegis-text-dim/70">{visibleSessions.length}</span>
        <button
          type="button"
          onClick={refreshSessions}
          disabled={refreshingSessions}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-aegis-text-dim transition-colors hover:bg-aegis-hover/40 hover:text-aegis-text disabled:cursor-wait disabled:opacity-60"
          title={t('sidebar.refreshSessions', '刷新会话')}
          aria-label={t('sidebar.refreshSessions', '刷新会话')}
        >
          <RefreshCw size={11.5} className={refreshingSessions ? 'animate-spin' : undefined} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-1">
        {visibleSessions.length === 0 && (
          <div className="px-4 py-3 text-[13px] text-aegis-text-dim">{t('sidebar.noSessions', '暂无对话')}</div>
        )}

        {buckets.map((bucket) => {
          if (bucket.sessions.length === 0) return null;
          const isOpen = expandedBuckets[bucket.key] ?? false;
          return (
            <div key={bucket.key} className="mb-2">
              <button
                type="button"
                onClick={() => toggleBucket(bucket.key)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-normal text-aegis-text-dim transition-colors hover:text-aegis-text-secondary"
              >
                {isOpen
                  ? <ChevronDown size={11} className="opacity-60" />
                  : <ChevronRight size={11} className="opacity-60" />}
                <span className="flex-1 truncate">{t(bucket.labelKey, bucket.fallback)}</span>
                <span className="text-[10.5px] font-mono text-aegis-text-dim/70">{bucket.sessions.length}</span>
              </button>
              {isOpen && bucket.sessions.map(renderRow)}
            </div>
          );
        })}
      </div>

      {backgroundTotal > 0 && (
        <div className="mx-3 shrink-0 border-t border-aegis-border/70 px-1 pb-1 pt-2">
          <button
            type="button"
            onClick={() => setBackgroundOpen((current) => !current)}
            className="flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] font-semibold text-aegis-text-dim transition-colors hover:bg-aegis-hover/30 hover:text-aegis-text-secondary"
            aria-expanded={backgroundOpen}
          >
            {backgroundOpen
              ? <ChevronDown size={11} className="opacity-60" />
              : <ChevronRight size={11} className="opacity-60" />}
            <Activity size={12} className={backgroundRunning ? 'text-aegis-success' : 'opacity-60'} />
            <span className="min-w-0 flex-1 truncate">{t('sidebar.background.title', '后台活动')}</span>
            {backgroundRunning && (
              <LoaderCircle
                size={11}
                className="animate-spin text-aegis-success"
                aria-label={t('sidebar.background.running', '后台任务运行中')}
              />
            )}
            <span className="text-[10.5px] font-mono text-aegis-text-dim/70">{backgroundTotal}</span>
          </button>

          {backgroundOpen && (
            <div className="mt-0.5 max-h-[min(42vh,320px)] space-y-1 overflow-y-auto overscroll-contain pl-3 pr-0.5">
              {BACKGROUND_ACTIVITY_ITEMS
                .filter((item) => presentation.background[item.kind].length > 0)
                .map((item) => {
                  const group = sortSessionsByActivity(presentation.background[item.kind]);
                  const running = group.some(isSessionExecutionActive);
                  const { Icon } = item;
                  return (
                    <div key={item.kind}>
                      <div className="flex h-7 w-full items-center gap-2 px-2 text-[11px] font-semibold text-aegis-text-dim">
                        <Icon size={12} className={clsx('shrink-0', running && 'text-aegis-success')} />
                        <span className="min-w-0 flex-1 truncate">{t(item.labelKey, item.fallback)}</span>
                        <span className="shrink-0 font-mono text-[10px] text-aegis-text-dim/70">{group.length}</span>
                      </div>
                      <div className="space-y-0.5 pl-2">
                        {group.map((session) => {
                          const state = sessionExecutionState(session);
                          const title = sessionTitle(session, firstUserByKey[session.key]);
                          const workerAgentId = session.agentId || agentIdFromSessionKey(session.key) || 'main';
                          const parentSessionKey = parentSessionKeyForSession(session);
                          const parentAgentId = parentSessionKey
                            ? agentIdFromSessionKey(parentSessionKey)
                            : null;
                          const workerName = getAgentDisplayName(
                            agents.find((agent) => agent.id === workerAgentId),
                            workerAgentId === 'main' ? t('agents.mainAgent', 'Main Agent') : workerAgentId,
                          );
                          const parentName = parentAgentId
                            ? getAgentDisplayName(
                                agents.find((agent) => agent.id === parentAgentId),
                                parentAgentId === 'main' ? t('agents.mainAgent', 'Main Agent') : parentAgentId,
                              )
                            : null;
                          const delegationLabel = parentName
                            ? parentAgentId === workerAgentId
                              ? t('sidebar.background.delegatedBy', { name: parentName, defaultValue: '{{name}} 委派' })
                              : t('sidebar.background.delegationRoute', {
                                  parent: parentName,
                                  worker: workerName,
                                  defaultValue: '{{parent}} → {{worker}}',
                                })
                            : workerName;
                          const status = state === 'running'
                            ? t('sidebar.background.status.running', '运行中')
                            : state === 'done'
                              ? t('sidebar.background.status.done', '完成')
                              : state === 'failed'
                                ? t('sidebar.background.status.failed', '失败')
                                : state === 'stopped'
                                  ? t('sidebar.background.status.stopped', '已停止')
                                  : '';
                          return (
                            <button
                              key={session.key}
                              type="button"
                              onClick={() => openBackgroundSession(session.key)}
                              className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-aegis-text-dim transition-colors hover:bg-aegis-hover/35 hover:text-aegis-text-secondary"
                              title={parentSessionKey
                                ? `${session.key}\n${delegationLabel}\n${parentSessionKey}`
                                : session.key}
                            >
                              <span className={clsx(
                                'h-1.5 w-1.5 shrink-0 rounded-full',
                                state === 'running' && 'animate-pulse bg-aegis-success',
                                state === 'done' && 'bg-aegis-primary/70',
                                state === 'failed' && 'bg-aegis-danger',
                                (state === 'stopped' || state === 'unknown') && 'bg-aegis-border',
                              )} aria-hidden="true" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] text-aegis-text-secondary">{title}</span>
                                <span className="mt-0.5 block truncate text-[9.5px] text-aegis-text-dim/80">{delegationLabel}</span>
                              </span>
                              {status && (
                                <span className={clsx(
                                  'inline-flex shrink-0 items-center gap-1 text-[9.5px]',
                                  state === 'running' && 'text-aegis-success',
                                  state === 'done' && 'text-aegis-primary',
                                  state === 'failed' && 'text-aegis-danger',
                                )}>
                                  {state === 'done' && <CheckCircle2 size={10} aria-hidden="true" />}
                                  {state === 'failed' && <X size={10} aria-hidden="true" />}
                                  {status}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Panel Registry — 真 React 组件 Map
// ═══════════════════════════════════════════════════════════

const PANEL_REGISTRY: Record<SidebarTab, React.ComponentType> = {
  workbench: WorkbenchPanel,
  agents:    AgentsPanel,
  tools:     ToolsPanel,
  commands:  CommandsPanel,
  settings:  SettingsPanel,
};

// ═══════════════════════════════════════════════════════════
// Mini 模式 + Expanded 模式
// ═══════════════════════════════════════════════════════════

function ExpandedView({ tab }: { tab: SidebarTab }) {
  const Panel = PANEL_REGISTRY[tab] ?? WorkbenchPanel;
  // key={tab} forces a clean remount on tab change so no hook state from the
  // previous panel can leak into the next (defensive against React #310).
  return (
    <Suspense fallback={<div className="px-4 py-3 text-[13px] text-aegis-text-dim" />}>
      <Panel key={tab} />
    </Suspense>
  );
}

function MiniView({ tab }: { tab: SidebarTab }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const items = filterEnabledNavigationItems(miniItemsFor(tab, t));
  return (
    <nav className="flex flex-col items-center gap-1 px-2">
      {/* Active-tab chip — single text label at top so users always know
          which panel they're seeing in mini mode. Without this the icons
          alone give no semantic context. */}
      <div
        title={t(`sidebar.tab.${tab}`, tab)}
        className="w-10 h-7 mt-0.5 mb-1 flex items-center justify-center rounded-md
          bg-aegis-primary/15 border border-aegis-primary/25
          text-aegis-primary text-[11.5px] font-bold uppercase tracking-wider select-none"
      >
        {t(`sidebar.tab.${tab}`, tab.slice(0, 1).toUpperCase())}
      </div>
      {items.map((it) => (
        <button
          key={`${it.to}:${it.label}`}
          type="button"
          title={it.label}
          onClick={() => navigate(it.to)}
          className="w-10 h-10 flex items-center justify-center rounded-lg text-aegis-text-muted hover:text-aegis-text hover:bg-aegis-hover/40"
        >
          {it.icon}
        </button>
      ))}
    </nav>
  );
}

function miniItemsFor(
  tab: SidebarTab,
  t: ReturnType<typeof useTranslation>['t'],
): ReadonlyArray<FeatureLinkedItem & { to: string; icon: React.ReactNode; label: string }> {
  switch (tab) {
    case 'agents': return [
      { to: '/agents?new=1', icon: <Plus size={20} />, label: t('sidebar.newAgent', 'New agent'), feature: 'agents' },
      { to: '/agents', icon: <Bot size={20} />, label: t('nav.agents', 'Agents'), feature: 'agents' },
      { to: '/memory', icon: <Brain size={20} />, label: t('nav.memory', 'Memory'), feature: 'memory' },
    ];
    case 'tools': return [
      { to: '/ai-workspace', icon: <Bot size={20} />, label: t('nav.aiWorkspace', 'AI 工作台'), feature: 'agentRun' },
      { to: '/terminal', icon: <Terminal size={20} />, label: t('nav.terminal', 'Terminal'), feature: 'terminal' },
      { to: '/files', icon: <Folder size={20} />, label: t('nav.files', 'Files'), feature: 'files' },
      { to: '/tools', icon: <Cpu size={20} />, label: t('nav.mcpTools', 'MCP Tools'), feature: 'tools' },
    ];
    case 'commands': return [
      { to: '/openclaw-commands', icon: <BookOpenText size={20} />, label: t('nav.openclawCommands', 'OpenClaw commands'), feature: 'tools' },
    ];
    case 'settings': return [
      { to: '/settings', icon: <Settings size={20} />, label: t('nav.settings', 'Settings'), feature: 'settings' },
      { to: '/config', icon: <Bot size={20} />, label: t('nav.agentConfig', 'Provider configuration'), feature: 'configManager' },
      { to: '/logs', icon: <FileText size={20} />, label: t('nav.logs', 'Logs'), feature: 'logs' },
    ];
    case 'workbench':
    default: return [
      { to: '/chat', icon: <Plus size={20} />, label: t('sidebar.newChat', 'New chat'), feature: 'chat' },
      { to: '/chat', icon: <MessageSquare size={20} />, label: t('nav.chat', 'Chat'), feature: 'chat' },
      { to: '/workshop', icon: <Folder size={20} />, label: t('nav.workspace', 'Workspace'), feature: 'workshop' },
    ];
  }
}

// ═══════════════════════════════════════════════════════════
// NavSidebar 顶层
// ═══════════════════════════════════════════════════════════

export function NavSidebar() {
  const location = useLocation();
  const sidebarMode = useSettingsStore((s) => s.sidebarMode);
  const isHidden = sidebarMode === 'hidden';
  const isMini = sidebarMode === 'mini';
  const isExpanded = sidebarMode === 'expanded';
  const targetWidth = isExpanded
    ? 'var(--aegis-sidebar-expanded)'
    : isMini
      ? 'var(--aegis-sidebar-mini)'
      : 0;
  const tab = useSettingsStore((s) => s.activeSidebarTab);
  const setActiveTab = useSettingsStore((s) => s.setActiveSidebarTab);

  // Sync explicit selection from URL for deep links / sidebar-internal navigation.
  useEffect(() => {
    const resolved = resolveTab(location.pathname);
    setActiveTab(resolved);
  }, [location.pathname, setActiveTab]);

  if (isHidden) return null;

  return (
    <aside
      className={clsx(
        'shrink-0 flex flex-col overflow-hidden py-3 sidebar-width-anim',
        isMini ? 'items-center' : 'items-stretch',
        'border-r border-aegis-border',
      )}
      style={{
        width: targetWidth,
        background: 'linear-gradient(180deg, var(--aegis-surface), var(--aegis-surface-elevated))',
      }}
      aria-label="侧边导航栏"
    >
      {isMini  ? <MiniView tab={tab} /> : null}
      {isExpanded ? <ExpandedView tab={tab} /> : null}
    </aside>
  );
}
