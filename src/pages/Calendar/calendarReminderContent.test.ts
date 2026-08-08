import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalendarEvent } from './calendarTypes';
import { buildCalendarReminderContent } from './calendarReminderContent';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    title: '项目评审',
    date: '2030-01-07',
    startTime: '09:00',
    endTime: '10:30',
    allDay: false,
    category: 'work',
    source: 'local',
    reminderMinutes: 15,
    reminderStatus: 'pending',
    deliveryChannel: 'last',
    status: 'scheduled',
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('calendar reminder content delegates the end-time separator to translations', () => {
  const content = buildCalendarReminderContent(event(), (key, options) => {
    const values = options ?? {};
    if (key === 'calendar.reminderContent.time') return `时间：${values.start}${values.end}`;
    if (key === 'calendar.reminderContent.timeEnd') return ` 至${values.end}`;
    if (key === 'calendar.reminderContent.title') return `标题：${values.title}`;
    if (key === 'calendar.reminderContent.jobName') return `提醒：${values.title}`;
    if (key === 'calendar.reminderContent.lastChannel') return '发送到最近活跃渠道';
    if (key === 'calendar.reminderContent.leadTime') return `提前${values.minutes}分钟`;
    return key;
  });

  assert.match(content.message, /时间：09:00 至10:30/);
  assert.doesNotMatch(content.message, /09:0010:30/);
});
