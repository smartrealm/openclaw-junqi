import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpenText, ClipboardList, History, Package, Puzzle, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ActiveTabIndicator, AnimatedTabPanel } from '@/components/shared/TabMotion';
import { PageTransition } from '@/components/shared/PageTransition';
import {
  openClawSkillsRuntime,
  type OpenClawSkill,
  type OpenClawSkillCard,
  type OpenClawSkillCuratorEntry,
  type OpenClawSkillCuratorStatus,
  type OpenClawSkillDetail,
  type OpenClawSkillProposalInspection,
  type OpenClawSkillProposalLifecycleEvent,
  type OpenClawSkillProposal,
  type OpenClawSkillSearchResult,
  type OpenClawSkillSecurityVerdict,
} from '@/services/openclawSkillsRuntime';
import {
  HubSkillRow,
  MySkillRow,
  SkillCardDialog,
  SkillDetailPanel,
  SkillProposalDialog,
  SkillProposalEventsDialog,
  type HubSkill,
  type InstallState,
  type MySkill,
  type SkillDetail,
} from './components';
import { SkillArchiveUploadPanel } from './SkillArchiveUploadPanel';
import {
  ACTIVE_SESSION_PROPOSAL_SCOPE,
  GATEWAY_DEFAULT_PROPOSAL_SCOPE,
  proposalScopeValueForAgent,
  resolveProposalScopeAgentId,
} from './proposalScope';

type SkillsTab = 'installed' | 'catalog' | 'proposals';

function operationError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function proposalDate(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
}

function proposalStatusLabel(
  proposal: OpenClawSkillProposal,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (proposal.status === 'pending') return t('skillsExtra.proposalPending', 'Pending');
  if (proposal.status === 'applied') return t('skillsExtra.proposalApplied', 'Applied');
  if (proposal.status === 'rejected') return t('skillsExtra.proposalRejected', 'Rejected');
  if (proposal.status === 'quarantined') return t('skillsExtra.proposalQuarantined', 'Quarantined');
  return t('skillsExtra.proposalStale', 'Stale');
}

function proposalStatusStyle(status: OpenClawSkillProposal['status']): string {
  if (status === 'pending') return 'border-aegis-warning/20 bg-aegis-warning/[0.07] text-aegis-warning';
  if (status === 'applied') return 'border-aegis-success/20 bg-aegis-success/[0.07] text-aegis-success';
  if (status === 'rejected' || status === 'quarantined') return 'border-aegis-danger/20 bg-aegis-danger/[0.07] text-aegis-danger';
  return 'border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.04)] text-aegis-text-dim';
}

function skillIcon() {
  return <Puzzle size={15} strokeWidth={1.75} aria-hidden="true" />;
}

function curatorEntryForSkill(
  skill: OpenClawSkill,
  entries: OpenClawSkillCuratorEntry[],
): OpenClawSkillCuratorEntry | undefined {
  return entries.find((entry) => entry.skillKey === skill.key);
}

function toMySkill(
  skill: OpenClawSkill,
  verdict?: OpenClawSkillSecurityVerdict,
  curator?: OpenClawSkillCuratorEntry,
): MySkill {
  return {
    slug: skill.key,
    name: skill.name,
    emoji: skillIcon(),
    description: skill.description,
    version: skill.version ?? '',
    enabled: skill.enabled,
    source: skill.source,
    ...(verdict ? {
      security: {
        passed: verdict.securityPassed,
        decision: verdict.decision,
      },
    } : {}),
    ...(curator ? {
      curator: {
        state: curator.state,
        pinned: curator.pinned,
        useCount: curator.useCount,
      },
    } : {}),
  };
}

function verdictForSkill(skill: OpenClawSkill, verdicts: OpenClawSkillSecurityVerdict[]): OpenClawSkillSecurityVerdict | undefined {
  return verdicts.find((verdict) => verdict.slug === skill.key || verdict.requestedSlug === skill.key);
}

function toHubSkill(skill: OpenClawSkillSearchResult): HubSkill {
  return {
    slug: skill.slug,
    name: skill.displayName,
    emoji: skillIcon(),
    summary: skill.summary ?? '',
    score: skill.score,
    ...(skill.version ? { version: skill.version } : {}),
    ...(skill.updatedAt !== undefined ? { updatedAt: skill.updatedAt } : {}),
  };
}

