import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Puzzle, RefreshCw, Search } from 'lucide-react';
import clsx from 'clsx';
import { useChatStore } from '@/stores/chatStore';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { ActiveTabIndicator, AnimatedTabPanel } from '@/components/shared/TabMotion';
import { PageTransition } from '@/components/shared/PageTransition';
import {
  openClawSkillsRuntime,
  type OpenClawSkill,
  type OpenClawSkillDetail,
  type OpenClawSkillSearchResult,
} from '@/services/openclawSkillsRuntime';
import {
  HubSkillRow,
  MySkillRow,
  SkillDetailPanel,
  type HubSkill,
  type InstallState,
  type MySkill,
  type SkillDetail,
} from './components';

type SkillsTab = 'installed' | 'catalog';

function operationError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function skillIcon() {
  return <Puzzle size={15} strokeWidth={1.75} aria-hidden="true" />;
}

function toMySkill(skill: OpenClawSkill): MySkill {
  return {
    slug: skill.key,
    name: skill.name,
    emoji: skillIcon(),
    description: skill.description,
    version: skill.version ?? '',
    enabled: skill.enabled,
    source: skill.source,
  };
}

function toHubSkill(skill: OpenClawSkillSearchResult): HubSkill {
  return {
    slug: skill.slug,
    name: skill.displayName,
    emoji: skillIcon(),
    summary: skill.summary ?? '',
    owner: '',
    ownerAvatar: '',
    stars: 0,
    downloads: 0,
    installs: 0,
    version: skill.version ?? '',
  };
}

function toSkillDetail(
  searchResult: OpenClawSkillSearchResult,
  detail: OpenClawSkillDetail | null,
): SkillDetail {
  const latest = detail?.version ?? searchResult.version ?? '';
  return {
    ...toHubSkill(searchResult),
    name: detail?.displayName ?? searchResult.displayName,
    summary: detail?.summary ?? searchResult.summary ?? '',
    version: latest,
    badge: detail?.official ? 'official' : undefined,
    owner: detail?.owner?.displayName ?? detail?.owner?.handle ?? '',
    ownerAvatar: detail?.owner?.image ?? '',
    readme: '',
    requirements: { env: [], bin: [] },
    versions: latest ? [{ version: latest, date: '', changelog: '', latest: true }] : [],
  };
}

function SkillsList({ skills, onToggle }: {
  skills: MySkill[];
  onToggle: (slug: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {skills.map((skill, index) => (
        <MySkillRow
          key={skill.slug}
          skill={skill}
          index={index}
          onToggle={() => onToggle(skill.slug)}
        />
      ))}
    </div>
  );
}

export function SkillsPage() {
  const { t } = useTranslation();
  const connected = useChatStore((state) => state.connected);
  const [activeTab, setActiveTab] = useState<SkillsTab>('installed');
  const [installed, setInstalled] = useState<MySkill[]>([]);
  const [catalog, setCatalog] = useState<HubSkill[]>([]);
  const [query, setQuery] = useState('');
  const [loadingInstalled, setLoadingInstalled] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [installState, setInstallState] = useState<InstallState>('idle');
  const [installError, setInstallError] = useState('');

  const loadInstalled = useCallback(async () => {
    if (!connected) return;
    setLoadingInstalled(true);
    try {
      setInstalled((await openClawSkillsRuntime.list()).map(toMySkill));
    } finally {
      setLoadingInstalled(false);
    }
  }, [connected]);

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

  useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  useEffect(() => {
    if (activeTab !== 'catalog') return;
    const timer = window.setTimeout(() => void loadCatalog(query), query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadCatalog, query]);

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
        score: 0,
        slug: searchResult.slug,
        displayName: searchResult.name,
        summary: searchResult.summary,
        version: searchResult.version,
      }, response));
    } catch (error) {
      setInstallError(operationError(error));
      setDetail({
        ...searchResult,
        readme: '',
        requirements: { env: [], bin: [] },
        versions: [],
      });
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
        version: detail?.version || undefined,
      });
      setInstallState('done');
      await loadInstalled();
    } catch (error) {
      setInstallError(operationError(error));
      setInstallState('error');
    }
  }, [detail?.version, loadInstalled]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetail(null);
    setInstallState('idle');
    setInstallError('');
  }, []);

  const tabItems = useMemo(() => [
    { id: 'installed' as const, icon: Package, label: t('skills.mySkills'), count: installed.length },
    { id: 'catalog' as const, icon: Search, label: t('skills.clawHub') },
  ], [installed.length, t]);

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
            {loadingInstalled ? (
              <div className="flex justify-center py-20"><LoadingIndicator size={22} className="text-aegis-text-dim" /></div>
            ) : installed.length === 0 ? (
              <div className="py-20 text-center">
                <Package size={28} className="mx-auto mb-3 text-aegis-text-dim" aria-hidden="true" />
                <p className="text-[13px] font-medium text-aegis-text-dim">{t('skills.noSkills')}</p>
              </div>
            ) : <SkillsList skills={installed} onToggle={(slug) => void toggleSkill(slug)} />}
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
        externalUrl={detail ? `https://clawhub.ai/skills/${encodeURIComponent(detail.slug)}` : undefined}
      />
    </PageTransition>
  );
}
