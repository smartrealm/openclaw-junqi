import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, BookOpenText, Bot, Brain, Calendar, Clock, Cpu, Database, FileText, Folder, History, KeyRound, ListChecks, MessageSquare, Pencil, Plus, Power, PowerOff, Puzzle, Server, Settings, Terminal, Wrench, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useSkillsStore } from '@/stores/skillsStore';
import { gateway } from '@/services/gateway';
import { SidebarRow, SidebarSection } from './SidebarRow';
import { filterEnabledNavigationItems, type FeatureLinkedItem } from './navigationVisibility';

type NavigationItem = FeatureLinkedItem & { to: string; icon: React.ReactNode; label: string };

function toolCategories(t: ReturnType<typeof useTranslation>['t']): ReadonlyArray<NavigationItem> {
  return [
    { to: '/workshop', icon: <Folder size={14} />,    label: t('nav.workspace', '工作空间'), feature: 'workshop' },
    { to: '/ai-workspace', icon: <Bot size={14} />,   label: t('nav.aiWorkspace', 'AI 工作台'), feature: 'agentRun' },
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
    { to: '/agent-run', icon: <Activity size={14} />,     label: t('nav.agentRun', 'Agent 运行'), feature: 'agentRun' },
    { to: '/agents/live', icon: <Bot size={14} />,        label: t('nav.liveAgents', '多智能体视图'), feature: 'liveAgents' },
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

export function AgentsPanel() {
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
                  <div className="flex items-center px-3 py-1.5 hover:bg-aegis-hover/30 transition-colors">
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
                  </div>
                  {isExpanded && (
                    <div className="ms-7 me-3 mb-1 rounded-lg border border-aegis-border/40 bg-aegis-surface/35 py-1">
                      <button
                        type="button"
                        onClick={() => navigate(`/agents?agent=${encodeURIComponent(a.id)}`)}
                        className="w-full flex items-center gap-2 border-b border-aegis-border/35 px-3 py-2 text-left text-[11.5px] font-medium text-aegis-text-muted hover:bg-aegis-primary/10 hover:text-aegis-primary"
                      >
                        <Pencil size={11} className="shrink-0" />
                        <span>{t('sidebar.editAgent', '编辑智能体')}</span>
                      </button>
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
          {filterEnabledNavigationItems(agentToolLinks(t)).map((it) => (
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
