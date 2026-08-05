import { create } from 'zustand';
import { getPrivacyLockStatus } from './api';
import type { PrivacyLockSnapshot } from './types';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

interface PrivacyLockStore {
  snapshot: PrivacyLockSnapshot | null;
  loading: boolean;
  error: boolean;
  setSnapshot: (snapshot: PrivacyLockSnapshot) => void;
  refresh: () => Promise<PrivacyLockSnapshot>;
}

export const usePrivacyLockStore = create<PrivacyLockStore>((set) => ({
  snapshot: null,
  loading: true,
  error: false,
  setSnapshot: (snapshot) => set({ snapshot, loading: false, error: false }),
  refresh: async () => {
    set({ loading: true, error: false });
    try {
      const snapshot = await getPrivacyLockStatus();
      set({ snapshot, loading: false, error: false });
      return snapshot;
    } catch (error) {
      set({ loading: false, error: true });
      throw error;
    }
  },
}));

let listening = false;

export function startPrivacyLockListener(): () => void {
  if (listening) return () => undefined;
  listening = true;
  const unlisten = subscribeTauriEvent<PrivacyLockSnapshot>(
    'junqi://privacy-lock-changed',
    (event) => {
      usePrivacyLockStore.getState().setSnapshot(event.payload);
    },
  );
  return () => {
    listening = false;
    unlisten();
  };
}

export function isPrivacyLocked(): boolean {
  return usePrivacyLockStore.getState().snapshot?.locked === true;
}
