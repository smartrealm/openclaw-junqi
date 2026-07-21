export const TASK_DISPLAY_WINDOWS = [3, 7, 15, 30, 'all'] as const;
export type TaskDisplayWindow = typeof TASK_DISPLAY_WINDOWS[number];

const TASK_DISPLAY_WINDOW_KEY = 'junqi:taskDisplayWindow';
const ATTENTION_BADGE_KEY = 'junqi:attentionBadge';

function notifyPreferenceChange(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('junqi:app-settings-changed'));
  }
}

export function readTaskDisplayWindow(): TaskDisplayWindow {
  try {
    const value = localStorage.getItem(TASK_DISPLAY_WINDOW_KEY);
    if (value === 'all') return 'all';
    const days = Number(value);
    return TASK_DISPLAY_WINDOWS.includes(days as TaskDisplayWindow) ? days as TaskDisplayWindow : 3;
  } catch {
    return 3;
  }
}

export function writeTaskDisplayWindow(value: TaskDisplayWindow): void {
  localStorage.setItem(TASK_DISPLAY_WINDOW_KEY, String(value));
  notifyPreferenceChange();
}

export function readAttentionBadge(): boolean {
  try {
    return localStorage.getItem(ATTENTION_BADGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeAttentionBadge(enabled: boolean): void {
  localStorage.setItem(ATTENTION_BADGE_KEY, enabled ? '1' : '0');
  notifyPreferenceChange();
}
