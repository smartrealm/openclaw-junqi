import { Timer, Coffee, Pause } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { themeHex } from '@/utils/theme-colors';
import type { CelebrateKind, PetPomodoroState } from './pet-states';

/**
 * Pure view helpers for the Pomodoro: map a phase (or a completed-phase kind)
 * to its Lucide icon + theme color. Centralized here so the badge, the live
 * countdown bubble, and the celebrate caption all agree — change the mapping
 * once, not in three places.
 */

/** A readable subset of the pomodoro state — enough to pick an icon/color. */
type PomodoroPhase = Pick<PetPomodoroState, 'paused' | 'phase'>;

/** Lucide icon for the pomodoro's *current* phase (live badge / countdown). */
export function pomodoroIcon(p: PomodoroPhase): LucideIcon {
  if (p.paused) return Pause;
  return p.phase === 'work' ? Timer : Coffee;
}

/** Theme accent color for the pomodoro's current phase. */
export function pomodoroColor(p: PomodoroPhase): string {
  if (p.paused) return '#9aa3b2';
  return p.phase === 'work' ? themeHex('warning') : themeHex('success');
}

/** Lucide icon for a *completed* pomodoro phase (the celebrate caption). */
export function celebrateIcon(kind: Exclude<CelebrateKind, 'task'>): LucideIcon {
  return kind === 'pomodoroBreak' ? Coffee : Timer;
}

/** i18n key + fallback caption for a completed pomodoro phase. */
export const CELEBRATE_CAPTION: Record<Exclude<CelebrateKind, 'task'>, { key: string; fallback: string }> = {
  pomodoroWork: { key: 'pet.pomodoro.workDone', fallback: '专注完成，休息一下！' },
  pomodoroWorkLong: { key: 'pet.pomodoro.workDoneLong', fallback: '4 轮专注完成，长休息一下！' },
  pomodoroBreak: { key: 'pet.pomodoro.breakDone', fallback: '休息结束，继续专注！' },
};
