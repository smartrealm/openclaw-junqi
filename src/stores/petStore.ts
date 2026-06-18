import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PetSkin } from '@/pet/skins';
export type { PetSkin };

/**
 * Pet companion settings. Persisted to localStorage (`aegis-pet-settings`) so
 * both the main window and the pet window read the same values (same origin).
 */
/** Pomodoro work/break timer. Config + daily count + cycle progress persisted; runtime resets. */
export interface PomodoroState {
  enabled: boolean;
  workMin: number;
  breakMin: number;
  longBreakMin: number; // every 4 work rounds → long break
  running: boolean;
  paused: boolean;
  phase: 'work' | 'break';
  endsAt: number | null; // epoch ms when current phase ends
  pausedRemainingMs: number | null; // remaining ms captured on pause
  lastDoneTs: number; // epoch ms of last phase completion (pet cue)
  workRounds: number; // work rounds done in the current 4-round cycle (0–3, resets after the long break)
  completedToday: number;
  completedDate: string; // YYYY-MM-DD for daily reset
}

interface PetSettings {
  enabled: boolean;
  position: { x: number; y: number } | null;
  clickThrough: boolean;
  skin: PetSkin;
  customAsset: string | null;
  pomodoro: PomodoroState;
  petVisible: boolean;

  setPetVisible: (v: boolean) => void;
  setEnabled: (v: boolean) => void;
  setPosition: (p: { x: number; y: number }) => void;
  setClickThrough: (v: boolean) => void;
  setSkin: (v: PetSkin) => void;
  setCustomAsset: (v: string | null) => void;
  setPomodoro: (p: Partial<PomodoroState>) => void;
}

export const usePetStore = create<PetSettings>()(
  persist(
    (set) => ({
      enabled: true,
      position: null,
      clickThrough: true,
      skin: 'lobster',
      customAsset: null,
      pomodoro: {
        enabled: false,
        workMin: 30,
        breakMin: 5,
        longBreakMin: 15,
        running: false,
        paused: false,
        phase: 'work',
        endsAt: null,
        pausedRemainingMs: null,
        lastDoneTs: 0,
        workRounds: 0,
        completedToday: 0,
        completedDate: '',
      },
      petVisible: true,
      setEnabled: (enabled) => set({ enabled }),
      setPosition: (position) => set({ position }),
      setClickThrough: (clickThrough) => set({ clickThrough }),
      setSkin: (skin) => set({ skin }),
      setCustomAsset: (customAsset) => set({ customAsset }),
      setPomodoro: (p) => set((s) => ({ pomodoro: { ...s.pomodoro, ...p } })),
      setPetVisible: (petVisible: boolean) => set({ petVisible }),
    }),
    {
      name: 'aegis-pet-settings',
      // customAsset (data URL) stays out of localStorage. pomodoro: persist
      // config + daily count + cycle progress; runtime (running/paused/phase/endsAt/...) resets.
      partialize: ({ enabled, position, clickThrough, skin, pomodoro }) => ({
        enabled,
        position,
        clickThrough,
        skin,
        pomodoro: {
          enabled: pomodoro.enabled,
          workMin: pomodoro.workMin,
          breakMin: pomodoro.breakMin,
          longBreakMin: pomodoro.longBreakMin,
          workRounds: pomodoro.workRounds,
          completedToday: pomodoro.completedToday,
          completedDate: pomodoro.completedDate,
        },
      }),
      merge: (persisted, current) => {
        const p = (persisted as Partial<PetSettings>) || {};
        const pomodoro = { ...current.pomodoro, ...(p.pomodoro || {}) };
        // Day rolled over (or first run / stale data): reset the daily count
        // and the 4-round cycle so yesterday's progress doesn't bleed in.
        const today = new Date().toISOString().slice(0, 10);
        if (pomodoro.completedDate !== today) {
          pomodoro.completedToday = 0;
          pomodoro.workRounds = 0;
          pomodoro.completedDate = today;
        }
        return { ...current, ...p, pomodoro };
      },
    },
  ),
);
