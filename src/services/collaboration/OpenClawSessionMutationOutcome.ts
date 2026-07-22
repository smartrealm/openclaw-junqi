import type { SessionMutationAction } from './SessionMutationCoordinator';

export type OpenClawSessionMutationOutcome =
  | { state: 'committed'; nextSessionId: string | null }
  | { state: 'not-committed' }
  | { state: 'unknown' };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Resolve a transport-ambiguous mutation from the official
 * `sessions.describe` response. A replacement identity proves that the old
 * transcript was changed; malformed or missing reset state remains unknown.
 */
export function resolveOpenClawSessionMutationOutcome(
  action: SessionMutationAction,
  expectedSessionId: string,
  description: unknown,
): OpenClawSessionMutationOutcome {
  const response = record(description);
  if (!response || !Object.prototype.hasOwnProperty.call(response, 'session')) {
    return { state: 'unknown' };
  }
  if (response.session === null) {
    return action === 'delete'
      ? { state: 'committed', nextSessionId: null }
      : { state: 'unknown' };
  }
  const session = record(response.session);
  const actualSessionId = typeof session?.sessionId === 'string'
    ? session.sessionId.trim()
    : '';
  if (!actualSessionId) return { state: 'unknown' };
  if (actualSessionId === expectedSessionId) return { state: 'not-committed' };
  return { state: 'committed', nextSessionId: actualSessionId };
}
