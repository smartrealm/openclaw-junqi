// ═══════════════════════════════════════════════════════════
// 日历状态：本地事件与 OpenClaw Cron 提醒关联
// 本地优先持久化，连接可用时再同步 Cron 提醒
// ═══════════════════════════════════════════════════════════

import { create } from 'zustand';
import { gateway } from '@/services/gateway';
import { buildCronAgentTurnAddParams } from '@/services/gateway/cronContract';
import type { CalendarEvent, CalendarFilter, CalendarSettings } from '@/pages/Calendar/calendarTypes';
import { DEFAULT_SETTINGS, DEFAULT_FILTER } from '@/pages/Calendar/calendarTypes';
import { generateEventId, getLocalTimezone } from '@/pages/Calendar/calendarUtils';
import { buildCalendarReminderContent } from '@/pages/Calendar/calendarReminderContent';
import { buildCronReminderSchedule } from '@/pages/Calendar/cronReminderSchedule';
import { debugError } from '@/utils/debugLog';

// ── localStorage 持久化 ──

const EVENTS_KEY = 'aegis-calendar-events';
const SETTINGS_KEY = 'aegis-calendar-settings';

function persistEvents(events: CalendarEvent[]): void {
  try { localStorage.setItem(EVENTS_KEY, JSON.stringify(events)); } catch { /* 存储空间不足 */ }
}

function loadPersistedEvents(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persistSettings(settings: CalendarSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* */ }
}

function loadPersistedSettings(): CalendarSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}

// ── Cron 提醒辅助逻辑 ──

type CronReminderCreation =
  | { readonly status: 'scheduled'; readonly jobId: string }
  | { readonly status: 'pending' | 'unsupported' | 'none' };

function initialReminderStatus(event: CalendarEvent): CalendarEvent['reminderStatus'] {
  const schedule = buildCronReminderSchedule(event, getLocalTimezone());
  if (schedule.status !== 'scheduled') return schedule.status;
  return schedule.reminderAt.getTime() > Date.now() ? 'pending' : 'none';
}

async function createCronReminder(event: CalendarEvent): Promise<CronReminderCreation> {
  const schedule = buildCronReminderSchedule(event, getLocalTimezone());
  if (schedule.status !== 'scheduled') return schedule;
  if (schedule.reminderAt.getTime() <= Date.now()) return { status: 'none' };

  try {
    const { default: runtimeI18n, i18nReady } = await import('@/i18n');
    await i18nReady;
    const content = buildCalendarReminderContent(event, (key, options) => runtimeI18n.t(key, options));
    const result = await gateway.addCronAgentTurn(buildCronAgentTurnAddParams({
      name: content.name,
      schedule: schedule.schedule,
      message: content.message,
      deleteAfterRun: !event.recurrence,
      enabled: true,
    }));
    return { status: 'scheduled', jobId: result.id };
  } catch (err) {
    debugError('app', '[Calendar] Failed to create cron reminder:', err);
    return { status: 'pending' };
  }
}

