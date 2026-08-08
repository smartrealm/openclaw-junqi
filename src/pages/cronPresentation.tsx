import type { ReactNode } from 'react';
import { Brain } from 'lucide-react';
import { Lightning, MagnifyingGlass, Note } from '@phosphor-icons/react';
import type { CronScheduleDetails, OpenClawCronJobDetails } from '@/services/gateway/cronRuns';
import type { CronSchedule } from '@/services/gateway/cronContract';

export type CronPresentationTranslate = (key: string, options?: Record<string, unknown>) => string;

export interface CronTemplate {
  readonly id: string;
  readonly icon: ReactNode;
  readonly colorIdx: number;
  readonly name: string;
  readonly desc: string;
  readonly job: {
    readonly name: string;
    readonly schedule: CronSchedule;
    readonly message: string;
    readonly enabled: boolean;
  };
}

export function getCronTemplates(t: CronPresentationTranslate, timezone: string): readonly CronTemplate[] {
  return [
    {
      id: 'morning-briefing', icon: <Lightning size={14} weight="regular" />, colorIdx: 2,
      name: t('cronTemplates.morningName'), desc: t('cronTemplates.morningDesc'),
      job: { name: t('cronTemplates.morningJobName'), schedule: { kind: 'cron', expr: '0 6 * * *', tz: timezone }, message: t('cronTemplates.morningMessage'), enabled: true },
    },
    {
      id: 'weekly-digest', icon: <Note size={14} weight="regular" />, colorIdx: 1,
      name: t('cronTemplates.weeklyName'), desc: t('cronTemplates.weeklyDesc'),
      job: { name: t('cronTemplates.weeklyJobName'), schedule: { kind: 'cron', expr: '0 20 * * 5', tz: timezone }, message: t('cronTemplates.weeklyMessage'), enabled: true },
    },
    {
      id: 'check-in', icon: <Brain size={14} strokeWidth={1.75} />, colorIdx: 3,
      name: t('cronTemplates.checkInName'), desc: t('cronTemplates.checkInDesc'),
      job: { name: t('cronTemplates.checkInJobName'), schedule: { kind: 'every', everyMs: 28_800_000 }, message: t('cronTemplates.checkInMessage'), enabled: true },
    },
    {
      id: 'system-health', icon: <MagnifyingGlass size={14} weight="regular" />, colorIdx: 5,
      name: t('cronTemplates.healthName'), desc: t('cronTemplates.healthDesc'),
      job: { name: t('cronTemplates.healthJobName'), schedule: { kind: 'every', everyMs: 21_600_000 }, message: t('cronTemplates.healthMessage'), enabled: true },
    },
  ];
}

function unit(value: number, unitName: Intl.NumberFormatOptions['unit'], locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit: unitName, unitDisplay: 'narrow', maximumFractionDigits: 1 }).format(value);
}

function elapsedParts(milliseconds: number, locale: string): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return unit(minutes, 'minute', locale);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? unit(hours, 'hour', locale) : `${unit(hours, 'hour', locale)} ${unit(remainingMinutes, 'minute', locale)}`;
}

export function formatCronSchedule(schedule: CronScheduleDetails, locale: string, t: CronPresentationTranslate): string {
  if (schedule.kind === 'every') return t('cron.format.every', { interval: elapsedParts(schedule.everyMs, locale) });
  if (schedule.kind === 'at') return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(schedule.at));
  if (schedule.kind === 'on-exit') return t('cron.format.onExit', { command: schedule.command });
  if (schedule.kind === 'stream') return t('cron.format.stream', { command: schedule.command.join(' ') });
  return schedule.expr;
}

export function formatCronTimeAgo(
  value: string | number | null | undefined,
  locale: string,
  t: CronPresentationTranslate,
): string {
  if (value === null || value === undefined) return t('cron.format.unavailable');
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return t('cron.format.unavailable');
  const difference = timestamp - Date.now();
  if (Math.abs(difference) < 60_000) return t('cron.format.now');
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (Math.abs(difference) < 3_600_000) return formatter.format(Math.round(difference / 60_000), 'minute');
  if (Math.abs(difference) < 86_400_000) return formatter.format(Math.round(difference / 3_600_000), 'hour');
  return formatter.format(Math.round(difference / 86_400_000), 'day');
}

export function formatCronCountdown(
  value: string | number | null | undefined,
  locale: string,
  t: CronPresentationTranslate,
): string {
  if (value === null || value === undefined) return t('cron.format.unavailable');
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return t('cron.format.unavailable');
  const remaining = timestamp - Date.now();
  return remaining <= 0 ? t('cron.format.now') : elapsedParts(remaining, locale);
}

export function formatCronDuration(milliseconds: number | undefined, locale: string, t: CronPresentationTranslate): string {
  if (milliseconds === undefined || milliseconds === null) return t('cron.format.unavailable');
  return milliseconds < 1_000 ? unit(milliseconds, 'millisecond', locale) : unit(milliseconds / 1_000, 'second', locale);
}

export function getCronNextRun(job: OpenClawCronJobDetails): number | undefined {
  return job.state.nextRunAtMs ?? job.nextRunAtMs;
}

export function getCronLastRun(job: OpenClawCronJobDetails): string | number | null | undefined {
  return job.state.lastRunAtMs ?? job.lastRunAtMs;
}

export function getCronStatus(job: OpenClawCronJobDetails): 'active' | 'error' | 'paused' {
  if (!job.enabled) return 'paused';
  const status = job.state.lastRunStatus ?? job.state.lastStatus;
  return status === 'error' ? 'error' : 'active';
}

export function getCronDeliveryStatus(job: OpenClawCronJobDetails): 'delivered' | 'failed' | 'unknown' | null {
  const status = job.state.lastDeliveryStatus;
  if (!status || status === 'not-requested') return null;
  if (status === 'not-delivered') return 'failed';
  return status === 'delivered' ? 'delivered' : 'unknown';
}

export function cronRunInFlight(status: 'queued' | 'waiting' | 'pending' | 'ok' | 'error' | 'skipped' | undefined): boolean {
  return status === 'queued' || status === 'waiting' || status === 'pending';
}

export function cronRunLoading(status: 'queued' | 'waiting' | 'pending' | 'ok' | 'error' | 'skipped' | undefined): boolean {
  return status === 'queued' || status === 'waiting';
}
