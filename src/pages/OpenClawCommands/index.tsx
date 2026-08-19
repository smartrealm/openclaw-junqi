import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpenText, CircleAlert, LoaderCircle, RefreshCw, TerminalSquare } from 'lucide-react';
import clsx from 'clsx';
import { useLocation, useNavigate } from 'react-router-dom';
import { CopyButton } from '@/components/shared/copy-button';
import { PageTransition } from '@/components/shared/PageTransition';
import { WORKSPACE_PAGE_CONTENT_CLASS_NAME } from '@/components/shared/workspacePageLayout';
import { useOpenClawCommands } from '@/hooks/useOpenClawCommands';
import { useChatStore } from '@/stores/chatStore';
import type { OpenClawCommandEntry } from '@/services/gateway/OpenClawCommandsClient';
import { agentIdFromSessionKey } from '@/utils/sessionPresentation';
import { groupOpenClawCommands } from './commandGroups';
import {
  openClawCommandCategoryFromHash,
  openClawCommandCategoryHash,
  resolveOpenClawCommandScrollGroup,
} from './commandScrollSpy';

const COMMAND_GROUP_ANCHOR_GAP_PX = 12;
const PROGRAMMATIC_SCROLL_SETTLE_MS = 140;

function commandSearchText(command: OpenClawCommandEntry): string {
  return [
    command.name,
    command.nativeName,
    ...(command.textAliases ?? []),
    command.description,
    command.category,
    command.source,
    command.scope,
    ...(command.args ?? []).flatMap((argument) => [
      argument.name,
      argument.description,
      ...(argument.choices ?? []).flatMap((choice) => [choice.value, choice.label]),
    ]),
  ].filter((value): value is string => typeof value === 'string').join('\n').toLocaleLowerCase();
}

function commandText(command: OpenClawCommandEntry): string | null {
  return command.textAliases?.[0] ?? null;
}