type CronReminderRemoval =
  | { readonly removed: true }
  | { readonly removed: false; readonly error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function removeCronReminder(jobId: string): Promise<CronReminderRemoval> {
  try {
    await gateway.removeCronJob(jobId);
    return { removed: true };
  } catch (err) {
    debugError('app', '[Calendar] Failed to remove cron reminder:', err);
    return { removed: false, error: errorMessage(err) };
  }
}

// ── 状态定义 ──

interface CalendarState {
  events: CalendarEvent[];
  settings: CalendarSettings;
  filter: CalendarFilter;
  selectedDate: Date;
  view: 'month' | 'week' | 'day';
  loading: boolean;
  error: string | null;

  // 导航操作
  setView: (view: 'month' | 'week' | 'day') => void;
  setSelectedDate: (date: Date) => void;
  navigate: (delta: number) => void;
  goToToday: () => void;

  // 增删改查操作
  loadEvents: () => void;
  addEvent: (data: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt' | 'source' | 'reminderStatus' | 'reminderCronJobId'>) => Promise<CalendarEvent>;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;

  // 筛选与设置操作
  setFilter: (patch: Partial<CalendarFilter>) => void;
  updateSettings: (patch: Partial<CalendarSettings>) => void;

  // Cron 同步操作
  syncPendingReminders: () => Promise<void>;
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  events: [],
  settings: loadPersistedSettings(),
  filter: DEFAULT_FILTER,
  selectedDate: new Date(),
  view: loadPersistedSettings().defaultView,
  loading: false,
  error: null,

  // ── 导航 ──

  setView: (view) => set({ view }),

  setSelectedDate: (date) => set({ selectedDate: date }),

  navigate: (delta) => {
    const { selectedDate, view } = get();
    const d = new Date(selectedDate);
    if (view === 'month') d.setMonth(d.getMonth() + delta);
    else if (view === 'week') d.setDate(d.getDate() + delta * 7);
    else d.setDate(d.getDate() + delta);
    set({ selectedDate: d });
  },

  goToToday: () => set({ selectedDate: new Date() }),

  // ── 增删改查 ──

  loadEvents: () => {
    set({ loading: true, error: null });
    const events = loadPersistedEvents();
    set({ events, loading: false });
  },

  addEvent: async (data) => {
    const now = new Date().toISOString();
    const event: CalendarEvent = {
      ...data,
      id: generateEventId(),
      source: 'local',
      reminderStatus: 'none',
      reminderCronJobId: undefined,
      createdAt: now,
      updatedAt: now,
    };
    event.reminderStatus = initialReminderStatus(event);

    // 先持久化本地事件，避免网络失败丢失用户输入。
    set((s) => ({ events: [...s.events, event] }));
    persistEvents(get().events);

    // 仅对可由官方 Cron 准确表达的提醒创建远端任务。
    if (event.reminderStatus === 'pending') {
      const creation = await createCronReminder(event);
      if (creation.status === 'scheduled') {
        set((s) => ({
          events: s.events.map((e) =>
            e.id === event.id ? { ...e, reminderCronJobId: creation.jobId, reminderStatus: 'scheduled' } : e
          ),
        }));
        persistEvents(get().events);
        event.reminderCronJobId = creation.jobId;
        event.reminderStatus = 'scheduled';
      } else if (creation.status !== 'pending') {
        set((s) => ({
          events: s.events.map((e) => e.id === event.id ? { ...e, reminderStatus: creation.status } : e),
        }));
        persistEvents(get().events);
        event.reminderStatus = creation.status;
      }
    }

    return event;
  },

  updateEvent: async (id, updates) => {
    const old = get().events.find((e) => e.id === id);
    if (!old) return;

    const updated = { ...old, ...updates, updatedAt: new Date().toISOString() };

    // 所有会改变计划或消息内容的字段都必须重建远端提醒。
    const reminderChanged =
      updates.reminderMinutes !== undefined ||
      updates.startTime !== undefined ||
      updates.date !== undefined ||
      updates.title !== undefined ||
      updates.endTime !== undefined ||
      updates.location !== undefined ||
      updates.notes !== undefined ||
      updates.allDay !== undefined ||
      updates.recurrence !== undefined ||
      updates.deliveryChannel !== undefined;

    if (reminderChanged && old.reminderCronJobId) {
      const removal = await removeCronReminder(old.reminderCronJobId);
      if (!removal.removed) {
        set({ error: removal.error });
        return;
      }
    }

    const replacementStatus = reminderChanged ? initialReminderStatus(updated) : updated.reminderStatus;
    const localUpdated: CalendarEvent = reminderChanged
      ? {
        ...updated,
        reminderCronJobId: undefined,
        reminderStatus: replacementStatus,
      }
      : updated;

    set((s) => ({ events: s.events.map((e) => (e.id === id ? localUpdated : e)), error: null }));
    persistEvents(get().events);

    if (localUpdated.reminderStatus === 'pending') {
      const creation = await createCronReminder(localUpdated);
      set((s) => ({
        events: s.events.map((e) =>
          e.id === id
            ? creation.status === 'scheduled'
              ? { ...e, reminderCronJobId: creation.jobId, reminderStatus: 'scheduled' }
              : { ...e, reminderStatus: creation.status }
            : e
        ),
      }));
      persistEvents(get().events);
    }
  },

  deleteEvent: async (id) => {
    const event = get().events.find((e) => e.id === id);
    if (!event) return;

    // 只有远端确认删除后才能移除本地关联。
    if (event.reminderCronJobId) {
      const removal = await removeCronReminder(event.reminderCronJobId);
      if (!removal.removed) {
        set({ error: removal.error });
        return;
      }
    }

    set((s) => ({ events: s.events.filter((e) => e.id !== id), error: null }));
    persistEvents(get().events);
  },

  // ── 筛选与设置 ──

  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),

  updateSettings: (patch) => {
    set((s) => {
      const settings = { ...s.settings, ...patch };
      persistSettings(settings);
      return { settings };
    });
  },

  // ── Cron 同步：补发离线期间未创建的提醒 ──

  syncPendingReminders: async () => {
    const { events } = get();
    const pending = events.filter(
      (e) => e.reminderMinutes > 0 && e.reminderStatus === 'pending' && !e.reminderCronJobId
    );

    for (const event of pending) {
      const creation = await createCronReminder(event);
      if (creation.status === 'scheduled') {
        set((s) => ({
          events: s.events.map((e) =>
            e.id === event.id ? { ...e, reminderCronJobId: creation.jobId, reminderStatus: 'scheduled' } : e
          ),
        }));
      } else if (creation.status !== 'pending') {
        set((s) => ({
          events: s.events.map((e) => e.id === event.id ? { ...e, reminderStatus: creation.status } : e),
        }));
      }
    }
    persistEvents(get().events);
  },
}));
