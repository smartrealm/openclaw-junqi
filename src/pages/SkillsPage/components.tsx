// ═══════════════════════════════════════════════════════════
// Skills Page — Sub-components
// ═══════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import { X, Copy, ExternalLink, Download, MessageSquare, FileText, BadgeCheck, BookOpenText, CheckCircle2, ShieldAlert, ShieldCheck, Star, Pin } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import type { SkillPersona, SkillPersonaFields } from '@/types/skills';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface MySkill extends SkillPersonaFields {
  slug: string;
  name: string;
  emoji: React.ReactNode;
  description: string;
  version: string;
  enabled: boolean;
  /** Raw source string from the gateway (e.g. "openclaw-bundled", "openclaw-managed", "openclaw-extra") */
  source: string;
  security?: {
    passed: boolean | null | undefined;
    decision: string;
  };
  curator?: {
    state: 'active' | 'stale' | 'archived';
    pinned: boolean;
    useCount: number;
  };
}

/** Map raw gateway source to a display group */
export function getSkillGroup(source: string): 'builtin' | 'installed' | 'extra' {
  if (source === 'openclaw-bundled') return 'builtin';
  if (source === 'openclaw-extra') return 'extra';
  return 'installed';
}

export interface HubSkill extends SkillPersonaFields {
  slug: string;
  name: string;
  emoji: React.ReactNode;
  summary: string;
  score: number;
  owner?: string;
  ownerAvatar?: string;
  version?: string;
  updatedAt?: number;
  badge?: 'official' | 'featured';
  homepage?: string;
}