export function OpenClawCommandsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const connected = useChatStore((state) => state.connected);
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const agentId = agentIdFromSessionKey(activeSessionKey) ?? undefined;
  const [query, setQuery] = useState('');
  const headerRef = useRef<HTMLElement>(null);
  const commandGroupsRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollSettleTimerRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const scrollSpyHashRef = useRef<string | null>(null);
  const currentLocationHashRef = useRef(location.hash);
  const resolvedNavigationHashRef = useRef<string | undefined>(undefined);
  currentLocationHashRef.current = location.hash;
  const { commands, failure, loading, refresh } = useOpenClawCommands(connected, {
    agentId,
    scope: 'text',
    includeArgs: true,
  });
  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? commands.filter((command) => commandSearchText(command).includes(normalized))
      : commands;
  }, [commands, query]);
  const groups = useMemo(() => groupOpenClawCommands(filteredCommands), [filteredCommands]);

  const scheduleProgrammaticScrollRelease = useCallback((onReleased: () => void) => {
    if (scrollSettleTimerRef.current !== null) {
      window.clearTimeout(scrollSettleTimerRef.current);
    }
    scrollSettleTimerRef.current = window.setTimeout(() => {
      scrollSettleTimerRef.current = null;
      programmaticScrollRef.current = false;
      onReleased();
    }, PROGRAMMATIC_SCROLL_SETTLE_MS);
  }, []);

  const measureActiveGroup = useCallback(() => {
    if (programmaticScrollRef.current) return;
    const content = commandGroupsRef.current;
    const routeScroll = content?.closest<HTMLElement>('[data-route-scroll]');
    if (!content || !routeScroll) return;

    const routeRect = routeScroll.getBoundingClientRect();
    const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? routeRect.top;
    const anchorTop = Math.max(0, headerBottom - routeRect.top) + COMMAND_GROUP_ANCHOR_GAP_PX;
    const positions = groups.flatMap((group) => {
      const section = document.getElementById(`openclaw-command-group-${group.id}`);
      return section ? [{ id: group.id, top: section.getBoundingClientRect().top - routeRect.top }] : [];
    });
    const atScrollEnd = routeScroll.scrollTop + routeScroll.clientHeight >= routeScroll.scrollHeight - 2;
    const activeCategory = resolveOpenClawCommandScrollGroup(positions, anchorTop, atScrollEnd);
    const nextHash = openClawCommandCategoryHash(activeCategory);
    if (currentLocationHashRef.current === nextHash) return;

    scrollSpyHashRef.current = nextHash;
    currentLocationHashRef.current = nextHash;
    navigate({
      pathname: location.pathname,
      search: location.search,
      hash: nextHash,
    }, { replace: true });
  }, [groups, location.pathname, location.search, navigate]);

  const scheduleActiveGroupMeasurement = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      measureActiveGroup();
    });
  }, [measureActiveGroup]);

  useEffect(() => {
    if (groups.length === 0) return;
    if (scrollSpyHashRef.current === location.hash) {
      scrollSpyHashRef.current = null;
      resolvedNavigationHashRef.current = location.hash;
      return;
    }
    if (resolvedNavigationHashRef.current === location.hash) return;

    const categoryId = openClawCommandCategoryFromHash(location.hash);
    const target = categoryId
      ? document.getElementById(`openclaw-command-group-${categoryId}`)
      : commandGroupsRef.current;
    if (!target) return;

    const firstResolvedNavigation = resolvedNavigationHashRef.current === undefined;
    resolvedNavigationHashRef.current = location.hash;
    if (firstResolvedNavigation && !categoryId) return;

    const routeScroll = commandGroupsRef.current?.closest<HTMLElement>('[data-route-scroll]');
    if (!routeScroll) return;
    const routeRect = routeScroll.getBoundingClientRect();
    const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? routeRect.top;
    const anchorTop = Math.max(0, headerBottom - routeRect.top) + COMMAND_GROUP_ANCHOR_GAP_PX;
    const targetTop = categoryId
      ? routeScroll.scrollTop + target.getBoundingClientRect().top - routeRect.top - anchorTop
      : 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    programmaticScrollRef.current = true;
    routeScroll.scrollTo({
      top: Math.max(0, targetTop),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    scheduleProgrammaticScrollRelease(scheduleActiveGroupMeasurement);
  }, [groups, location.hash, scheduleActiveGroupMeasurement, scheduleProgrammaticScrollRelease]);

  useEffect(() => {
    const routeScroll = commandGroupsRef.current?.closest<HTMLElement>('[data-route-scroll]');
    if (!routeScroll || groups.length === 0) return;

    const handleScroll = () => {
      if (programmaticScrollRef.current) {
        scheduleProgrammaticScrollRelease(scheduleActiveGroupMeasurement);
        return;
      }
      scheduleActiveGroupMeasurement();
    };
    routeScroll.addEventListener('scroll', handleScroll, { passive: true });
    scheduleActiveGroupMeasurement();
    return () => routeScroll.removeEventListener('scroll', handleScroll);
  }, [groups.length, scheduleActiveGroupMeasurement, scheduleProgrammaticScrollRelease]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    if (scrollSettleTimerRef.current !== null) window.clearTimeout(scrollSettleTimerRef.current);
  }, []);

  return (
    <PageTransition className="min-h-full bg-aegis-bg">
      <div className="min-h-full">
        <header ref={headerRef} className="sticky top-0 z-10 border-b border-aegis-border bg-aegis-bg">
          <div className={`${WORKSPACE_PAGE_CONTENT_CLASS_NAME} flex flex-col gap-4 py-4`}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-aegis-primary/12 text-aegis-primary ring-1 ring-inset ring-aegis-primary/20">
                  <BookOpenText size={18} />
                </span>
                <div className="min-w-0">
                  <h1 className="truncate text-[18px] font-semibold leading-6 text-aegis-text">
                    {t('openclawCommands.title')}
                  </h1>
                  <p className="mt-0.5 truncate text-[11.5px] text-aegis-text-dim">
                    {agentId
                      ? t('openclawCommands.currentAgent', { agentId })
                      : t('openclawCommands.defaultAgent')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={!connected || loading}
                className="grid size-9 shrink-0 place-items-center rounded-md border border-aegis-border bg-aegis-surface text-aegis-text-secondary transition-colors hover:border-aegis-primary/35 hover:text-aegis-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t('common.refresh')}
                title={t('common.refresh')}
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />
              </button>
            </div>
            <label className="relative block min-w-0">
              <span className="sr-only">{t('openclawCommands.searchLabel')}</span>
              <TerminalSquare size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-aegis-text-dim" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('openclawCommands.searchPlaceholder')}
                className="h-10 w-full rounded-md border border-aegis-border bg-aegis-surface ps-9 pe-3 text-[13px] text-aegis-text outline-none transition-colors placeholder:text-aegis-text-dim focus:border-aegis-primary/60 focus:ring-2 focus:ring-aegis-primary/15"
              />
            </label>
          </div>
        </header>

        <main className={`${WORKSPACE_PAGE_CONTENT_CLASS_NAME} py-5`}>
          {!connected ? (
            <CommandState icon={CircleAlert} message={t('openclawCommands.disconnected')} />
          ) : loading ? (
            <CommandState icon={LoaderCircle} message={t('openclawCommands.loading')} spinning />
          ) : failure ? (
            <CommandState
              icon={CircleAlert}
              message={t(failure === 'unavailable'
                ? 'openclawCommands.unavailable'
                : 'openclawCommands.invalidResponse')}
            />
          ) : groups.length === 0 ? (
            <CommandState icon={BookOpenText} message={t('openclawCommands.empty')} />
          ) : (
            <div ref={commandGroupsRef} className="space-y-7 pb-8">
              {groups.map((group) => (
                <section
                  key={group.id}
                  id={`openclaw-command-group-${group.id}`}
                  aria-labelledby={`openclaw-command-group-${group.id}-label`}
                >
                  <div className="mb-2.5 flex items-center gap-2">
                    <h2 id={`openclaw-command-group-${group.id}-label`} className="text-[13px] font-semibold text-aegis-text">
                      {t(`openclawCommands.categories.${group.id}`)}
                    </h2>
                    <span className="text-[11px] tabular-nums text-aegis-text-dim">{group.commands.length}</span>
                    <span className="h-px min-w-6 flex-1 bg-aegis-border" aria-hidden="true" />
                  </div>
                  <div className="grid gap-2 2xl:grid-cols-2">
                    {group.commands.map((command) => {
                      const text = commandText(command);
                      return (
                        <article
                          key={`${command.source}:${command.name}:${command.textAliases?.join(',') ?? ''}`}
                          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border border-aegis-border bg-aegis-surface/45 px-4 py-3.5"
                        >
                          <div className="min-w-0">
                            <div className="flex min-h-7 min-w-0 flex-wrap items-start gap-2">
                              <code className="break-words font-mono text-[12.5px] font-semibold leading-5 text-aegis-text">
                                {text ?? command.name}
                              </code>
                              <span className="rounded border border-aegis-border bg-aegis-overlay/[0.04] px-1.5 py-0.5 text-[10px] font-medium leading-4 text-aegis-text-secondary">
                                {t(`openclawCommands.sources.${command.source}`)}
                              </span>
                              <span className="rounded border border-aegis-border bg-aegis-overlay/[0.04] px-1.5 py-0.5 text-[10px] font-medium leading-4 text-aegis-text-dim">
                                {t(`openclawCommands.scopes.${command.scope}`)}
                              </span>
                            </div>
                            <p className="mt-1 text-[12px] leading-5 text-aegis-text-secondary">{command.description}</p>
                            {command.textAliases && command.textAliases.length > 1 && (
                              <p className="mt-1 break-words font-mono text-[10px] text-aegis-text-dim">
                                {command.textAliases.slice(1).join('  ')}
                              </p>
                            )}
                            {command.args && command.args.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {command.args.map((argument) => (
                                  <span key={argument.name} className="rounded border border-aegis-border px-1.5 py-0.5 font-mono text-[10px] text-aegis-text-dim">
                                    {argument.name}{argument.required ? '*' : ''}{argument.dynamic ? ' ...' : ''}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          {text && (
                            <CopyButton
                              text={text}
                              size="sm"
                              variant="ghost"
                              className="size-8"
                              aria-label={t('openclawCommands.copyCommand')}
                              title={t('openclawCommands.copyCommand')}
                            />
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </main>
      </div>
    </PageTransition>
  );
}

function CommandState({
  icon: Icon,
  message,
  spinning = false,
}: {
  icon: typeof BookOpenText;
  message: string;
  spinning?: boolean;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
      <Icon size={22} className={clsx('text-aegis-text-dim', spinning && 'animate-spin')} />
      <p className="max-w-md text-[13px] leading-6 text-aegis-text-secondary">{message}</p>
    </div>
  );
}
