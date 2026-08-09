import { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowUpRight, BarChart3, BookOpenText, Bot, Brain, Building2, Calendar, Clock, Cpu, Database, FileText, Folder, History, ListChecks, MessageSquare, Plus, Puzzle, Settings, Settings2, Terminal, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useChatStore } from '@/stores/chatStore';
import { OPENCLAW_TOOLS_ROUTE } from '@/config/openClawToolsRoute';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useSkillsStore } from '@/stores/skillsStore';
import { SidebarRow, SidebarSection } from './SidebarRow';
import { filterEnabledNavigationItems, type FeatureLinkedItem } from './navigationVisibility';
import { getAgentDisplayName } from '@/utils/agentDisplayName';
import { agentIdFromSessionKey, projectSessionActivity } from '@/utils/sessionPresentation';
import { SidebarPrimaryAction } from './SidebarPrimaryAction';
import { collectDingTalkTools } from '@/business-applications/dingtalkTools';
import { useBusinessActivityStore } from '@/business-applications/activityStore';

type NavigationItem = FeatureLinkedItem & { to: string; icon: React.ReactNode; label: string };

function toolCategories(t: ReturnType<typeof useTranslation>['t']): ReadonlyArray<NavigationItem> {
  return [
    { to: '/activity',  icon: <Activity size={14} />,  label: t('nav.activity', '活动中心'), feature: 'dashboard' },
    { to: '/workshop', icon: <Folder size={14} />,    label: t('nav.workspace', '工作空间'), feature: 'workshop' },
    { to: '/ai-workspace', icon: <Bot size={14} />,   label: t('nav.agentTasks', 'Agent 任务'), feature: 'agentRun' },
    { to: '/briefs', icon: <BookOpenText size={14} />, label: t('nav.taskBriefs'), feature: 'agentRun' },
    { to: '/terminal', icon: <Terminal size={14} />,  label: t('nav.terminal', '终端'), feature: 'terminal' },
    { to: '/files',    icon: <FileText size={14} />,  label: t('nav.files', '文件管理'), feature: 'files' },
    { to: OPENCLAW_TOOLS_ROUTE, icon: <Database size={14} />, label: t('nav.openClawTools', 'OpenClaw 工具'), feature: 'configManager' },
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
  const compactionStatusBySession = useChatStore((st) => st.compactionStatusBySession);
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
    compactionStatusBySession,
  }), [activeSessionKey, compactionStatusBySession, sendingBySession, sessions, thinkingBySession, typingBySession, typingStartedAtBySession]);
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
      <SidebarPrimaryAction icon={<Plus size={16} />} onClick={() => navigate('/agents?new=1')}>
        {t('sidebar.newAgent', '新建智能体')}
      </SidebarPrimaryAction>
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
              onClick={() => navigate('/skills')}
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
      <SidebarPrimaryAction icon={<Terminal size={16} />} onClick={() => navigate('/terminal')}>
        {t('sidebar.openTerminal', '快速打开终端')}
      </SidebarPrimaryAction>
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

