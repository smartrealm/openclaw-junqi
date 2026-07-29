import type {
  PaneId,
  ProviderId,
  ProviderSessionId,
  PtyId,
  PtyRunId,
  WorktreeId,
} from './types';

export interface ProviderSessionClaim {
  claimId: string;
  generation: number;
  worktreeId: WorktreeId;
  paneId: PaneId;
  ptyId: PtyId;
  ptyRunId: PtyRunId;
  providerId: ProviderId;
  providerSessionId: ProviderSessionId | null;
  transcriptPath: string | null;
  status: 'claiming' | 'running' | 'sleeping' | 'attention' | 'exited';
}

export interface ProviderClaimRequest extends Omit<ProviderSessionClaim, 'generation' | 'status'> {
  expectedClaimId?: string;
}

export interface ProviderClaimState {
  byPane: Record<PaneId, ProviderSessionClaim>;
}

let nextProviderGeneration = 0;

function allocateProviderGeneration(): number {
  nextProviderGeneration += 1;
  return nextProviderGeneration;
}

export type ProviderClaimResult =
  | { ok: true; state: ProviderClaimState; claim: ProviderSessionClaim; idempotent: boolean }
  | { ok: false; state: ProviderClaimState; reason: 'pane-owned' | 'pty-owned' | 'resume-owned' | 'stale-replacement' };

export function providerResumeFingerprint(claim: Pick<ProviderSessionClaim,
  'worktreeId' | 'providerId' | 'providerSessionId' | 'transcriptPath'
>): string | null {
  if (!claim.providerSessionId && !claim.transcriptPath) return null;
  return JSON.stringify([
    claim.worktreeId,
    claim.providerId,
    claim.providerSessionId ?? '',
    claim.transcriptPath ?? '',
  ]);
}

function sameIdentity(current: ProviderSessionClaim, request: ProviderClaimRequest): boolean {
  return current.claimId === request.claimId
    && current.worktreeId === request.worktreeId
    && current.paneId === request.paneId
    && current.ptyId === request.ptyId
    && current.ptyRunId === request.ptyRunId
    && current.providerId === request.providerId
    && current.providerSessionId === request.providerSessionId
    && current.transcriptPath === request.transcriptPath;
}

export function claimProviderSession(state: ProviderClaimState, request: ProviderClaimRequest): ProviderClaimResult {
  const current = state.byPane[request.paneId];
  if (current && sameIdentity(current, request)) {
    return { ok: true, state, claim: current, idempotent: true };
  }
  if (current && request.expectedClaimId !== current.claimId) {
    return {
      ok: false,
      state,
      reason: request.expectedClaimId ? 'stale-replacement' : 'pane-owned',
    };
  }
  if (!current && request.expectedClaimId) {
    return { ok: false, state, reason: 'stale-replacement' };
  }
  const resume = providerResumeFingerprint(request);
  for (const claim of Object.values(state.byPane)) {
    if (claim.paneId === request.paneId) continue;
    if (claim.ptyId === request.ptyId || claim.ptyRunId === request.ptyRunId) {
      return { ok: false, state, reason: 'pty-owned' };
    }
    if (resume && providerResumeFingerprint(claim) === resume) {
      return { ok: false, state, reason: 'resume-owned' };
    }
  }
  const claim: ProviderSessionClaim = {
    claimId: request.claimId,
    generation: allocateProviderGeneration(),
    worktreeId: request.worktreeId,
    paneId: request.paneId,
    ptyId: request.ptyId,
    ptyRunId: request.ptyRunId,
    providerId: request.providerId,
    providerSessionId: request.providerSessionId,
    transcriptPath: request.transcriptPath,
    status: 'claiming',
  };
  return {
    ok: true,
    idempotent: false,
    claim,
    state: { byPane: { ...state.byPane, [request.paneId]: claim } },
  };
}

export function updateProviderClaimStatus(
  state: ProviderClaimState,
  paneId: PaneId,
  claimId: string,
  generation: number,
  status: ProviderSessionClaim['status'],
): ProviderClaimState {
  const current = state.byPane[paneId];
  if (!current || current.claimId !== claimId || current.generation !== generation) return state;
  return { byPane: { ...state.byPane, [paneId]: { ...current, status } } };
}

export function releaseProviderClaim(
  state: ProviderClaimState,
  paneId: PaneId,
  claimId: string,
  generation: number,
): ProviderClaimState {
  const current = state.byPane[paneId];
  if (!current || current.claimId !== claimId || current.generation !== generation) return state;
  const byPane = { ...state.byPane };
  delete byPane[paneId];
  return { byPane };
}
