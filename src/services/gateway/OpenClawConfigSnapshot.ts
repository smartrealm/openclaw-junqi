import type { GatewayRuntimeConfig } from '@/types/openclawConfig';

export interface OpenClawConfigSnapshot {
  exists: boolean;
  config: GatewayRuntimeConfig;
  hash?: string;
  path?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGatewayRuntimeConfig(value: unknown): value is GatewayRuntimeConfig {
  return isRecord(value);
}

/** Decodes the current OpenClaw config.get envelope before a control-plane write. */
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

  return {
    exists: snapshot.exists,
    config: snapshot.config,
    ...(hash ? { hash } : {}),
    ...(typeof snapshot.path === 'string' && snapshot.path.trim() ? { path: snapshot.path } : {}),
  };
}
