// NavSidebar — Context-sensitive sidebar (4 Panel 组件, Tab 切换整体替换)
// 每个 Panel 是真 React 组件，hooks 各自管理。Registry 按 tab 分发。

import { lazy, Suspense, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArchiveRestore, Plus, MessageSquare, BookOpenText, Bot, Terminal, Settings, Settings2, Brain, Folder, Clock, Cpu, FileText, Trash2, X, Check, ChevronDown, ChevronRight, LoaderCircle, CheckCircle2, Activity, Moon, Ellipsis, Pin, ListChecks, Wrench, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSettingsStore } from '@/stores/settingsStore';
import { OPENCLAW_TOOLS_ROUTE } from '@/config/openClawToolsRoute';
import { isFeatureEnabled } from '@/config/edition';
import { useChatStore, type Session } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { showConfirm } from '@/components/shared/alertStore';
import { SidebarPrimaryAction } from './SidebarPrimaryAction';
import { resolveTab, type SidebarTab } from './tab-utils';
import {
  extendSidebarSessionCreationFallbackOrder,
  filterSidebarSessionsByAgent,
  normalizeSidebarSessionGrouping,
  promoteSidebarSessionCreationFallbackOrder,
  projectSidebarSessions,
  resolveSidebarSessionAgentId,
  sessionActivityTime,
  sortSessionsByActivity,
  sortSidebarSessions,
  type SidebarSessionGrouping,
  type SidebarSessionSortMode,
} from './sidebarUtils';
import { applySessionRename } from '@/utils/sessionRename';
import { deleteSessionEverywhere } from '@/utils/sessionDelete';
import { createNativeSession } from '@/utils/sessionCreate';
import { resolveNewSessionAgentId } from '@/utils/sessionLifecycle';
import { getSessionDisplayLabel } from '@/utils/sessionLabel';
import { useNotificationStore } from '@/stores/notificationStore';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import {
  agentIdFromSessionKey,
  parentSessionKeyForSession,
  partitionSessionsForPresentation,
  projectSessionActivity,
  type BackgroundActivityKind,
  type SessionActivity,
} from '@/utils/sessionPresentation';
import { resolveBackgroundActivityNavigation } from '@/utils/backgroundActivityNavigation';
import { resolveSessionChannelPresentation } from '@/utils/sessionChannelPresentation';
import { filterEnabledNavigationItems, type FeatureLinkedItem } from './navigationVisibility';
import { SessionChannelIcon } from '@/components/shared/SessionChannelIcon';
import { SessionActionsMenu } from '@/components/Chat/session-actions/SessionActionsMenu';
import { FloatingMenuPortal } from '@/components/shared/FloatingMenuPortal';
import {
  isWorkbenchNavigationItemActive,
  WORKBENCH_NAVIGATION_ITEMS,
  type WorkbenchNavigationIcon,
} from './workbenchNavigation';
import { SessionScopeControls } from './SessionScopeControls';

const AgentsPanel = lazy(() => import('./NavSidebarPanels').then(m => ({ default: m.AgentsPanel })));
const BusinessApplicationsPanel = lazy(() => import('./NavSidebarPanels').then(m => ({ default: m.BusinessApplicationsPanel })));
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

const SIDEBAR_SESSION_GROUPING_STORAGE_KEY = 'junqi:sidebar:sessions:grouping';

const WORKBENCH_NAVIGATION_ICONS: Record<WorkbenchNavigationIcon, LucideIcon> = {
  agents: Bot,
  models: Cpu,
  channels: MessageSquare,
  cron: Clock,
};

