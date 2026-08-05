import type { GatewayHelloObservation } from '@/types/gatewayRuntime';

export const OPENCLAW_SESSION_HISTORY_METHODS = {
  listBranches: 'sessions.branches.list',
  switchBranch: 'sessions.branches.switch',
  rewind: 'sessions.rewind',
  forkAtMessage: 'sessions.fork',
} as const;

export type OpenClawSessionHistoryMethod =
  (typeof OPENCLAW_SESSION_HISTORY_METHODS)[keyof typeof OPENCLAW_SESSION_HISTORY_METHODS];

export interface OpenClawSessionCapabilities {
  readonly branches: boolean;
  readonly branchSwitch: boolean;
  readonly rewind: boolean;
  readonly forkAtMessage: boolean;
}
const EMPTY_CAPABILITIES: OpenClawSessionCapabilities = {
  branches: false,
  branchSwitch: false,
  rewind: false,
  forkAtMessage: false,
};

/**
 * 仅当认证后的 Gateway 明确声明方法时才呈现对应操作。
 * 缺失的 feature 列表代表能力未知，不能据此乐观调用 RPC。
 */
export function readOpenClawSessionCapabilities(
  observation: GatewayHelloObservation | null,
): OpenClawSessionCapabilities {
  if (!observation || observation.methods.length === 0) return EMPTY_CAPABILITIES;
  const methods = new Set(observation.methods);
  const has = (method: OpenClawSessionHistoryMethod) => methods.has(method);
  return {
    branches: has(OPENCLAW_SESSION_HISTORY_METHODS.listBranches),
    branchSwitch: has(OPENCLAW_SESSION_HISTORY_METHODS.switchBranch),
    rewind: has(OPENCLAW_SESSION_HISTORY_METHODS.rewind),
    forkAtMessage: has(OPENCLAW_SESSION_HISTORY_METHODS.forkAtMessage),
  };
}
