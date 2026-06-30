// NavSidebar — Context-sensitive sidebar (Strategy Pattern)
//
// 顶层组件只负责容器 + 状态路由。Tab → Panel 的映射通过 PanelRegistry
// 注入，避免组件内 switch case。新增 Tab 只需在 registry 注册，
// 不必修改 NavSidebar。

import { useMemo, type ReactNode, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, MessageSquare, Bot, Terminal, Settings, Brain, Folder, Clock, Calendar, BarChart3, Puzzle, Activity, Wrench, Database, Cpu, FileText, Volume2, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { resolveTab, type SidebarTab } from './tab-utils';
import { sessionTitle, isSessionActive, partitionSessions, type PanelActions } from './sidebarUtils';
import { SidebarRow, SidebarSection } from './SidebarRow';

// ═══════════════════════════════════════════════════════════
// Strategy 接口
// ═══════════════════════════════════════════════════════════

interface PanelStrategy {
  /** 主操作按钮（顶部） */
  primary: {
    label: string;
    icon: ReactNode;
    onClick: (navigate: ReturnType<typeof useNavigate>) => void;
    filled?: boolean;
  } | null;
  /** 分组列表 */
  groups: Array<{
    label: string;
    rows: Array<{
      key: string;
      icon?: ReactNode;
      title: string;
      meta?: string;
      live?: boolean;
      active?: boolean;
      to?: string;
      onClick?: () => void;
    }>;
  }>;
  /** 空状态文案 */
  emptyText?: string;
}

type PanelComponent = (actions: PanelActions) => PanelStrategy;

// ═══════════════════════════════════════════════════════════
// 工具函数：useNavigate 同步桥
// ═══════════════════════════════════════════════════════════

function useNavActions(): PanelActions {
  const navigate = useNavigate();
  return {
    navigate: (to: string) => navigate(to),
    goSession: (key: string) => {
      useChatStore.getState().setActiveSession(key);
      navigate('/chat');
    },
    navigateActiveSession: (key: string) => {
      useChatStore.getState().setActiveSession(key);
      navigate('/chat');
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 4 个 Panel 策略实现
// ═══════════════════════════════════════════════════════════

const workbenchPanel: PanelComponent = (act) => {
  const { t } = useTranslation();
  const location = useLocation();
  const sessions = useChatStore((st) => st.sessions) ?? [];
  const typingBySession = useChatStore((st) => st.typingBySession) ?? {};
  const activeKey = useChatStore((st) => st.activeSessionKey) ?? '';
  const { active, recent } = partitionSessions(sessions, typingBySession);

  return {
    primary: {
      label: t('sidebar.newChat', '新建对话'),
      icon: <Plus size={14} />,
      onClick: (n) => n('/chat'),
      filled: true,
    },
    groups: [
      ...(active.length > 0 ? [{
        label: t('sidebar.active', '进行中'),
        rows: active.map((sx) => ({
          key: sx.key,
          live: true,
          title: sessionTitle(sx),
          meta: typeof sx.model === 'string' ? sx.model.split('/').pop() : undefined,
          onClick: () => act.goSession(sx.key),
        })),
      }] : []),
      ...(recent.length > 0 ? [{
        label: t('sidebar.recent', '最近对话'),
        rows: recent.slice(0, 20).map((sx) => ({
          key: sx.key,
          active: sx.key === activeKey,
          title: sessionTitle(sx),
          meta: typeof sx.model === 'string' ? sx.model.split('/').pop() : undefined,
          onClick: () => act.goSession(sx.key),
        })),
      }] : []),
    ],
    emptyText: t('sidebar.noSessions', '暂无对话'),
  };
};

const agentsPanel: PanelComponent = (act) => {
  const { t } = useTranslation();
  const agents: any[] = useGatewayDataStore((st) => st.agents) ?? [];
  const sessions = useChatStore((st) => st.sessions) ?? [];

  const runningIds = useMemo(() => {
    const set = new Set<string>();
    for (const sx of sessions) {
      if (isSessionActive(sx)) {
        const parts = sx.key.split(':');
        if (parts[0] === 'agent' && parts[1]) set.add(parts[1]);
      }
    }
    return set;
  }, [sessions]);

  return {
    primary: {
      label: t('sidebar.newAgent', '新建智能体'),
      icon: <Plus size={14} />,
      onClick: (n) => n('/agents?new=1'),
      filled: true,
    },
    groups: [
      ...(agents.length > 0 ? [{
        label: t('sidebar.active', '在线智能体'),
        rows: agents.map((a) => ({
          key: a.id,
          live: runningIds.has(a.id),
          title: a.name || a.id,
          meta: typeof a.model === 'string' ? a.model.split('/').pop() : undefined,
          onClick: () => act.navigate(`/agents?agent=${encodeURIComponent(a.id)}`),
        })),
      }] : []),
      {
        label: t('sidebar.subAgents', '子页面'),
        rows: [
          { key: '/memory',    icon: <Brain size={14} />,    title: t('nav.memory', '记忆管理'), onClick: () => act.navigate('/memory') },
          { key: '/agent-run', icon: <Activity size={14} />, title: t('nav.agentRun', 'Agent 运行'), onClick: () => act.navigate('/agent-run') },
          { key: '/skills',    icon: <Puzzle size={14} />,   title: t('nav.skills', '技能市场'), onClick: () => act.navigate('/skills') },
        ],
      },
    ],
    emptyText: t('sidebar.noAgents', '暂无已配置的智能体'),
  };
};

const toolsPanel: PanelComponent = (act) => {
  const { t } = useTranslation();
  const location = useLocation();
  return {
    primary: {
      label: t('sidebar.openTerminal', '快速打开终端'),
      icon: <Terminal size={14} />,
      onClick: (n) => n('/terminal'),
      filled: false,
    },
    groups: [{
      label: t('sidebar.toolCategories', '工具分类'),
      rows: TOOL_CATEGORIES.map((it) => ({
        key: it.to,
        icon: it.icon,
        title: it.label,
        active: location.pathname === it.to,
        onClick: () => act.navigate(it.to),
      })),
    }],
  };
};

const settingsPanel: PanelComponent = (act) => {
  const { t } = useTranslation();
  const location = useLocation();
  return {
    primary: undefined as never, // settings panel 无顶部按钮
    groups: SETTINGS_GROUPS.map((g) => ({
      label: g.label,
      rows: g.items.map((it) => ({
        key: it.to,
        icon: it.icon,
        title: it.label,
        active: location.pathname === it.to,
        onClick: () => act.navigate(it.to),
      })),
    })),
  };
};

// ═══════════════════════════════════════════════════════════
// 静态数据
// ═══════════════════════════════════════════════════════════

const TOOL_CATEGORIES: ReadonlyArray<{ to: string; icon: ReactNode; label: string }> = [
  { to: '/sessions', icon: <ListChecks size={14} />, label: '会话历史' },
  { to: '/workshop', icon: <Folder size={14} />,    label: '工作空间' },
  { to: '/terminal', icon: <Terminal size={14} />,  label: '终端' },
  { to: '/files',    icon: <FileText size={14} />,  label: '文件管理' },
  { to: '/tools',    icon: <Database size={14} />,  label: 'MCP 工具' },
  { to: '/cron',     icon: <Clock size={14} />,     label: '定时任务' },
  { to: '/calendar', icon: <Calendar size={14} />,  label: '日历' },
  { to: '/sandbox',  icon: <Wrench size={14} />,   label: '代码沙盒' },
  { to: '/git',      icon: <Cpu size={14} />,       label: 'Git 仓库' },
  { to: '/files',    icon: <Volume2 size={14} />,   label: '媒体预览' },
] as const;

interface SettingsGroup {
  label: string;
  items: ReadonlyArray<{ to: string; icon: ReactNode; label: string }>;
}

const SETTINGS_GROUPS: ReadonlyArray<SettingsGroup> = [
  { label: '通用', items: [
    { to: '/settings', icon: <Settings size={14} />, label: '通用设置' },
    { to: '/config',   icon: <Bot size={14} />,      label: '智能体配置' },
    { to: '/memory',   icon: <Brain size={14} />,    label: '记忆' },
  ]},
  { label: '诊断与监控', items: [
    { to: '/logs',     icon: <FileText size={14} />,  label: '日志' },
    { to: '/perf',     icon: <Activity size={14} />,  label: '性能' },
    { to: '/analytics', icon: <BarChart3 size={14} />, label: '用量' },
  ]},
  { label: '管理', items: [
    { to: '/sessions', icon: <MessageSquare size={14} />, label: '会话管理' },
    { to: '/skills',   icon: <Puzzle size={14} />,       label: '技能' },
  ]},
] as const;

// ═══════════════════════════════════════════════════════════
// Panel Registry
// ═══════════════════════════════════════════════════════════

const PANEL_REGISTRY: Record<SidebarTab, PanelComponent> = {
  workbench: workbenchPanel,
  agents:    agentsPanel,
  tools:     toolsPanel,
  settings:  settingsPanel,
};

// ═══════════════════════════════════════════════════════════
// Sidebar 子组件 — 纯展示，由父组件传入 strategy
// ═══════════════════════════════════════════════════════════

function PrimaryButton({ spec, onClick }: { spec: PanelStrategy['primary'] | undefined; onClick: (n: ReturnType<typeof useNavigate>) => void }) {
  const navigate = useNavigate();
  if (!spec) return null;
  return (
    <div className="px-3 mb-1">
      <button
        type="button"
        onClick={() => spec.onClick(navigate)}
        className={clsx(
          'w-full h-9 rounded font-semibold text-[13px] flex items-center justify-center gap-1.5 transition-colors',
          spec.filled
            ? 'bg-aegis-primary text-white hover:opacity-90'
            : 'bg-aegis-overlay/[0.05] border border-aegis-border text-aegis-text hover:bg-aegis-hover/40',
        )}
      >
        {spec.icon}{spec.label}
      </button>
    </div>
  );
}

function PanelBody({ strategy }: { strategy: PanelStrategy }) {
  const hasContent = strategy.groups.some((g) => g.rows.length > 0);
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {strategy.groups.map((g) => (
        <SidebarSection key={g.label} label={g.label}>
          {g.rows.map((r) => (
            <SidebarRow
              key={r.key}
              icon={r.icon}
              title={r.title}
              meta={r.meta}
              live={r.live}
              active={r.active}
              onClick={r.onClick ?? (() => {})}
            />
          ))}
        </SidebarSection>
      ))}
      {!hasContent && strategy.emptyText && (
        <div className="px-4 py-3 text-[11px] text-aegis-text-dim">{strategy.emptyText}</div>
      )}
    </div>
  );
}

/** 包装为真正的 React 组件 — PanelComponent 是返回 strategy 数据的纯函数，
 *  不能直接作为 JSX 组件使用（会触发 hooks 规则违规）。
 *  这里用一个空壳组件固定 hooks 调用点，确保每次 render 走同一条路径。 */
function PanelRenderer({ tab, actions }: { tab: SidebarTab; actions: PanelActions }) {
  const Panel: PanelComponent = PANEL_REGISTRY[tab] ?? workbenchPanel;
  const strategy = Panel(actions);
  return (
    <>
      <PrimaryButton spec={strategy.primary} onClick={() => {}} />
      <PanelBody strategy={strategy} />
    </>
  );
}

function ExpandedView({ tab }: { tab: SidebarTab }) {
  const actions = useNavActions();
  return <PanelRenderer tab={tab} actions={actions} />;
}

function MiniView({ tab }: { tab: SidebarTab }) {
  const navigate = useNavigate();
  const items = miniItemsFor(tab);
  return (
    <nav className="flex flex-col items-center gap-1 px-2">
      {items.map((it) => (
        <button
          key={it.to}
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

function miniItemsFor(tab: SidebarTab): ReadonlyArray<{ to: string; icon: ReactNode; label: string }> {
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
      return [
        { to: '/chat', icon: <Plus size={18} />, label: '新建对话' },
        { to: '/chat', icon: <MessageSquare size={18} />, label: '对话' },
        { to: '/workshop', icon: <Folder size={18} />, label: '工作空间' },
      ];
  }
}

// ═══════════════════════════════════════════════════════════
// NavSidebar 顶层 — 纯容器 + 状态路由
// ═══════════════════════════════════════════════════════════

export function NavSidebar() {
  const location = useLocation();
  const { sidebarMode } = useSettingsStore();
  const isHidden = sidebarMode === 'hidden';
  const isMini = sidebarMode === 'mini';
  const isExpanded = sidebarMode === 'expanded';
  const targetWidth = isExpanded ? 220 : isMini ? 64 : 0;
  const tab = resolveTab(location.pathname);

  if (isHidden) return null;

  return (
    <motion.aside
      initial={false}
      animate={{ width: targetWidth, opacity: 1 }}
      transition={{ type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.24 }}
      className={clsx(
        'shrink-0 flex flex-col overflow-hidden py-3',
        isMini ? 'items-center' : 'items-stretch',
        'border-r border-aegis-border',
      )}
      style={{ background: 'linear-gradient(180deg, var(--aegis-surface), var(--aegis-surface-elevated))' }}
      aria-label="侧边导航栏"
    >
      {isMini  ? <MiniView tab={tab} /> : null}
      {isExpanded ? <ExpandedView tab={tab} /> : null}
    </motion.aside>
  );
}
