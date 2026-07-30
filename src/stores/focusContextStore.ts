import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isFocusContext, type FocusContext } from '@/focus/focusContext';

interface FocusContextState {
  focus: FocusContext | null;
  setFocus: (focus: FocusContext) => void;
  clearFocus: () => void;
}

export const useFocusContextStore = create<FocusContextState>()(persist(
  (set) => ({
    focus: null,
    setFocus: (focus) => set((state) => isFocusContext(focus) ? { focus } : state),
    clearFocus: () => set({ focus: null }),
  }),
  {
    name: 'junqi:focus-context:v1',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    merge: (persisted, current) => {
      const candidate = (persisted as Partial<FocusContextState> | undefined)?.focus;
      return { ...current, focus: isFocusContext(candidate) ? candidate : null };
    },
    partialize: (state) => ({ focus: state.focus }),
  },
));
