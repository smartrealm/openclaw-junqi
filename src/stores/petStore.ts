import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Pet companion settings. Persisted to localStorage (`aegis-pet-settings`) so
 * both the main window and the pet window read the same values (same origin).
 *
 * Follows the `workshopStore` persist pattern rather than the hand-rolled
 * localStorage reads elsewhere in the app.
 */
interface PetSettings {
  /** Master switch — when false the pet window is never opened. */
  enabled: boolean;
  /** Last logical (x, y) the user dragged the pet to (for position restore). */
  position: { x: number; y: number } | null;
  /** Whether the pet lets clicks pass through to the desktop when not hovered. */
  clickThrough: boolean;

  setEnabled: (v: boolean) => void;
  setPosition: (p: { x: number; y: number }) => void;
  setClickThrough: (v: boolean) => void;
}

export const usePetStore = create<PetSettings>()(
  persist(
    (set) => ({
      enabled: true,
      position: null,
      clickThrough: true,
      setEnabled: (enabled) => set({ enabled }),
      setPosition: (position) => set({ position }),
      setClickThrough: (clickThrough) => set({ clickThrough }),
    }),
    { name: 'aegis-pet-settings' },
  ),
);