function readSidebarSessionGrouping(): SidebarSessionGrouping {
  try {
    return normalizeSidebarSessionGrouping(window.localStorage.getItem(SIDEBAR_SESSION_GROUPING_STORAGE_KEY));
  } catch {
    return 'category';
  }
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

// ═══════════════════════════════════════════════════════════
// 4 个 Panel — 真正 React 组件，hooks 各组件内独立调用
// ═══════════════════════════════════════════════════════════
function SessionRowItem({ session, sessionKey, currentTitle, isActive, activity }: {
  session: Session;
  sessionKey: string;
  currentTitle: string;
  isActive: boolean;
  activity: SessionActivity;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useGatewayDataStore((st) => st.agents);
  const defaultAgentId = useGatewayDataStore((st) => st.defaultAgentId);
  const defaultMainSessionKey = useChatStore((st) => st.defaultMainSessionKey);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(currentTitle);
  const [renamingInFlight, setRenamingInFlight] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const agentId = resolveSidebarSessionAgentId(session, defaultAgentId, defaultMainSessionKey) ?? '';
  const agentFallbackName = agentId === defaultAgentId ? t('agents.mainAgent', 'Main Agent') : agentId;
  const agentName = getAgentDisplayName(agents.find((agent) => agent.id === agentId), agentFallbackName);
  const agentLabel = compactMeta(agentName, 20);
  const channelPresentation = resolveSessionChannelPresentation(session);
  const channelLabel = channelPresentation?.label ?? null;
  const sourceLabel = channelLabel
    ? t('sidebar.session.channelAndAgent', '{{channel}} · {{agent}}', {
      channel: channelLabel,
      agent: agentName,
    })
    : agentName;
  const compactSourceLabel = compactMeta(sourceLabel, 30);
  const primaryIdentityLabel = channelLabel
    ? t('sidebar.session.channelIdentity', '{{channel}} channel', { channel: channelLabel })
    : agentName;
  const isWorking = activity.active;
  const hasPendingCompletion = session.hasPendingCompletion === true && !isWorking;
  const sessionStatusLabel = isWorking
    ? t('chat.sessionWorking', 'Working…')
    : hasPendingCompletion
      ? t('chat.sessionCompleted', 'Reply ready')
      : '';
  const timeLabel = formatSidebarTime(sessionActivityTime(session));
  const [actionsPosition, setActionsPosition] = useState<{ x: number; y: number } | null>(null);

  const goSession = () => {
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
      onContextMenu={(event) => {
        event.preventDefault();
        setActionsPosition({ x: event.clientX, y: event.clientY });
      }}
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
          'w-full cursor-pointer rounded-lg border px-2 py-1.5 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/55',
          isActive
            ? 'border-aegis-primary/35 bg-aegis-primary/[0.14] text-aegis-text shadow-[inset_0_0_0_1px_rgb(var(--aegis-primary)/0.14)]'
            : 'border-transparent text-aegis-text-secondary hover:bg-aegis-hover/35',
        )}
        >
        <span className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5">
          <span
            className={clsx(
              'relative row-span-2 flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-md border transition-colors',
              isActive
                ? 'border-aegis-primary/35 bg-aegis-primary/[0.12] text-aegis-text'
                : 'border-aegis-border/70 bg-aegis-elevated/70 text-aegis-text-dim group-hover/session:border-aegis-border-hover group-hover/session:text-aegis-text-secondary',
            )}
            role="group"
            aria-label={primaryIdentityLabel}
            title={primaryIdentityLabel}
          >
            {channelPresentation ? (
              <SessionChannelIcon icon={channelPresentation.icon} />
            ) : (
              <Bot size={13} aria-hidden="true" />
            )}
            {sessionStatusLabel && (
              <span
                className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-aegis-surface bg-aegis-elevated"
                role="status"
                aria-label={sessionStatusLabel}
                title={sessionStatusLabel}
              >
                {isWorking ? (
                  <LoaderCircle
                    size={9}
                    className={clsx(
                      'animate-spin',
                      isActive
                        ? 'text-aegis-text'
                        : 'text-aegis-primary group-hover/session:text-aegis-text group-focus-within/session:text-aegis-text',
                    )}
                    aria-hidden="true"
                  />
                ) : (
                  <CheckCircle2
                    size={10}
                    className="text-aegis-success"
                    aria-hidden="true"
                  />
                )}
              </span>
            )}
          </span>
          <span className={clsx(
            'col-start-2 row-start-1 min-w-0 truncate text-[13px] font-semibold leading-[18px] tracking-normal',
            isActive ? 'text-aegis-text' : 'text-aegis-text-secondary',
          )}>
            {currentTitle}
          </span>
          <span
            className="col-start-2 row-start-2 min-w-0 truncate text-[11px] leading-4 text-aegis-text-dim"
            title={sourceLabel}
          >
            {channelPresentation ? compactSourceLabel : agentLabel}
          </span>
          {timeLabel && (
            <time
              className="col-start-3 row-start-2 self-center pl-1 text-[10.5px] leading-4 tabular-nums text-aegis-text-dim/70"
              dateTime={new Date(sessionActivityTime(session)).toISOString()}
            >
              {timeLabel}
            </time>
          )}
        </span>
      </div>
      <span className="pointer-events-none absolute end-1 top-1/2 z-20 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-aegis-border/80 bg-aegis-elevated p-0.5 text-aegis-text-muted opacity-0 shadow-sm transition-[opacity,background-color] group-hover/session:pointer-events-auto group-hover/session:opacity-100 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setActionsPosition({ x: rect.right, y: rect.bottom + 4 });
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-aegis-hover/55 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/45"
          title={t('chat.sessionActions', '会话操作')}
          aria-label={t('chat.sessionActions', '会话操作')}
        >
          <Ellipsis size={14} aria-hidden="true" />
        </button>
      </span>
      {actionsPosition && (
        <FloatingMenuPortal
          point={actionsPosition}
          origin="top-end"
          onDismiss={() => setActionsPosition(null)}
        >
          <SessionActionsMenu
            session={session}
            onDismiss={() => setActionsPosition(null)}
            onRequestRename={startRename}
            onOpenSession={(key) => {
              useChatStore.getState().openTab(key);
              navigate('/chat');
            }}
          />
        </FloatingMenuPortal>
      )}
    </div>
  );
}

