import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface BusinessGuidePersistedState {
  welcomeDismissed: boolean;
}

interface BusinessGuideState extends BusinessGuidePersistedState {
  tourOpen: boolean;
  dismissWelcome: () => void;
  openTour: () => void;
  closeTour: () => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Version 2 stored the obsolete dismissed/tourSeen pair. Either field means
 * the welcome was already handled, so a migration must never reopen it.
 */
export function migrateBusinessGuidePersistedState(
  persistedState: unknown,
  version: number,
): BusinessGuidePersistedState {
  const persisted = asRecord(persistedState);
  const legacySeen = version <= 2
    && (persisted.dismissed === true || persisted.tourSeen === true);

  return {
    welcomeDismissed: persisted.welcomeDismissed === true || legacySeen,
  };
}

export const useBusinessGuideStore = create<BusinessGuideState>()(persist(
  (set) => ({
    welcomeDismissed: false,
    tourOpen: false,
    dismissWelcome: () => set({ welcomeDismissed: true, tourOpen: false }),
    openTour: () => set({ tourOpen: true }),
    closeTour: () => set({ tourOpen: false }),
  }),
  {
    name: 'junqi:business-guide:v1',
    version: 3,
    storage: createJSONStorage(() => localStorage),
    migrate: migrateBusinessGuidePersistedState,
    merge: (persisted, current) => ({
      ...current,
      ...migrateBusinessGuidePersistedState(persisted, 3),
      tourOpen: false,
    }),
    partialize: (state) => ({ welcomeDismissed: state.welcomeDismissed }),
  },
));
