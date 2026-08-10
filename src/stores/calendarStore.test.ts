import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { CalendarEvent } from '@/pages/Calendar/calendarTypes';
import { gateway } from '@/services/gateway';
import { useCalendarStore } from './calendarStore';

const originalAddCronAgentTurn = gateway.addCronAgentTurn;
const originalRemoveCronJob = gateway.removeCronJob;

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    title: 'Planning',
    date: '2030-01-02',
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    category: 'work',
    source: 'local',
    reminderMinutes: 15,
    reminderCronJobId: 'cron-1',
    reminderStatus: 'scheduled',
    deliveryChannel: 'last',
    status: 'scheduled',
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function replaceGatewayMutationMethods(params: {
  add: typeof gateway.addCronAgentTurn;
  remove: typeof gateway.removeCronJob;
}): void {
  Object.assign(gateway, {
    addCronAgentTurn: params.add,
    removeCronJob: params.remove,
  });
}

function reset(events: CalendarEvent[]): void {
  localStorage.clear();
  useCalendarStore.setState({ events, error: null, loading: false });
}

afterEach(() => {
  replaceGatewayMutationMethods({
    add: originalAddCronAgentTurn,
    remove: originalRemoveCronJob,
  });
  reset([]);
});

describe('calendar reminder Cron reconciliation', () => {
  it('retains an event and its Cron link when OpenClaw does not confirm deletion', async () => {
    reset([event()]);
    replaceGatewayMutationMethods({
      add: async () => ({ id: 'unused' }),
      remove: async () => { throw new Error('Gateway denied cron removal'); },
    });

    await useCalendarStore.getState().deleteEvent('event-1');

    const state = useCalendarStore.getState();
    assert.deepEqual(state.events, [event()]);
    assert.equal(state.error, 'Gateway denied cron removal');
  });

  it('does not create a replacement reminder while the old Cron job remains unconfirmed', async () => {
    let addCalls = 0;
    reset([event()]);
    replaceGatewayMutationMethods({
      add: async () => {
        addCalls += 1;
        return { id: 'replacement' };
      },
      remove: async () => { throw new Error('Gateway disconnected'); },
    });

    await useCalendarStore.getState().updateEvent('event-1', { title: 'Updated planning' });

    const state = useCalendarStore.getState();
    assert.equal(addCalls, 0);
    assert.equal(state.events[0]?.title, 'Planning');
    assert.equal(state.events[0]?.reminderCronJobId, 'cron-1');
    assert.equal(state.events[0]?.reminderStatus, 'scheduled');
    assert.equal(state.error, 'Gateway disconnected');
  });

  it('marks the local reminder pending when the old job is removed but its replacement cannot be created', async () => {
    reset([event()]);
    replaceGatewayMutationMethods({
      add: async () => { throw new Error('Gateway denied cron creation'); },
      remove: async () => undefined,
    });

    await useCalendarStore.getState().updateEvent('event-1', { recurrence: { freq: 'daily', interval: 1 } });

    const updated = useCalendarStore.getState().events[0];
    assert.equal(updated?.recurrence?.freq, 'daily');
    assert.equal(updated?.reminderCronJobId, undefined);
    assert.equal(updated?.reminderStatus, 'pending');
  });

  it('does not mark an all-day event as pending when no Cron reminder can be created', async () => {
    let addCalls = 0;
    reset([]);
    replaceGatewayMutationMethods({
      add: async () => {
        addCalls += 1;
        return { id: 'unused' };
      },
      remove: async () => undefined,
    });

    const created = await useCalendarStore.getState().addEvent({
      title: 'All day planning',
      date: '2030-01-02',
      allDay: true,
      category: 'work',
      reminderMinutes: 15,
      deliveryChannel: 'last',
      status: 'scheduled',
    });

    assert.equal(addCalls, 0);
    assert.equal(created.reminderStatus, 'none');
    assert.equal(created.reminderCronJobId, undefined);
  });

  it('uses one stable Gateway declaration key when retrying the same pending reminder', async () => {
    const declarations: Array<string | undefined> = [];
    reset([event({ reminderCronJobId: undefined, reminderStatus: 'pending' })]);
    replaceGatewayMutationMethods({
      add: async (params) => {
        declarations.push(params.declarationKey);
        if (declarations.length === 1) throw new Error('Gateway response was interrupted');
        return { id: 'cron-1' };
      },
      remove: async () => undefined,
    });

    await useCalendarStore.getState().syncPendingReminders();
    await useCalendarStore.getState().syncPendingReminders();

    assert.deepEqual(declarations, [
      'junqi-calendar-reminder:event-1',
      'junqi-calendar-reminder:event-1',
    ]);
    const current = useCalendarStore.getState().events[0];
    assert.equal(current?.reminderStatus, 'scheduled');
    assert.equal(current?.reminderCronJobId, 'cron-1');
  });
});