export function BusinessApplicationsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const view = new URLSearchParams(location.search).get('view');
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const sessions = useChatStore((state) => state.sessions);
  const effective = useGatewayDataStore((state) => state.toolsEffective[activeSessionKey]);
  const toolsLoading = useGatewayDataStore((state) => (
    state.toolsEffectiveLoading && state.toolsEffectiveLoadingSessionKey === activeSessionKey
  ));
  const attempts = useBusinessActivityStore((state) => state.attempts);
  const activeSession = sessions.find((session) => session.key === activeSessionKey) ?? null;
  const toolCount = useMemo(() => collectDingTalkTools(effective?.groups).length, [effective]);
  const agentId = effective?.agentId ?? activeSession?.agentId ?? null;
  const latestAttempt = attempts[0] ?? null;
  const toolsMeta = toolsLoading
    ? t('businessApplications.sidebarToolsLoading', '正在读取当前 Session')
    : activeSession
      ? t('businessApplications.sidebarToolsCount', '{{count}} 个当前有效工具', { count: toolCount })
      : t('businessApplications.sidebarNoSession', '尚未选择有效 Session');
  const activityMeta = attempts.length > 0
    ? t('businessApplications.sidebarActivityCount', '{{count}} 条本窗口投影', { count: attempts.length })
    : t('businessApplications.sidebarAuditBoundary', '官方审计与本窗口投影');
  const openWorkbench = (nextView: 'tools' | 'activity' | 'runtime') => {
    navigate({ pathname: '/business-applications', search: nextView === 'tools' ? '' : `?view=${nextView}` });
  };
  return (
    <>
      <div className="mx-2 mb-3 mt-1 rounded-lg border border-aegis-border/75 bg-aegis-surface/55 p-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-aegis-primary/25 bg-aegis-primary/10 text-aegis-primary">
            <Building2 size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-aegis-text">
              {t('businessApplications.sidebarPlatformName', '钉钉工作台')}
            </div>
            <div className="mt-0.5 truncate text-[10.5px] text-aegis-text-dim">
              {t('businessApplications.sidebarPlatformContext', '当前唯一业务平台')}
            </div>
          </div>
          <span className="h-2 w-2 shrink-0 rounded-full bg-aegis-primary" aria-label={t('businessApplications.sidebarPlatformActive', '当前平台')} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarSection label={t('businessApplications.sidebarTitle', '工作区')}>
          <SidebarRow
            icon={<Wrench size={14} />}
            title={t('businessApplications.workspaceTools', '有效工具')}
            meta={toolsMeta}
            active={location.pathname === '/business-applications' && view !== 'activity' && view !== 'runtime'}
            onClick={() => openWorkbench('tools')}
          />
          <SidebarRow
            icon={<ListChecks size={14} />}
            title={t('businessApplications.workspaceActivity', '操作审计')}
            meta={activityMeta}
            active={location.pathname === '/business-applications' && view === 'activity'}
            onClick={() => openWorkbench('activity')}
          />
          <SidebarRow
            icon={<Settings2 size={14} />}
            title={t('businessApplications.workspaceRuntime', '接入与授权')}
            meta={t('businessApplications.sidebarRuntimeBoundary', 'Session、插件、Agent、DWS')}
            active={location.pathname === '/business-applications' && view === 'runtime'}
            onClick={() => openWorkbench('runtime')}
          />
        </SidebarSection>
        <SidebarSection label={t('businessApplications.sidebarCurrentContext', '当前上下文')}>
          <div className="mx-2 rounded-md border border-aegis-border/70 bg-aegis-overlay/[0.025] px-2.5 py-2.5">
            <dl className="grid grid-cols-[48px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[10.5px]">
              <dt className="text-aegis-text-dim">Session</dt>
              <dd className="truncate font-mono text-aegis-text-secondary" title={activeSessionKey || undefined}>{activeSession ? activeSessionKey : t('businessApplications.sidebarNotSelected', '未选择')}</dd>
              <dt className="text-aegis-text-dim">Agent</dt>
              <dd className="truncate font-mono text-aegis-text-secondary" title={agentId ?? undefined}>{agentId ?? t('businessApplications.sidebarNotReturned', '未返回')}</dd>
            </dl>
          </div>
        </SidebarSection>
        <SidebarSection label={t('businessApplications.sidebarRecentActivity', '最近操作')}>
          <button
            type="button"
            onClick={() => openWorkbench('activity')}
            className="group mx-2 flex w-[calc(100%_-_1rem)] items-start gap-2 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-aegis-border hover:bg-aegis-hover/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
          >
            <span className={clsx(
              'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
              latestAttempt?.state === 'succeeded'
                ? 'bg-aegis-success'
                : latestAttempt?.state === 'failed'
                  ? 'bg-aegis-danger'
                  : latestAttempt ? 'bg-aegis-warning' : 'bg-aegis-text-dim/55',
            )} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-medium text-aegis-text-secondary">
                {latestAttempt?.toolLabel ?? t('businessApplications.sidebarNoActivity', '本窗口尚无业务操作')}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-aegis-text-dim">
                {latestAttempt
                  ? t('businessApplications.sidebarActivityState', '{{state}} · {{agent}}', {
                    state: latestAttempt.state,
                    agent: latestAttempt.agentId ?? t('businessApplications.sidebarNotReturned', '未返回'),
                  })
                  : t('businessApplications.sidebarNoActivityHint', '打开操作审计查看官方记录')}
              </span>
            </span>
            <ArrowUpRight size={11} className="mt-0.5 shrink-0 text-aegis-text-dim opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        </SidebarSection>
      </div>
    </>
  );
}

export function CommandsPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();

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
            <div className="text-[11px] text-aegis-text-dim">
              {t('openclawCommands.subtitle')}
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <SidebarSection label={t('openclawCommands.title')}>
          <SidebarRow
            icon={<BookOpenText size={14} />}
            title={t('openclawCommands.title')}
            onClick={() => navigate('/openclaw-commands')}
          />
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
