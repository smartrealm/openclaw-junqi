// ═══════════════════════════════════════════════════════════
// Session Manager — Live session monitoring & overview
// Header + filter bar + 2-column session cards grid
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, RefreshCw, Loader2, Zap, Clock, Bot, Activity, Search, Pencil, Trash2, Check, X } from 'lucide-react';
import { PageTransition } from '@/components/shared/PageTransition';
import { useGatewayDataStore, refreshGroup } from '@/stores/gatewayDataStore';
import { formatTokens } from '@/utils/format';
import { getSessionDisplayLabel } from '@/utils/sessionLabel';
import { applySessionRename } from '@/utils/sessionRename';
import { deleteSessionEverywhere } from '@/utils/sessionDelete';
import { isAgentMainSession } from '@/utils/sessionLifecycle';
import { isSubagentSessionKey } from '@/utils/sessionPresentation';
import { showConfirm } from '@/components/shared/AlertDialog';
import type { AgentInfo, SessionInfo } from '@/stores/gatewayDataStore';
import clsx from 'clsx';
import { Badge, StatusDot } from '@/components/shared/badge';
import { IconButton } from '@/components/shared/button';

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

/** Relative time — e.g. "2m ago", "1h ago", "just now" */
function formatTimeAgo(ts: string | undefined | null, t: ReturnType<typeof useTranslation>['t']): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    const diff = Date.now() - d.getTime();
    if (diff < 0) return t('sessions.justNow', 'just now');
    if (diff < 60_000) return t('sessions.justNow', 'just now');
    if (diff < 3_600_000) return t('sessions.minutesAgo', { count: Math.floor(diff / 60_000), defaultValue: `${Math.floor(diff / 60_000)}m ago` });
    if (diff < 86_400_000) return t('sessions.hoursAgo', { count: Math.floor(diff / 3_600_000), defaultValue: `${Math.floor(diff / 3_600_000)}h ago` });
    return t('sessions.daysAgo', { count: Math.floor(diff / 86_400_000), defaultValue: `${Math.floor(diff / 86_400_000)}d ago` });
  } catch {
    return '—';
  }
}

/** Token usage percentage (0–100), capped */
function tokenPercent(context?: number, max?: number): number {
  if (!context || !max || max === 0) return 0;
  return Math.min(100, Math.round((context / max) * 100));
}

/** Colour of the token bar based on fill level */
function tokenBarColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500/70';
  if (pct >= 70) return 'bg-amber-500/70';
  return 'bg-aegis-primary/60';
}

/** Format tokens — wraps central formatTokens with null handling */
const fmtTokens = (n?: number): string => n == null ? '—' : formatTokens(n);

// ═══════════════════════════════════════════════════════════
// Filter types
// ═══════════════════════════════════════════════════════════

type FilterType = 'all' | 'running' | 'idle' | 'subagent';

const FILTERS: { id: FilterType; labelKey: string; fallback: string }[] = [
  { id: 'all',      labelKey: 'sessions.filterAll',      fallback: 'All'        },
  { id: 'running',  labelKey: 'sessions.filterRunning',  fallback: 'Running'    },
  { id: 'idle',     labelKey: 'sessions.filterIdle',     fallback: 'Idle'       },
  { id: 'subagent', labelKey: 'sessions.filterSubagent', fallback: 'Sub-agents' },
];


function getAgentId(session: SessionInfo): string | undefined {
  if (typeof session.agentId === 'string' && session.agentId.trim()) return session.agentId.trim();
  const parts = String(session.key || '').split(':');
  return parts[0] === 'agent' && parts[1] ? parts[1] : undefined;
}

function getSessionKind(session: SessionInfo): 'main' | 'subagent' | 'agent' | 'session' {
  if (isAgentMainSession(session.key)) return 'main';
  if (isSubagentSessionKey(String(session.key || ''))) return 'subagent';
  if (String(session.key || '').startsWith('agent:')) return 'agent';
  return 'session';
}

function shortModel(model?: string): string | undefined {
  if (!model) return undefined;
  return String(model).split('/').pop() || model;
}

// ═══════════════════════════════════════════════════════════
// SessionCard
// ═══════════════════════════════════════════════════════════

interface SessionCardProps {
  session: SessionInfo;
  agentNameById: Record<string, string>;
}

