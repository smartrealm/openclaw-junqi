import type { GatewayRuntimeConfig } from '@/types/openclawConfig';
import {
  readOpenClawConfigSnapshot,
  type OpenClawConfigSnapshot,
} from './OpenClawConfigSnapshot';

interface OpenClawRuntimeConfigGateway {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  callPrivileged(method: string, params: Record<string, unknown>): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Gateway 只确认成功回执；其余结构不得被客户端解释为配置已写入。 */
function requireConfigSetAcknowledgement(value: unknown): void {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error('OpenClaw config.set response is unavailable');
  }
}

/**
 * OpenClaw 配置控制面唯一入口。读取快照与写入使用同一个 `hash`，避免桌面端
 * 绕过 Gateway 的 schema、脱敏恢复、权限和并发保护直接改写运行时文件。
 */
export class OpenClawRuntimeConfigClient {
  constructor(private readonly gateway: OpenClawRuntimeConfigGateway) {}

  async read(): Promise<OpenClawConfigSnapshot> {
    return readOpenClawConfigSnapshot(await this.gateway.call('config.get', {}));
  }

  async replace(
    config: GatewayRuntimeConfig,
    snapshot: OpenClawConfigSnapshot,
  ): Promise<void> {
    requireConfigSetAcknowledgement(await this.gateway.callPrivileged('config.set', {
      raw: JSON.stringify(config),
      ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
    }));
  }
}
