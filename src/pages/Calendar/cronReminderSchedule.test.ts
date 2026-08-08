import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalendarEvent } from './calendarTypes';
import { buildCronReminderSchedule } from './cronReminderSchedule';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    title: 'Planning',
    date: '2030-01-07',
    startTime: '00:05',
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

test('weekly reminder uses the preceding local weekday after a cross-day offset', () => {
  const result = buildCronReminderSchedule(event({ recurrence: { freq: 'weekly', interval: 1 } }), 'Asia/Tokyo');

  assert.deepEqual(result, {
    status: 'scheduled',
    schedule: { kind: 'cron', expr: '50 23 * * 0', tz: 'Asia/Tokyo' },
    reminderAt: new Date('2030-01-06T23:50:00'),
  });
});

test('daily and multi-week intervals preserve the first reminder as the official every anchor', () => {
  const daily = buildCronReminderSchedule(event({ recurrence: { freq: 'daily', interval: 2 } }), 'Asia/Tokyo');
  const weekly = buildCronReminderSchedule(event({ recurrence: { freq: 'weekly', interval: 3 } }), 'Asia/Tokyo');

  assert.equal(daily.status, 'scheduled');
  assert.equal(weekly.status, 'scheduled');
  if (daily.status === 'scheduled' && weekly.status === 'scheduled') {
    assert.deepEqual(daily.schedule, {
      kind: 'every',
      everyMs: 2 * 24 * 60 * 60 * 1000,
      anchorMs: daily.reminderAt.getTime(),
    });
    assert.deepEqual(weekly.schedule, {
      kind: 'every',
      everyMs: 3 * 7 * 24 * 60 * 60 * 1000,
      anchorMs: weekly.reminderAt.getTime(),
    });
  }
});

test('does not falsely schedule bounded or cross-boundary calendar recurrences', () => {
  assert.deepEqual(
    buildCronReminderSchedule(event({ recurrence: { freq: 'monthly', interval: 1 } }), 'Asia/Tokyo'),
    { status: 'unsupported', reason: 'cross-boundary' },
  );
  assert.deepEqual(
    buildCronReminderSchedule(event({ recurrence: { freq: 'yearly', interval: 1, count: 3 } }), 'Asia/Tokyo'),
    { status: 'unsupported', reason: 'bounded-recurrence' },
  );
});

test('does not normalize an invalid local calendar date into another Cron run date', () => {
  assert.deepEqual(
    buildCronReminderSchedule(event({ date: '2030-02-30' }), 'Asia/Tokyo'),
    { status: 'none' },
  );
});
