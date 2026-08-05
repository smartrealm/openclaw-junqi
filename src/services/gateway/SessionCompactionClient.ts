import {
  buildSessionsCompactionCheckpointParams,
  parseSessionsCompactionBranchResult,
  parseSessionsCompactionGetResult,
  parseSessionsCompactionRestoreResult,
  type SessionsCompactionBranchResult,
  type SessionsCompactionGetResult,
  type SessionsCompactionRestoreResult,
} from './sessionInspection';
import { requireOpenClawSessionTarget } from './OpenClawSessionTarget';

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
 * 检查点读取和写入保留在其协议所属的连接通道。
 * Gateway 始终是转录身份与生命周期的唯一事实来源。
 */
export class SessionCompactionClient {
  constructor(private readonly deps: SessionCompactionClientDependencies) {}

  async get(sessionKey: string, checkpointId: string, agentId?: string): Promise<SessionsCompactionGetResult> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return this.deps.request(
      'sessions.compaction.get',
      { ...buildSessionsCompactionCheckpointParams(targetSessionKey, checkpointId, agentId) },
    ).then((result) => parseSessionsCompactionGetResult(result, targetSessionKey));
  }

  async branch(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ): Promise<SessionsCompactionBranchResult> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return this.deps.runMutation(targetSessionKey, async () => parseSessionsCompactionBranchResult(
      await this.deps.request(
        'sessions.compaction.branch',
        { ...buildSessionsCompactionCheckpointParams(targetSessionKey, checkpointId, agentId) },
      ),
      targetSessionKey,
    ));
  }

  async restore(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ): Promise<SessionsCompactionRestoreResult> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return this.deps.runMutation(targetSessionKey, async () => parseSessionsCompactionRestoreResult(
      await this.deps.requestPrivileged(
        'sessions.compaction.restore',
        { ...buildSessionsCompactionCheckpointParams(targetSessionKey, checkpointId, agentId) },
      ),
      targetSessionKey,
    ));
  }
}
