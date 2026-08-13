// Gateway 状态动作执行器：解析连接目标、启动进程并建立 WebSocket。

import { gateway } from './index';
import {
  startDockerGateway,
  startGateway,
} from '@/api/tauri-commands';
import type { ConnectionTarget, GatewayStartResult } from './types';
import {
  resolveGatewayConnectionTarget as resolveConnectionTarget,
  type GatewayConnectionTargetRequest,
} from './GatewayConnectionTargetResolver';

export { resolveConnectionTarget };

export interface GatewayConnectExecutorPort {
  resolveTarget(request: GatewayConnectionTargetRequest): Promise<ConnectionTarget>;
  persistHttpUrl(httpUrl: string): void;
  connect(wsUrl: string, token: string, deviceToken: string): void;
}

export interface GatewayConnectActionOptions {
  targetRequest?: GatewayConnectionTargetRequest;
  executor?: GatewayConnectExecutorPort;
}

const defaultGatewayConnectExecutor: GatewayConnectExecutorPort = {
  resolveTarget: (request) => resolveConnectionTarget(request),
  persistHttpUrl: (httpUrl) => localStorage.setItem('aegis-gateway-http', httpUrl),
  connect: (wsUrl, token, deviceToken) => gateway.connect(wsUrl, token, deviceToken),
};

/** 每次连接动作都重新解析目标；首次设置可显式限定为当前所选运行时。 */
export async function executeConnect(
  onHttpUrl: (url: string) => void,
  isCurrent: () => boolean = () => true,
  options: GatewayConnectActionOptions = {},
): Promise<void> {
  const executor = options.executor ?? defaultGatewayConnectExecutor;
  const target = await executor.resolveTarget(options.targetRequest ?? {});
  if (!isCurrent()) return;
  onHttpUrl(target.httpUrl);
  executor.persistHttpUrl(target.httpUrl);

  if (!isCurrent()) return;
  executor.connect(target.wsUrl, target.token, target.deviceToken);
}

/** 启动当前明确选中的 OpenClaw 运行时。 */
export async function executeStart(): Promise<GatewayStartResult> {
  try {
    const result = await startGateway();
    return { ...result, success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
export async function executeDockerStart(): Promise<GatewayStartResult> {
  try {
    const result = await startDockerGateway();
    return { ...result, success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
