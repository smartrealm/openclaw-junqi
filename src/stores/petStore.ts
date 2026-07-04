import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PetSkin } from '@/pet/skins';
export type { PetSkin };

/** Coarse classification of a drag payload — drives the bubble icon + accent
 *  colour so the user can tell at a glance whether they dragged an image, an
 *  archive, code, text, or a folder. Heuristic, not authoritative. */
export type DragKind = 'image' | 'archive' | 'code' | 'text' | 'folder' | 'unknown';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|svg|ico|avif)$/i;
const ARCHIVE_EXT = /\.(zip|tar|gz|tgz|bz2|xz|7z|rar|zst|jar|war)$/i;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|rs|go|py|java|kt|swift|c|cpp|h|hpp|cs|rb|php|sh|bash|zsh|sql|vue|svelte|html|css|scss|less|json|ya?ml|toml|md|mdx)$/i;

export function classifyDragKind(paths: string[]): DragKind {
  if (paths.length === 0) return 'unknown';
  // If every path looks like a directory (no extension, no dot in basename),
  // call it a folder drag.
  const looksLikeDir = paths.every((p) => {
    const base = p.split(/[\\/]/).pop() ?? p;
    return !/\.[^./\\]+$/.test(base);
  });
  if (looksLikeDir) return 'folder';
  // Otherwise classify by the most common extension among the paths.
  const exts = paths.map((p) => {
    const m = /\.([^.\\/]+)$/.exec(p);
    return m ? m[1].toLowerCase() : '';
  });
  const counts: Record<DragKind, number> = {
    image: 0, archive: 0, code: 0, text: 0, folder: 0, unknown: 0,
  };
  for (const e of exts) {
    if (!e) counts.folder++;
    else if (IMAGE_EXT.test('.' + e)) counts.image++;
    else if (ARCHIVE_EXT.test('.' + e)) counts.archive++;
    else if (CODE_EXT.test('.' + e)) counts.code++;
    else counts.text++;
  }
  let best: DragKind = 'unknown';
  let bestN = 0;
  for (const [k, n] of Object.entries(counts) as [DragKind, number][]) {
    if (n > bestN) { bestN = n; best = k; }
  }
  return best;
}

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
  /** Bumped on every file-drop event so the pet window reruns the
   *  swallow animation each time the user drops something new. */
  swallowTick: number;
  /** Rolling list of recent swallow timestamps (capped) — drives the
   *  "still chewing" / rapidSwallow emotion when a new drop lands within
   *  RAPID_SWALLOW_GAP ms of the previous one. */
  swallowHistory: number[];
  /** Live drag state — true while an OS file drag is in flight over the
   *  main window. The pet uses this to render the drag / overdrag
   *  emotions regardless of the underlying business state. */
  dragActive: boolean;
  /** Coarse file classification for the in-flight drag (drives bubble icon). */
  dragKind: 'image' | 'archive' | 'code' | 'text' | 'folder' | 'unknown' | null;
  /** Number of paths being dragged (0 = none). */
  dragCount: number;
  /** True while the cursor is directly over the pet/main window during a drag. */
  dragOver: boolean;
  /** Sound effects — pet can play a soft "munch" on drop. Toggleable from settings. */
  soundEnabled: boolean;

  setPetVisible: (v: boolean) => void;
  setEnabled: (v: boolean) => void;
  setPosition: (p: { x: number; y: number }) => void;
  setClickThrough: (v: boolean) => void;
  setSkin: (v: PetSkin) => void;
  setCustomAsset: (v: string | null) => void;
  setPomodoro: (p: Partial<PomodoroState>) => void;
  bumpSwallowTick: () => void;
  setDragActive: (v: boolean, paths?: string[]) => void;
  setDragOver: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
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
      swallowTick: 0,
      swallowHistory: [],
      dragActive: false,
      dragKind: null,
      dragCount: 0,
      dragOver: false,
      soundEnabled: true,
      setEnabled: (enabled) => set({ enabled }),
      setPosition: (position) => set({ position }),
      setClickThrough: (clickThrough) => set({ clickThrough }),
      setSkin: (skin) => set({ skin }),
      setCustomAsset: (customAsset) => set({ customAsset }),
      setPomodoro: (p) => set((s) => ({ pomodoro: { ...s.pomodoro, ...p } })),
      setPetVisible: (petVisible: boolean) => set({ petVisible }),
      bumpSwallowTick: () =>
        set((s) => ({
          swallowTick: s.swallowTick + 1,
          // Keep at most 6 timestamps so the rapidSwallow detection can look
          // back across the last few drops. Anything older than ~5s is irrelevant.
          swallowHistory: [...s.swallowHistory, Date.now()].slice(-6),
        })),
      setDragActive: (v, paths) =>
        set(() => ({
          dragActive: v,
          dragCount: v ? paths?.length ?? 0 : 0,
          dragKind: v ? classifyDragKind(paths ?? []) : null,
          // Leaving the window → also drop the over flag.
          dragOver: v ? false : false,
        })),
      setDragOver: (v) => set({ dragOver: v }),
      setSoundEnabled: (v) => set({ soundEnabled: v }),
    }),
    {
      name: 'aegis-pet-settings',
      // customAsset (data URL) stays out of localStorage. pomodoro: persist
      // config + daily count + cycle progress; runtime (running/paused/phase/endsAt/...) resets.
      partialize: ({ enabled, position, clickThrough, skin, pomodoro, soundEnabled }) => ({
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
        soundEnabled,
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
