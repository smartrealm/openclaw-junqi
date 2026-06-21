// ═══════════════════════════════════════════════════════════
// SessionView — Timeline-style session browser
// Ported from nezha/SessionView.tsx, adapted for our chat data model
// ═══════════════════════════════════════════════════════════

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, MessageCircle, Clock, Bot, Cpu, BarChart3, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageTransition } from '@/components/shared/PageTransition';
import { useChatStore } from '@/stores/chatStore';
import type { Session } from '@/stores/chatStore';
import clsx from 'clsx';

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

/** Format a relative time string — e.g. "2m ago", "3h ago", "just now" */
function formatTimeAgo(ts: string | undefined | null): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    const diff = Date.now() - d.getTime();
    if (diff < 0) return 'just now';
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return `${Math.floor(diff / 604_800_000)}w ago`;
  } catch {
    return '—';
  }
}

/** Format a full date string for the detail view */
function formatFullDate(ts: string | undefined | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** Truncate text to a max length, appending "…" if needed */
function truncate(text: string | undefined | null, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

/** Format token count for display */
function fmtTokens(n: number | undefined | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Token usage percentage */
function tokenPct(used: number | undefined | null, max: number | undefined | null): number {
  if (!used || !max || max === 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

/** Colour for token bar based on fill level */
function tokenBarColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500/60';
  if (pct >= 70) return 'bg-amber-500/60';
  return 'bg-aegis-primary/50';
}

// ═══════════════════════════════════════════════════════════
// TimelineSessionNode — a single session entry in the timeline
// ═══════════════════════════════════════════════════════════

interface TimelineSessionNodeProps {
  session: Session;
  isExpanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

function TimelineSessionNode({ session, isExpanded, onToggle, onOpen }: TimelineSessionNodeProps) {
  const { t } = useTranslation();
  const topic = session.topic;
  const label = topic || session.label;
  const displayLabel = truncate(label, 60);
  const pct = tokenPct(session.totalTokens, session.contextTokens);
  const isMainSession = session.key === 'agent:main:main';

  return (
    <div className="relative flex gap-3">
      {/* ── Timeline dot + expand toggle ── */}
      <div className="flex flex-col items-center shrink-0 pt-1">
        <button
          onClick={onToggle}
          className={clsx(
            'w-8 h-8 rounded-full flex items-center justify-center border transition-all shrink-0',
            isExpanded
              ? 'bg-aegis-primary/15 border-aegis-primary/30 text-aegis-primary'
              : 'bg-[rgb(var(--aegis-overlay)/0.04)] border-[rgb(var(--aegis-overlay)/0.12)] text-aegis-text-dim hover:border-aegis-primary/20 hover:text-aegis-text-secondary',
          )}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {/* ── Session card ── */}
      <div className="flex-1 min-w-0 pb-4">
        <div
          className={clsx(
            'rounded-xl border transition-all cursor-pointer',
            'bg-[rgb(var(--aegis-overlay)/0.015)] hover:bg-[rgb(var(--aegis-overlay)/0.03)]',
            isExpanded
              ? 'border-aegis-primary/20 hover:border-aegis-primary/30'
              : 'border-[rgb(var(--aegis-overlay)/0.07)] hover:border-[rgb(var(--aegis-overlay)/0.12)]',
          )}
          onClick={onToggle}
        >
          {/* ── Row 1: Label + type icon + timestamp ── */}
          <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Session icon */}
              <div
                className={clsx(
                  'shrink-0 w-7 h-7 rounded-lg flex items-center justify-center border',
                  isMainSession
                    ? 'bg-aegis-primary/10 border-aegis-primary/20'
                    : 'bg-aegis-accent/10 border-aegis-accent/20',
                )}
              >
                {isMainSession ? (
                  <Bot size={13} className="text-aegis-primary" />
                ) : (
                  <MessageCircle size={13} className="text-aegis-accent" />
                )}
              </div>

              <div className="min-w-0">
                {/* Display label */}
                <div className="text-[13px] font-semibold truncate leading-tight">
                  {displayLabel || t('sessionView.untitled', 'Untitled Session')}
                </div>
                {/* Session key underneath (for non-main sessions) */}
                {!isMainSession && (
                  <div className="text-[9px] font-mono text-aegis-text-dim truncate leading-tight mt-0.5">
                    {session.key.length > 48 ? session.key.slice(0, 48) + '…' : session.key}
                  </div>
                )}
              </div>
            </div>

            {/* Timestamp */}
            <div className="shrink-0 flex items-center gap-1 text-[9px] text-aegis-text-dim">
              <Clock size={9} />
              <span>{formatTimeAgo(session.lastTimestamp)}</span>
            </div>
          </div>

          {/* ── Row 2: Last message preview ── */}
          {session.lastMessage && (
            <div className="px-4 pb-2">
              <p className="text-[11px] text-aegis-text-muted line-clamp-1 leading-relaxed">
                {truncate(session.lastMessage, 120)}
              </p>
            </div>
          )}

          {/* ── Token bar (compact inline) ── */}
          {session.contextTokens != null && session.contextTokens > 0 && (
            <div className="px-4 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 rounded-full bg-[rgb(var(--aegis-overlay)/0.06)] overflow-hidden">
                  <div
                    className={clsx('h-full rounded-full transition-all', tokenBarColor(pct))}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
                <span className="text-[9px] font-mono text-aegis-text-dim shrink-0">
                  {fmtTokens(session.totalTokens)} / {fmtTokens(session.contextTokens)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Expanded detail panel ── */}
        {isExpanded && (
          <div className="mt-0.5 rounded-xl border border-aegis-primary/10 bg-[rgb(var(--aegis-overlay)/0.02)] overflow-hidden">
            <div className="p-4 space-y-3">
              {/* Metadata grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Model */}
                <div className="space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-[0.5px] text-aegis-text-dim">
                    {t('sessionView.model', 'Model')}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-aegis-text-secondary">
                    <Cpu size={10} className="shrink-0 text-aegis-text-dim" />
                    <span className="font-mono truncate">
                      {session.model || t('sessionView.default', 'Default')}
                    </span>
                  </div>
                </div>

                {/* Thinking level */}
                <div className="space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-[0.5px] text-aegis-text-dim">
                    {t('sessionView.thinking', 'Thinking')}
                  </div>
                  <div className="text-[11px] text-aegis-text-secondary">
                    {session.thinkingLevel
                      ? session.thinkingLevel.charAt(0).toUpperCase() + session.thinkingLevel.slice(1)
                      : t('sessionView.off', 'Off')}
                  </div>
                </div>

                {/* Total tokens */}
                <div className="space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-[0.5px] text-aegis-text-dim">
                    {t('sessionView.tokens', 'Tokens')}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-aegis-text-secondary">
                    <BarChart3 size={10} className="shrink-0 text-aegis-text-dim" />
                    <span className="font-mono">
                      {fmtTokens(session.totalTokens)} {t('sessionView.total', 'total')}
                    </span>
                  </div>
                </div>

                {/* Compactions */}
                <div className="space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-[0.5px] text-aegis-text-dim">
                    {t('sessionView.compactions', 'Compactions')}
                  </div>
                  <div className="text-[11px] font-mono text-aegis-text-secondary">
                    {session.compactionCount ?? 0}
                  </div>
                </div>
              </div>

              {/* Full date */}
              {session.lastTimestamp && (
                <div className="text-[10px] text-aegis-text-dim pt-1 border-t border-[rgb(var(--aegis-overlay)/0.05)]">
                  {t('sessionView.lastActive', 'Last active')}: {formatFullDate(session.lastTimestamp)}
                </div>
              )}

              {/* Open button */}
              <div className="pt-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen();
                  }}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all',
                    'bg-aegis-primary/10 border border-aegis-primary/20 text-aegis-primary',
                    'hover:bg-aegis-primary/15 hover:border-aegis-primary/30',
                  )}
                >
                  <MessageCircle size={12} />
                  {t('sessionView.openChat', 'Open Chat')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SessionView — Main page component
// ═══════════════════════════════════════════════════════════

type SortKey = 'recent' | 'oldest' | 'tokens' | 'name';

const SORT_OPTIONS: { key: SortKey; labelKey: string; fallback: string }[] = [
  { key: 'recent',  labelKey: 'sessionView.sortRecent',  fallback: 'Recent'  },
  { key: 'oldest',  labelKey: 'sessionView.sortOldest',  fallback: 'Oldest'  },
  { key: 'tokens',  labelKey: 'sessionView.sortTokens',  fallback: 'Tokens'  },
  { key: 'name',    labelKey: 'sessionView.sortName',    fallback: 'Name'    },
];

export function SessionView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sessions = useChatStore((s) => s.sessions);
  const openTab = useChatStore((s) => s.openTab);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [search, setSearch] = useState('');

  // ── Filter + Sort ──
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list = sessions;
    if (query) {
      list = sessions.filter((s) => {
        const inKey = s.key.toLowerCase().includes(query);
        const inLabel = (s.label || '').toLowerCase().includes(query);
        const inTopic = (s.topic || '').toLowerCase().includes(query);
        const inModel = (s.model || '').toLowerCase().includes(query);
        return inKey || inLabel || inTopic || inModel;
      });
    }

    const sorted = [...list];
    switch (sortKey) {
      case 'recent':
        sorted.sort((a, b) => {
          const ta = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0;
          const tb = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0;
          return tb - ta;
        });
        break;
      case 'oldest':
        sorted.sort((a, b) => {
          const ta = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0;
          const tb = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0;
          return ta - tb;
        });
        break;
      case 'tokens':
        sorted.sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0));
        break;
      case 'name':
        sorted.sort((a, b) => (a.label || a.key).localeCompare(b.label || b.key));
        break;
    }
    return sorted;
  }, [sessions, sortKey, search]);

  const handleToggle = useCallback((key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  const handleOpen = useCallback((key: string) => {
    openTab(key);
    navigate('/chat');
  }, [openTab, navigate]);

  // Main session always at the top
  const mainSession = filtered.find((s) => s.key === 'agent:main:main');
  const otherSessions = filtered.filter((s) => s.key !== 'agent:main:main');
  const sortedSessions = mainSession
    ? [mainSession, ...otherSessions]
    : otherSessions;

  // ═══ RENDER ═══
  return (
    <PageTransition className="flex flex-col flex-1 min-h-0 p-6 gap-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-aegis-primary/10 border border-aegis-primary/20 shrink-0">
            <MessageCircle size={18} className="text-aegis-primary" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-tight">
              {t('sessionView.title', 'Chat Sessions')}
            </h1>
            <p className="text-[11px] text-aegis-text-muted">
              {t('sessionView.subtitle', 'Timeline view of all chat sessions')}
            </p>
          </div>
          {/* Count badge */}
          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-lg bg-aegis-primary/10 border border-aegis-primary/20 text-aegis-primary uppercase tracking-[0.5px]">
            {filtered.length}
          </span>
        </div>
      </div>

      {/* ── Search + Sort bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search input */}
        <div className="relative flex-1 min-w-[180px] max-w-[320px]">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-aegis-text-dim pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sessionView.searchPlaceholder', 'Search sessions…')}
            className={clsx(
              'w-full pl-8 pr-8 py-2 rounded-xl text-[12px] border transition-colors',
              'bg-[rgb(var(--aegis-overlay)/0.03)] border-[rgb(var(--aegis-overlay)/0.08)]',
              'text-aegis-text-secondary placeholder:text-aegis-text-dim',
              'focus:outline-none focus:border-aegis-primary/30 focus:bg-[rgb(var(--aegis-overlay)/0.05)]',
            )}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-aegis-text-dim hover:text-aegis-text-secondary"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Sort pills */}
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSortKey(opt.key)}
            className={clsx(
              'px-3 py-1.5 rounded-xl text-[11px] font-semibold border transition-all',
              sortKey === opt.key
                ? 'bg-aegis-primary/10 border-aegis-primary/25 text-aegis-primary'
                : 'bg-[rgb(var(--aegis-overlay)/0.02)] border-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-muted hover:text-aegis-text-secondary hover:border-[rgb(var(--aegis-overlay)/0.10)]',
            )}
          >
            {t(opt.labelKey, opt.fallback)}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          /* Empty state — no sessions at all */
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.08)]">
                <MessageCircle size={24} className="text-aegis-text-dim" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-aegis-text-muted">
                  {t('sessionView.empty', 'No sessions yet')}
                </p>
                <p className="text-[11px] text-aegis-text-dim mt-0.5">
                  {t('sessionView.emptyHint', 'Sessions will appear here once you start chatting')}
                </p>
              </div>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          /* No search results */
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.08)]">
                <Search size={24} className="text-aegis-text-dim" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-aegis-text-muted">
                  {t('sessionView.noResults', 'No matching sessions')}
                </p>
                <p className="text-[11px] text-aegis-text-dim mt-0.5">
                  {t('sessionView.noResultsHint', 'Try a different search term')}
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Timeline list */
          <div className="max-w-[720px]">
            {sortedSessions.map((session) => (
              <TimelineSessionNode
                key={session.key}
                session={session}
                isExpanded={expandedKey === session.key}
                onToggle={() => handleToggle(session.key)}
                onOpen={() => handleOpen(session.key)}
              />
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  );
}

export default SessionView;
