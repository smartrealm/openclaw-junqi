export type CronRunStatus = 'ok' | 'error' | 'skipped';

export interface CronCalendarJob {
  readonly id: string;
  readonly name?: string;
  readonly enabled?: boolean;
  readonly nextRunAtMs?: number;
  readonly lastRunStatus?: string;
  readonly state?: {
    readonly nextRunAtMs?: number;
    readonly lastRunStatus?: string;
  };
}

export interface UpcomingCronJob {
  readonly id: string;
  readonly label: string;
  readonly nextRunAtMs: number;
  readonly lastRunStatus?: CronRunStatus;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCronRunStatus(value: unknown): value is CronRunStatus {
  return value === 'ok' || value === 'error' || value === 'skipped';
}

/**
 * The current Gateway read view flattens scheduler state onto a cron job.
 * Keep the nested state fallback for the same official CronJob schema.
 */
export function resolveCronNextRunAtMs(job: CronCalendarJob): number | null {
  if (job.nextRunAtMs !== undefined) {
    return isTimestamp(job.nextRunAtMs) ? job.nextRunAtMs : null;
  }
  return isTimestamp(job.state?.nextRunAtMs) ? job.state.nextRunAtMs : null;
}

export function resolveCronLastRunStatus(job: CronCalendarJob): CronRunStatus | undefined {
  if (job.lastRunStatus !== undefined) {
    return isCronRunStatus(job.lastRunStatus) ? job.lastRunStatus : undefined;
  }
  return isCronRunStatus(job.state?.lastRunStatus) ? job.state.lastRunStatus : undefined;
}

export function projectUpcomingCronJobs(
  jobs: readonly CronCalendarJob[],
  nowMs: number,
): UpcomingCronJob[] {
  return jobs
    .filter((job) => job.enabled === true)
    .flatMap((job) => {
      const nextRunAtMs = resolveCronNextRunAtMs(job);
      if (nextRunAtMs === null || nextRunAtMs < nowMs) return [];
      return [{
        id: job.id,
        label: job.name || job.id,
        nextRunAtMs,
        lastRunStatus: resolveCronLastRunStatus(job),
      }];
    })
    .sort((left, right) => left.nextRunAtMs - right.nextRunAtMs);
}
