import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowUpRight, BarChart3, BookOpenText, Bot, Brain, Calendar, Clock, Cpu, Database, FileText, Folder, History, KeyRound, ListChecks, MessageSquare, Plus, Puzzle, Server, Settings, Terminal, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useSkillsStore } from '@/stores/skillsStore';
import { SidebarRow, SidebarSection } from './SidebarRow';
import { filterEnabledNavigationItems, type FeatureLinkedItem } from './navigationVisibility';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import { agentIdFromSessionKey, projectSessionActivity } from '@/utils/sessionPresentation';

type NavigationItem = FeatureLinkedItem & { to: string; icon: React.ReactNode; label: string };

function toolCategories(t: ReturnType<typeof useTranslation>['t']): ReadonlyArray<NavigationItem> {
  return [
    { to: '/activity',  icon: <Activity size={14} />,  label: t('nav.activity', '活动中心'), feature: 'dashboard' },
    { to: '/workshop', icon: <Folder size={14} />,    label: t('nav.workspace', '工作空间'), feature: 'workshop' },
    { to: '/ai-workspace', icon: <Bot size={14} />,   label: t('nav.agentTasks', 'Agent 任务'), feature: 'agentRun' },
    { to: '/terminal', icon: <Terminal size={14} />,  label: t('nav.terminal', '终端'), feature: 'terminal' },
    { to: '/files',    icon: <FileText size={14} />,  label: t('nav.files', '文件管理'), feature: 'files' },
    { to: '/tools',    icon: <Database size={14} />,  label: t('nav.mcpTools', 'MCP 工具'), feature: 'tools' },
    { to: '/cron',     icon: <Clock size={14} />,     label: t('nav.cron', '定时任务'), feature: 'cron' },
    { to: '/calendar', icon: <Calendar size={14} />,  label: t('nav.calendar', '日历'), feature: 'calendar' },
    { to: '/sandbox',  icon: <Wrench size={14} />,    label: t('nav.sandbox', '代码沙盒'), feature: 'sandbox' },
    { to: '/git',      icon: <Cpu size={14} />,       label: t('nav.gitRepo', 'Git 仓库'), feature: 'git' },
    { to: '/kanban',   icon: <ListChecks size={14} />, label: t('nav.kanban', '看板'), feature: 'workshop' },
    { to: '/timeline', icon: <History size={14} />,    label: t('nav.timeline', '时间线'), feature: 'workshop' },
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

function agentToolLinks(t: ReturnType<typeof useTranslation>['t']): ReadonlyArray<NavigationItem> {
  return [
    { to: '/config',   icon: <Bot size={14} />,           label: t('nav.agentConfig', '智能体配置'), feature: 'configManager' },
    { to: '/sessions', icon: <MessageSquare size={14} />, label: t('nav.sessionManager', '会话管理'), feature: 'sessions' },
    { to: '/memory',   icon: <Brain size={14} />,         label: t('nav.memory', '记忆管理'), feature: 'memory' },
    { to: '/agents/live', icon: <Bot size={14} />,        label: t('nav.liveAgents', '多智能体视图'), feature: 'liveAgents' },
  ];
}

export function AgentsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const agents = useGatewayDataStore((st) => st.agents);
  const sessions = useChatStore((st) => st.sessions);
  const activeSessionKey = useChatStore((st) => st.activeSessionKey);
  const typingBySession = useChatStore((st) => st.typingBySession);
  const typingStartedAtBySession = useChatStore((st) => st.typingStartedAtBySession);
  const thinkingBySession = useChatStore((st) => st.thinkingBySession);
  const sendingBySession = useChatStore((st) => st.sendingBySession);
  const skillList = useSkillsStore((s) => s.skills);
  const refreshSkills = useSkillsStore((s) => s.refresh);

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  const activityProjection = useMemo(() => projectSessionActivity({
    sessions,
    activeSessionKey,
    typingBySession,
    typingStartedAtBySession,
    thinkingBySession,
    sendingBySession,
  }), [activeSessionKey, sendingBySession, sessions, thinkingBySession, typingBySession, typingStartedAtBySession]);
  const runningIds = useMemo(() => {
    const set = new Set<string>();
    for (const activity of activityProjection.active) {
      const agentId = activity.session?.agentId || agentIdFromSessionKey(activity.sessionKey);
      if (agentId) set.add(agentId);
    }
    return set;
  }, [activityProjection]);

  const skillEntries = Object.entries(skillList);
  const enabledSkillEntries = skillEntries.filter(([, info]) => info.enabled !== false);
  const enabledSkillPercent = skillEntries.length > 0
    ? Math.round((enabledSkillEntries.length / skillEntries.length) * 100)
    : 0;

  const sessionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      if (typeof session?.key !== 'string') continue;
      const [, agentId] = session.key.split(':');
      if (!agentId) continue;
      counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
    }
    return counts;
  }, [sessions]);

  const sortedAgents = useMemo(() => {
    const rows = [...agents];
    if (!rows.some((a: any) => a.id === 'main')) {
      const mainSession = sessions.find((sx: any) => typeof sx?.key === 'string' && sx.key.startsWith('agent:main:'));
      rows.unshift({
        id: 'main',
        name: t('agents.mainAgent', 'Main Agent'),
        model: mainSession?.model ?? undefined,
      });
    }
    return rows.sort((a: any, b: any) => {
      const aRunning = runningIds.has(a.id) ? 1 : 0;
      const bRunning = runningIds.has(b.id) ? 1 : 0;
      if (aRunning !== bRunning) return bRunning - aRunning;
      if (a.id === 'main') return -1;
      if (b.id === 'main') return 1;
      return getAgentDisplayName(a).localeCompare(getAgentDisplayName(b));
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
              const isLive = runningIds.has(a.id);
              const sessionCount = sessionCounts.get(a.id) ?? 0;
              const displayName = getAgentDisplayName(
                a,
                a.id === 'main' ? t('agents.mainAgent', 'Main Agent') : a.id,
              );
              const model = typeof a.model === 'string' ? a.model.split('/').pop() : '';
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => navigate(`/agents?agent=${encodeURIComponent(a.id)}`)}
                  title={t('sidebar.openAgentDetails', { name: displayName, defaultValue: '打开 {{name}} 详情' })}
                  className="group mx-2 mb-1 flex w-[calc(100%_-_1rem)] min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-aegis-hover/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
                >
                  <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-aegis-border/50 bg-aegis-overlay/[0.05] text-[12px] font-semibold text-aegis-text-secondary">
                    {displayName.slice(0, 1).toUpperCase()}
                    <i className={clsx('absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-aegis-surface', isLive ? 'bg-aegis-success' : 'bg-aegis-text-dim/55')} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <strong className="truncate text-[12.5px] font-medium leading-4 text-aegis-text-secondary">{displayName}</strong>
                      {isLive && <em className="shrink-0 text-[9.5px] not-italic text-aegis-success">{t('sidebar.agentRunning', '执行中')}</em>}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10.5px] leading-4 text-aegis-text-dim">
                      <span className="truncate">{model || a.id}</span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0 tabular-nums">{t('sidebar.agentSessionCount', { count: sessionCount, defaultValue: '{{count}} 个会话' })}</span>
                    </span>
                  </span>
                  <ArrowUpRight size={12} className="shrink-0 text-aegis-text-dim opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                </button>
              );
            })}
          </SidebarSection>
        )}
        <SidebarSection label={t('nav.agentTools', '智能体工具')}>
          {filterEnabledNavigationItems(agentToolLinks(t)).map((it) => (
            <SidebarRow key={it.to} icon={it.icon} title={it.label} onClick={() => navigate(it.to)} />
          ))}
        </SidebarSection>
        {skillEntries.length > 0 && (
          <div className="px-2 py-2">
            <button
              type="button"
              onClick={() => navigate('/skill-hub')}
              title={t('sidebar.sharedSkillsHint', '当前技能由所有智能体共享，在技能管理中统一启停。')}
              className="group w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-aegis-hover/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-aegis-primary/10 text-aegis-primary">
                  <Puzzle size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <strong className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-aegis-text-secondary">
                      {t('sidebar.sharedSkills', '共享技能')}
                    </strong>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-aegis-text-dim transition-colors group-hover:text-aegis-primary">
                      {t('nav.skillManager', '技能管理')}
                      <ArrowUpRight size={11} aria-hidden="true" />
                    </span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-aegis-border/60">
                      <span
                        className="block h-full rounded-full bg-aegis-primary transition-[width] duration-300"
                        style={{ width: `${enabledSkillPercent}%` }}
                      />
                    </span>
                    <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-aegis-text-dim">
                      {enabledSkillEntries.length}/{skillEntries.length}
                    </span>
                  </span>
                </span>
              </span>
            </button>
          </div>
        )}
        {sortedAgents.length === 0 && <div className="px-4 py-3 text-[13px] text-aegis-text-dim">{t('sidebar.noAgents', '暂无已配置的智能体')}</div>}
      </div>
    </>
  );
}

