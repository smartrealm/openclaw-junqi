// ── TimelineView — adapted from nezha (hanshuaikang/nezha/TimelineView) ────
//
// Cross-day task timeline. Groups tasks into today / yesterday / earlier
// (last 7 days) and sorts by creation time descending.
//
// Differences from upstream nezha TimelineView:
//   - Uses JunQi chat/workshop activity while preserving project labels.
//   - Uses Tailwind + aegis CSS vars instead of nezha's `s.xxx` styles.
//   - i18n via react-i18next (junqi's i18n) instead of nezha's useI18n.
//
// Source: nezha/src/components/nezha/TimelineView.tsx

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Coins, Cpu, Inbox, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusIcon, type StatusIconValue } from './StatusIcon';

export interface TimelineTask {
  id: string;
  title: string;
  agent?: string;
  status: StatusIconValue | string;
  createdAt: number; // epoch ms
  additions?: number;
  deletions?: number;
  /** Optional project label (junqi may not have a project; falls back to "All"). */
  project?: string;
  /** Canonical execution metadata shown beside the activity title. */
  model?: string;
  runtime?: string;
  durationMs?: number;
  tokens?: number;
  cost?: number;
  statusLabel?: string;
  /** Optional click-through target. When set, row click navigates here. */
  href?: string;
}

type Bucket = 'today' | 'yesterday' | 'earlier';

type TimelineViewProps = {
  tasks: TimelineTask[];
  onTaskClick?: (task: TimelineTask) => void;
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  /** Reference "now" for date bucketing. Defaults to real time; tests inject a fixed value. */
  now?: Date;
};

