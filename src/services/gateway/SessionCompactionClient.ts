import {
  buildSessionsCompactionCheckpointParams,
  parseSessionsCompactionBranchResult,
  parseSessionsCompactionGetResult,
  parseSessionsCompactionRestoreResult,
  type SessionsCompactionBranchResult,
  type SessionsCompactionGetResult,
  type SessionsCompactionRestoreResult,
} from './sessionInspection';

export type SessionCompactionRequester = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type SessionCompactionMutationRunner = <T>(
  sessionKey: string,
  operation: () => Promise<T>,
) => Promise<T>;

export interface SessionCompactionClientDependencies {
  request: SessionCompactionRequester;
  requestPrivileged: SessionCompactionRequester;
  runMutation: SessionCompactionMutationRunner;
}

/**
 * Keeps checkpoint reads and mutations on their protocol-owned connection lanes.
 * The Gateway remains the source of truth for transcript identity and lifecycle.
 */
export class SessionCompactionClient {
  constructor(private readonly deps: SessionCompactionClientDependencies) {}

  get(sessionKey: string, checkpointId: string, agentId?: string): Promise<SessionsCompactionGetResult> {
    return this.deps.request(
      'sessions.compaction.get',
      { ...buildSessionsCompactionCheckpointParams(sessionKey, checkpointId, agentId) },
    ).then((result) => parseSessionsCompactionGetResult(result, sessionKey));
  }

  branch(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ): Promise<SessionsCompactionBranchResult> {
    return this.deps.runMutation(sessionKey, async () => parseSessionsCompactionBranchResult(
      await this.deps.request(
        'sessions.compaction.branch',
        { ...buildSessionsCompactionCheckpointParams(sessionKey, checkpointId, agentId) },
      ),
      sessionKey,
    ));
  }

  restore(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ): Promise<SessionsCompactionRestoreResult> {
    return this.deps.runMutation(sessionKey, async () => parseSessionsCompactionRestoreResult(
      await this.deps.requestPrivileged(
        'sessions.compaction.restore',
        { ...buildSessionsCompactionCheckpointParams(sessionKey, checkpointId, agentId) },
      ),
      sessionKey,
    ));
  }
}
