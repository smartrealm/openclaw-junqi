// ═══════════════════════════════════════════════════════════
// Dashboard/components.tsx
// Sub-components: ContextRing, QuickAction, SessionItem,
//                 FeedItem, AgentItem
// ═══════════════════════════════════════════════════════════

import { Loader2, Pin, PinOff } from 'lucide-react';
import clsx from 'clsx';
import { themeColorVar } from '@/utils/theme-colors';
import { Badge, StatusDot } from '@/components/shared/badge';
import i18n from '@/i18n';

// ── Format helpers (shared with index.tsx) ──────────────────
export const fmtCost = (n: number) => `$${n.toFixed(2)}`;

export const fmtCostShort = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`;

export const timeAgo = (ts?: string) => {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return i18n.t('dashboard.timeNow', { defaultValue: 'now' });
  if (diff < 3_600_000) return i18n.t('dashboard.timeMinutes', { n: Math.floor(diff / 60_000), defaultValue: '{{n}}m' });
  if (diff < 86_400_000) return i18n.t('dashboard.timeHours', { n: Math.floor(diff / 3_600_000), defaultValue: '{{n}}h' });
  return i18n.t('dashboard.timeDays', { n: Math.floor(diff / 86_400_000), defaultValue: '{{n}}d' });
};

export const fmtUptime = (ms: number) => {
  if (ms < 60_000) return i18n.t('dashboard.uptimeUnderMinute', { defaultValue: '<1m' });
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h === 0) return i18n.t('dashboard.uptimeMinutes', { m, defaultValue: '{{m}}m' });
  return m > 0
    ? i18n.t('dashboard.uptimeHoursMinutes', { h, m, defaultValue: '{{h}}h {{m}}m' })
    : i18n.t('dashboard.uptimeHours', { h, defaultValue: '{{h}}h' });
};

// ═══════════════════════════════════════════════════════════
// ContextRing — SVG circular progress ring
// ═══════════════════════════════════════════════════════════
export function ContextRing({ percentage }: { percentage: number }) {
  const size = 88;
  const sw   = 6;
  const r    = (size - sw) / 2;
  const c    = 2 * Math.PI * r;
  const offset = c - (Math.min(100, percentage) / 100) * c;
  const tone = percentage > 85 ? 'danger'
             : percentage > 60 ? 'warning'
             : 'primary';
  const color = themeColorVar(tone);
  const shadowColor = themeColorVar(tone, 0.25);

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="rgb(var(--aegis-overlay) / 0.04)" strokeWidth={sw} />
        {/* Glow layer */}
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={sw + 4}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          opacity={0.12}
          style={{ transition: 'stroke-dashoffset 1.5s ease', filter: 'blur(3px)' }} />
        {/* Fill */}
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={sw}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.5s ease' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[20px] font-extrabold" style={{ color, textShadow: `0 0 12px ${shadowColor}` }}>
          {Math.round(percentage)}%
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// QuickAction — Action button with hover glow
// ═══════════════════════════════════════════════════════════
export function QuickAction({ icon: Icon, label, glowColor, bgColor, iconColor, onClick, loading, disabled }: {
  icon: React.ElementType;
  label: string;
  glowColor: string;
  bgColor: string;
  iconColor: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={clsx(
        'relative flex min-h-[58px] items-center gap-2.5 rounded-lg p-2.5 text-left',
        'border border-[rgb(var(--aegis-overlay)/0.05)] bg-[rgb(var(--aegis-overlay)/0.015)]',
        'transition-all duration-250 overflow-hidden',
        (loading || disabled) && 'opacity-45 cursor-not-allowed',
        !loading && !disabled && 'group hover:border-[rgb(var(--aegis-overlay)/0.12)] hover:-translate-y-0.5 active:translate-y-0'
      )}
    >
      {/* Radial hover glow */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl"
        style={{ background: `radial-gradient(ellipse at top, ${glowColor}, transparent)` }}
      />
      {loading ? (
        <Loader2 size={18} className="animate-spin text-aegis-text-dim relative z-10" />
      ) : (
        <div
          className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-250 group-hover:scale-105"
          style={{ background: bgColor, border: `1px solid ${bgColor}` }}
        >
          <Icon size={16} style={{ color: iconColor }} />
        </div>
      )}
      <span className="relative z-10 line-clamp-2 min-w-0 text-[11.5px] font-medium leading-[1.3] text-aegis-text-muted transition-colors group-hover:text-aegis-text">
        {label}
      </span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
// SessionItem — Single session row
// ═══════════════════════════════════════════════════════════
export function SessionItem({ isMain, name, model, detail, tokens, avatarBg, avatarColor, icon: Icon, pinned, onPinToggle, onClick }: {
  isMain?: boolean;
  name: string;
  model: string;
  detail: string;
  tokens: string;
  avatarBg: string;
  avatarColor: string;
  icon: React.ElementType;
  pinned?: boolean;
  onPinToggle?: () => void;
  onClick?: () => void;
}) {
  return (
    <div
      className={clsx(
        'w-full flex items-center gap-1 rounded-lg transition-all duration-200',
        isMain
          ? 'bg-aegis-primary-surface border border-aegis-primary/10'
          : 'hover:bg-[rgb(var(--aegis-overlay)/0.03)] cursor-pointer'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex flex-1 items-center gap-2 px-2 py-1.5 text-left"
      >
        <div
          className="w-[26px] h-[26px] rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: avatarBg }}
        >
          <Icon size={13} style={{ color: avatarColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-aegis-text truncate leading-tight">{name}</div>
          <div className="text-[10px] text-aegis-text-muted font-mono flex gap-1.5">
            <span className="truncate max-w-[80px]">{model}</span>
            <span className="opacity-60">{detail}</span>
          </div>
        </div>
        <span className={clsx(
          'text-[11px] font-bold font-mono tabular-nums flex-shrink-0',
          isMain ? 'text-aegis-primary' : 'text-aegis-text-dim'
        )}>{tokens}</span>
      </button>
      {onPinToggle && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPinToggle(); }}
          title={pinned ? 'Unpin' : 'Pin'}
          className={clsx(
            'mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
            pinned
              ? 'text-aegis-primary bg-aegis-primary/10 hover:bg-aegis-primary/15'
              : 'text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.05)]',
          )}
        >
          {pinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FeedItem — Activity feed entry with connector line
// ═══════════════════════════════════════════════════════════
export function FeedItem({ color, glowColor, text, time, timeTitle, isLast, agentName, model, modelTitle, tokens, running, onClick }: {
  color: string;
  glowColor: string;
  text: string;
  time: string;
  timeTitle?: string;
  isLast?: boolean;
  agentName?: string;
  model?: string;
  modelTitle?: string;
  tokens?: string;
  running?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex flex-col items-center pt-1.5">
        <div
          className="w-[7px] h-[7px] rounded-full flex-shrink-0"
          style={{ background: color, boxShadow: `0 0 6px ${glowColor}` }}
        />
        {!isLast && (
          <div className="w-px flex-1 mt-1 bg-gradient-to-b from-white/[0.06] to-transparent" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[1.45] text-aegis-text" title={text}>{text}</div>
          <time className="shrink-0 font-mono text-[10px] tabular-nums text-aegis-text-dim" title={timeTitle}>{time}</time>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          {agentName && (
            <span className="max-w-[88px] truncate text-[10px] font-medium text-aegis-accent" title={agentName}>{agentName}</span>
          )}
          {agentName && model && <span className="text-[9px] text-aegis-text-dim/55">·</span>}
          {model && (
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-aegis-text-muted" title={modelTitle}>{model}</span>
          )}
          {tokens && (
            <span className="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-aegis-text-dim">{tokens}</span>
          )}
          {running && (
            <span
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-aegis-success"
              title={i18n.t('dashboard.working', { defaultValue: 'Working' }) as string}
            />
          )}
        </div>
      </div>
    </>
  );
  const rowClass = 'w-full text-left flex gap-2.5 px-1 py-2 border-b border-[rgb(var(--aegis-overlay)/0.025)] last:border-b-0 animate-slide-in-right rounded-md';
  if (!onClick) return <div className={rowClass}>{content}</div>;
  return (
    <button type="button" onClick={onClick} className={`${rowClass} hover:bg-[rgb(var(--aegis-overlay)/0.02)] transition-colors`}>
      {content}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
// AgentItem — Agent row with relative token bar
// ═══════════════════════════════════════════════════════════
export function AgentItem({ emoji, name, model, tokens, tokenCount, maxTokens, sessions, running }: {
  emoji: React.ReactNode;
  name: string;
  model: string;
  tokens: string;
  tokenCount: number;
  maxTokens: number;
  sessions?: number;
  running?: boolean;
}) {
  const barPct = maxTokens > 0 ? Math.min(100, (tokenCount / maxTokens) * 100) : 0;
  const tone = running ? 'running' : 'neutral';
  const barColor = themeColorVar('primary');
  const barShadow = themeColorVar('primary', 0.2);

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[rgb(var(--aegis-overlay)/0.04)] last:border-b-0">
      <span className="text-[18px] flex-shrink-0 leading-none w-6 text-center relative">
        {emoji}
        <StatusDot tone={tone} live={running} size="sm" className="absolute -right-1 -bottom-0.5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[13px] font-semibold text-aegis-text truncate">{name}</span>
          <Badge tone={tone} size="sm" variant="soft" className="font-mono tabular-nums flex-shrink-0">{tokens}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-[rgb(var(--aegis-overlay)/0.04)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${barPct}%`, background: barColor, boxShadow: `0 0 4px ${barShadow}` }}
            />
          </div>
          <span className="text-[10px] text-aegis-text-muted font-mono flex-shrink-0 truncate max-w-[112px]">{model}</span>
          {sessions && sessions > 1 && <Badge tone="info" size="sm" variant="outline" className="font-mono flex-shrink-0">×{sessions}</Badge>}
        </div>
      </div>
    </div>
  );
}
