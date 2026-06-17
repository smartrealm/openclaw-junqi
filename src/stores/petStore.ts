import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Pet companion settings. Persisted to localStorage (`aegis-pet-settings`) so
 * both the main window and the pet window read the same values (same origin).
 *
 * Follows the `workshopStore` persist pattern rather than the hand-rolled
 * localStorage reads elsewhere in the app.
 */
export type PetSkin = 'sprite' | 'robot' | 'lobster';

interface PetSettings {
  /** Master switch — when false the pet window is never opened. */
  enabled: boolean;
  /** Last logical (x, y) the user dragged the pet to (for position restore). */
  position: { x: number; y: number } | null;
  /** Whether the pet lets clicks pass through to the desktop when not hovered. */
  clickThrough: boolean;
  /** Built-in character body shape. */
  skin: PetSkin;
  /** Custom uploaded skin as a data URL — NOT persisted (loaded from disk on startup). */
  customAsset: string | null;

  setEnabled: (v: boolean) => void;
  setPosition: (p: { x: number; y: number }) => void;
  setClickThrough: (v: boolean) => void;
  setSkin: (v: PetSkin) => void;
  setCustomAsset: (v: string | null) => void;
}

export const usePetStore = create<PetSettings>()(
  persist(
    (set) => ({
      enabled: true,
      position: null,
      clickThrough: true,
      skin: 'lobster',
      customAsset: null,
      setEnabled: (enabled) => set({ enabled }),
      setPosition: (position) => set({ position }),
      setClickThrough: (clickThrough) => set({ clickThrough }),
      setSkin: (skin) => set({ skin }),
      setCustomAsset: (customAsset) => set({ customAsset }),
    }),
    {
      name: 'aegis-pet-settings',
      // customAsset is a large data URL — keep it out of localStorage; it's
      // loaded from disk (load_pet_asset) on startup instead.
      partialize: ({ enabled, position, clickThrough, skin }) => ({ enabled, position, clickThrough, skin }),
    },
  ),
);