function SessionCard({ session, agentNameById }: SessionCardProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const isRunning = session.running === true;
  const kind = getSessionKind(session);
  const isSubAgent = kind === 'subagent';
  const agentId = getAgentId(session);
  const agentName = agentId ? (agentNameById[agentId] || agentId) : undefined;
  const pct = tokenPercent(session.contextTokens, session.maxTokens);

  const displayName = getSessionDisplayLabel(session, {
    mainSessionLabel: t('dashboard.mainSession', 'Main Session'),
    genericSessionLabel: t('dashboard.session', 'Session'),
  });
  const isAgentKey  = session.key.startsWith('agent:');
  const canDelete = !isAgentMainSession(session.key);
  const inputId = `session-rename-${session.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const errorId = `${inputId}-error`;

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  const startRename = useCallback(() => {
    setDraftLabel(session.label?.trim() || displayName);
    setRenameError(null);
    setEditing(true);
  }, [displayName, session.label]);

  const cancelRename = useCallback(() => {
    if (savingRename) return;
    setEditing(false);
    setRenameError(null);
  }, [savingRename]);

  const handleRenameBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      cancelRename();
    }
  }, [cancelRename]);

  const submitRename = useCallback(async () => {
    if (savingRename) return;
    setSavingRename(true);
    setRenameError(null);
    try {
      const result = await applySessionRename(session.key, draftLabel);
      if (!result.ok) {
        setRenameError(result.error || t('chat.renameSessionFailed', 'Could not rename session. Try again.'));
        return;
      }

      setEditing(false);
      setRenameError(null);
    } catch (error) {
      const detail = error instanceof Error && error.message
        ? error.message
        : t('chat.renameSessionFailed', 'Could not rename session. Try again.');
      setRenameError(detail);
    } finally {
      setSavingRename(false);
    }
  }, [draftLabel, savingRename, session.key, t]);

  const handleDelete = useCallback(() => {
    showConfirm(
      t('chat.deleteSession', 'Delete session'),
      t('chat.deleteSessionConfirm', 'Delete this session and its history? This cannot be undone.'),
      async () => {
        await deleteSessionEverywhere(session.key);
      },
    );
  }, [session.key, t]);

  return (
    <div
      className={clsx(
        'flex flex-col gap-3 p-4 rounded-2xl border transition-all',
        'bg-[rgb(var(--aegis-overlay)/0.02)] hover:bg-[rgb(var(--aegis-overlay)/0.035)]',
        isRunning
          ? 'border-aegis-primary/20 hover:border-aegis-primary/30'
          : 'border-[rgb(var(--aegis-overlay)/0.07)] hover:border-[rgb(var(--aegis-overlay)/0.12)]',
      )}
    >
      {/* ── Row 1: name + status + compact icon actions ── */}
      <div className="flex items-start justify-between gap-2" onBlur={editing ? handleRenameBlur : undefined}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Icon */}
          <div
            className={clsx(
              'shrink-0 w-8 h-8 rounded-[10px] flex items-center justify-center border',
              isSubAgent
                ? 'bg-aegis-accent/10 border-aegis-accent/20'
                : 'bg-aegis-primary/10 border-aegis-primary/20',
            )}
          >
            {isSubAgent ? (
              <Zap size={14} className="text-aegis-accent" />
            ) : (
              <Bot size={14} className="text-aegis-primary" />
            )}
          </div>

          {/* Name */}
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="min-w-0">
                <input
                  ref={inputRef}
                  id={inputId}
                  value={draftLabel}
                  onChange={(event) => setDraftLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void submitRename();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelRename();
                    }
                  }}
                  disabled={savingRename}
                  aria-label={t('chat.renameSession', 'Rename session')}
                  aria-describedby={renameError ? errorId : undefined}
                  aria-invalid={Boolean(renameError)}
                  className="h-7 w-full min-w-0 rounded-md border border-aegis-primary/35 bg-aegis-bg px-2 text-[12px] text-aegis-text outline-none transition-colors focus:border-aegis-primary focus:ring-1 focus:ring-aegis-primary/40 disabled:cursor-wait disabled:opacity-60"
                />
                {renameError && (
                  <p id={errorId} role="alert" className="mt-1 max-w-[15rem] text-[10px] leading-4 text-aegis-danger">
                    {renameError}
                  </p>
                )}
              </div>
            ) : (
              <div className="text-[13px] font-bold truncate leading-tight">
                {displayName}
              </div>
            )}
            {/* Show formatted key underneath when label exists OR when key is agent-style */}
            {isAgentKey && (
              <div className="text-[9px] font-mono text-aegis-text-dim truncate leading-tight mt-0.5">
                {session.key.length > 40 ? session.key.substring(0, 40) + '…' : session.key}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Status pill */}
          <Badge tone={isRunning ? 'running' : 'neutral'} size="sm" variant="soft" className="uppercase tracking-[0.5px]">
            <StatusDot tone={isRunning ? 'running' : 'idle'} size="sm" live={isRunning} />
            {isRunning ? t('sessions.statusRunning', 'Running') : t('sessions.statusIdle', 'Idle')}
          </Badge>

          {editing ? (
            <>
              <IconButton
                size="xs"
                variant="ghost"
                tone="primary"
                aria-label={t('common.save', 'Save')}
                title={t('common.save', 'Save')}
                loading={savingRename}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => void submitRename()}
              >
                <Check size={13} aria-hidden="true" />
              </IconButton>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={t('common.cancel', 'Cancel')}
                title={t('common.cancel', 'Cancel')}
                disabled={savingRename}
                onPointerDown={(event) => event.preventDefault()}
                onClick={cancelRename}
              >
                <X size={13} aria-hidden="true" />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton
                size="xs"
                variant="ghost"
                aria-label={t('chat.renameSession', 'Rename session')}
                title={t('chat.renameSession', 'Rename session')}
                onClick={startRename}
              >
                <Pencil size={13} aria-hidden="true" />
              </IconButton>
              {canDelete && (
                <IconButton
                  size="xs"
                  variant="ghost"
                  tone="danger"
                  aria-label={t('chat.deleteSession', 'Delete session')}
                  title={t('chat.deleteSession', 'Delete session')}
                  onClick={handleDelete}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </IconButton>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Row 2: agent + type + model tags ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {agentName && (
          <Badge tone={agentId === 'main' ? 'ok' : 'info'} size="sm" variant="soft" className="font-medium">
            <Bot size={10} />
            {agentName}
          </Badge>
        )}

        <Badge tone={isSubAgent ? 'attention' : kind === 'main' ? 'ok' : 'neutral'} size="sm" variant="outline">
          {kind === 'main'
            ? t('sessions.typeMain', 'Main')
            : kind === 'subagent'
              ? t('sessions.typeSubagent', 'Sub-agent')
              : kind === 'agent'
                ? t('sessions.typeAgent', 'Agent')
                : t('sessions.typeSession', 'Session')}
        </Badge>

        {session.model && (
          <Badge tone="info" size="sm" variant="soft" className="font-mono">
            {shortModel(session.model)}
          </Badge>
        )}

        {(session.compactions ?? 0) > 0 && (
          <Badge tone="warn" size="sm" variant="soft">
            <Zap size={9} />
            {session.compactions}
          </Badge>
        )}
      </div>

      {/* ── Row 3: token usage bar ── */}
      {session.maxTokens ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[9px] text-aegis-text-dim">
            <span className="flex items-center gap-1">
              <Activity size={9} />
              {t('sessions.context', 'Context')}
            </span>
            <span className="font-mono">
              {fmtTokens(session.contextTokens)} / {fmtTokens(session.maxTokens)}
              <span className="ms-1 opacity-60">({pct}%)</span>
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-[rgb(var(--aegis-overlay)/0.06)] overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all', tokenBarColor(pct))}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : session.contextTokens ? (
        <div className="text-[9px] text-aegis-text-dim flex items-center gap-1">
          <Activity size={9} />
          <span className="font-mono">{t('sessions.tokensUsed', { tokens: fmtTokens(session.contextTokens), defaultValue: `${fmtTokens(session.contextTokens)} tokens used` })}</span>
        </div>
      ) : null}

      {/* ── Row 4: last active ── */}
      <div className="flex items-center gap-1 text-[9px] text-aegis-text-dim">
        <Clock size={9} className="shrink-0" />
        <span>{formatTimeAgo(session.lastActive, t)}</span>
        {session.totalTokens != null && (
          <>
            <span className="mx-1 opacity-30">·</span>
            <span className="font-mono">{t('sessions.totalTokens', { tokens: fmtTokens(session.totalTokens), defaultValue: `${fmtTokens(session.totalTokens)} total` })}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SessionManagerPage
// ═══════════════════════════════════════════════════════════

export function SessionManagerPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FilterType>('all');
  const [query, setQuery] = useState('');

  // ── Store ──
  const sessions = useGatewayDataStore((s) => s.sessions);
  const agents = useGatewayDataStore((s) => s.agents) as AgentInfo[];
  const loading   = useGatewayDataStore((s) => s.loading.sessions);

  const agentNameById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name || a.id])), [agents]);

  // ── Filtered list ──
  const filtered = useMemo<SessionInfo[]>(() => {
    const base = (() => {
      switch (filter) {
        case 'running':
          return sessions.filter((s) => s.running === true);
        case 'idle':
          return sessions.filter((s) => s.running !== true);
        case 'subagent':
          return sessions.filter((s) => getSessionKind(s) === 'subagent');
        default:
          return sessions;
      }
    })();
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((s) => {
      const agentId = getAgentId(s) || '';
      const agentName = agentId ? (agentNameById[agentId] || agentId) : '';
      const label = getSessionDisplayLabel(s, {
        mainSessionLabel: t('dashboard.mainSession', 'Main Session'),
        genericSessionLabel: t('dashboard.session', 'Session'),
      });
      return [label, s.key, s.model, s.kind, agentId, agentName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [sessions, filter, query, agentNameById, t]);

  // ── Counts for filter badges ──
  const counts = useMemo(() => ({
    all:      sessions.length,
    running:  sessions.filter((s) => s.running === true).length,
    idle:     sessions.filter((s) => s.running !== true).length,
    subagent: sessions.filter((s) => getSessionKind(s) === 'subagent').length,
  }), [sessions]);

  // ═══ RENDER ═══
  return (
    <PageTransition className="flex flex-col flex-1 min-h-0 p-6 gap-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-aegis-primary/10 border border-aegis-primary/20 shrink-0">
            <Users size={18} className="text-aegis-primary" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-tight">
              {t('sessions.title', 'Sessions')}
            </h1>
            <p className="text-[11px] text-aegis-text-muted">
              {t('sessions.subtitle', 'Active and idle agent sessions')}
            </p>
          </div>
          {/* Total count badge */}
          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-lg bg-aegis-primary/10 border border-aegis-primary/20 text-aegis-primary uppercase tracking-[0.5px]">
            {counts.all}
          </span>
        </div>

        {/* Refresh button */}
        <button
          onClick={() => refreshGroup('sessions')}
          disabled={loading}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-semibold transition-colors',
            'border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted hover:text-aegis-text-secondary',
            'bg-[rgb(var(--aegis-overlay)/0.02)] hover:bg-[rgb(var(--aegis-overlay)/0.04)]',
            loading && 'opacity-50 pointer-events-none',
          )}
        >
          {loading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          {t('sessions.refresh', 'Refresh')}
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => {
          const count = counts[f.id];
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold border transition-all',
                active
                  ? 'bg-aegis-primary/10 border-aegis-primary/25 text-aegis-primary'
                  : 'bg-[rgb(var(--aegis-overlay)/0.02)] border-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-muted hover:text-aegis-text-secondary hover:border-[rgb(var(--aegis-overlay)/0.10)]',
              )}
            >
              {t(f.labelKey, f.fallback)}
              <span
                className={clsx(
                  'text-[9px] font-bold px-1.5 py-0.5 rounded-md min-w-[18px] text-center',
                  active
                    ? 'bg-aegis-primary/15 text-aegis-primary'
                    : 'bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Search ── */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.02)]">
        <Search size={14} className="text-aegis-text-dim shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('sessions.searchPlaceholder', 'Search by agent, model, session key...')}
          className="flex-1 bg-transparent outline-none text-[12px] text-aegis-text placeholder:text-aegis-text-dim"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-[10px] text-aegis-text-dim hover:text-aegis-text">
            {t('sessions.clearSearch', 'Clear')}
          </button>
        )}
      </div>

      {/* ── Content ── */}
      {loading && sessions.length === 0 ? (
        /* Initial loading state */
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-aegis-text-dim">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-[12px]">{t('sessions.loading', 'Loading sessions…')}</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.08)]">
              <Users size={24} className="text-aegis-text-dim" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-aegis-text-muted">
                {t('sessions.empty', 'No sessions found')}
              </p>
              <p className="text-[11px] text-aegis-text-dim mt-0.5">
                {filter !== 'all'
                  ? t('sessions.emptyFilter', 'Try switching to a different filter')
                  : t('sessions.emptyHint', 'Sessions will appear here when agents are active')}
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* Sessions grid — 2 columns */
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 auto-rows-max overflow-y-auto pb-2">
          {filtered.map((session) => (
            <SessionCard key={session.key} session={session} agentNameById={agentNameById} />
          ))}
        </div>
      )}
    </PageTransition>
  );
}
