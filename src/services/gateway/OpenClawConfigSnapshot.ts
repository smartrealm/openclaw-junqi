import type { GatewayRuntimeConfig } from '@/types/openclawConfig';

export interface OpenClawConfigSnapshot {
  exists: boolean;
  config: GatewayRuntimeConfig;
  hash?: string;
  path?: string;
  configRevisionHash?: string;
  appliedConfigHash?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGatewayRuntimeConfig(value: unknown): value is GatewayRuntimeConfig {
  return isRecord(value);
}

/** 在控制面写入或运行时交接前解码 OpenClaw config.get 信封。 */
export function readOpenClawConfigSnapshot(value: unknown): OpenClawConfigSnapshot {
  const snapshot = isRecord(value) ? value : null;
  if (!snapshot || typeof snapshot.exists !== 'boolean' || snapshot.valid !== true) {
    throw new Error('OpenClaw config snapshot is unavailable');
  }

  if (!isGatewayRuntimeConfig(snapshot.config)) {
    throw new Error('OpenClaw config snapshot is unavailable');
  }

  const hash = typeof snapshot.hash === 'string' && snapshot.hash.trim()
    ? snapshot.hash
    : undefined;
  if (snapshot.exists && !hash) {
    throw new Error('OpenClaw config hash is unavailable; reload configuration and retry');
  }
  const configRevisionHash = typeof snapshot.configRevisionHash === 'string'
    && snapshot.configRevisionHash.trim()
    ? snapshot.configRevisionHash
    : undefined;
  const appliedConfigHash = typeof snapshot.appliedConfigHash === 'string'
    && snapshot.appliedConfigHash.trim()
    ? snapshot.appliedConfigHash
    : snapshot.appliedConfigHash === null
      ? null
      : undefined;

  return {
    exists: snapshot.exists,
    config: snapshot.config,
    ...(hash ? { hash } : {}),
    ...(typeof snapshot.path === 'string' && snapshot.path.trim() ? { path: snapshot.path } : {}),
    ...(configRevisionHash ? { configRevisionHash } : {}),
    ...(appliedConfigHash !== undefined ? { appliedConfigHash } : {}),
  };
}
