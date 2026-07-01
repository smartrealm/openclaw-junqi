// NavSidebar — Context-sensitive sidebar (4 Panel 组件, Tab 切换整体替换)
// 每个 Panel 是真 React 组件，hooks 各自管理。Registry 按 tab 分发。

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Plus, MessageSquare, Bot, Terminal, Settings, Brain, Folder, Clock, Calendar, BarChart3, Puzzle, Activity, Wrench, Database, Cpu, FileText, Volume2, ListChecks, Pencil, Trash2, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { showConfirm } from '@/components/shared/AlertDialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { resolveTab, type SidebarTab } from './tab-utils';
import { sessionTitle, partitionSessions } from './sidebarUtils';
import { SidebarRow, SidebarSection } from './SidebarRow';
import { applySessionRename } from '@/utils/sessionRename';

// ═══════════════════════════════════════════════════════════
// 静态配置
// ═══════════════════════════════════════════════════════════

const TOOL_CATEGORIES: ReadonlyArray<{ to: string; icon: React.ReactNode; label: string }> = [
  { to: '/workshop', icon: <Folder size={14} />,    label: '工作空间' },
  { to: '/terminal', icon: <Terminal size={14} />,  label: '终端' },
  { to: '/files',    icon: <FileText size={14} />,  label: '文件管理' },
  { to: '/tools',    icon: <Database size={14} />,  label: 'MCP 工具' },
  { to: '/cron',     icon: <Clock size={14} />,     label: '定时任务' },
  { to: '/calendar', icon: <Calendar size={14} />,  label: '日历' },
  { to: '/sandbox',  icon: <Wrench size={14} />,   label: '代码沙盒' },
  { to: '/git',      icon: <Cpu size={14} />,       label: 'Git 仓库' },
  { to: '/kanban',   icon: <ListChecks size={14} />, label: '看板' },
  { to: '/timeline', icon: <Clock size={14} />,     label: '时间线' },
];

const SETTINGS_GROUPS: ReadonlyArray<{ label: string; items: ReadonlyArray<{ to: string; icon: React.ReactNode; label: string }> }> = [
  { label: '通用', items: [
    { to: '/settings', icon: <Settings size={14} />, label: '通用设置' },
    { to: '/config',   icon: <Bot size={14} />,      label: '智能体配置' },
  ]},
  { label: '诊断与监控', items: [
    { to: '/logs',     icon: <FileText size={14} />,  label: '日志' },
    { to: '/perf',     icon: <Activity size={14} />,  label: '性能' },
    { to: '/analytics', icon: <BarChart3 size={14} />, label: '用量' },
  ]},
  { label: '管理', items: [
    { to: '/sessions', icon: <MessageSquare size={14} />, label: '会话管理' },
    { to: '/skill-hub', icon: <Puzzle size={14} />,       label: '技能管理' },
  ]},
];

// ═══════════════════════════════════════════════════════════
// 4 个 Panel — 真正 React 组件，hooks 各组件内独立调用
// ═══════════════════════════════════════════════════════════

