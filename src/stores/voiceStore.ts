import { create } from 'zustand';
import type {
  VoiceGlobalClaim,
  VoicePhase,
  VoiceRuntimeSnapshot,
} from '@/services/voice/types';

interface VoiceStore extends VoiceRuntimeSnapshot {
  /** Output owned by another WebView; local capture state remains independent. */
  remoteOutput: VoiceGlobalClaim | null;
  setSnapshot: (snapshot: VoiceRuntimeSnapshot) => void;
  setPhase: (phase: VoicePhase, patch?: Partial<VoiceRuntimeSnapshot>) => void;
  setRemoteOutput: (claim: VoiceGlobalClaim | null) => void;
}

const INITIAL: VoiceRuntimeSnapshot = {
  phase: 'idle',
  sessionKey: null,
  queueLength: 0,
  startedAt: null,
  lastError: null,
};

export const useVoiceStore = create<VoiceStore>((set) => ({
  ...INITIAL,
  remoteOutput: null,
  setSnapshot: (snapshot) => set(snapshot),
  setPhase: (phase, patch = {}) => set((state) => ({
    ...state,
    ...patch,
    phase,
    lastError: phase === 'error' ? (patch.lastError ?? state.lastError) : null,
  })),
  setRemoteOutput: (remoteOutput) => set({ remoteOutput }),
}));

export const VOICE_IDLE_SNAPSHOT = INITIAL;
