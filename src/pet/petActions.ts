import { usePetStore, type PetSkin } from '@/stores/petStore';
import { PET_SKIN_IDS } from './skins';
import { minutesToMs, remainingMsFromPause } from './pomodoroDomain';

/**
 * Pet actions that mutate the authoritative store. These run in the MAIN
 * window (where the live timer + store live); the pet window forwards user
 * intents here via the "pet-action" event (see usePetActions).
 */

/** 皮肤切换顺序来自统一元数据，避免设置页和右键菜单各自维护。 */
const SKIN_ORDER: PetSkin[] = [...PET_SKIN_IDS];

/** Advance to the next skin in the cycle. */
export function cycleSkin(): void {
  const cur = usePetStore.getState().skin;
  const next = SKIN_ORDER[(SKIN_ORDER.indexOf(cur) + 1) % SKIN_ORDER.length];
  usePetStore.getState().setSkin(next);
}

/** Start a fresh work phase (resets elapsed + last-done). */
export function startPomodoro(): void {
  const { workMin } = usePetStore.getState().pomodoro;
  usePetStore.getState().setPomodoro({
    running: true,
    paused: false,
    phase: 'work',
    endsAt: Date.now() + minutesToMs(workMin),
    lastDoneTs: 0,
  });
}

/** Stop the timer and clear the current phase. */
export function stopPomodoro(): void {
  usePetStore.getState().setPomodoro({
    running: false,
    endsAt: null,
    paused: false,
    pausedRemainingMs: null,
  });
}

/** Pause if running, resume if paused — preserves the remaining time. */
export function togglePausePomodoro(): void {
  const p = usePetStore.getState().pomodoro;
  if (!p.running) return;
  if (p.paused) {
    usePetStore.getState().setPomodoro({
      paused: false,
      endsAt: Date.now() + remainingMsFromPause(p.pausedRemainingMs),
      pausedRemainingMs: null,
    });
  } else {
    usePetStore.getState().setPomodoro({
      paused: true,
      pausedRemainingMs: p.endsAt ? p.endsAt - Date.now() : 0,
      endsAt: null,
    });
  }
}

// ── Right-click context menu ───────────────────────────────────────────────

export type PetMenuKind = 'showMain' | 'hide' | 'nextSkin' | 'pomoStart' | 'pomoPause' | 'pomoStop';

export interface PetMenuItem {
  /** 'sep' renders a divider; otherwise the kind reported back on click. */
  kind: PetMenuKind | 'sep';
  label: string;
  disabled?: boolean;
}
