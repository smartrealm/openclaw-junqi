// NavSidebar — Context-sensitive sidebar (4 Panel 组件, Tab 切换整体替换)
// 每个 Panel 是真 React 组件，hooks 各自管理。Registry 按 tab 分发。

import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, MessageSquare, Bot, Terminal, Settings, Brain, Folder, Clock, Calendar, BarChart3, Puzzle, Activity, Wrench, Database, Cpu, FileText, Volume2, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { resolveTab, type SidebarTab } from './tab-utils';
import { sessionTitle, partitionSessions } from './sidebarUtils';
import { SidebarRow, SidebarSection } from './SidebarRow';

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
  ]},
];

// ═══════════════════════════════════════════════════════════
// 4 个 Panel — 真正 React 组件，hooks 各组件内独立调用
// ═══════════════════════════════════════════════════════════

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
              <SidebarRow key={sx.key} live title={sessionTitle(sx)}
                meta={typeof sx.model === 'string' ? sx.model.split('/').pop() : undefined}
                onClick={() => goSession(sx.key)} />
            ))}
          </SidebarSection>
        )}
        {recent.length > 0 && (
          <SidebarSection label={t('sidebar.recent', '最近对话')}>
            {recent.slice(0, 20).map((sx) => (
              <SidebarRow key={sx.key} title={sessionTitle(sx)} active={sx.key === activeKey}
                meta={typeof sx.model === 'string' ? sx.model.split('/').pop() : undefined}
                onClick={() => goSession(sx.key)} />
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
  const items = miniItemsFor(tab);
  return (
    <nav className="flex flex-col items-center gap-1 px-2">
      {items.map((it) => (
        <button key={`${it.to}:${it.label}`} type="button" title={it.label}
          onClick={() => navigate(it.to)}
          className="w-10 h-10 flex items-center justify-center rounded-lg text-aegis-text-muted hover:text-aegis-text hover:bg-aegis-hover/40">
          {it.icon}
        </button>
      ))}
    </nav>
  );
}

function miniItemsFor(tab: SidebarTab): ReadonlyArray<{ to: string; icon: React.ReactNode; label: string }> {
  switch (tab) {
    case 'agents': return [
      { to: '/agents?new=1', icon: <Plus size={18} />, label: '新建智能体' },
      { to: '/agents', icon: <Bot size={18} />, label: '智能体' },
      { to: '/memory', icon: <Brain size={18} />, label: '记忆' },
    ];
    case 'tools': return [
      { to: '/terminal', icon: <Terminal size={18} />, label: '终端' },
      { to: '/files', icon: <Folder size={18} />, label: '文件' },
      { to: '/tools', icon: <Cpu size={18} />, label: 'MCP 工具' },
    ];
    case 'settings': return [
      { to: '/settings', icon: <Settings size={18} />, label: '设置' },
      { to: '/config', icon: <Bot size={18} />, label: '配置' },
      { to: '/logs', icon: <FileText size={18} />, label: '日志' },
    ];
    case 'workbench':
    default: return [
      { to: '/chat', icon: <Plus size={18} />, label: '新建对话' },
      { to: '/chat', icon: <MessageSquare size={18} />, label: '对话' },
      { to: '/workshop', icon: <Folder size={18} />, label: '工作空间' },
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
