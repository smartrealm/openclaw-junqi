import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Pet companion settings. Persisted to localStorage (`aegis-pet-settings`) so
 * both the main window and the pet window read the same values (same origin).
 */
export type PetSkin = 'sprite' | 'robot' | 'lobster';

/** Pomodoro work/break timer. Only config (enabled/workMin/breakMin) is
 * persisted; running/phase/endsAt reset on restart. */
export interface PomodoroState {
  enabled: boolean;
  workMin: number;
  breakMin: number;
  running: boolean;
  phase: 'work' | 'break';
  endsAt: number | null; // epoch ms when current phase ends
  lastDoneTs: number; // epoch ms of last phase completion (pet cue), 0 = none
}

interface PetSettings {
  enabled: boolean;
  position: { x: number; y: number } | null;
  clickThrough: boolean;
  skin: PetSkin;
  customAsset: string | null;
  pomodoro: PomodoroState;

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
        running: false,
        phase: 'work',
        endsAt: null,
        lastDoneTs: 0,
      },
      setEnabled: (enabled) => set({ enabled }),
      setPosition: (position) => set({ position }),
      setClickThrough: (clickThrough) => set({ clickThrough }),
      setSkin: (skin) => set({ skin }),
      setCustomAsset: (customAsset) => set({ customAsset }),
      setPomodoro: (p) => set((s) => ({ pomodoro: { ...s.pomodoro, ...p } })),
    }),
    {
      name: 'aegis-pet-settings',
      // customAsset is a large data URL — keep out of localStorage (loaded from
      // disk). pomodoro: persist only config, not runtime (running/phase/endsAt).
      partialize: ({ enabled, position, clickThrough, skin, pomodoro }) => ({
        enabled,
        position,
        clickThrough,
        skin,
        pomodoro: { enabled: pomodoro.enabled, workMin: pomodoro.workMin, breakMin: pomodoro.breakMin },
      }),
      merge: (persisted, current) => {
        const p = (persisted as Partial<PetSettings>) || {};
        return {
          ...current,
          ...p,
          pomodoro: { ...current.pomodoro, ...(p.pomodoro || {}) },
        };
      },
    },
  ),
);
