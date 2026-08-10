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
/** 只有官方 config.patch 返回明确成功回执时，调用方才可继续投影本地状态。 */
export function requireOpenClawConfigPatchAcknowledgement(value: unknown): void {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error('OpenClaw config.patch response is unavailable');
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

  async patch(
    config: Record<string, unknown>,
    snapshot: OpenClawConfigSnapshot,
    replacePaths: string[] = [],
  ): Promise<void> {
    requireOpenClawConfigPatchAcknowledgement(await this.gateway.callPrivileged('config.patch', {
      raw: JSON.stringify(config),
      ...(snapshot.hash ? { baseHash: snapshot.hash } : {}),
      ...(replacePaths.length > 0 ? { replacePaths } : {}),
    }));
  }
}
