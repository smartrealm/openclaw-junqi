// ── UsagePopover — minimal port of junqi's UsagePopover ───────────────────────
//
// Frontend popover that:
//   1. Uses the shared cached usage snapshot while open
//   2. Renders Claude (5h / 7d) + Codex (primary / secondary) usage bars
//   3. Handles unavailable agent usage with a friendly placeholder
//
// Adapted differences from junqi:
//   - Uses `react-i18next` (junqi's i18n) instead of junqi's useI18n.
//   - Uses JunQi's shared useUsageSnapshot hook.
//   - Uses Tailwind + aegis CSS variables instead of junqi's `s.xxx` styles.
//
// Source: junqi/src/components/junqi/UsagePopover.tsx

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getUsageColor,
  useUsageSnapshot,
  type ClaudeUsageData,
  type CodexUsageData,
  type UsageSource,
  type UsageWindow,
} from '@/hooks/useUsageSnapshot';

// ── Types — must match commands/usage.rs serialized shape ────────────────────

function formatResetTime(resetAt?: number | null): string | null {
  if (!resetAt) return null;
  const date = new Date(resetAt * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function UsageMetricRow({ label, window: w }: { label: string; window: UsageWindow }) {
  const { t } = useTranslation();
  const color = getUsageColor(w.remainingPercent);
  const resetLabel = formatResetTime(w.resetAt);

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12px] text-aegis-text-secondary">{label}</span>
      <span className="flex items-center gap-2 text-[12px] font-semibold tabular-nums">
        <span style={{ color }}>{w.remainingPercent}{t('usage.left', '% left')}</span>
        {resetLabel && (
          <span className="text-[10px] text-aegis-text-dim">{resetLabel}</span>
        )}
      </span>
    </div>
  );
}

function SourceCard<T>({
  title, subtitle, source, renderMetrics,
}: {
  title: string;
  subtitle?: string | null;
  source: UsageSource<T>;
  renderMetrics: (data: T) => React.ReactNode;
}) {
  return (
    <section className="px-3 py-2.5 border-b" style={{ borderColor: 'rgb(var(--aegis-overlay) / 0.06)' }}>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[12px] font-bold text-aegis-text">{title}</span>
        {subtitle && <span className="text-[10px] text-aegis-text-dim">{subtitle}</span>}
      </div>
      {source.status === 'unavailable' ? (
        <div className="text-[11px] text-aegis-text-dim py-1">{source.reason}</div>
      ) : (
        renderMetrics(source.data)
      )}
    </section>
  );
}

export function UsagePopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { snapshot, loading, error } = useUsageSnapshot(open);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
  };

  const renderClaude = (data: ClaudeUsageData) => (
    <div className="flex flex-col">
      {data.fiveHour ? <UsageMetricRow label={t('usage.fiveHour', '5h')} window={data.fiveHour} /> : null}
      {data.sevenDay ? <UsageMetricRow label={t('usage.sevenDay', '7d')} window={data.sevenDay} /> : null}
      {!data.fiveHour && !data.sevenDay && (
        <div className="text-[11px] text-aegis-text-dim py-1">{t('usage.noWindows', 'No usage windows reported.')}</div>
      )}
    </div>
  );

  const renderCodex = (data: CodexUsageData) => (
    <div className="flex flex-col">
      {data.primary ? <UsageMetricRow label={t('usage.fiveHour', '5h')} window={data.primary} /> : null}
      {data.secondary ? <UsageMetricRow label={t('usage.sevenDay', '7d')} window={data.secondary} /> : null}
      {!data.primary && !data.secondary && (
        <div className="text-[11px] text-aegis-text-dim py-1">{t('usage.noWindows', 'No usage windows reported.')}</div>
      )}
    </div>
  );

  const codexSubtitle = snapshot?.codex.status === 'available'
    ? [snapshot.codex.data.planType, snapshot.codex.data.email].filter(Boolean).join(' · ')
    : null;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={t('usage.title', 'Usage')}
          aria-label={t('usage.title', 'Usage')}
          className="w-[28px] h-[28px] flex items-center justify-center rounded-[5px] transition-colors"
          style={{
            background: open ? 'rgb(var(--aegis-overlay) / 0.12)' : 'transparent',
            color: 'rgb(var(--aegis-text-secondary))',
          }}
        >
          <Activity size={14} className="text-aegis-text-dim" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="w-[280px] rounded-xl overflow-hidden border border-aegis-border bg-aegis-elevated shadow-glass-lg"
          style={{ zIndex: 9999 }}
        >
          <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: 'rgb(var(--aegis-overlay) / 0.08)' }}>
            <Activity size={14} className="text-aegis-text-muted" />
            <span className="text-[12px] font-bold text-aegis-text">{t('usage.title', 'Usage')}</span>
          </div>

          {loading ? (
            <div className="p-4 text-center text-[11px] text-aegis-text-dim">
              {t('usage.loading', 'Loading…')}
            </div>
          ) : error ? (
            <div className="p-4 text-center text-[11px] text-aegis-danger" style={{ lineHeight: 1.5 }}>
              {t('usage.failed', 'Failed to load usage')}: {error}
            </div>
          ) : snapshot ? (
            <div className="flex flex-col">
              <SourceCard<ClaudeUsageData>
                title="Claude Code"
                source={snapshot.claude}
                renderMetrics={renderClaude}
              />
              <SourceCard<CodexUsageData>
                title="Codex"
                subtitle={codexSubtitle}
                source={snapshot.codex}
                renderMetrics={renderCodex}
              />
            </div>
          ) : (
            <div className="p-4 text-center text-[11px] text-aegis-text-dim">
              {t('usage.noDataYet', 'No usage data yet.')}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
