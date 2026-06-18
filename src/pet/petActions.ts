import { usePetStore, type PetSkin } from '@/stores/petStore';
import { SKIN_REGISTRY } from './skins';

/**
 * Pet actions that mutate the authoritative store. These run in the MAIN
 * window (where the live timer + store live); the pet window forwards user
 * intents here via the "pet-action" event (see usePetActions).
 */

/** Skin cycle order — derived from the registry so it never drifts from it. */
const SKIN_ORDER = Object.keys(SKIN_REGISTRY) as PetSkin[];

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
    endsAt: Date.now() + workMin * 60_000,
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
  if (p.paused) {
    usePetStore.getState().setPomodoro({
      paused: false,
      endsAt: Date.now() + (p.pausedRemainingMs ?? 0),
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
