import type { GatewayHelloObservation } from '@/types/gatewayRuntime';

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
const CONNECTED_CAPABILITIES: OpenClawSessionHistoryCapabilities = {
  branches: true,
  branchSwitch: true,
  rewind: true,
  forkAtMessage: true,
};

/**
 * 官方握手方法列表允许为空，不能作为完整能力清单。
 * 认证连接建立后允许调用官方 RPC，最终状态由该次结构化响应判定。
 */
export function readOpenClawSessionHistoryCapabilities(
  observation: GatewayHelloObservation | null,
): OpenClawSessionHistoryCapabilities {
  return observation ? CONNECTED_CAPABILITIES : EMPTY_CAPABILITIES;
}
