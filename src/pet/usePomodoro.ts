import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { usePetStore } from '@/stores/petStore';
import { notifications } from '@/services/notifications';

/**
 * Pomodoro timer (runs in the MAIN window). When enabled + running, ticks every
 * second; when the current phase ends it flips work↔break, arms the next phase,
 * stamps lastDoneTs (so the pet celebrates briefly), and fires a notification.
 * Loops until the user stops it. Default 30/5.
 */
export function usePomodoro() {
  const { t } = useTranslation();
  const enabled = usePetStore((s) => s.pomodoro.enabled);
  const running = usePetStore((s) => s.pomodoro.running);

  useEffect(() => {
    if (!enabled || !running) return;
    const id = setInterval(() => {
      const { pomodoro, setPomodoro } = usePetStore.getState();
      if (!pomodoro.running || !pomodoro.endsAt) return;
      const now = Date.now();
      if (now < pomodoro.endsAt) return;
      const wasWork = pomodoro.phase === 'work';
      const nextPhase = wasWork ? 'break' : 'work';
      const nextMs = (wasWork ? pomodoro.breakMin : pomodoro.workMin) * 60_000;
      setPomodoro({ phase: nextPhase, endsAt: now + nextMs, lastDoneTs: now });
      const title = wasWork
        ? t('pet.pomodoro.workDone', '专注完成，休息一下！')
        : t('pet.pomodoro.breakDone', '休息结束，继续专注！');
      notifications.notify({ type: 'task_complete', title, body: title });
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, running, t]);
}
