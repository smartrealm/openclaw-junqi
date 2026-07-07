// NavSidebar — Context-sensitive sidebar (4 Panel 组件, Tab 切换整体替换)
// 每个 Panel 是真 React 组件，hooks 各自管理。Registry 按 tab 分发。

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, MessageSquare, Bot, Terminal, Settings, Brain, Folder, Clock, Calendar, BarChart3, Puzzle, Activity, Wrench, Database, Cpu, FileText, Volume2, ListChecks, Pencil, Trash2, X, History, Power, PowerOff, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore, type Session } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useSkillsStore } from '@/stores/skillsStore';
import { gateway } from '@/services/gateway';
import { showConfirm } from '@/components/shared/AlertDialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { resolveTab, type SidebarTab } from './tab-utils';
import {
  bucketSessionsByActivity,
  isEmptyTransientSession,
  isSessionActive,
  sessionActivityTime,
  sessionTitle,
  type SessionBucketKey,
} from './sidebarUtils';
import { SidebarRow, SidebarSection } from './SidebarRow';
import { applySessionRename } from '@/utils/sessionRename';

// ═══════════════════════════════════════════════════════════
// 静态配置
// ═══════════════════════════════════════════════════════════

function toolCategories(t: ReturnType<typeof useTranslation>['t']): ReadonlyArray<{ to: string; icon: React.ReactNode; label: string }> {
  return [
    { to: '/workshop', icon: <Folder size={14} />,    label: t('nav.workspace', '工作空间') },
    { to: '/terminal', icon: <Terminal size={14} />,  label: t('nav.terminal', '终端') },
    { to: '/files',    icon: <FileText size={14} />,  label: t('nav.files', '文件管理') },
    { to: '/tools',    icon: <Database size={14} />,  label: t('nav.mcpTools', 'MCP 工具') },
    { to: '/cron',     icon: <Clock size={14} />,     label: t('nav.cron', '定时任务') },
    { to: '/calendar', icon: <Calendar size={14} />,  label: t('nav.calendar', '日历') },
    { to: '/sandbox',  icon: <Wrench size={14} />,   label: t('nav.sandbox', '代码沙盒') },
    { to: '/git',      icon: <Cpu size={14} />,       label: t('nav.gitRepo', 'Git 仓库') },
    { to: '/kanban',   icon: <ListChecks size={14} />, label: t('nav.kanban', '看板') },
    { to: '/timeline', icon: <History size={14} />,   label: t('nav.timeline', '时间线') },
  ];
}

function settingsGroups(t: ReturnType<typeof useTranslation>['t']): ReadonlyArray<{ label: string; items: ReadonlyArray<{ to: string; icon: React.ReactNode; label: string }> }> {
  return [
    { label: t('nav.general', '通用'), items: [
      { to: '/settings', icon: <Settings size={14} />, label: t('nav.generalSettings', '通用设置') },
    ]},
    { label: t('nav.diagMonitor', '诊断与监控'), items: [
      { to: '/logs',     icon: <FileText size={14} />,  label: t('nav.logs', '日志') },
      { to: '/perf',     icon: <Activity size={14} />,  label: t('nav.perf', '性能') },
      { to: '/analytics', icon: <BarChart3 size={14} />, label: t('nav.usage', '用量') },
    ]},
  ];
}

function agentToolLinks(t: ReturnType<typeof useTranslation>['t']): ReadonlyArray<{ to: string; icon: React.ReactNode; label: string }> {
  return [
    { to: '/config',   icon: <Bot size={14} />,           label: t('nav.agentConfig', '智能体配置') },
    { to: '/sessions', icon: <MessageSquare size={14} />, label: t('nav.sessionManager', '会话管理') },
    { to: '/memory',   icon: <Brain size={14} />,         label: t('nav.memory', '记忆管理') },
    { to: '/agent-run', icon: <Activity size={14} />,     label: t('nav.agentRun', 'Agent 运行') },
    { to: '/agents/live', icon: <Bot size={14} />,        label: t('nav.liveAgents', '多智能体视图') },
  ];
}

function parseSkillStatus(result: any): Array<[string, { name: string; enabled: boolean }]> {
  const list: any[] = result?.skills || result?.entries || [];
  const entries: Array<[string, { name: string; enabled: boolean }]> = [];
  for (const item of list) {
    const slug = item?.skillKey || item?.slug || item?.name || '';
    if (!slug) continue;
    entries.push([slug, { name: item?.name || slug, enabled: item?.enabled !== false }]);
  }
  return entries;
}

