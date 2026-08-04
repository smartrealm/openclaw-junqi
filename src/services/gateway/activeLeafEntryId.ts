import { GatewayRpcError } from './Connection';

export function parseOpenClawActiveLeafEntryId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function isOpenClawActiveLeafChangedError(error: unknown): boolean {
  if (!(error instanceof GatewayRpcError)) return false;
  const details = error.details;
  return details !== null
    && typeof details === 'object'
    && !Array.isArray(details)
    && (details as { reason?: unknown }).reason === 'active-leaf-changed';
}
