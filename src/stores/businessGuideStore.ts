import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface BusinessGuideState {
  welcomeDismissed: boolean;
  tourOpen: boolean;
  dismissWelcome: () => void;
  openTour: () => void;
  closeTour: () => void;
}

export const useBusinessGuideStore = create<BusinessGuideState>()(persist(
  (set) => ({
    welcomeDismissed: false,
    tourOpen: false,
    dismissWelcome: () => set({ welcomeDismissed: true }),
    openTour: () => set({ tourOpen: true }),
    closeTour: () => set({ tourOpen: false }),
  }),
  { name: 'junqi:business-guide:v1', version: 3, storage: createJSONStorage(() => localStorage), merge: (persisted, current) => {
    const saved = persisted as Partial<BusinessGuideState> | undefined;
    const legacy = saved as (Partial<BusinessGuideState> & { dismissed?: boolean; tourSeen?: boolean }) | undefined;
    return {
      ...current,
      welcomeDismissed: saved?.welcomeDismissed === true || legacy?.dismissed === true || legacy?.tourSeen === true,
    };
  }, partialize: (state) => ({ welcomeDismissed: state.welcomeDismissed }) },
));