function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketFor(createdAt: number, now: Date): Bucket {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  if (createdAt >= todayStart) return 'today';
  if (createdAt >= yesterdayStart) return 'yesterday';
  return 'earlier';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDuration(ms?: number): string | null {
  if (!Number.isFinite(ms) || !ms || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function formatTokens(tokens?: number): string | null {
  if (!Number.isFinite(tokens) || !tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tok`;
  if (tokens >= 1000) return `${Math.round(tokens / 100) / 10}K tok`;
  return `${Math.round(tokens)} tok`;
}

function formatCost(cost?: number): string | null {
  if (!Number.isFinite(cost) || !cost || cost <= 0) return null;
  return `$${cost < 0.01 ? cost.toFixed(3) : cost.toFixed(2)}`;
}

function TimelineRow({
  task,
  onClick,
}: {
  task: TimelineTask;
  onClick?: (task: TimelineTask) => void;
}) {
  const additions = task.additions ?? 0;
  const deletions = task.deletions ?? 0;
  const hasDiff = additions > 0 || deletions > 0;
  const duration = formatDuration(task.durationMs);
  const tokens = formatTokens(task.tokens);
  const cost = formatCost(task.cost);

  return (
    <button
      type="button"
      onClick={() => onClick?.(task)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-start transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
    >
      <span className="font-mono text-[11px] text-aegis-text-dim tabular-nums w-[44px] shrink-0">
        {formatTime(task.createdAt)}
      </span>
      <span className="shrink-0" title={task.statusLabel}>
        <StatusIcon status={task.status as StatusIconValue} size={13} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-aegis-text truncate">{task.title}</div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] text-aegis-text-dim">
          {task.agent && <span>{task.agent}</span>}
          {task.model && (
            <>
              <span className="opacity-50">·</span>
              <span className="inline-flex min-w-0 max-w-[180px] items-center gap-1 truncate font-mono" title={task.model}>
                <Cpu size={9} className="shrink-0" />
                {task.model}
              </span>
            </>
          )}
          {task.runtime && (
            <>
              <span className="opacity-50">·</span>
              <span className="truncate">{task.runtime}</span>
            </>
          )}
          {task.project && (
            <>
              <span className="opacity-50">·</span>
              <span>{task.project}</span>
            </>
          )}
          {hasDiff && (
            <>
              <span className="opacity-50">·</span>
              <span className="font-mono tabular-nums">
                <span className="text-aegis-success">+{additions}</span>{' '}
                <span className="text-aegis-danger">−{deletions}</span>
              </span>
            </>
          )}
          {duration && (
            <>
              <span className="opacity-50">·</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums"><Timer size={9} />{duration}</span>
            </>
          )}
          {tokens && (
            <>
              <span className="opacity-50">·</span>
              <span className="font-mono tabular-nums">{tokens}</span>
            </>
          )}
          {cost && (
            <>
              <span className="opacity-50">·</span>
              <span className="inline-flex items-center gap-1 font-mono tabular-nums"><Coins size={9} />{cost}</span>
            </>
          )}
          {task.statusLabel && <span className="text-aegis-text-secondary">{task.statusLabel}</span>}
        </div>
      </div>
    </button>
  );
}

export function TimelineViewContent({
  tasks,
  onTaskClick,
  title,
  subtitle,
  emptyMessage,
  now: nowProp,
}: TimelineViewProps) {
  const { t } = useTranslation();
  const handleClick = onTaskClick;

  const groups = useMemo(() => {
    const now = nowProp ?? new Date();
    const cutoff = startOfDay(now) - 6 * 24 * 60 * 60 * 1000;
    const byBucket: Record<Bucket, TimelineTask[]> = {
      today: [],
      yesterday: [],
      earlier: [],
    };
    const sorted = [...tasks]
      .filter((task) => task.createdAt >= cutoff)
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const task of sorted) {
      byBucket[bucketFor(task.createdAt, now)].push(task);
    }
    return [
      { bucket: 'today' as Bucket, items: byBucket.today },
      { bucket: 'yesterday' as Bucket, items: byBucket.yesterday },
      { bucket: 'earlier' as Bucket, items: byBucket.earlier },
    ].filter((g) => g.items.length > 0);
  }, [tasks, nowProp]);

  const bucketLabel = (b: Bucket) =>
    b === 'today'
      ? t('timeline.today', 'Today')
      : b === 'yesterday'
        ? t('timeline.yesterday', 'Yesterday')
        : t('timeline.earlier', 'Earlier');

  return (
    <div className="flex flex-col h-full overflow-auto" style={{ background: 'rgb(var(--aegis-bg))' }}>
      {(title || subtitle) && (
        <div className="px-6 py-4 border-b" style={{ borderColor: 'rgb(var(--aegis-border))' }}>
          {title && <div className="text-[16px] font-bold text-aegis-text">{title}</div>}
          {subtitle && (
            <div className="text-[12px] text-aegis-text-dim mt-1">{subtitle}</div>
          )}
        </div>
      )}
      {groups.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
          <Inbox size={32} className="text-aegis-text-dim opacity-40" />
          <div className="text-[13px] text-aegis-text-dim">
            {emptyMessage ?? t('timeline.empty', 'No tasks in the past 7 days.')}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          {groups.map((group) => (
            <section key={group.bucket} className="flex flex-col gap-1">
              <header className="flex items-center gap-2 px-2 py-1">
                <Clock size={11} className="text-aegis-text-dim" />
                <span className="text-[10.5px] font-bold text-aegis-text-secondary uppercase tracking-wider">
                  {bucketLabel(group.bucket)}
                </span>
                <span className="text-[10.5px] text-aegis-text-dim">
                  {group.items.length}
                </span>
              </header>
              <div className="flex flex-col gap-0.5">
                {group.items.map((task) => (
                  <TimelineRow key={task.id} task={task} onClick={handleClick} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function TimelineView(props: TimelineViewProps) {
  const navigate = useNavigate();
  const handleClick = props.onTaskClick ?? ((task: TimelineTask) => {
    if (task.href) navigate(task.href);
  });
  return <TimelineViewContent {...props} onTaskClick={handleClick} />;
}
