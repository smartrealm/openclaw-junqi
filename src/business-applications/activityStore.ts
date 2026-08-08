import { create } from 'zustand';

export type BusinessAttemptState = 'pending' | 'approval_required' | 'succeeded' | 'failed' | 'unknown';

export interface BusinessInvocationEvidence {
  readonly gatewayToolName?: string;
  readonly gatewaySource?: string;
  readonly dwsCanonicalPath?: string;
  readonly schemaDigest?: string;
  readonly recoveryEventId?: string;
}

export interface BusinessActivityAttempt {
  readonly id: string;
  readonly sessionKey: string;
  readonly sessionId: string | null;
  readonly agentId: string | null;
  readonly runtimeFingerprint: string | null;
  readonly runtimeConnectionId: string | null;
  readonly toolName: string;
  readonly toolLabel: string;
  readonly profileRef: string | null;
  readonly effect: 'read' | 'write';
  readonly risk: 'low' | 'medium' | 'high';
  readonly state: BusinessAttemptState;
  readonly approvalId?: string;
  readonly errorCode?: string;
  readonly evidence?: BusinessInvocationEvidence;
  readonly startedAt: number;
  readonly finishedAt?: number;
}

interface BusinessActivityState {
  attempts: BusinessActivityAttempt[];
  begin: (attempt: BusinessActivityAttempt) => void;
  settle: (id: string, patch: Partial<Pick<BusinessActivityAttempt, 'state' | 'approvalId' | 'errorCode' | 'evidence' | 'finishedAt'>>) => void;
  clear: () => void;
}

const MAX_ATTEMPTS = 100;

export const useBusinessActivityStore = create<BusinessActivityState>((set) => ({
  attempts: [],
  begin: (attempt) => set((state) => ({
    attempts: [attempt, ...state.attempts].slice(0, MAX_ATTEMPTS),
  })),
  settle: (id, patch) => set((state) => ({
    attempts: state.attempts.map((attempt) => attempt.id === id ? { ...attempt, ...patch } : attempt),
  })),
  clear: () => set({ attempts: [] }),
}));
