import type { CalendarEvent } from './calendarTypes';

export type CalendarReminderTranslate = (key: string, options?: Record<string, unknown>) => string;

export interface CalendarReminderContent {
  readonly name: string;
  readonly message: string;
}

export function buildCalendarReminderContent(
  event: CalendarEvent,
  t: CalendarReminderTranslate,
): CalendarReminderContent {
  const end = event.endTime === undefined
    ? ''
    : t('calendar.reminderContent.timeEnd', { end: event.endTime });
  const time = event.startTime === undefined
    ? t('calendar.reminderContent.allDay')
    : t('calendar.reminderContent.time', { start: event.startTime, end });
  const channel = event.deliveryChannel === 'last'
    ? t('calendar.reminderContent.lastChannel')
    : t('calendar.reminderContent.namedChannel', { channel: event.deliveryChannel });

  return {
    name: t('calendar.reminderContent.jobName', { title: event.title }),
    message: [
      t('calendar.reminderContent.title', { title: event.title }),
      time,
      event.location ? t('calendar.reminderContent.location', { location: event.location }) : '',
      event.notes ? t('calendar.reminderContent.notes', { notes: event.notes }) : '',
      channel,
      t('calendar.reminderContent.leadTime', { minutes: event.reminderMinutes }),
    ].filter(Boolean).join('\n'),
  };
}