export interface SkillDetail extends HubSkill {
  readme?: string;
  createdAt?: number;
  latestVersion?: {
    version: string;
    createdAt: number;
    changelog?: string;
  };
  metadata?: {
    os?: string[] | null;
    systems?: string[] | null;
  };
  tags?: Record<string, string>;
  channel?: string | null;
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function formatDate(timestamp: number | undefined): string | null {
  if (timestamp === undefined) return null;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : null;
}

/**
 * Normalize a skill's optional `persona` field into a SkillPersona object, or
 * return null when the persona is missing/empty/whitespace. UI elements gate
 * on this so tool-only skills remain visually unchanged.
 */
export function resolvePersona(p?: SkillPersona | string): SkillPersona | null {
  if (typeof p === 'string') {
    const trimmed = p.trim();
    return trimmed ? { prompt: p } : null;
  }
  if (p && typeof p === 'object' && typeof p.prompt === 'string' && p.prompt.trim()) {
    return p;
  }
  return null;
}

function SourceBadge({ source }: { source: string }) {
  const group = getSkillGroup(source);
  const style =
    group === 'installed'
      ? 'bg-aegis-primary/[0.08] border-aegis-primary/15 text-aegis-primary'
      : group === 'extra'
        ? 'bg-aegis-accent/[0.08] border-aegis-accent/15 text-aegis-accent'
        : 'bg-[rgb(var(--aegis-overlay)/0.04)] border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-dim';
  const label =
    group === 'installed' ? 'Installed' : group === 'extra' ? 'Extra' : 'Built-In';
  return (
    <span className={clsx('inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border', style)}>
      {label}
    </span>
  );
}

function CuratorBadge({ curator }: { curator: NonNullable<MySkill['curator']> }) {
  const { t } = useTranslation();
  const style = curator.state === 'active'
    ? 'border-aegis-success/20 bg-aegis-success/[0.07] text-aegis-success'
    : curator.state === 'stale'
      ? 'border-aegis-warning/20 bg-aegis-warning/[0.07] text-aegis-warning'
      : 'border-aegis-text-dim/20 bg-[rgb(var(--aegis-overlay)/0.04)] text-aegis-text-dim';
  const label = curator.state === 'active'
    ? t('skillsExtra.curatorActive', 'Active')
    : curator.state === 'stale'
      ? t('skillsExtra.curatorStale', 'Stale')
      : t('skillsExtra.curatorArchived', 'Archived');
  return (
    <span
      className={clsx('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold', style)}
      title={t('skillsExtra.curatorUseCount', '{{count}} uses', { count: curator.useCount })}
    >
      {curator.pinned && <Pin size={9} aria-hidden="true" />}
      {label}
    </span>
  );
}

/** Color bar palette — matches CronMonitor style */
const SKILL_COLORS = [
  'rgb(var(--aegis-data-1))',
  'rgb(var(--aegis-data-2))',
  'rgb(var(--aegis-data-3))',
  'rgb(var(--aegis-data-4))',
  'rgb(var(--aegis-data-5))',
  'rgb(var(--aegis-data-6))',
  'rgb(var(--aegis-data-7))',
  'rgb(var(--aegis-data-8))',
  'rgb(var(--aegis-data-9))',
  'rgb(var(--aegis-data-10))',
];

function HubBadge({ badge }: { badge?: 'official' | 'featured' }) {
  const { t } = useTranslation();
  if (!badge) return null;
  if (badge === 'official') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold
        bg-aegis-primary/[0.08] border border-aegis-primary/15 text-aegis-primary">
        <BadgeCheck size={10} aria-hidden="true" />
        {t('skillsExtra.official', 'Official')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold
      bg-aegis-accent/[0.08] border border-aegis-accent/15 text-aegis-accent">
      <Star size={10} aria-hidden="true" />
      {t('skillsExtra.featured')}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════
// MySkillRow — Installed skill (clean list item)
// ═══════════════════════════════════════════════════════════

export function MySkillRow({ skill, onToggle, onViewCard, index = 0 }: {
  skill: MySkill;
  onToggle: () => void;
  onViewCard?: () => void;
  index?: number;
}) {
  const { t } = useTranslation();
  const color = SKILL_COLORS[index % SKILL_COLORS.length];

  return (
    <div
      className={clsx(
        'flex items-stretch gap-0 mb-1.5 rounded-[14px] overflow-hidden cursor-default transition-all border group',
        skill.enabled
          ? 'border-[rgb(var(--aegis-overlay)/0.06)] bg-[rgb(var(--aegis-overlay)/0.02)] hover:bg-[rgb(var(--aegis-overlay)/0.03)]'
          : 'border-[rgb(var(--aegis-overlay)/0.04)] bg-[rgb(var(--aegis-overlay)/0.01)] opacity-35',
      )}
    >
      {/* Color bar — same as CronMonitor */}
      <div
        className="w-[4px] shrink-0 rounded-s-[14px]"
        style={{ background: skill.enabled ? color : 'rgb(var(--aegis-overlay) / 0.06)' }}
      />

      {/* Info — emoji + name on line 1, description + badge on line 2 */}
      <div className="flex-1 min-w-0 py-3 ps-3.5 pe-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[13px]">{skill.emoji}</span>
          <span className={clsx(
            'text-[13px] font-bold truncate',
            !skill.enabled && 'text-aegis-text-muted',
          )}>
            {skill.name}
          </span>
        </div>
        <div className="text-[10px] text-aegis-text-muted flex items-center gap-2 flex-wrap">
          <span className="truncate max-w-[260px]">{skill.description}</span>
          <SourceBadge source={skill.source} />
          {skill.curator && <CuratorBadge curator={skill.curator} />}
          {skill.security?.passed === true && (
            <span
              className="inline-flex items-center text-aegis-success"
              title={t('skillsExtra.securityPassed', 'Security check passed')}
              aria-label={t('skillsExtra.securityPassed', 'Security check passed')}
            >
              <ShieldCheck size={12} aria-hidden="true" />
            </span>
          )}
          {skill.security?.passed === false && (
            <span
              className="inline-flex items-center text-aegis-danger"
              title={t('skillsExtra.securityFailed', 'Security check failed')}
              aria-label={t('skillsExtra.securityFailed', 'Security check failed')}
            >
              <ShieldAlert size={12} aria-hidden="true" />
            </span>
          )}
        </div>
      </div>

      {/* Version — same position as "Time Left" in CronMonitor */}
      <div className="w-[80px] shrink-0 flex flex-col items-end justify-center pe-3 py-2">
        <span className="text-[8px] text-aegis-text-dim font-medium mb-0.5">{t('skillsExtra.version', 'Version')}</span>
        <span className="text-sm font-bold font-mono" style={{
          color: skill.enabled ? color : 'rgb(var(--aegis-overlay) / 0.1)',
        }}>
          {skill.version ? `v${skill.version}` : '—'}
        </span>
      </div>

      {/* Actions — toggle + optional persona chat */}
      <div className="flex items-center gap-1.5 pe-3 shrink-0">
        {onViewCard && (
          <button
            type="button"
            onClick={onViewCard}
            title={t('skillsExtra.viewSkillCard', 'View skill card')}
            aria-label={t('skillsExtra.viewSkillCard', 'View skill card')}
            className="flex size-7 items-center justify-center rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-dim transition-all hover:border-aegis-primary/30 hover:bg-aegis-primary/[0.04] hover:text-aegis-primary"
          >
            <BookOpenText size={12} aria-hidden="true" />
          </button>
        )}
        {(() => {
          const persona = resolvePersona(skill.persona);
          if (!persona) return null;
          return (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('aegis:open-new-session-picker', {
                detail: { persona },
              }))}
              title={t('skills.startChatWithPersona', 'Start chat with this persona')}
              aria-label={t('skills.startChatWithPersona', 'Start chat with this persona')}
              className="w-7 h-7 rounded-lg flex items-center justify-center border
                border-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-dim
                hover:text-aegis-primary hover:border-aegis-primary/30 hover:bg-aegis-primary/[0.04]
                transition-all"
            >
              <MessageSquare size={11} />
            </button>
          );
        })()}
        <button
          onClick={onToggle}
          className={clsx(
            'w-8 h-[18px] rounded-full relative border transition-all shrink-0',
            skill.enabled
              ? 'bg-aegis-primary/25 border-aegis-primary/40'
              : 'bg-[rgb(var(--aegis-overlay)/0.05)] border-[rgb(var(--aegis-overlay)/0.1)]',
          )}
        >
          <div className={clsx(
            'absolute top-[2px] w-3 h-3 rounded-full transition-all',
            skill.enabled ? 'start-[16px] bg-aegis-primary' : 'start-[2px] bg-[rgb(var(--aegis-overlay)/0.2)]',
          )} style={skill.enabled ? { boxShadow: '0 0 6px rgb(var(--aegis-primary) / 0.5)' } : undefined} />
        </button>
      </div>
    </div>
  );
}

export function SkillCardDialog({
  open,
  card,
  loading,
  error,
  onClose,
}: {
  open: boolean;
  card: { skillKey: string; sizeBytes: number; content: string } | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(680px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden border-aegis-border bg-aegis-card-solid p-0 text-aegis-text shadow-2xl sm:rounded-lg">
        <DialogHeader className="border-b border-aegis-border px-5 py-4 pe-12 text-start">
          <DialogTitle className="text-sm font-bold text-aegis-text">
            {t('skillsExtra.skillCardTitle', 'Skill card')}
          </DialogTitle>
          <DialogDescription className="mt-1 truncate font-mono text-[11px] text-aegis-text-dim">
            {card?.skillKey ?? t('skillsExtra.skillCardPending', 'Waiting for OpenClaw response')}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex min-h-40 items-center justify-center">
              <LoadingIndicator size={20} className="text-aegis-text-dim" />
            </div>
          )}
          {!loading && error && (
            <div className="border-s-2 border-aegis-danger/60 bg-aegis-danger/[0.04] px-3 py-2.5 text-[12px] leading-relaxed text-aegis-text-secondary">
              {error}
            </div>
          )}
          {!loading && !error && card && (
            <div>
              <p className="mb-3 text-[10px] text-aegis-text-dim">
                {t('skillsExtra.skillCardSize', '{{size}} bytes', { size: card.sizeBytes })}
              </p>
              <pre className="max-h-[min(60dvh,580px)] overflow-auto whitespace-pre-wrap break-words rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.025)] p-3 font-mono text-[11px] leading-5 text-aegis-text-secondary">
                {card.content}
              </pre>
            </div>
          )}
        </div>
        <DialogFooter className="border-t border-aegis-border bg-[rgb(var(--aegis-overlay)/0.02)] px-5 py-3">
          <DialogClose className="w-full rounded-lg border border-aegis-border px-3 py-2 text-[11px] font-medium text-aegis-text-muted transition-colors hover:bg-aegis-hover/40 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40 sm:w-auto">
            {t('common.close', 'Close')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════
// HubSkillRow — Marketplace result row
// ═══════════════════════════════════════════════════════════

export function HubSkillRow({ skill, onClick }: { skill: HubSkill; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3.5 px-4 py-3 rounded-[10px] cursor-pointer
        hover:bg-[rgb(var(--aegis-overlay)/0.025)] transition-colors
        border-b border-[rgb(var(--aegis-overlay)/0.02)] last:border-0"
    >
      {/* Emoji */}
      <div className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[20px]
        bg-[rgb(var(--aegis-overlay)/0.025)] shrink-0">
        {skill.emoji}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <span className="text-[13px] font-semibold">{skill.name}</span>
          <HubBadge badge={skill.badge} />
          {skill.owner && (
            <span className="flex items-center gap-1 text-[10.5px] text-aegis-text-dim">
              {skill.ownerAvatar && <img src={skill.ownerAvatar} alt="" className="w-[13px] h-[13px] rounded-full" loading="lazy" />}
              {skill.owner}
            </span>
          )}
        </div>
        <div className="text-[11.5px] text-aegis-text-muted truncate">{skill.summary}</div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3.5 shrink-0 text-[11px] text-aegis-text-dim">
        <span className="text-[10px] font-mono" title={t('skillsExtra.score', 'Search score')}>
          {skill.score.toFixed(2)}
        </span>
        {skill.version && <span className="text-[10px] font-mono">v{skill.version}</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SkillDetailPanel — Slide-in detail panel
// ═══════════════════════════════════════════════════════════

export type InstallState = 'idle' | 'installing' | 'done' | 'error';

export function SkillDetailPanel({ open, skill, loading, onClose, onInstall, installState,
  accentColor, installLabel, installingLabel, doneLabel, doneHint, errorLabel,
  externalUrl, externalLabel, installCmd, errorText, secondaryActionLabel, onSecondaryAction,
  persona, onStartChat,
}: {
  open: boolean;
  skill: SkillDetail | null;
  loading: boolean;
  onClose: () => void;
  onInstall?: (slug: string) => void;
  installState?: InstallState;
  accentColor?: 'primary' | 'red';
  installLabel?: string;
  installingLabel?: string;
  doneLabel?: string;
  /** Small hint text shown below the done button, e.g. "active next conversation". */
  doneHint?: string;
  errorLabel?: string;
  externalUrl?: string;
  externalLabel?: string;
  /** Optional runtime-provided command shown in the code block. */
  installCmd?: string;
  errorText?: string;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** Optional persona carried by the skill; surfaces a "Start chat" action. */
  persona?: SkillPersona | string;
  /** Called when user clicks the "Start chat" button with the resolved persona. */
  onStartChat?: (persona: SkillPersona) => void;
}) {
  const { t } = useTranslation();
  const isRed = accentColor === 'red';
  const [activePane, setActivePane] = useState<'overview' | 'readme' | 'version'>('overview');
  useEffect(() => {
    setActivePane('overview');
  }, [skill?.slug]);
  const hasReadme = Boolean(skill?.readme);
  const hasLatestVersion = Boolean(skill?.latestVersion);
  const updatedAt = formatDate(skill?.updatedAt);
  const latestVersionCreatedAt = formatDate(skill?.latestVersion?.createdAt);
  const hasMetadata = Boolean(skill?.metadata?.os?.length || skill?.metadata?.systems?.length);
  const hasCatalogFields = Boolean(skill?.channel || Object.keys(skill?.tags ?? {}).length > 0);
  const safeReadme = useMemo(
    () => DOMPurify.sanitize(skill?.readme ?? ''),
    [skill?.readme],
  );
  const resolvedPersona = resolvePersona(persona);
  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed top-[56px] end-0 bottom-0 start-0 z-[2147481000] bg-black/35"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Detail workspace */}
      <div
        className={clsx(
          'fixed top-[56px] bottom-[6px] z-[2147481001] flex w-[460px] max-w-[calc(100vw-12px)] flex-col',
          'bg-aegis-bg border-s border-[rgb(var(--aegis-overlay)/0.09)]',
          open && 'shadow-[-12px_0_40px_rgba(0,0,0,0.3)]',
          'overflow-hidden',
          'transition-[inset-inline-end] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          open ? 'end-0' : '-end-[460px] pointer-events-none',
        )}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <LoadingIndicator size={24} className="text-aegis-text-dim" />
          </div>
        ) : skill ? (
          <>
            <header className="shrink-0 border-b border-[rgb(var(--aegis-overlay)/0.08)] bg-aegis-bg px-4 pt-3">
              <div className="flex items-center gap-2.5 pb-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.035)] text-[20px]">
                  {skill.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-aegis-text">{skill.name}</span>
                    <HubBadge badge={skill.badge} />
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-aegis-text-dim">{skill.slug}</div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  title={t('common.close', 'Close')}
                  aria-label={t('common.close', 'Close')}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-danger/[0.08] hover:text-aegis-danger"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="flex items-center gap-1" role="tablist" aria-label={t('skills.skillDetails', 'Skill details')}>
                {([
                  { id: 'overview' as const, label: t('skills.overview', 'Overview'), visible: true },
                  { id: 'readme' as const, label: t('skills.readme', 'Readme'), visible: hasReadme },
                  { id: 'version' as const, label: t('skills.latestVersion', 'Latest version'), visible: hasLatestVersion },
                ]).filter((tab) => tab.visible).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activePane === tab.id}
                    onClick={() => setActivePane(tab.id)}
                    className={clsx(
                      'border-b-2 px-2.5 py-2 text-[10.5px] font-medium transition-colors',
                      activePane === tab.id
                        ? 'border-aegis-primary text-aegis-primary'
                        : 'border-transparent text-aegis-text-dim hover:text-aegis-text-secondary',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
            {activePane === 'overview' && <>
            <div className="px-4 py-4">
              {skill.owner && (
                <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-aegis-text-muted">
                  {skill.ownerAvatar && <img src={skill.ownerAvatar} alt="" className="size-4 rounded-full" />}
                  <span className="truncate">{skill.owner}</span>
                </div>
              )}
              <p className="max-w-[48ch] text-[12px] leading-5 text-aegis-text-secondary">{skill.summary}</p>
            </div>

            {/* Facts from the native catalog response. */}
            <div className="grid grid-cols-3 divide-x divide-[rgb(var(--aegis-overlay)/0.06)] border-y border-[rgb(var(--aegis-overlay)/0.08)]">
              {[
                { value: skill.score.toFixed(2), label: t('skillsExtra.score', 'Search score') },
                ...(skill.version ? [{ value: `v${skill.version}`, label: t('skillsExtra.version', 'Version') }] : []),
                ...(updatedAt ? [{ value: updatedAt, label: t('skillsExtra.updated', 'Updated') }] : []),
              ].map(s => (
                <div key={s.label} className="py-2.5 text-center">
                  <div className="text-[15px] font-semibold tabular-nums">{s.value}</div>
                  <div className="mt-0.5 text-[9px] text-aegis-text-dim">{s.label}</div>
                </div>
              ))}
            </div>

            {installCmd && (
              <div className="border-b border-[rgb(var(--aegis-overlay)/0.08)] px-4 py-3">
                <div className="flex items-center gap-2 border-s-2 border-aegis-primary/50 bg-[rgb(var(--aegis-overlay)/0.025)] px-3 py-2 font-mono text-[11px] text-aegis-primary">
                  <code className="flex-1 truncate">{installCmd}</code>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(installCmd)}
                    title={t('common.copy', 'Copy')}
                    aria-label={t('common.copy', 'Copy')}
                    className="text-aegis-text-dim hover:text-aegis-primary transition-colors shrink-0"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            )}

            {installState === 'error' && errorText && (
              <div className="mx-4 mt-3 border-s-2 border-aegis-danger/60 bg-aegis-danger/[0.04] px-3 py-2.5 text-[11.5px] leading-relaxed text-aegis-text-secondary">
                {errorText}
              </div>
            )}

            {hasMetadata && (
              <div className="px-4 py-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-aegis-text-muted">
                  {t('skillsExtra.metadata', 'Gateway metadata')}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {skill.metadata?.os?.map(value => (
                    <span key={`os:${value}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-mono bg-aegis-primary/[0.06] border border-aegis-primary/10 text-aegis-primary">
                      {t('skillsExtra.os', 'OS')}: {value}
                    </span>
                  ))}
                  {skill.metadata?.systems?.map(value => (
                    <span key={`system:${value}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-mono bg-aegis-primary/[0.06] border border-aegis-primary/10 text-aegis-primary">
                      {t('skillsExtra.systems', 'Systems')}: {value}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {hasCatalogFields && (
              <div className="border-t border-[rgb(var(--aegis-overlay)/0.08)] px-4 py-4">
                <h3 className="mb-2 text-[11px] font-semibold text-aegis-text-muted">
                  {t('skillsExtra.catalogFields', 'Catalog fields')}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {skill.channel && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-aegis-primary/10 bg-aegis-primary/[0.06] px-2 py-1 text-[10.5px] font-mono text-aegis-primary">
                      {t('skillsExtra.channel', 'Channel')}: {skill.channel}
                    </span>
                  )}
                  {Object.entries(skill.tags ?? {}).map(([key, value]) => (
                    <span key={`tag:${key}`} className="inline-flex items-center gap-1 rounded-md border border-aegis-primary/10 bg-aegis-primary/[0.06] px-2 py-1 text-[10.5px] font-mono text-aegis-primary">
                      {key}: {value}
                    </span>
                  ))}
                </div>
              </div>
            )}
            </>}

            {activePane === 'readme' && skill.readme && (
              <div className="px-4 py-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold text-aegis-text-muted">
                  <BookOpenText size={13} aria-hidden="true" />
                  {t('skills.readme', 'Readme')}
                </h3>
                <div
                  className="prose-sm min-h-[320px] text-[12.5px] leading-relaxed text-aegis-text-secondary"
                  dangerouslySetInnerHTML={{ __html: safeReadme }}
                />
              </div>
            )}

            {activePane === 'version' && skill.latestVersion && (
              <div className="px-4 py-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold text-aegis-text-muted">
                  <FileText size={14} strokeWidth={1.75} /> {t('skills.latestVersion', 'Latest version')}
                </h3>
                <div className="flex items-center gap-2 border-b border-[rgb(var(--aegis-overlay)/0.06)] py-2.5 text-[11.5px]">
                  <span className="rounded bg-aegis-primary/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-aegis-primary">v{skill.latestVersion.version}</span>
                  {skill.latestVersion.changelog && (
                    <span className="min-w-0 flex-1 text-aegis-text-secondary">{skill.latestVersion.changelog}</span>
                  )}
                  {latestVersionCreatedAt && <span className="shrink-0 text-[10px] text-aegis-text-dim">{latestVersionCreatedAt}</span>}
                </div>
              </div>
            )}
            </div>

            <footer className="shrink-0 border-t border-[rgb(var(--aegis-overlay)/0.08)] bg-aegis-bg px-4 py-3">
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (installState === 'error' || installState === 'idle') ? onInstall?.(skill.slug) : undefined}
                disabled={installState !== 'idle' && installState !== 'error'}
                className={clsx(
                  'flex-1 rounded-md py-2.5 text-[12px] font-semibold transition-all',
                  'flex items-center justify-center gap-1.5',
                  installState === 'done'
                    ? 'bg-aegis-success/10 border border-aegis-success/30 text-aegis-success cursor-default'
                    : installState === 'error'
                      ? 'bg-aegis-danger/[0.07] border border-aegis-danger/20 text-aegis-danger hover:bg-aegis-danger/10 cursor-pointer'
                      : installState === 'installing'
                        ? isRed
                          ? 'bg-red-500/[0.07] border border-red-500/20 text-red-400 cursor-wait opacity-70'
                          : 'bg-aegis-primary text-aegis-btn-primary-text cursor-wait opacity-70'
                        : isRed
                          ? 'bg-red-500/[0.08] border border-red-500/20 text-red-400 hover:bg-red-500/[0.14] cursor-pointer'
                          : 'bg-aegis-primary text-aegis-btn-primary-text hover:brightness-110 cursor-pointer',
                )}
              >
                {installState === 'installing' ? (
                  <><LoadingIndicator size={13} /> {installingLabel ?? t('skillsExtra.installing', 'Installing…')}</>
                ) : installState === 'done' ? (
                  <><CheckCircle2 size={13} aria-hidden="true" />{doneLabel ?? t('skillsExtra.installed', 'Installed')}</>
                ) : installState === 'error' ? (
                  <><Download size={13} /> {errorLabel ?? t('skillsExtra.retryInstall', 'Retry Install')}</>
                ) : (
                  <><Download size={13} /> {installLabel ?? t('skillsExtra.install', 'Install')}</>
                )}
              </button>
              {resolvedPersona && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onStartChat) onStartChat(resolvedPersona);
                      else window.dispatchEvent(new CustomEvent('aegis:open-new-session-picker', { detail: { persona: resolvedPersona } }));
                    }}
                    title={t('skills.startChatWithPersona', 'Start chat with this persona')}
                    aria-label={t('skills.startChatWithPersona', 'Start chat with this persona')}
                    className="grid size-9 shrink-0 place-items-center rounded-md border border-aegis-primary/20 bg-aegis-primary/[0.06] text-aegis-primary transition-colors hover:bg-aegis-primary/[0.12]"
                  >
                    <MessageSquare size={14} />
                  </button>
              )}
              {externalUrl && (
                <button
                  type="button"
                  onClick={() => window.open(externalUrl, '_blank')}
                  title={externalLabel ?? t('skillsExtra.viewExternal', 'Open source page')}
                  aria-label={externalLabel ?? t('skillsExtra.viewExternal', 'Open source page')}
                  className="grid size-9 shrink-0 place-items-center rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-muted transition-colors hover:border-aegis-primary/30 hover:bg-aegis-primary/[0.06] hover:text-aegis-primary"
                >
                  <ExternalLink size={14} />
                </button>
              )}
              </div>
              {installState === 'done' && doneHint && <p className="mt-2 text-center text-[10px] text-aegis-text-dim">{doneHint}</p>}
              {installState === 'error' && secondaryActionLabel && onSecondaryAction && (
                <button type="button" onClick={onSecondaryAction} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] px-3 py-2 text-[11px] font-medium text-aegis-text-secondary transition-colors hover:border-aegis-primary/30 hover:text-aegis-primary">
                  <ExternalLink size={12} /> {secondaryActionLabel}
                </button>
              )}
            </footer>
          </>
        ) : null}
      </div>
    </>
  );
}
