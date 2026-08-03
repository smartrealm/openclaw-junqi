export interface SessionListMutationFence {
  readonly capture: () => number;
  readonly invalidate: () => void;
  readonly isCurrent: (revision: number) => boolean;
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
