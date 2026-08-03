import { GatewayRpcError } from './Connection';

export type OpenClawSessionListRequester = (
  method: 'sessions.list',
  params: Record<string, boolean>,
) => Promise<unknown>;

export interface OpenClawSessionListResponses {
  readonly active: unknown;
  readonly archived?: unknown;
}

const ACTIVE_SESSION_LIST_PARAMS: Record<string, boolean> = {};
const ARCHIVED_SESSION_LIST_PARAMS: Record<string, boolean> = { archived: true };

function isArchivedFilterUnsupported(error: unknown): error is GatewayRpcError {
  if (!(error instanceof GatewayRpcError)) return false;
  const code = error.code?.trim().toUpperCase();
  if (code === 'METHOD_NOT_FOUND' || code === 'UNKNOWN_METHOD' || code === 'UNKNOWN_COMMAND') {
    return true;
  }
  if (code !== 'INVALID_PARAMS' && code !== 'INVALID_REQUEST' && code !== 'VALIDATION_ERROR') {
    return false;
  }
  return /\barchived\b/i.test(error.message);
}

/**
 * Reads the native active and archived session projections without inventing a
 * tri-state filter. Older Gateways that explicitly reject `archived` retain a
 * usable active-session view; authorization and transport errors still surface.
 */
export async function listOpenClawSessionLifecycle(
  request: OpenClawSessionListRequester,
): Promise<OpenClawSessionListResponses> {
  const active = await request('sessions.list', ACTIVE_SESSION_LIST_PARAMS);
  try {
    const archived = await request('sessions.list', ARCHIVED_SESSION_LIST_PARAMS);
    return { active, archived };
  } catch (error) {
    if (isArchivedFilterUnsupported(error)) return { active };
    throw error;
  }
}
