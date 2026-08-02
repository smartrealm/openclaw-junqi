import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface BusinessGuideState {
  dismissed: boolean;
  tourOpen: boolean;
  tourSeen: boolean;
  dismiss: () => void;
  reopen: () => void;
  closeTour: () => void;
}

export const useBusinessGuideStore = create<BusinessGuideState>()(persist(
  (set) => ({ dismissed: false, tourOpen: true, tourSeen: false, dismiss: () => set({ dismissed: true, tourOpen: false, tourSeen: true }), reopen: () => set({ dismissed: false, tourOpen: true, tourSeen: true }), closeTour: () => set({ tourOpen: false, tourSeen: true }) }),
  { name: 'junqi:business-guide:v1', version: 2, storage: createJSONStorage(() => localStorage), merge: (persisted, current) => {
    const saved = persisted as Partial<BusinessGuideState> | undefined;
    const tourSeen = saved?.tourSeen === true || saved?.dismissed === true;
    return { ...current, dismissed: saved?.dismissed === true, tourSeen, tourOpen: !tourSeen };
  }, partialize: (state) => ({ dismissed: state.dismissed, tourSeen: state.tourSeen }) },
));