function sessionAgentId(session: Session, sessionKey: string): string {
  if (session.agentId) return session.agentId;
  const parts = String(sessionKey || '').split(':');
  if (parts[0] !== 'agent') return 'main';
  return parts[1] || 'main';
}

function sessionChannelLabel(channel?: string | null): string | null {
  if (!channel) return null;
  const normalized = channel.trim().toLowerCase();
  if (!normalized || normalized === 'web' || normalized === 'webchat' || normalized === 'desktop') return null;
  const labels: Record<string, string> = {
    feishu: '飞书',
    lark: '飞书',
    dingtalk: '钉钉',
    dingding: '钉钉',
    wechat: '微信',
    wecom: '企微',
    slack: 'Slack',
  };
  return labels[normalized] ?? channel;
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

function compactMeta(value: string, max = 22): string {
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const agentId = sessionAgentId(session, sessionKey);
  const agentName = agents.find((agent: any) => agent?.id === agentId)?.name || agentId;
  const agentLabel = compactMeta(agentName || t('agents.mainAgent', 'Main Agent'));
  const isRunning = isSessionActive(session);
  const channelLabel = sessionChannelLabel(session.channel ?? session.lastChannel ?? null);
  const timeLabel = formatSidebarTime(sessionActivityTime(session));

  const goSession = () => {
    cleanupEmptyActiveSession(sessionKey);
    useChatStore.getState().setActiveSession(sessionKey);
    navigate('/chat');
  };

  const startRename = useCallback(() => {
    setRenameValue(currentTitle);
    setRenaming(true);
    // Focus after the row re-renders with the input.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [currentTitle]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
    setRenameValue('');
  }, []);

  const submitRename = useCallback(async () => {
    if (renamingInFlight) return;
    if (!renameValue.trim() || renameValue.trim() === currentTitle) {
      cancelRename();
      return;
    }
    setRenamingInFlight(true);
    try {
      await applySessionRename(sessionKey, renameValue);
      // Both the sidebar row and the chat tab read from the same
      // useChatStore.sessions record, so the rename auto-syncs to
      // the top ChatTabs row without any extra wiring.
      window.dispatchEvent(new Event('aegis:refresh'));
    } finally {
      setRenamingInFlight(false);
      cancelRename();
    }
  }, [renameValue, currentTitle, renamingInFlight, cancelRename, sessionKey]);

  const handleDelete = useCallback(() => {
    showConfirm(
      t('chat.deleteSession', '删除会话'),
      t('chat.deleteSessionConfirm', '确定删除此会话及其历史记录？此操作不可撤销。'),
      async () => {
        try { await gateway.deleteSession(sessionKey); } catch {}
        useChatStore.getState().removeSession(sessionKey);
      }
    );
  }, [sessionKey, t]);

  if (renaming) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-[rgb(var(--aegis-primary)/0.10)] border-l-2 border-l-aegis-primary">
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => void submitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submitRename(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
          }}
          disabled={renamingInFlight}
          className="flex-1 min-w-0 h-[24px] px-2 rounded bg-aegis-bg border border-aegis-primary/40 text-[13px] text-aegis-text outline-none focus:border-aegis-primary"
        />
        <button
          onClick={(e) => { e.stopPropagation(); cancelRename(); }}
          className="p-1 rounded text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-hover/40"
          title={t('common.cancel', '取消')}
        >
          <X size={11} />
        </button>
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
          'flex w-full cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2.5 text-left transition-colors',
          'hover:border-aegis-border/70 hover:bg-aegis-hover/25',
          isActive
            ? 'border-aegis-primary/40 bg-aegis-primary/[0.10] text-aegis-text shadow-[inset_2px_0_0_rgb(var(--aegis-primary))]'
            : 'border-transparent text-aegis-text-secondary',
        )}
        >
        <span
          className={clsx(
            'mt-[7px] h-2 w-2 shrink-0 rounded-full',
            isRunning ? 'bg-aegis-success shadow-[0_0_0_3px_rgb(var(--aegis-success)/0.12)]' : isActive ? 'bg-aegis-primary' : 'bg-aegis-text-dim/35',
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={clsx(
              'min-w-0 flex-1 truncate text-[13px] font-medium leading-5 tracking-normal',
              isActive ? 'text-aegis-text' : 'text-aegis-text-secondary',
            )}>
              {currentTitle}
            </span>
            {isRunning && (
              <span className="shrink-0 rounded-full bg-aegis-success/10 px-1.5 py-0.5 text-[10px] font-semibold leading-3 text-aegis-success">
                {t('sessions.statusRunning', 'Running')}
              </span>
            )}
          </span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] leading-4 text-aegis-text-dim">
            <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-aegis-overlay/[0.035] px-1.5 py-0.5">
              <Bot size={10.5} className="shrink-0 opacity-70" />
              <span className="truncate">{agentLabel}</span>
            </span>
            {channelLabel && (
              <span className="inline-flex items-center gap-1 rounded-md bg-aegis-primary/[0.08] px-1.5 py-0.5 text-aegis-primary/90">
                <MessageSquare size={10.5} className="shrink-0 opacity-75" />
                <span className="truncate">{compactMeta(channelLabel, 10)}</span>
              </span>
            )}
            {timeLabel && (
              <span className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-aegis-text-dim/80">
                <Clock size={10.5} className="shrink-0 opacity-65" />
                <span>{timeLabel}</span>
              </span>
            )}
          </span>
        </span>
        <span className={clsx(
          'relative z-10 ml-1 flex shrink-0 items-center gap-0.5 rounded-md bg-aegis-surface/80 opacity-0 transition-opacity',
          'group-hover/session:opacity-100 group-focus-within/session:opacity-100',
        )}>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); startRename(); }}
          className="flex h-6 w-6 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover/50 hover:text-aegis-text"
          title={t('chat.renameSession', 'Rename session')}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          className="flex h-6 w-6 items-center justify-center rounded text-aegis-text-dim hover:bg-red-500/10 hover:text-red-400"
          title={t('chat.deleteSession', 'Delete session')}
        >
          <Trash2 size={12} />
        </button>
        </span>
      </div>
    </div>
  );
}

function WorkbenchPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sessions = useChatStore((st) => st.sessions) ?? [];
  const activeKey = useChatStore((st) => st.activeSessionKey) ?? '';
  const [nowMs, setNowMs] = useState(Date.now());
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

  const visibleSessions = useMemo(
    () => sessions.filter((sx) => !sx.key?.includes(':subagent:') && !sx.archived),
    [sessions],
  );
  const buckets = useMemo(() => bucketSessionsByActivity(visibleSessions, nowMs), [visibleSessions, nowMs]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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

  // Quick-create dropdown. The "split button" pattern: the left half
  // creates a chat (the most common action), the right chevron opens a
  // menu with the other quick-create targets. The menu mirrors the
  // primary creation entry points across the app — agent / model /
  // channel / cron — so the user doesn't have to navigate to a settings
  // page just to spin up a new entity.
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const quickMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!quickMenuOpen) return;
    // (No more split-button / dropdown. Each quick-create item is now its
    //  own dedicated row button so users can hit any one with a single click
    //  without first opening a chevron.)
  }, [/* no listeners needed without the dropdown */ 0]);

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
            const newKey = `agent:main:s-${Date.now().toString(36).slice(-5)}`;
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
          { key: 'models',  to: '/config?tab=providers',    label: t('sidebar.nav.models',  '模型'),     icon: <Cpu size={14} /> },
          { key: 'channels', to: '/channels',              label: t('sidebar.nav.channels', '通道'),     icon: <MessageSquare size={14} /> },
          { key: 'cron',    to: '/cron?new=1',              label: t('sidebar.nav.cron',    '定时任务'), icon: <Clock size={14} /> },
        ].map((it) => {
          const active = location.pathname === it.to.split('?')[0] && (
            (it.to.includes('tab=providers') && location.search.includes('tab=providers')) ||
            (it.to === '/channels' && location.pathname.startsWith('/channels')) ||
            (it.to === '/agents' && location.pathname.startsWith('/agents')) ||
            (it.to === '/cron?new=1' && location.pathname.startsWith('/cron'))
          );
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => navigate(it.to)}
              className={clsx(
                'h-8 px-2 -mx-2 rounded-md text-[13px] text-left flex items-center gap-2.5 transition-colors',
                active
                  ? 'text-aegis-primary bg-aegis-primary/[0.08] font-semibold'
                  : 'text-aegis-text-secondary hover:text-aegis-text hover:bg-aegis-hover/30',
              )}
            >
              <span className={clsx('shrink-0', active ? 'text-aegis-primary' : 'text-aegis-text-dim')}>
                {it.icon}
              </span>
              <span className="flex-1">{it.label}</span>
            </button>
          );
        })}
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
    </>
  );
}

function AgentsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useGatewayDataStore((st) => (st as any).agents) ?? [];
  const sessions = useChatStore((st) => st.sessions) ?? [];
  const skillList = useSkillsStore((s) => s.skills);
  const refreshSkills = useSkillsStore((s) => s.refresh);
  const setSkillEnabled = useSkillsStore((s) => s.setEnabled);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [agentSkillEntries, setAgentSkillEntries] = useState<Record<string, Array<[string, { name: string; enabled: boolean }]>>>({});
  const [loadingAgentSkills, setLoadingAgentSkills] = useState<string | null>(null);

  // Load skills once when the Agents panel mounts. Refresh is cheap (one
  // gateway RPC) so we don't cache across panels — the value here is
  // always fresh when the user opens this panel.
  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  const runningIds = useMemo(() => {
    const set = new Set<string>();
    for (const sx of sessions) {
      if (!sx?.key || typeof sx.key !== 'string') continue;
      if (sx.running !== true) continue;
      const parts = sx.key.split(':');
      if (parts[0] === 'agent' && parts[1]) set.add(parts[1]);
    }
    return set;
  }, [sessions]);

  const skillEntries = Object.entries(skillList);
  const enabledSkillEntries = skillEntries.filter(([, info]) => info.enabled !== false);
  useEffect(() => {
    if (!expandedAgentId || agentSkillEntries[expandedAgentId]) return;
    let cancelled = false;
    setLoadingAgentSkills(expandedAgentId);
    gateway.getSkills(expandedAgentId)
      .then((result) => {
        if (cancelled) return;
        const parsed = parseSkillStatus(result).filter(([, info]) => info.enabled !== false);
        setAgentSkillEntries((prev) => ({ ...prev, [expandedAgentId]: parsed }));
      })
      .catch(() => {
        if (!cancelled) setAgentSkillEntries((prev) => ({ ...prev, [expandedAgentId]: [] }));
      })
      .finally(() => {
        if (!cancelled) setLoadingAgentSkills((prev) => prev === expandedAgentId ? null : prev);
      });
    return () => { cancelled = true; };
  }, [expandedAgentId, agentSkillEntries]);

  const sortedAgents = useMemo(() => {
    const rows = [...agents];
    if (!rows.some((a: any) => a.id === 'main')) {
      const mainSession = sessions.find((sx: any) => typeof sx?.key === 'string' && sx.key.startsWith('agent:main:'));
      rows.unshift({
        id: 'main',
        name: t('agents.mainAgent', 'Main Agent'),
        model: mainSession?.model,
      });
    }
    return rows.sort((a: any, b: any) => {
      const aRunning = runningIds.has(a.id) ? 1 : 0;
      const bRunning = runningIds.has(b.id) ? 1 : 0;
      if (aRunning !== bRunning) return bRunning - aRunning;
      if (a.id === 'main') return -1;
      if (b.id === 'main') return 1;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
  }, [agents, runningIds, sessions, t]);

  return (
    <>
      <div className="px-3 mb-1">
        <button type="button" onClick={() => navigate('/agents?new=1')}
          className="w-full h-9 bg-aegis-primary text-white rounded font-semibold text-[14px] flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity">
          <Plus size={14} />{t('sidebar.newAgent', '新建智能体')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {sortedAgents.length > 0 && (
          <SidebarSection label={t('sidebar.active', '在线智能体')}>
            {sortedAgents.map((a: any) => {
              const isExpanded = expandedAgentId === a.id;
              const isLive = runningIds.has(a.id);
              const scopedSkills = agentSkillEntries[a.id];
              const visibleSkills = scopedSkills && scopedSkills.length > 0 ? scopedSkills : enabledSkillEntries;
              const isLoadingSkills = loadingAgentSkills === a.id;
              return (
                <div key={a.id} className="mb-1">
                  <div className="flex items-center gap-1 px-3 py-1.5 hover:bg-aegis-hover/30 transition-colors">
                    <button
                      type="button"
                      onClick={() => setExpandedAgentId((prev) => prev === a.id ? null : a.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {isExpanded ? <ChevronDown size={12} className="text-aegis-text-dim" /> : <ChevronRight size={12} className="text-aegis-text-dim" />}
                      <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", isLive ? "bg-aegis-success animate-pulse" : "bg-aegis-text-dim/45")} />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-[13px] leading-5 text-aegis-text-secondary">{a.name || a.id}</span>
                        <span className="block truncate text-[11px] leading-4 text-aegis-text-dim">{typeof a.model === 'string' ? a.model.split('/').pop() : a.id}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/agents?agent=${encodeURIComponent(a.id)}`)}
                      className="shrink-0 rounded p-1 text-aegis-text-dim hover:bg-aegis-primary/10 hover:text-aegis-primary"
                      title={t('common.edit', 'Edit')}
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="ms-7 me-3 mb-1 rounded-lg border border-aegis-border/40 bg-aegis-surface/35 py-1">
                      {isLoadingSkills && (
                        <div className="px-3 py-2 text-[11.5px] text-aegis-text-dim">
                          {t('common.loading', 'Loading...')}
                        </div>
                      )}
                      {!isLoadingSkills && visibleSkills.length > 0 ? visibleSkills.map(([slug, info]) => (
                        <button
                          key={`${a.id}:${slug}`}
                          type="button"
                          onClick={() => navigate('/skill-hub')}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-aegis-text-secondary hover:text-aegis-primary hover:bg-aegis-primary/10"
                        >
                          <Puzzle size={11} className="shrink-0 text-aegis-primary/80" />
                          <span className="truncate">{info.name}</span>
                        </button>
                      )) : !isLoadingSkills ? (
                        <div className="px-3 py-2 text-[11.5px] text-aegis-text-dim">
                          {t('sidebar.noAgentSkills', '暂无可用技能')}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </SidebarSection>
        )}
        <SidebarSection label={t('nav.agentTools', '智能体工具')}>
          {agentToolLinks(t).map((it) => (
            <SidebarRow key={it.to} icon={it.icon} title={it.label} onClick={() => navigate(it.to)} />
          ))}
        </SidebarSection>
        {skillEntries.length > 0 && (
          <SidebarSection label={t('nav.agentSkills', '智能体技能')}>
            <SidebarRow icon={<Puzzle size={14} />} title={t('nav.skillManager', '技能管理')} onClick={() => navigate('/skill-hub')} />
            {skillEntries.map(([slug, info]) => {
              const enabled = info.enabled !== false;
              return (
                <div key={slug} className="flex items-center gap-2 px-4 py-1.5 group">
                  <Puzzle size={12} className={enabled ? 'text-aegis-primary opacity-80' : 'text-aegis-text-dim opacity-50'} />
                  <span
                    onClick={() => navigate('/skill-hub')}
                    className={clsx('flex-1 text-[13px] leading-5 truncate cursor-pointer', enabled ? 'text-aegis-text' : 'text-aegis-text-dim line-through')}>
                    {info.name}
                  </span>
                  <button
                    type="button"
                    aria-label={enabled ? t('skills.disable', 'Disable') : t('skills.enable', 'Enable')}
                    title={enabled ? t('skills.disable', 'Disable') : t('skills.enable', 'Enable')}
                    onClick={() => void setSkillEnabled(slug, !enabled)}
                    className={clsx('shrink-0 w-6 h-6 rounded flex items-center justify-center transition-colors',
                      enabled
                        ? 'text-aegis-primary hover:bg-aegis-primary/15'
                        : 'text-aegis-text-dim hover:bg-aegis-hover/40')}
                  >
                    {enabled ? <Power size={11} /> : <PowerOff size={11} />}
                  </button>
                </div>
              );
            })}
          </SidebarSection>
        )}
        {sortedAgents.length === 0 && <div className="px-4 py-3 text-[13px] text-aegis-text-dim">{t('sidebar.noAgents', '暂无已配置的智能体')}</div>}
      </div>
    </>
  );
}

function ToolsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <div className="px-3 mb-1">
        <button type="button" onClick={() => navigate('/terminal')}
          className="w-full h-9 bg-aegis-overlay/[0.05] border border-aegis-border text-aegis-text rounded font-semibold text-[14px] flex items-center justify-center gap-1.5 hover:bg-aegis-hover/40 transition-colors">
          <Terminal size={14} />{t('sidebar.openTerminal', '快速打开终端')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <SidebarSection label={t('sidebar.toolCategories', '工具分类')}>
          {toolCategories(t).map((it) => (
            <SidebarRow key={it.to} icon={it.icon} title={it.label} active={location.pathname === it.to} onClick={() => navigate(it.to)} />
          ))}
        </SidebarSection>
      </div>
    </>
  );
}

function SettingsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {settingsGroups(t).map((g) => (
        <SidebarSection key={g.label} label={g.label}>
          {g.items.map((it) => (
            <SidebarRow key={it.to} icon={it.icon} title={it.label} active={location.pathname === it.to} onClick={() => navigate(it.to)} />
          ))}
        </SidebarSection>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Panel Registry — 真 React 组件 Map
// ═══════════════════════════════════════════════════════════

const PANEL_REGISTRY: Record<SidebarTab, React.ComponentType> = {
  workbench: WorkbenchPanel,
  agents:    AgentsPanel,
  tools:     ToolsPanel,
  settings:  SettingsPanel,
};

// ═══════════════════════════════════════════════════════════
// Mini 模式 + Expanded 模式
// ═══════════════════════════════════════════════════════════

function ExpandedView({ tab }: { tab: SidebarTab }) {
  const Panel = PANEL_REGISTRY[tab] ?? WorkbenchPanel;
  // key={tab} forces a clean remount on tab change so no hook state from the
  // previous panel can leak into the next (defensive against React #310).
  return <Panel key={tab} />;
}

function MiniView({ tab }: { tab: SidebarTab }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const items = miniItemsFor(tab);
  return (
    <nav className="flex flex-col items-center gap-1 px-2">
      {/* Active-tab chip — single text label at top so users always know
          which panel they're seeing in mini mode. Without this the icons
          alone give no semantic context. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="w-10 h-7 mt-0.5 mb-1 flex items-center justify-center rounded-md
            bg-aegis-primary/15 border border-aegis-primary/25
            text-aegis-primary text-[11.5px] font-bold uppercase tracking-wider select-none">
            {t(`sidebar.tab.${tab}`, tab.slice(0, 1).toUpperCase())}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">{t(`sidebar.tab.${tab}`, tab)}</TooltipContent>
      </Tooltip>
      {items.map((it) => (
        <Tooltip key={`${it.to}:${it.label}`}>
          <TooltipTrigger asChild>
            <button type="button"
              onClick={() => navigate(it.to)}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-aegis-text-muted hover:text-aegis-text hover:bg-aegis-hover/40">
              {it.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{it.label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

function miniItemsFor(tab: SidebarTab): ReadonlyArray<{ to: string; icon: React.ReactNode; label: string }> {
  switch (tab) {
    case 'agents': return [
      { to: '/agents?new=1', icon: <Plus size={20} />, label: '新建智能体' },
      { to: '/agents', icon: <Bot size={20} />, label: '智能体' },
      { to: '/memory', icon: <Brain size={20} />, label: '记忆' },
    ];
    case 'tools': return [
      { to: '/terminal', icon: <Terminal size={20} />, label: '终端' },
      { to: '/files', icon: <Folder size={20} />, label: '文件' },
      { to: '/tools', icon: <Cpu size={20} />, label: 'MCP 工具' },
    ];
    case 'settings': return [
      { to: '/settings', icon: <Settings size={20} />, label: '设置' },
      { to: '/config', icon: <Bot size={20} />, label: '配置' },
      { to: '/logs', icon: <FileText size={20} />, label: '日志' },
    ];
    case 'workbench':
    default: return [
      { to: '/chat', icon: <Plus size={20} />, label: '新建对话' },
      { to: '/chat', icon: <MessageSquare size={20} />, label: '对话' },
      { to: '/workshop', icon: <Folder size={20} />, label: '工作空间' },
    ];
  }
}

// ═══════════════════════════════════════════════════════════
// NavSidebar 顶层
// ═══════════════════════════════════════════════════════════

export function NavSidebar() {
  const location = useLocation();
  const { sidebarMode } = useSettingsStore();
  const isHidden = sidebarMode === 'hidden';
  const isMini = sidebarMode === 'mini';
  const isExpanded = sidebarMode === 'expanded';
  const targetWidth = isExpanded ? 220 : isMini ? 64 : 0;
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
