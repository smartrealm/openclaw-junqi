import { gateway } from './index';
import { readOpenClawConfigSnapshot } from './OpenClawConfigSnapshot';

export interface OpenClawConfigApplicationEvidence {
  configRevisionHash?: string;
  appliedConfigHash?: string | null;
  reloadDisabled: boolean;
}

type FencedGatewayRequest = (
  method: string,
  params: Record<string, unknown>,
  connectionId: string,
) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 只接受 OpenClaw health 的结构化监听器状态，不从文本或超时推断禁用。 */
export function isOpenClawConfigReloaderDisabled(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.configReload)) return false;
  return value.configReload.hotReloadStatus === 'disabled';
}

/**
 * 在同一条已核验连接上读取磁盘修订、活动修订和官方重载状态。
 * health 只补充恢复依据；读取失败不能把未知状态猜成禁用。
 */
export async function readOpenClawConfigApplicationEvidence(
  connectionId: string,
  request: FencedGatewayRequest = (method, params, expectedConnectionId) => (
    gateway.callFenced(method, params, expectedConnectionId)
  ),
): Promise<OpenClawConfigApplicationEvidence> {
  const snapshot = readOpenClawConfigSnapshot(await request(
    'config.get',
    {},
    connectionId,
  ));
  let reloadDisabled = snapshot.config.gateway?.reload?.mode === 'off';
  const applicationPending = Boolean(snapshot.configRevisionHash)
    && snapshot.appliedConfigHash !== undefined
    && snapshot.configRevisionHash !== snapshot.appliedConfigHash;

  if (!reloadDisabled && applicationPending) {
    try {
      reloadDisabled = isOpenClawConfigReloaderDisabled(await request(
        'health',
        {},
        connectionId,
      ));
    } catch {
      reloadDisabled = false;
    }
  }

  return {
    ...(snapshot.configRevisionHash ? { configRevisionHash: snapshot.configRevisionHash } : {}),
    ...(snapshot.appliedConfigHash !== undefined
      ? { appliedConfigHash: snapshot.appliedConfigHash }
      : {}),
    reloadDisabled,
  };
}
