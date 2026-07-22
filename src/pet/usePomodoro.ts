import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { usePetStore } from '@/stores/petStore';
import { minutesToMs, todayStr } from './pomodoroDomain';

function notifyPomodoro(title: string) {
  void import('@/services/notifications').then((mod) => {
    mod.notifications.notify({ type: 'task_complete', title, body: title });
  }).catch(() => undefined);
}

/**
 * Pomodoro timer (runs in the MAIN window). One timer per phase, scheduled to
 * fire exactly when `endsAt` elapses — no 1s poll. The effect re-runs (and
 * re-arms the timer) whenever endsAt/phase changes: on start, pause→resume, and
 * each phase transition. On phase end: work→break counts the pomodoro, advances
 * the 4-round cycle (workRounds 1→2→3→4; the 4th triggers a long break, and the
 * following break→work resets it to 0 — a day change also resets it to 0), and
 * rolls the daily count over at day change; break→work re-arms a work phase.
 * Each transition fires a notification + stamps lastDoneTs so the pet celebrates
 * briefly. Paused or stopped → endsAt is null → no timer scheduled.
 */
export function usePomodoro() {
  const { t } = useTranslation();
  const enabled = usePetStore((s) => s.pomodoro.enabled);
  const running = usePetStore((s) => s.pomodoro.running);
  const paused = usePetStore((s) => s.pomodoro.paused);
  const endsAt = usePetStore((s) => s.pomodoro.endsAt);

  useEffect(() => {
    if (!enabled || !running || paused || !endsAt) return;
    const ms = endsAt - Date.now();

    const id = setTimeout(() => {
      const { pomodoro, setPomodoro } = usePetStore.getState();
      // State may have shifted since scheduling; cleanup clears this timer on
      // re-arm, but guard defensively against pause/stop that raced the fire.
      if (!pomodoro.running || pomodoro.paused) return;

      const now = Date.now();
      if (pomodoro.phase === 'work') {
        const sameDay = pomodoro.completedDate === todayStr();
        const rounds = sameDay ? pomodoro.workRounds + 1 : 1; // day change → new cycle
        const isLong = rounds % 4 === 0;
        const completedToday = sameDay ? pomodoro.completedToday + 1 : 1;
        const nextMs = minutesToMs(isLong ? pomodoro.longBreakMin : pomodoro.breakMin);
        setPomodoro({
          phase: 'break',
          endsAt: now + nextMs,
          lastDoneTs: now,
          workRounds: rounds,
          completedToday,
          completedDate: todayStr(),
        });
        const title = isLong
          ? t('pet.pomodoro.workDoneLong', '4 轮专注完成，长休息一下！')
          : t('pet.pomodoro.workDone', '专注完成，休息一下！');
        notifyPomodoro(title);
      } else {
        // break→work. If the break just ended was a long one (4th round done),
        // reset the 4-round cycle counter back to 0.
        const resetCycle = pomodoro.workRounds > 0 && pomodoro.workRounds % 4 === 0;
        setPomodoro({
          phase: 'work',
          endsAt: now + minutesToMs(pomodoro.workMin),
          lastDoneTs: now,
          workRounds: resetCycle ? 0 : pomodoro.workRounds,
        });
        const title = t('pet.pomodoro.breakDone', '休息结束，继续专注！');
        notifyPomodoro(title);
      }
    }, Math.max(ms, 0));

    return () => clearTimeout(id);
  }, [enabled, running, paused, endsAt, t]);
}
