import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface BusinessGuidePersistedState {
  welcomeDismissed: boolean;
}

interface BusinessGuideState extends BusinessGuidePersistedState {
  tourOpen: boolean;
  tourStartIndex: number;
  dismissWelcome: () => void;
  openTour: (startIndex?: number) => void;
  closeTour: () => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * 版本 2 保存了已废弃的 dismissed/tourSeen 字段。任一字段为真都表示用户已处理欢迎引导，
 * 迁移时不得重新打开。
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
    tourStartIndex: 0,
    dismissWelcome: () => set({ welcomeDismissed: true, tourOpen: false }),
    openTour: (startIndex = 0) => set({ tourOpen: true, tourStartIndex: Math.max(0, startIndex) }),
    closeTour: () => set({ tourOpen: false, tourStartIndex: 0 }),
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
      tourStartIndex: 0,
    }),
    partialize: (state) => ({ welcomeDismissed: state.welcomeDismissed }),
  },
));
