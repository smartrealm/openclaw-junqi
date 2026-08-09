import type { CronSchedule } from '@/services/gateway/cronContract';
import type { CalendarEvent } from './calendarTypes';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const WEEK_MS = 7 * DAY_MS;

export type CronReminderScheduleResult =
  | { readonly status: 'scheduled'; readonly schedule: CronSchedule; readonly reminderAt: Date }
  | { readonly status: 'none' }
  | { readonly status: 'unsupported'; readonly reason: 'bounded-recurrence' | 'calendar-interval' | 'cross-boundary' };

function createLocalDateTime(date: string, time: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(`${date}T${time}`);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const result = new Date(year, month - 1, day, hour, minute, 0, 0);

  return Number.isNaN(result.getTime())
    || result.getFullYear() !== year
    || result.getMonth() !== month - 1
    || result.getDate() !== day
    || result.getHours() !== hour
    || result.getMinutes() !== minute
    ? null
    : result;
}

function isValidInterval(interval: number): boolean {
  return Number.isInteger(interval) && interval > 0;
}

function supportsMonthlyInterval(interval: number): boolean {
  return 12 % interval === 0;
}

function cronExpression(date: Date, dayOfWeek?: number, months?: number[]): string {
  const minute = date.getMinutes();
  const hour = date.getHours();
  if (dayOfWeek !== undefined) return `${minute} ${hour} * * ${dayOfWeek}`;
  if (months !== undefined) return `${minute} ${hour} ${date.getDate()} ${months.join(',')} *`;
  return `${minute} ${hour} ${date.getDate()} ${date.getMonth() + 1} *`;
}

function recurringReminderSchedule(event: CalendarEvent, reminderAt: Date, timezone: string): CronReminderScheduleResult {
  const recurrence = event.recurrence;
  if (!recurrence) {
    return { status: 'scheduled', schedule: { kind: 'at', at: reminderAt.toISOString() }, reminderAt };
  }

  if (!isValidInterval(recurrence.interval)) return { status: 'unsupported', reason: 'calendar-interval' };
  if (recurrence.until !== undefined || recurrence.count !== undefined) {
    return { status: 'unsupported', reason: 'bounded-recurrence' };
  }

  const eventAt = createLocalDateTime(event.date, event.startTime ?? '');
  if (!eventAt) return { status: 'none' };

  switch (recurrence.freq) {
    case 'daily':
      return {
        status: 'scheduled',
        schedule: {
          kind: 'every',
          everyMs: recurrence.interval * DAY_MS,
          anchorMs: reminderAt.getTime(),
        },
        reminderAt,
      };
    case 'weekly':
      return recurrence.interval === 1
        ? {
          status: 'scheduled',
          schedule: { kind: 'cron', expr: cronExpression(reminderAt, reminderAt.getDay()), tz: timezone },
          reminderAt,
        }
        : {
          status: 'scheduled',
          schedule: {
            kind: 'every',
            everyMs: recurrence.interval * WEEK_MS,
            anchorMs: reminderAt.getTime(),
          },
          reminderAt,
        };
    case 'monthly': {
      if (eventAt.getDate() !== reminderAt.getDate() || !supportsMonthlyInterval(recurrence.interval)) {
        return { status: 'unsupported', reason: eventAt.getDate() !== reminderAt.getDate() ? 'cross-boundary' : 'calendar-interval' };
      }
      const months = Array.from(
        { length: 12 / recurrence.interval },
        (_, index) => ((reminderAt.getMonth() + index * recurrence.interval) % 12) + 1,
      );
      return {
        status: 'scheduled',
        schedule: { kind: 'cron', expr: cronExpression(reminderAt, undefined, months), tz: timezone },
        reminderAt,
      };
    }
    case 'yearly':
      if (eventAt.getDate() !== reminderAt.getDate() || eventAt.getMonth() !== reminderAt.getMonth() || recurrence.interval !== 1) {
        return { status: 'unsupported', reason: eventAt.getDate() !== reminderAt.getDate() || eventAt.getMonth() !== reminderAt.getMonth() ? 'cross-boundary' : 'calendar-interval' };
      }
      return {
        status: 'scheduled',
        schedule: { kind: 'cron', expr: cronExpression(reminderAt), tz: timezone },
        reminderAt,
      };
  }
}

export function buildCronReminderSchedule(
  event: CalendarEvent,
  timezone: string,
): CronReminderScheduleResult {
  if (event.reminderMinutes <= 0 || event.allDay || !event.startTime) return { status: 'none' };

  const eventAt = createLocalDateTime(event.date, event.startTime);
  if (!eventAt) return { status: 'none' };

  const reminderAt = new Date(eventAt.getTime() - event.reminderMinutes * MINUTE_MS);
  return recurringReminderSchedule(event, reminderAt, timezone);
}