export function ToolsPanel() {
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
          {filterEnabledNavigationItems(toolCategories(t)).map((it) => (
            <SidebarRow key={it.to} icon={it.icon} title={it.label} active={location.pathname === it.to} onClick={() => navigate(it.to)} />
          ))}
        </SidebarSection>
      </div>
    </>
  );
}

const COMMAND_CATEGORY_LINKS = [
  { id: 'all', count: 55, Icon: BookOpenText },
  { id: 'setup', count: 5, Icon: Settings },
  { id: 'gateway', count: 9, Icon: Server },
  { id: 'diagnostics', count: 9, Icon: Activity },
  { id: 'models', count: 13, Icon: Bot },
  { id: 'auth', count: 7, Icon: KeyRound },
  { id: 'channels', count: 5, Icon: MessageSquare },
  { id: 'automation', count: 7, Icon: Clock },
] as const;

export function CommandsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedCategory = new URLSearchParams(location.search).get('category') ?? 'all';
  const selectedCategory = COMMAND_CATEGORY_LINKS.some((item) => item.id === requestedCategory)
    ? requestedCategory
    : 'all';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-aegis-border px-4 pb-3 pt-1">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-aegis-primary/12 text-aegis-primary">
            <BookOpenText size={16} />
          </span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold leading-4 text-aegis-text">
              {t('openclawCommands.title')}
            </div>
            <div className="text-[11px] tabular-nums text-aegis-text-dim">
              {t('openclawCommands.resultCount', { count: 55 })}
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <SidebarSection label={t('openclawCommands.categoryLabel')}>
          {COMMAND_CATEGORY_LINKS.map(({ id, count, Icon }) => (
            <SidebarRow
              key={id}
              icon={<Icon size={14} />}
              title={t(`openclawCommands.categories.${id}`)}
              meta={t('openclawCommands.resultCount', { count })}
              active={selectedCategory === id}
              onClick={() => navigate(id === 'all' ? '/openclaw-commands' : `/openclaw-commands?category=${id}`)}
            />
          ))}
        </SidebarSection>
      </div>
    </div>
  );
}

export function SettingsPanel() {
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