function toSkillDetail(
  searchResult: OpenClawSkillSearchResult,
  detail: OpenClawSkillDetail | null,
): SkillDetail {
  const ownerName = detail?.owner?.displayName ?? detail?.owner?.handle;
  return {
    ...toHubSkill(searchResult),
    name: detail?.displayName ?? searchResult.displayName,
    summary: detail?.summary ?? searchResult.summary ?? '',
    ...(detail?.isOfficial === true ? { badge: 'official' as const } : {}),
    ...(ownerName ? { owner: ownerName } : {}),
    ...(detail?.owner?.image ? { ownerAvatar: detail.owner.image } : {}),
    ...(detail?.createdAt !== undefined ? { createdAt: detail.createdAt } : {}),
    ...(detail?.updatedAt !== undefined ? { updatedAt: detail.updatedAt } : {}),
    ...(detail?.latestVersion ? { latestVersion: detail.latestVersion } : {}),
    ...(detail?.metadata ? { metadata: detail.metadata } : {}),
    ...(detail?.tags ? { tags: detail.tags } : {}),
    ...(detail?.channel !== undefined ? { channel: detail.channel } : {}),
  };
}

function SkillsList({ skills, onToggle, onViewCard }: {
  skills: MySkill[];
  onToggle: (slug: string) => void;
  onViewCard?: (slug: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {skills.map((skill, index) => (
        <MySkillRow
          key={skill.slug}
          skill={skill}
          index={index}
          onToggle={() => onToggle(skill.slug)}
          {...(onViewCard ? { onViewCard: () => onViewCard(skill.slug) } : {})}
        />
      ))}
    </div>
  );
}

export function SkillsPage() {
  const { t } = useTranslation();
  const connected = useChatStore((state) => state.connected);
  const activeSessionAgentId = useChatStore(
    (state) => state.sessions.find((session) => session.key === state.activeSessionKey)?.agentId,
  );
  const agents = useGatewayDataStore((state) => state.agents);
  const agentsLoading = useGatewayDataStore((state) => state.loading.agents);
  const agentsError = useGatewayDataStore((state) => state.errors.agents);
  const archiveUploadCapability = openClawSkillsRuntime.archiveUploadCapability();
  const skillCardCapability = openClawSkillsRuntime.skillCardCapability();
  const curatorStatusCapability = openClawSkillsRuntime.curatorStatusCapability();
  const proposalsCapability = openClawSkillsRuntime.proposalsCapability();
  const proposalInspectCapability = openClawSkillsRuntime.proposalInspectCapability();
  const proposalEventsCapability = openClawSkillsRuntime.proposalEventsCapability();
  const [activeTab, setActiveTab] = useState<SkillsTab>('installed');
  const [installed, setInstalled] = useState<MySkill[]>([]);
  const [catalog, setCatalog] = useState<HubSkill[]>([]);
  const [query, setQuery] = useState('');
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [curatorStatus, setCuratorStatus] = useState<OpenClawSkillCuratorStatus | null>(null);
  const [curatorError, setCuratorError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<OpenClawSkillProposal[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [proposalScope, setProposalScope] = useState(GATEWAY_DEFAULT_PROPOSAL_SCOPE);
  const [proposalInspectionOpen, setProposalInspectionOpen] = useState(false);
  const [proposalInspectionLoading, setProposalInspectionLoading] = useState(false);
  const [proposalInspection, setProposalInspection] = useState<OpenClawSkillProposalInspection | null>(null);
  const [proposalInspectionError, setProposalInspectionError] = useState<string | null>(null);
  const [proposalEventsOpen, setProposalEventsOpen] = useState(false);
  const [proposalEventsLoading, setProposalEventsLoading] = useState(false);
  const [proposalEvents, setProposalEvents] = useState<OpenClawSkillProposalLifecycleEvent[]>([]);
  const [proposalEventsError, setProposalEventsError] = useState<string | null>(null);
  const [proposalEventsNextSequence, setProposalEventsNextSequence] = useState<number | undefined>();
  const [proposalEventsProposal, setProposalEventsProposal] = useState<OpenClawSkillProposal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [installState, setInstallState] = useState<InstallState>('idle');
  const [installError, setInstallError] = useState('');
  const [skillCardOpen, setSkillCardOpen] = useState(false);
  const [skillCardLoading, setSkillCardLoading] = useState(false);
  const [skillCard, setSkillCard] = useState<OpenClawSkillCard | null>(null);
  const [skillCardError, setSkillCardError] = useState<string | null>(null);
  const skillCardRequestGeneration = useRef(0);
  const proposalRequestGeneration = useRef(0);
  const proposalInspectionRequestGeneration = useRef(0);
  const proposalEventsRequestGeneration = useRef(0);
  const activeProposalSessionAgentId = activeSessionAgentId?.trim() || undefined;
  const proposalScopeAgentId = resolveProposalScopeAgentId(proposalScope, activeProposalSessionAgentId);
  const proposalScopeAgents = useMemo(
    () => agents.filter((agent) => agent.id !== activeProposalSessionAgentId),
    [activeProposalSessionAgentId, agents],
  );

  const loadInstalled = useCallback(async () => {
    if (!connected) return;
    setLoadingInstalled(true);
    setSecurityError(null);
    setCuratorError(null);
    try {
      const [skillsResult, verdictResult, curatorResult] = await Promise.allSettled([
        openClawSkillsRuntime.list(),
        openClawSkillsRuntime.securityVerdicts(),
        curatorStatusCapability === false
          ? Promise.resolve(null)
          : openClawSkillsRuntime.curatorStatus(),
      ]);
      if (skillsResult.status === 'rejected') throw skillsResult.reason;
      const verdicts = verdictResult.status === 'fulfilled' ? verdictResult.value : [];
      const curator = curatorResult.status === 'fulfilled' ? curatorResult.value : null;
      setSecurityError(verdictResult.status === 'rejected' ? operationError(verdictResult.reason) : null);
      setCuratorStatus(curator);
      setCuratorError(curatorResult.status === 'rejected' ? operationError(curatorResult.reason) : null);
      setInstalled(skillsResult.value.map((skill) => toMySkill(
        skill,
        verdictForSkill(skill, verdicts),
        curator ? curatorEntryForSkill(skill, curator.skills) : undefined,
      )));
    } finally {
      setLoadingInstalled(false);
    }
  }, [connected, curatorStatusCapability]);

  const loadCatalog = useCallback(async (nextQuery = query) => {
    if (!connected) return;
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      setCatalog((await openClawSkillsRuntime.search(nextQuery, 40)).map(toHubSkill));
    } catch (error) {
      setCatalogError(operationError(error));
    } finally {
      setLoadingCatalog(false);
    }
  }, [connected, query]);

  const loadProposals = useCallback(async () => {
    if (!connected || proposalsCapability === false) return;
    const requestGeneration = proposalRequestGeneration.current + 1;
    proposalRequestGeneration.current = requestGeneration;
    setLoadingProposals(true);
    setProposalsError(null);
    try {
      const manifest = await openClawSkillsRuntime.proposals(proposalScopeAgentId);
      if (proposalRequestGeneration.current === requestGeneration) {
        setProposals([...manifest.proposals].sort((left, right) => (
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
        )));
      }
    } catch (error) {
      if (proposalRequestGeneration.current === requestGeneration) {
        setProposalsError(operationError(error));
      }
    } finally {
      if (proposalRequestGeneration.current === requestGeneration) {
        setLoadingProposals(false);
      }
    }
  }, [connected, proposalScopeAgentId, proposalsCapability]);

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  useEffect(() => {
    if (activeTab !== 'catalog') return;
    const timer = window.setTimeout(() => void loadCatalog(query), query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadCatalog, query]);

  useEffect(() => {
    if (proposalScope === ACTIVE_SESSION_PROPOSAL_SCOPE && !activeProposalSessionAgentId) {
      setProposalScope(GATEWAY_DEFAULT_PROPOSAL_SCOPE);
    }
  }, [activeProposalSessionAgentId, proposalScope]);

  useEffect(() => {
    proposalRequestGeneration.current += 1;
    setLoadingProposals(false);
    setProposals([]);
    setProposalsError(null);
  }, [proposalScopeAgentId]);

  useEffect(() => {
    proposalInspectionRequestGeneration.current += 1;
    setProposalInspectionOpen(false);
    setProposalInspectionLoading(false);
    setProposalInspection(null);
    setProposalInspectionError(null);
  }, [proposalScopeAgentId, connected, proposalInspectCapability]);

  useEffect(() => {
    proposalEventsRequestGeneration.current += 1;
    setProposalEventsOpen(false);
    setProposalEventsLoading(false);
    setProposalEvents([]);
    setProposalEventsError(null);
    setProposalEventsNextSequence(undefined);
    setProposalEventsProposal(null);
  }, [proposalScopeAgentId, connected, proposalEventsCapability]);

  useEffect(() => {
    if (activeTab !== 'proposals') return;
    void loadProposals();
  }, [activeTab, loadProposals]);

  useEffect(() => {
    if (activeTab === 'proposals' && proposalsCapability === false) {
      setActiveTab('installed');
    }
  }, [activeTab, proposalsCapability]);

  useEffect(() => {
    if (connected && proposalsCapability !== false) return;
    proposalRequestGeneration.current += 1;
    setLoadingProposals(false);
    setProposals([]);
    setProposalsError(null);
  }, [connected, proposalsCapability]);

  useEffect(() => {
    if (connected) return;
    skillCardRequestGeneration.current += 1;
    setSkillCardOpen(false);
    setSkillCardLoading(false);
    setSkillCard(null);
    setSkillCardError(null);
  }, [connected]);

  const toggleSkill = useCallback(async (slug: string) => {
    const current = installed.find((skill) => skill.slug === slug);
    if (!current) return;
    const enabled = !current.enabled;
    setInstalled((items) => items.map((skill) => (
      skill.slug === slug ? { ...skill, enabled } : skill
    )));
    try {
      await openClawSkillsRuntime.setEnabled(slug, enabled);
    } catch {
      setInstalled((items) => items.map((skill) => (
        skill.slug === slug ? { ...skill, enabled: current.enabled } : skill
      )));
    }
  }, [installed]);

  const openDetail = useCallback(async (slug: string) => {
    const searchResult = catalog.find((skill) => skill.slug === slug);
    if (!searchResult) return;
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    setInstallState('idle');
    setInstallError('');
    try {
      const response = await openClawSkillsRuntime.detail(slug);
      setDetail(toSkillDetail({
        score: searchResult.score,
        slug: searchResult.slug,
        displayName: searchResult.name,
        summary: searchResult.summary,
        ...(searchResult.version ? { version: searchResult.version } : {}),
        ...(searchResult.updatedAt !== undefined ? { updatedAt: searchResult.updatedAt } : {}),
      }, response));
    } catch (error) {
      setInstallError(operationError(error));
      setDetail({ ...searchResult });
    } finally {
      setDetailLoading(false);
    }
  }, [catalog]);

  const install = useCallback(async (slug: string) => {
    setInstallState('installing');
    setInstallError('');
    try {
      await openClawSkillsRuntime.installFromClawHub({
        slug,
        version: detail?.latestVersion?.version || detail?.version || undefined,
      });
      setInstallState('done');
      await loadInstalled();
    } catch (error) {
      setInstallError(operationError(error));
      setInstallState('error');
    }
  }, [detail?.latestVersion?.version, detail?.version, loadInstalled]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetail(null);
    setInstallState('idle');
    setInstallError('');
  }, []);

  const openSkillCard = useCallback(async (skillKey: string) => {
    const requestGeneration = skillCardRequestGeneration.current + 1;
    skillCardRequestGeneration.current = requestGeneration;
    setSkillCardOpen(true);
    setSkillCardLoading(true);
    setSkillCard(null);
    setSkillCardError(null);
    try {
      const card = await openClawSkillsRuntime.skillCard(skillKey);
      if (skillCardRequestGeneration.current === requestGeneration) setSkillCard(card);
    } catch (error) {
      if (skillCardRequestGeneration.current === requestGeneration) {
        setSkillCardError(operationError(error));
      }
    } finally {
      if (skillCardRequestGeneration.current === requestGeneration) {
        setSkillCardLoading(false);
      }
    }
  }, []);

  const closeSkillCard = useCallback(() => {
    skillCardRequestGeneration.current += 1;
    setSkillCardOpen(false);
    setSkillCardLoading(false);
    setSkillCard(null);
    setSkillCardError(null);
  }, []);

  const openProposalInspection = useCallback(async (proposalId: string) => {
    if (!connected || proposalInspectCapability === false) return;
    const requestGeneration = proposalInspectionRequestGeneration.current + 1;
    proposalInspectionRequestGeneration.current = requestGeneration;
    setProposalInspectionOpen(true);
    setProposalInspectionLoading(true);
    setProposalInspection(null);
    setProposalInspectionError(null);
    try {
      const inspection = await openClawSkillsRuntime.inspectProposal(proposalId, proposalScopeAgentId);
      if (proposalInspectionRequestGeneration.current === requestGeneration) {
        setProposalInspection(inspection);
      }
    } catch (error) {
      if (proposalInspectionRequestGeneration.current === requestGeneration) {
        setProposalInspectionError(operationError(error));
      }
    } finally {
      if (proposalInspectionRequestGeneration.current === requestGeneration) {
        setProposalInspectionLoading(false);
      }
    }
  }, [connected, proposalInspectCapability, proposalScopeAgentId]);

  const closeProposalInspection = useCallback(() => {
    proposalInspectionRequestGeneration.current += 1;
    setProposalInspectionOpen(false);
    setProposalInspectionLoading(false);
    setProposalInspection(null);
    setProposalInspectionError(null);
  }, []);

  const loadProposalEvents = useCallback(async (
    proposal: OpenClawSkillProposal,
    afterSequence?: number,
  ) => {
    if (!connected || proposalEventsCapability === false) return;
    const requestGeneration = proposalEventsRequestGeneration.current + 1;
    proposalEventsRequestGeneration.current = requestGeneration;
    if (afterSequence === undefined) {
      setProposalEventsOpen(true);
      setProposalEventsProposal(proposal);
      setProposalEvents([]);
      setProposalEventsNextSequence(undefined);
    }
    setProposalEventsLoading(true);
    setProposalEventsError(null);
    try {
      const page = await openClawSkillsRuntime.proposalEvents(proposal.id, {
        ...(proposalScopeAgentId ? { agentId: proposalScopeAgentId } : {}),
        ...(afterSequence === undefined ? {} : { afterSequence }),
      });
      if (proposalEventsRequestGeneration.current === requestGeneration) {
        setProposalEvents((currentEvents) => (
          afterSequence === undefined ? page.events : [...currentEvents, ...page.events]
        ));
        setProposalEventsNextSequence(page.nextSequence);
      }
    } catch (error) {
      if (proposalEventsRequestGeneration.current === requestGeneration) {
        setProposalEventsError(operationError(error));
      }
    } finally {
      if (proposalEventsRequestGeneration.current === requestGeneration) {
        setProposalEventsLoading(false);
      }
    }
  }, [connected, proposalEventsCapability, proposalScopeAgentId]);

  const closeProposalEvents = useCallback(() => {
    proposalEventsRequestGeneration.current += 1;
    setProposalEventsOpen(false);
    setProposalEventsLoading(false);
    setProposalEvents([]);
    setProposalEventsError(null);
    setProposalEventsNextSequence(undefined);
    setProposalEventsProposal(null);
  }, []);

  const tabItems = useMemo(() => [
    { id: 'installed' as const, icon: Package, label: t('skills.mySkills'), count: installed.length },
    { id: 'catalog' as const, icon: Search, label: t('skills.clawHub') },
    ...(proposalsCapability !== false ? [{ id: 'proposals' as const, icon: ClipboardList, label: t('skillsExtra.proposalsTitle', 'Workshop') }] : []),
  ], [installed.length, proposalsCapability, t]);

  return (
    <PageTransition className="flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto max-w-[900px] px-9 py-8 pb-16">
        <header className="mb-6 flex items-center gap-3">
          <Puzzle size={20} className="text-aegis-primary" aria-hidden="true" />
          <h1 className="text-[21px] font-bold">{t('skills.title')}</h1>
        </header>

        <nav className="mb-7 inline-flex gap-0.5 rounded-xl border border-[rgb(var(--aegis-overlay)/0.05)] p-[3px]" role="tablist" aria-label={t('skills.title')}>
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'relative isolate flex items-center gap-2 rounded-[9px] px-5 py-2.5 text-[13px] font-medium',
                'transition-[color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98]',
                activeTab === tab.id
                  ? 'font-semibold text-aegis-primary'
                  : 'text-aegis-text-muted hover:text-aegis-text-secondary',
              )}
            >
              {activeTab === tab.id && (
                <ActiveTabIndicator
                  layoutId="skills-active-tab"
                  className="inset-0 -z-10 rounded-[9px] bg-aegis-primary/[0.08]"
                />
              )}
              <tab.icon size={14} aria-hidden="true" />
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-md bg-[rgb(var(--aegis-overlay)/0.04)] px-1.5 py-0.5 text-[10px] font-semibold text-aegis-text-dim">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <AnimatedTabPanel transitionKey={activeTab}>
        {activeTab === 'installed' && (
          <section>
            <SkillArchiveUploadPanel connected={connected} onInstalled={loadInstalled} />
            <div className="mb-4 flex items-center justify-between gap-4">
              <p className="text-[11px] text-aegis-text-dim">
                {installed.length > 0 ? t('skills.installedCount', { count: installed.length }) : t('skills.noSkillsHint')}
              </p>
              <button
                type="button"
                onClick={() => void loadInstalled()}
                disabled={loadingInstalled || !connected}
                title={t('common.refresh', 'Refresh')}
                aria-label={t('common.refresh', 'Refresh')}
                className="grid size-8 place-items-center rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-muted transition-colors hover:border-aegis-primary/30 hover:bg-aegis-primary/[0.06] hover:text-aegis-primary disabled:cursor-wait disabled:opacity-50"
              >
                {loadingInstalled ? <LoadingIndicator size={13} /> : <RefreshCw size={13} aria-hidden="true" />}
              </button>
            </div>
            {archiveUploadCapability !== false && (
              <SkillArchiveUploadPanel connected={connected} onInstalled={loadInstalled} />
            )}
            {curatorStatus && (
              <div className="mb-4 border-y border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.015)] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold text-aegis-text-secondary">
                    {t('skillsExtra.curatorTitle', 'Skill lifecycle')}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] text-aegis-text-dim">
                    <span>{t('skillsExtra.curatorActive', 'Active')}: {curatorStatus.counts.active}</span>
                    <span>{t('skillsExtra.curatorStale', 'Stale')}: {curatorStatus.counts.stale}</span>
                    <span>{t('skillsExtra.curatorArchived', 'Archived')}: {curatorStatus.counts.archived}</span>
                    {curatorStatus.overlaps.length > 0 && (
                      <span>{t('skillsExtra.curatorOverlaps', '{{count}} overlap candidates', { count: curatorStatus.overlaps.length })}</span>
                    )}
                  </div>
                </div>
                {curatorStatus.lastError && (
                  <p className="mt-2 break-words text-[10px] text-aegis-warning">{curatorStatus.lastError}</p>
                )}
              </div>
            )}
            {securityError && (
              <div className="mb-4 flex items-start gap-2 border-s-2 border-aegis-warning/60 bg-aegis-warning/[0.04] px-4 py-3 text-[12px] text-aegis-text-secondary">
                <ShieldAlert size={14} className="mt-0.5 shrink-0 text-aegis-warning" aria-hidden="true" />
                <div className="min-w-0">
                  <p>{t('skillsExtra.securityUnavailable', 'Security verdict unavailable')}</p>
                  <p className="mt-1 break-words text-[11px] text-aegis-text-dim">{securityError}</p>
                </div>
              </div>
            )}
            {curatorError && (
              <div className="mb-4 flex items-start gap-2 border-s-2 border-aegis-warning/60 bg-aegis-warning/[0.04] px-4 py-3 text-[12px] text-aegis-text-secondary">
                <ShieldAlert size={14} className="mt-0.5 shrink-0 text-aegis-warning" aria-hidden="true" />
                <div className="min-w-0">
                  <p>{t('skillsExtra.curatorUnavailable', 'Skill lifecycle status unavailable')}</p>
                  <p className="mt-1 break-words text-[11px] text-aegis-text-dim">{curatorError}</p>
                </div>
              </div>
            )}
            {loadingInstalled ? (
              <div className="flex justify-center py-20"><LoadingIndicator size={22} className="text-aegis-text-dim" /></div>
            ) : installed.length === 0 ? (
              <div className="py-20 text-center">
                <Package size={28} className="mx-auto mb-3 text-aegis-text-dim" aria-hidden="true" />
                <p className="text-[13px] font-medium text-aegis-text-dim">{t('skills.noSkills')}</p>
              </div>
            ) : (
              <SkillsList
                skills={installed}
                onToggle={(slug) => void toggleSkill(slug)}
                {...(connected && skillCardCapability !== false
                  ? { onViewCard: (slug: string) => void openSkillCard(slug) }
                  : {})}
              />
            )}
          </section>
        )}

        {activeTab === 'catalog' && (
          <section>
            <div className="relative mx-auto mb-5 max-w-[560px]">
              <Search size={14} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-aegis-text-dim" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('skills.searchPlaceholder')}
                className="w-full rounded-xl border border-[rgb(var(--aegis-overlay)/0.06)] bg-[rgb(var(--aegis-overlay)/0.02)] py-2.5 ps-10 pe-10 text-[13.5px] text-aegis-text outline-none transition-colors placeholder:text-aegis-text-dim focus:border-aegis-primary/30"
              />
              <button
                type="button"
                onClick={() => void loadCatalog()}
                disabled={loadingCatalog || !connected}
                title={t('common.refresh', 'Refresh')}
                aria-label={t('common.refresh', 'Refresh')}
                className="absolute end-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-aegis-text-dim hover:bg-aegis-primary/[0.06] hover:text-aegis-primary disabled:cursor-wait disabled:opacity-50"
              >
                {loadingCatalog ? <LoadingIndicator size={13} /> : <RefreshCw size={13} aria-hidden="true" />}
              </button>
            </div>
            {catalogError ? (
              <div className="border-s-2 border-aegis-danger/60 bg-aegis-danger/[0.04] px-4 py-3 text-[12px] text-aegis-text-secondary">
                <p>{catalogError}</p>
                <button type="button" onClick={() => void loadCatalog()} className="mt-2 text-aegis-primary hover:underline">
                  {t('skills.skillshubRetry')}
                </button>
              </div>
            ) : loadingCatalog ? (
              <div className="flex justify-center py-20"><LoadingIndicator size={22} className="text-aegis-text-dim" /></div>
            ) : catalog.length === 0 ? (
              <div className="py-20 text-center text-[13px] text-aegis-text-dim">{t('skills.noResults')}</div>
            ) : (
              <div className="flex flex-col gap-px">
                {catalog.map((skill) => <HubSkillRow key={skill.slug} skill={skill} onClick={() => void openDetail(skill.slug)} />)}
              </div>
            )}
          </section>
        )}
        {activeTab === 'proposals' && (
          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] text-aegis-text-dim">{t('skillsExtra.proposalsHint', 'OpenClaw Skill Workshop proposals')}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label htmlFor="skill-proposal-scope" className="text-[10px] text-aegis-text-dim">
                    {t('skillsExtra.proposalsScope', 'Agent scope')}
                  </label>
                  <Select value={proposalScope} onValueChange={setProposalScope}>
                    <SelectTrigger
                      id="skill-proposal-scope"
                      aria-label={t('skillsExtra.proposalsScope', 'Agent scope')}
                      disabled={!connected}
                      className="h-7 w-[min(260px,calc(100vw-8rem))] border-aegis-border bg-aegis-surface-solid px-2 text-[10px] text-aegis-text focus:ring-aegis-primary/40"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-aegis-border bg-aegis-card-solid text-aegis-text">
                      <SelectItem value={GATEWAY_DEFAULT_PROPOSAL_SCOPE} className="text-[11px]">
                        {t('skillsExtra.proposalsGatewayDefaultScope', 'Gateway default agent')}
                      </SelectItem>
                      {activeProposalSessionAgentId && (
                        <SelectItem value={ACTIVE_SESSION_PROPOSAL_SCOPE} className="text-[11px]">
                          {t('skillsExtra.proposalsCurrentSessionScope', 'Current session: {{agent}}', { agent: activeProposalSessionAgentId })}
                        </SelectItem>
                      )}
                      {proposalScopeAgents.map((agent) => (
                        <SelectItem key={agent.id} value={proposalScopeValueForAgent(agent.id)} className="text-[11px]">
                          {agent.name || agent.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {agentsLoading && <span className="text-[10px] text-aegis-text-dim">{t('common.loading', 'Loading')}</span>}
                  {agentsError && <span className="max-w-full break-words text-[10px] text-aegis-warning">{t('skillsExtra.proposalsAgentsUnavailable', 'Agent list unavailable')}: {agentsError}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadProposals()}
                disabled={loadingProposals || !connected}
                title={t('common.refresh', 'Refresh')}
                aria-label={t('common.refresh', 'Refresh')}
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-muted transition-colors hover:border-aegis-primary/30 hover:bg-aegis-primary/[0.06] hover:text-aegis-primary disabled:cursor-wait disabled:opacity-50"
              >
                {loadingProposals ? <LoadingIndicator size={13} /> : <RefreshCw size={13} aria-hidden="true" />}
              </button>
            </div>
            {proposalsError ? (
              <div className="border-s-2 border-aegis-warning/60 bg-aegis-warning/[0.04] px-4 py-3 text-[12px] text-aegis-text-secondary">
                <p>{t('skillsExtra.proposalsUnavailable', 'Skill Workshop proposals unavailable')}</p>
                <p className="mt-1 break-words text-[11px] text-aegis-text-dim">{proposalsError}</p>
              </div>
            ) : loadingProposals ? (
              <div className="flex justify-center py-20"><LoadingIndicator size={22} className="text-aegis-text-dim" /></div>
            ) : proposals.length === 0 ? (
              <div className="py-20 text-center">
                <ClipboardList size={28} className="mx-auto mb-3 text-aegis-text-dim" aria-hidden="true" />
                <p className="text-[13px] font-medium text-aegis-text-dim">{t('skillsExtra.proposalsEmpty', 'No Skill Workshop proposals')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {proposals.map((proposal) => (
                  <div key={proposal.id} className="border border-[rgb(var(--aegis-overlay)/0.06)] bg-[rgb(var(--aegis-overlay)/0.02)] px-4 py-3">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13px] font-semibold text-aegis-text">{proposal.title}</p>
                          <span className={clsx('inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold', proposalStatusStyle(proposal.status))}>
                            {proposalStatusLabel(proposal, t)}
                          </span>
                          {connected && proposalInspectCapability !== false && (
                            <button
                              type="button"
                              onClick={() => void openProposalInspection(proposal.id)}
                              title={t('skillsExtra.proposalInspect', 'View proposal draft')}
                              aria-label={t('skillsExtra.proposalInspect', 'View proposal draft')}
                              className="grid size-6 place-items-center rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-dim transition-colors hover:border-aegis-primary/30 hover:bg-aegis-primary/[0.04] hover:text-aegis-primary"
                            >
                              <BookOpenText size={12} aria-hidden="true" />
                            </button>
                          )}
                          {connected && proposalEventsCapability !== false && (
                            <button
                              type="button"
                              onClick={() => void loadProposalEvents(proposal)}
                              title={t('skillsExtra.proposalEvents', 'View proposal activity')}
                              aria-label={t('skillsExtra.proposalEvents', 'View proposal activity')}
                              className="grid size-6 place-items-center rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-dim transition-colors hover:border-aegis-primary/30 hover:bg-aegis-primary/[0.04] hover:text-aegis-primary"
                            >
                              <History size={12} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-aegis-text-muted">{proposal.description}</p>
                      </div>
                      <div className="shrink-0 text-end font-mono text-[10px] text-aegis-text-dim">
                        <p>{proposal.skillKey}</p>
                        <p className="mt-1">{proposalDate(proposal.updatedAt)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        </AnimatedTabPanel>
      </div>

      <SkillDetailPanel
        open={detailOpen}
        skill={detail}
        loading={detailLoading}
        onClose={closeDetail}
        onInstall={(slug) => void install(slug)}
        installState={installState}
        installLabel={t('skills.hubInstall')}
        installingLabel={t('skills.hubInstalling')}
        doneLabel={t('skills.hubInstallDone')}
        doneHint={t('skills.hubInstallDoneHint')}
        errorLabel={t('skills.hubInstallError')}
        errorText={installError}
      />
      <SkillCardDialog
        open={skillCardOpen}
        card={skillCard}
        loading={skillCardLoading}
        error={skillCardError}
        onClose={closeSkillCard}
      />
      <SkillProposalDialog
        open={proposalInspectionOpen}
        proposal={proposalInspection}
        loading={proposalInspectionLoading}
        error={proposalInspectionError}
        onClose={closeProposalInspection}
      />
      <SkillProposalEventsDialog
        open={proposalEventsOpen}
        proposal={proposalEventsProposal}
        events={proposalEvents}
        loading={proposalEventsLoading}
        error={proposalEventsError}
        onClose={closeProposalEvents}
        {...(proposalEventsProposal && proposalEventsNextSequence !== undefined
          ? { onLoadMore: () => void loadProposalEvents(proposalEventsProposal, proposalEventsNextSequence) }
          : {})}
      />
    </PageTransition>
  );
}
