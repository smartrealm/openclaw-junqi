// ═══════════════════════════════════════════════════════════
// 日历类型：所有日历数据的唯一来源
// ═══════════════════════════════════════════════════════════

export type EventCategory = 'work' | 'personal' | 'health' | 'social' | 'education' | 'other';
export type EventSource = 'local' | 'memory' | 'ics';
export type ReminderStatus = 'pending' | 'scheduled' | 'fired' | 'failed' | 'unsupported' | 'none';
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type DeliveryChannel = string;

export interface CalendarEvent {
  id: string;
  title: string;

  // 时间
  date: string;           // YYYY-MM-DD
  startTime?: string;     // HH:MM（不填表示全天）
  endTime?: string;       // HH:MM（不填表示默认一小时）
  allDay: boolean;

  // 详情
  location?: string;
  notes?: string;
  category: EventCategory;
  color?: string;         // 覆盖分类颜色

  // 来源
  source: EventSource;
  externalId?: string;    // Notion ID、ICS UID 或记忆引用

  // 提醒对应 OpenClaw Cron
  reminderMinutes: number;       // 0 表示不提醒
  reminderCronJobId?: string;    // 关联的 Cron 任务 ID
  reminderStatus: ReminderStatus;
  deliveryChannel: DeliveryChannel;

  // 重复规则（当前版本的基础能力）
  recurrence?: {
    freq: RecurrenceFreq;
    interval: number;      // 每 N 天、周、月或年
    until?: string;        // YYYY-MM-DD 结束日期
    count?: number;        // 或重复次数
  };

  // 元数据
  status: 'scheduled' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface CalendarFilter {
  categories: EventCategory[];
  sources: EventSource[];
  search: string;
  showCompleted: boolean;
}

export interface CalendarSettings {
  weekStartDay: 0 | 1 | 6;   // 0=周日，1=周一，6=周六
  defaultView: 'month' | 'week' | 'day';
  defaultReminder: number;    // 分钟
  timelineStart: number;      // 小时（0-23）
  timelineEnd: number;        // 小时（0-23）
  defaultDeliveryChannel: DeliveryChannel;
}

// 来自设计基础色的分类颜色
export const CAT_COLORS: Record<EventCategory, string> = {
  work:      'rgb(108 159 255)',  // --color-blue-400
  personal:  'rgb(78 201 176)',   // --color-teal-400
  health:    'rgb(244 112 103)',  // --color-red-400
  social:    'rgb(232 184 78)',   // --color-amber-400
  education: 'rgb(164 134 255)', // 紫色
  other:     'rgb(139 148 158)',  // --color-slate-400
};

// 用于遍历的全部分类
export const ALL_CATEGORIES: EventCategory[] = ['work', 'personal', 'health', 'social', 'education', 'other'];

// 提醒预设（分钟）
export const REMINDER_PRESETS = [0, 5, 15, 30, 60, 120, 1440, 10080] as const;

// 默认设置
export const DEFAULT_SETTINGS: CalendarSettings = {
  weekStartDay: 6,       // 周六
  defaultView: 'month',
  defaultReminder: 30,
  timelineStart: 0,
  timelineEnd: 23,
  defaultDeliveryChannel: 'last',
};

// 默认筛选器（显示全部）
export const DEFAULT_FILTER: CalendarFilter = {
  categories: [...ALL_CATEGORIES],
  sources: ['local', 'memory', 'ics'],
  search: '',
  showCompleted: false,
};
