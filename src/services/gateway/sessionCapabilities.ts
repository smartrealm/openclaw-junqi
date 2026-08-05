import type { GatewayHelloObservation } from '@/types/gatewayRuntime';

export const OPENCLAW_SESSION_HISTORY_METHODS = {
  listBranches: 'sessions.branches.list',
  switchBranch: 'sessions.branches.switch',
  rewind: 'sessions.rewind',
  forkAtMessage: 'sessions.fork',
  listFiles: 'sessions.files.list',
  getFile: 'sessions.files.get',
  setViewerPresence: 'sessions.viewers.set',
  abortSession: 'sessions.abort',
} as const;

export type OpenClawSessionHistoryMethod =
  (typeof OPENCLAW_SESSION_HISTORY_METHODS)[keyof typeof OPENCLAW_SESSION_HISTORY_METHODS];

export interface OpenClawSessionCapabilities {
  readonly connectionId: string | null;
  readonly methodsAdvertised: boolean;
  readonly branches: boolean;
  readonly branchSwitch: boolean;
  readonly rewind: boolean;
  readonly forkAtMessage: boolean;
  readonly workspace: boolean;
  readonly viewerPresence: boolean;
  readonly abortSession: boolean;
}
const EMPTY_CAPABILITIES: OpenClawSessionCapabilities = {
  connectionId: null,
  methodsAdvertised: false,
  branches: false,
  branchSwitch: false,
  rewind: false,
  forkAtMessage: false,
  workspace: false,
  viewerPresence: false,
  abortSession: false,
};

/**
 * Newer OpenClaw methods are displayed only when the authenticated Gateway
 * explicitly advertises them. An omitted feature list is an unknown legacy
 * runtime, not permission to optimistically call a newer RPC.
 */
export function readOpenClawSessionCapabilities(
  observation: GatewayHelloObservation | null,
): OpenClawSessionCapabilities {
  if (!observation || observation.methods.length === 0) return EMPTY_CAPABILITIES;
  const methods = new Set(observation.methods);
  const has = (method: OpenClawSessionHistoryMethod) => methods.has(method);
  return {
    connectionId: observation.connectionId || null,
    methodsAdvertised: true,
    branches: has(OPENCLAW_SESSION_HISTORY_METHODS.listBranches),
    branchSwitch: has(OPENCLAW_SESSION_HISTORY_METHODS.switchBranch),
    rewind: has(OPENCLAW_SESSION_HISTORY_METHODS.rewind),
    forkAtMessage: has(OPENCLAW_SESSION_HISTORY_METHODS.forkAtMessage),
    workspace: has(OPENCLAW_SESSION_HISTORY_METHODS.listFiles)
      && has(OPENCLAW_SESSION_HISTORY_METHODS.getFile),
    viewerPresence: has(OPENCLAW_SESSION_HISTORY_METHODS.setViewerPresence),
    abortSession: has(OPENCLAW_SESSION_HISTORY_METHODS.abortSession),
  };
}
