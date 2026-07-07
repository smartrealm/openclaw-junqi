export const MIN_POMODORO_MINUTES = 1;
export const MIN_PHASE_MS = 1_000;

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function minutesToMs(minutes: number): number {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(MIN_POMODORO_MINUTES, minutes) : MIN_POMODORO_MINUTES;
  return safeMinutes * 60_000;
}

export function remainingMsFromPause(value: number | null | undefined): number {
  return Math.max(MIN_PHASE_MS, value ?? MIN_PHASE_MS);
}
