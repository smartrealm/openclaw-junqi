import type { GatewayHelloObservation } from '@/types/gatewayRuntime';

export const OPENCLAW_SESSION_HISTORY_METHODS = {
  listBranches: 'sessions.branches.list',
  switchBranch: 'sessions.branches.switch',
  rewind: 'sessions.rewind',
  forkAtMessage: 'sessions.fork',
} as const;

export interface OpenClawSessionHistoryCapabilities {
  readonly branches: boolean;
  readonly branchSwitch: boolean;
  readonly rewind: boolean;
  readonly forkAtMessage: boolean;
}

const EMPTY_CAPABILITIES: OpenClawSessionHistoryCapabilities = {
  branches: false,
  branchSwitch: false,
  rewind: false,
  forkAtMessage: false,
};

/**
 * Session history controls are additive Gateway features. Their UI is visible
 * only after the authenticated socket explicitly advertises each method.
 */
export function readOpenClawSessionHistoryCapabilities(
  observation: GatewayHelloObservation | null,
): OpenClawSessionHistoryCapabilities {
  if (!observation || observation.methods.length === 0) return EMPTY_CAPABILITIES;
  const methods = new Set(observation.methods);
  return {
    branches: methods.has(OPENCLAW_SESSION_HISTORY_METHODS.listBranches),
    branchSwitch: methods.has(OPENCLAW_SESSION_HISTORY_METHODS.switchBranch),
    rewind: methods.has(OPENCLAW_SESSION_HISTORY_METHODS.rewind),
    forkAtMessage: methods.has(OPENCLAW_SESSION_HISTORY_METHODS.forkAtMessage),
  };
}