function SessionRowItem({ sessionKey, currentTitle, isActive, meta }: {
  sessionKey: string;
  currentTitle: string;
  isActive: boolean;
  meta?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(currentTitle);
  const [renamingInFlight, setRenamingInFlight] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const goSession = () => {
    useChatStore.getState().setActiveSession(sessionKey);
    navigate('/chat');
  };

  const startRename = useCallback(() => {
    setCtxMenu(null);
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
    setCtxMenu(null);
    showConfirm(
      t('chat.deleteSession', '删除会话'),
      t('chat.deleteSessionConfirm', '确定删除此会话及其历史记录？此操作不可撤销。'),
      async () => {
        try { await (await import('@/services/gateway')).gateway.deleteSession(sessionKey); } catch {}
        useChatStore.getState().removeSession(sessionKey);
      }
    );
  }, [sessionKey, t]);

  const handleReset = useCallback(() => {
    setCtxMenu(null);
    showConfirm(
      t('chat.resetSession', '重置会话'),
      t('chat.resetSessionConfirm', '确定清除此会话的对话历史？会话本身会保留。'),
      async () => {
        const { clearSessionMessages, clearSessionTokens } = useChatStore.getState();
        try { await (await import('@/services/gateway')).gateway.resetSession(sessionKey); } catch {}
        clearSessionMessages(sessionKey);
        clearSessionTokens(sessionKey);
        window.dispatchEvent(new CustomEvent('aegis:session-reset'));
      }
    );
  }, [sessionKey, t]);

  // Close context menu on outside click.
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ctxMenu]);

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
          className="flex-1 min-w-0 h-[24px] px-2 rounded bg-aegis-bg border border-aegis-primary/40 text-[12px] text-aegis-text outline-none focus:border-aegis-primary"
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
    <>
      <div
        onDoubleClick={(e) => { e.stopPropagation(); startRename(); }}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <SidebarRow
          title={currentTitle}
          active={isActive}
          meta={meta}
          onClick={goSession}
        />
      </div>
      {ctxMenu && createPortal(
        <div
          ref={ctxRef}
          className="fixed z-[9999] min-w-[160px] py-1 rounded-lg border bg-aegis-menu-bg border-aegis-menu-border text-[12px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y, boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <button
            onClick={startRename}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
          >
            <Pencil size={13} className="opacity-60" />
            {t('chat.renameSession', 'Rename session')}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
          >
            <RefreshCw size={13} className="opacity-60" />
            {t('chat.resetSession', 'Reset session')}
          </button>
          <div className="my-1 border-t border-[rgb(var(--aegis-overlay)/0.06)]" />
          <button
            onClick={handleDelete}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={13} />
            {t('chat.deleteSession', 'Delete session')}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

function WorkbenchPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sessions = useChatStore((st) => st.sessions) ?? [];
  const typingBySession = useChatStore((st) => st.typingBySession) ?? {};
  const activeKey = useChatStore((st) => st.activeSessionKey) ?? '';
  const { active, recent } = partitionSessions(sessions, typingBySession);

  const goSession = (key: string) => {
    useChatStore.getState().setActiveSession(key);
    navigate('/chat');
  };

  return (
    <>
      <div className="px-3 mb-1">
        <button type="button" onClick={() => navigate('/chat')}
          className="w-full h-9 bg-aegis-primary text-white rounded font-semibold text-[13px] flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity">
          <Plus size={14} />{t('sidebar.newChat', '新建对话')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {active.length > 0 && (
          <SidebarSection label={t('sidebar.active', '进行中')}>
            {active.map((sx) => (
              <SessionRowItem key={sx.key} sessionKey={sx.key}
                currentTitle={sessionTitle(sx)} isActive={sx.key === activeKey}
                meta={typeof sx.model === 'string' ? sx.model.split('/').pop() : undefined} />
            ))}
          </SidebarSection>
        )}
        {recent.length > 0 && (
          <SidebarSection label={t('sidebar.recent', '最近对话')}>
            {recent.slice(0, 20).map((sx) => (
              <SessionRowItem key={sx.key} sessionKey={sx.key}
                currentTitle={sessionTitle(sx)} isActive={sx.key === activeKey}
                meta={typeof sx.model === 'string' ? sx.model.split('/').pop() : undefined} />
            ))}
          </SidebarSection>
        )}
        {active.length === 0 && recent.length === 0 && (
          <div className="px-4 py-3 text-[11px] text-aegis-text-dim">{t('sidebar.noSessions', '暂无对话')}</div>
        )}
      </div>
    </>
  );
}

function AgentsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useGatewayDataStore((st) => (st as any).agents) ?? [];
  const sessions = useChatStore((st) => st.sessions) ?? [];

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

  return (
    <>
      <div className="px-3 mb-1">
        <button type="button" onClick={() => navigate('/agents?new=1')}
          className="w-full h-9 bg-aegis-primary text-white rounded font-semibold text-[13px] flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity">
          <Plus size={14} />{t('sidebar.newAgent', '新建智能体')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {agents.length > 0 && (
          <SidebarSection label={t('sidebar.active', '在线智能体')}>
            {agents.map((a: any) => (
              <SidebarRow key={a.id} live={runningIds.has(a.id)} title={a.name || a.id}
                meta={typeof a.model === 'string' ? a.model.split('/').pop() : undefined}
                onClick={() => navigate(`/agents?agent=${encodeURIComponent(a.id)}`)} />
            ))}
          </SidebarSection>
        )}
        <SidebarSection label={t('sidebar.subAgents', '子页面')}>
          <SidebarRow icon={<Brain size={14} />} title={t('nav.memory', '记忆管理')} onClick={() => navigate('/memory')} />
          <SidebarRow icon={<Activity size={14} />} title={t('nav.agentRun', 'Agent 运行')} onClick={() => navigate('/agent-run')} />
          <SidebarRow icon={<Bot size={14} />} title={t('nav.liveAgents', '多智能体视图')} onClick={() => navigate('/agents/live')} />
          <SidebarRow icon={<Puzzle size={14} />} title={t('nav.skills', '技能市场')} onClick={() => navigate('/skills')} />
        </SidebarSection>
        {agents.length === 0 && <div className="px-4 py-3 text-[11px] text-aegis-text-dim">{t('sidebar.noAgents', '暂无已配置的智能体')}</div>}
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
          className="w-full h-9 bg-aegis-overlay/[0.05] border border-aegis-border text-aegis-text rounded font-semibold text-[13px] flex items-center justify-center gap-1.5 hover:bg-aegis-hover/40 transition-colors">
          <Terminal size={14} />{t('sidebar.openTerminal', '快速打开终端')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <SidebarSection label={t('sidebar.toolCategories', '工具分类')}>
          {TOOL_CATEGORIES.map((it) => (
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
      {SETTINGS_GROUPS.map((g) => (
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
            text-aegis-primary text-[10px] font-bold uppercase tracking-wider select-none">
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