interface SessionCategory {
  readonly id: string;
  readonly label: string;
}

function SessionCategoryHeader({ category, count }: { category: SessionCategory; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-aegis-text-dim">
      <Folder size={11} className="opacity-70" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{category.label}</span>
      <span className="text-[10.5px] font-mono text-aegis-text-dim/70">{count}</span>
    </div>
  );
}

function WorkbenchPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const sessions = useChatStore((st) => st.sessions);
  const defaultMainSessionKey = useChatStore((st) => st.defaultMainSessionKey);
  const sessionGroupCatalog = useChatStore((st) => st.sessionGroupCatalog);
  const refreshSessionGroupCatalog = useChatStore((st) => st.refreshSessionGroupCatalog);
  const cronJobs = useGatewayDataStore((st) => st.cronJobs);
  const agents = useGatewayDataStore((st) => st.agents);
  const defaultAgentId = useGatewayDataStore((st) => st.defaultAgentId);
  const agentsLoading = useGatewayDataStore((st) => st.loading.agents);
  const sessionsLoading = useGatewayDataStore((st) => st.loading.sessions);
  const agentsError = useGatewayDataStore((st) => st.errors.agents);
  const sessionsError = useGatewayDataStore((st) => st.errors.sessions);
  const activeKey = useChatStore((st) => st.activeSessionKey) ?? '';
  const typingBySession = useChatStore((st) => st.typingBySession);
  const typingStartedAtBySession = useChatStore((st) => st.typingStartedAtBySession);
  const thinkingBySession = useChatStore((st) => st.thinkingBySession);
  const sendingBySession = useChatStore((st) => st.sendingBySession);
  const compactionStatusBySession = useChatStore((st) => st.compactionStatusBySession);
  const [backgroundUserOpen, setBackgroundUserOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [grouping, setGrouping] = useState<SidebarSessionGrouping>(readSidebarSessionGrouping);
  const [sortMode, setSortMode] = useState<SidebarSessionSortMode>('created');
  const setSessionArchived = useChatStore((state) => state.setSessionArchived);
  const agentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);
  const activeAgentId = resolveNewSessionAgentId(activeKey, agentIds, defaultAgentId);
  const [selectedAgentId, setSelectedAgentId] = useState(activeAgentId ?? '');
  const [sessionCreationFallbackOrder, setSessionCreationFallbackOrder] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const previousActiveSessionKeyRef = useRef(activeKey);

  useEffect(() => {
    const activeSessionChanged = previousActiveSessionKeyRef.current !== activeKey;
    previousActiveSessionKeyRef.current = activeKey;
    setSelectedAgentId((current) => {
      if (activeSessionChanged && activeAgentId) return activeAgentId;
      if (current && agentIds.includes(current)) return current;
      return activeAgentId ?? '';
    });
  }, [activeAgentId, activeKey, agentIds]);

  useEffect(() => {
    void refreshSessionGroupCatalog().catch(() => undefined);
  }, [refreshSessionGroupCatalog]);

  useEffect(() => {
    setSessionCreationFallbackOrder((current) => extendSidebarSessionCreationFallbackOrder(current, sessions));
  }, [sessions]);

  const agentOptions = useMemo(() => agents.map((agent) => ({
    id: agent.id,
    label: getAgentDisplayName(
      agent,
      agent.id === defaultAgentId ? t('agents.mainAgent', 'Main Agent') : agent.id,
    ),
  })), [agents, defaultAgentId, t]);

  // 按会话缓存第一条用户消息，避免每次渲染会话行时重复遍历消息。
  const messagesPerSession = useChatStore((st) => st.messagesPerSession);
  const firstUserByKey = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, msgs] of Object.entries(messagesPerSession)) {
      const first = msgs.find((message) => (
        message.role === 'user' && typeof message.content === 'string' && message.content.trim()
      ));
      if (first) out[k] = first.content;
    }
    return out;
  }, [messagesPerSession]);
  const displaySessionTitle = useCallback((session: Session) => getSessionDisplayLabel(session, {
    mainSessionLabel: t('agents.mainAgent', 'Main Agent'),
    mainSessionKey: defaultMainSessionKey,
    genericSessionLabel: t('chat.newSessionLabel'),
    messageFallback: firstUserByKey[session.key],
  }), [defaultMainSessionKey, firstUserByKey, t]);

  const scopedSessions = useMemo(() => filterSidebarSessionsByAgent(
    sessions,
    selectedAgentId,
    defaultAgentId,
    defaultMainSessionKey,
  ), [defaultAgentId, defaultMainSessionKey, selectedAgentId, sessions]);
  const presentation = useMemo(() => partitionSessionsForPresentation(
    scopedSessions.filter((session) => !session.archived),
    cronJobs,
  ), [cronJobs, scopedSessions]);
  const visibleSessions = presentation.conversations;
  const sidebarProjection = useMemo(() => projectSidebarSessions({
    sessions: visibleSessions,
    agentId: selectedAgentId,
    defaultAgentId,
    defaultMainSessionKey,
    grouping,
    sortMode,
    creationFallbackOrder: sessionCreationFallbackOrder,
    categoryOrder: sessionGroupCatalog,
  }), [defaultAgentId, defaultMainSessionKey, grouping, selectedAgentId, sessionCreationFallbackOrder, sessionGroupCatalog, sortMode, visibleSessions]);
  const archivedSessions = useMemo(() => sortSidebarSessions(
    scopedSessions.filter((session) => session.archived),
    sortMode,
    sessionCreationFallbackOrder,
  ), [scopedSessions, sessionCreationFallbackOrder, sortMode]);
  const activityProjection = useMemo(() => projectSessionActivity({
    sessions: scopedSessions.filter((session) => !session.archived),
    activeSessionKey: activeKey,
    jobs: cronJobs,
    typingBySession,
    typingStartedAtBySession,
    thinkingBySession,
    sendingBySession,
    compactionStatusBySession,
  }), [activeKey, compactionStatusBySession, cronJobs, scopedSessions, sendingBySession, thinkingBySession, typingBySession, typingStartedAtBySession]);
  const backgroundTotal = Object.values(presentation.background)
    .reduce((total, group) => total + group.length, 0);
  const backgroundRunning = Object.values(presentation.background)
    .some((group) => group.some((session) => activityProjection.bySessionKey.get(session.key)?.active));
  const routedBackgroundSessionKey = useMemo(
    () => new URLSearchParams(location.search).get('session')?.trim() ?? '',
    [location.search],
  );
  const backgroundHasSelectedSession = useMemo(() => {
    const selectedKey = location.pathname === '/chat' ? activeKey : routedBackgroundSessionKey;
    if (!selectedKey) return false;
    return Object.values(presentation.background)
      .some((group) => group.some((session) => session.key === selectedKey));
  }, [activeKey, location.pathname, presentation.background, routedBackgroundSessionKey]);
  const backgroundOpen = backgroundUserOpen || backgroundRunning || backgroundHasSelectedSession;

  const openBackgroundSession = useCallback((kind: BackgroundActivityKind, sessionKey: string) => {
    setBackgroundUserOpen(true);
    const target = resolveBackgroundActivityNavigation(kind, sessionKey);
    if (target.kind === 'chat') {
      useChatStore.getState().openTab(target.sessionKey);
      navigate('/chat');
      return;
    }
    navigate(target.to);
  }, [navigate]);

  const deleteBackgroundSession = useCallback((sessionKey: string) => {
    showConfirm(
      t('chat.deleteSession', '删除会话'),
      t('chat.deleteSessionConfirm', '确定删除此会话及其历史记录？此操作不可撤销。'),
      async () => {
        await deleteSessionEverywhere(sessionKey);
      },
    );
  }, [t]);

  const renderRow = (sx: Session) => {
    const activity = activityProjection.bySessionKey.get(sx.key);
    if (!activity) return null;
    return (
      <SessionRowItem key={sx.key} session={sx} sessionKey={sx.key}
        currentTitle={displaySessionTitle(sx)} isActive={sx.key === activeKey}
        activity={activity} />
    );
  };

  const createSelectedAgentSession = useCallback(() => {
    if (!selectedAgentId) return;
    void createNativeSession({ agentId: selectedAgentId }).then((result) => {
      if (result.ok) {
        setSessionCreationFallbackOrder((current) => promoteSidebarSessionCreationFallbackOrder(
          extendSidebarSessionCreationFallbackOrder(current, [result.session]),
          result.session.key,
        ));
        navigate('/chat');
        return;
      }
      useNotificationStore.getState().addToast(
        'error',
        t('sidebar.newChat', '新建对话'),
        result.error,
      );
    });
  }, [navigate, selectedAgentId, t]);

  const changeGrouping = useCallback((nextGrouping: SidebarSessionGrouping) => {
    setGrouping(nextGrouping);
    try {
      window.localStorage.setItem(SIDEBAR_SESSION_GROUPING_STORAGE_KEY, nextGrouping);
    } catch {
      // 本地偏好不可写时保留当前窗口状态，不影响 Gateway 会话数据。
    }
  }, []);

  const visibleRowCount = Number(Boolean(sidebarProjection.mainSession))
    + sidebarProjection.pinnedSessions.length
    + sidebarProjection.flatSessions.length
    + sidebarProjection.ungroupedSessions.length
    + sidebarProjection.categories.reduce((total, category) => total + category.sessions.length, 0);

  return (
    <>
      <div className="shrink-0">
        <SidebarPrimaryAction
          icon={<Plus size={16} />}
          onClick={createSelectedAgentSession}
          disabled={!selectedAgentId}
        >
          {t('sidebar.newChat', '新建对话')}
        </SidebarPrimaryAction>

        <nav
          className="mb-4 flex flex-col gap-1 pe-4 ps-[var(--aegis-sidebar-menu-row-inset)]"
          aria-label={t('sidebar.primaryNavigation', '主要功能')}
        >
          {WORKBENCH_NAVIGATION_ITEMS.map((item) => {
            const active = isWorkbenchNavigationItemActive(item, location.pathname, location.search);
            const Icon = WORKBENCH_NAVIGATION_ICONS[item.key];
            const rowClassName = clsx(
              'h-8 rounded-md text-[13px] text-left flex items-center gap-2.5 transition-colors',
              active
                ? 'text-aegis-primary bg-aegis-primary/[0.08] font-semibold'
                : 'text-aegis-text-secondary hover:text-aegis-text hover:bg-aegis-hover/30',
            );
            const rowContent = (
              <>
                <span className={clsx('shrink-0', active ? 'text-aegis-primary' : 'text-aegis-text-dim')}>
                  <Icon size={14} aria-hidden="true" />
                </span>
                <span className="flex-1 truncate">{t(item.labelKey, item.fallback)}</span>
              </>
            );

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => navigate(item.to)}
                className={clsx(rowClassName, 'pe-2 ps-[var(--aegis-sidebar-menu-button-icon-padding)]')}
                aria-current={active ? 'page' : undefined}
              >
                {rowContent}
              </button>
            );
          })}
        </nav>
      </div>

      <SessionScopeControls
        agents={agentOptions}
        selectedAgentId={selectedAgentId}
        grouping={grouping}
        sortMode={sortMode}
        agentsLoading={agentsLoading}
        agentsFailed={Boolean(agentsError)}
        onAgentChange={setSelectedAgentId}
        onGroupingChange={changeGrouping}
        onSortModeChange={setSortMode}
        onCreateAgent={() => navigate('/agents?new=1')}
        onOpenAgentSettings={() => {
          if (selectedAgentId) navigate(`/agents?agent=${encodeURIComponent(selectedAgentId)}`);
        }}
      />

      <div className="flex-1 overflow-y-auto min-h-0 px-1">
        {agentsError ? (
          <div role="alert" className="mx-3 mb-2 rounded-md border border-aegis-danger/20 bg-aegis-danger/[0.06] px-3 py-2 text-[11px] text-aegis-danger">
            {t('sidebar.sessions.loadAgentsFailed', '智能体列表加载失败，Gateway 将自动重试。')}
          </div>
        ) : sessionsError ? (
          <div role="alert" className="mx-3 mb-2 rounded-md border border-aegis-danger/20 bg-aegis-danger/[0.06] px-3 py-2 text-[11px] text-aegis-danger">
            {t('sidebar.sessions.loadSessionsFailed', '会话列表加载失败，Gateway 将自动重试。')}
          </div>
        ) : visibleRowCount === 0 && (agentsLoading || sessionsLoading) ? (
          <div role="status" className="px-4 py-3 text-[13px] text-aegis-text-dim">
            {t('sidebar.sessions.loading', '正在加载会话')}
          </div>
        ) : visibleRowCount === 0 ? (
          <div className="px-4 py-3 text-[13px] text-aegis-text-dim">{t('sidebar.noSessions', '暂无对话')}</div>
        ) : null}

        {sidebarProjection.mainSession ? (
          <div className="mb-1">
            {renderRow(sidebarProjection.mainSession)}
          </div>
        ) : null}

        {sidebarProjection.pinnedSessions.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-aegis-text-dim">
              <Pin size={11} className="opacity-70" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t('chat.pinnedSessions')}</span>
              <span className="text-[10.5px] font-mono text-aegis-text-dim/70">{sidebarProjection.pinnedSessions.length}</span>
            </div>
            {sidebarProjection.pinnedSessions.map(renderRow)}
          </div>
        )}

        {sidebarProjection.categories.map((category) => (
          <div key={category.id} className="mb-2">
            <SessionCategoryHeader category={category} count={category.sessions.length} />
            {category.sessions.map(renderRow)}
          </div>
        ))}

        {sidebarProjection.ungroupedSessions.length > 0 ? (
          <div className="mb-2">
            {sidebarProjection.ungroupedSessions.map(renderRow)}
          </div>
        ) : null}

        {sidebarProjection.flatSessions.length > 0 ? (
          <div className="mb-2">
            {sidebarProjection.flatSessions.map(renderRow)}
          </div>
        ) : null}

        {archivedSessions.length > 0 && (
          <div className="mt-2 border-t border-aegis-border/70 pt-2">
            <button
              type="button"
              onClick={() => setArchivedOpen((current) => !current)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-semibold text-aegis-text-dim transition-colors hover:text-aegis-text-secondary"
              aria-expanded={archivedOpen}
            >
              {archivedOpen ? <ChevronDown size={11} className="opacity-60" /> : <ChevronRight size={11} className="opacity-60" />}
              <ArchiveRestore size={12} className="opacity-70" />
              <span className="min-w-0 flex-1 truncate">{t('sidebar.archivedSessions')}</span>
              <span className="font-mono text-[10.5px] text-aegis-text-dim/70">{archivedSessions.length}</span>
            </button>
            {archivedOpen && archivedSessions.map((session) => (
              <div key={session.key} className="group/archived-session flex items-center gap-1 px-2 py-0.5">
                <button
                  type="button"
                  onClick={() => {
                    void setSessionArchived(session.key, false).then(() => {
                      useChatStore.getState().openTab(session.key);
                      navigate('/chat');
                    }).catch((error: unknown) => {
                      useNotificationStore.getState().addToast('error', t('chat.sessionActions'), error instanceof Error ? error.message : String(error));
                    });
                  }}
                  className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-[11px] text-aegis-text-dim transition-colors hover:bg-aegis-hover/35 hover:text-aegis-text-secondary"
                  title={displaySessionTitle(session)}
                >
                  {displaySessionTitle(session)}
                </button>
                <button
                  type="button"
                  onClick={() => void setSessionArchived(session.key, false).catch((error: unknown) => {
                    useNotificationStore.getState().addToast('error', t('chat.sessionActions'), error instanceof Error ? error.message : String(error));
                  })}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-aegis-text-dim opacity-0 transition-opacity hover:bg-aegis-hover/40 hover:text-aegis-text focus-visible:opacity-100 group-hover/archived-session:opacity-100"
                  title={t('sidebar.restoreSession')}
                  aria-label={t('sidebar.restoreSession')}
                >
                  <ArchiveRestore size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {backgroundTotal > 0 && (
        <div className="mx-3 shrink-0 border-t border-aegis-border/70 px-1 pb-1 pt-2">
          <button
            type="button"
            onClick={() => setBackgroundUserOpen((current) => !current)}
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
                  const running = group.some((session) => activityProjection.bySessionKey.get(session.key)?.active);
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
                          const state = activityProjection.bySessionKey.get(session.key)?.state ?? 'unknown';
                          const isSelected = item.kind === 'subagent'
                            ? location.pathname === '/chat' && activeKey === session.key
                            : routedBackgroundSessionKey === session.key;
                          const title = displaySessionTitle(session);
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
                            <div key={session.key} className="group/background-session relative">
                              <button
                                type="button"
                                onClick={() => openBackgroundSession(item.kind, session.key)}
                                className={clsx(
                                  'flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 pr-9 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/50',
                                  isSelected
                                    ? 'bg-aegis-primary/[0.08] text-aegis-primary'
                                    : 'text-aegis-text-dim hover:bg-aegis-hover/35 hover:text-aegis-text-secondary',
                                )}
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
                                    'inline-flex shrink-0 items-center gap-1 text-[9.5px] transition-opacity group-hover/background-session:opacity-0 group-focus-within/background-session:opacity-0',
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
                              <button
                                type="button"
                                onClick={() => deleteBackgroundSession(session.key)}
                                className="absolute end-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-aegis-text-dim opacity-0 transition-[opacity,color,background-color] hover:bg-aegis-danger/10 hover:text-aegis-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-danger/50 group-hover/background-session:opacity-100 group-focus-within/background-session:opacity-100"
                                title={t('chat.deleteSession', '删除会话')}
                                aria-label={t('chat.deleteSession', '删除会话')}
                              >
                                <Trash2 size={11} aria-hidden="true" />
                              </button>
                            </div>
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

      {isFeatureEnabled('sessions') ? (
        <div className="mx-3 shrink-0 border-t border-aegis-border/70 py-1.5">
          <button
            type="button"
            onClick={() => navigate('/sessions')}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-aegis-text-dim transition-colors hover:bg-aegis-hover/30 hover:text-aegis-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/50"
          >
            <span className="min-w-0 flex-1 truncate">{t('sidebar.sessions.all', '所有会话')}</span>
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Panel Registry — 真 React 组件 Map
// ═══════════════════════════════════════════════════════════

const PANEL_REGISTRY: Record<SidebarTab, React.ComponentType> = {
  workbench: WorkbenchPanel,
  agents:    AgentsPanel,
  businessApplications: BusinessApplicationsPanel,
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
    <nav className="flex flex-col items-start gap-1 pe-2 ps-[var(--aegis-sidebar-mini-control-start)]">
      {/* 迷你模式顶部保留当前面板名称，避免仅靠图标失去语义。 */}
      <div
        title={t(`sidebar.tab.${tab}`, tab)}
        className="h-7 w-[var(--aegis-sidebar-mini-control-size)] mt-0.5 mb-1 flex items-center justify-center rounded-md
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
          className="h-[var(--aegis-sidebar-mini-control-size)] w-[var(--aegis-sidebar-mini-control-size)] flex items-center justify-center rounded-lg text-aegis-text-muted hover:text-aegis-text hover:bg-aegis-hover/40"
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
    case 'businessApplications': return [
      { to: '/business-applications', icon: <Wrench size={20} />, label: t('businessApplications.workspaceTools', '有效工具'), feature: 'businessApplications' },
      { to: '/business-applications?view=activity', icon: <ListChecks size={20} />, label: t('businessApplications.workspaceActivity', '操作审计'), feature: 'businessApplications' },
      { to: '/business-applications?view=runtime', icon: <Settings2 size={20} />, label: t('businessApplications.workspaceRuntime', '接入与授权'), feature: 'businessApplications' },
    ];
    case 'tools': return [
      { to: '/ai-workspace', icon: <Bot size={20} />, label: t('nav.agentTasks', 'Agent 任务'), feature: 'agentRun' },
      { to: '/briefs', icon: <BookOpenText size={20} />, label: t('nav.taskBriefs'), feature: 'agentRun' },
      { to: '/terminal', icon: <Terminal size={20} />, label: t('nav.terminal', 'Terminal'), feature: 'terminal' },
      { to: '/files', icon: <Folder size={20} />, label: t('nav.files', 'Files'), feature: 'files' },
      { to: OPENCLAW_TOOLS_ROUTE, icon: <Cpu size={20} />, label: t('nav.openClawTools', 'OpenClaw Tools'), feature: 'configManager' },
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
