export interface SessionListMutationFence {
  readonly capture: () => number;
  readonly invalidate: () => void;
  readonly isCurrent: (revision: number) => boolean;
}

export type SessionListLoadResult = 'failed' | 'superseded';

export function classifySessionListLoadFailure(
  requestIsCurrent: boolean,
  mutationIsCurrent: boolean,
): SessionListLoadResult {
  return requestIsCurrent && mutationIsCurrent ? 'failed' : 'superseded';
}

export function createSessionListMutationFence(): SessionListMutationFence {
  let revision = 0;
  return {
    capture: () => revision,
    invalidate: () => { revision += 1; },
    isCurrent: (candidate) => candidate === revision,
  };
}

export const sessionListMutationFence = createSessionListMutationFence();
