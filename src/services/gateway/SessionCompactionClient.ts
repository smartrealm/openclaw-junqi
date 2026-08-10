import {
  buildSessionsCompactionCheckpointParams,
  parseSessionsCompactionBranchResult,
  parseSessionsCompactionGetResult,
  parseSessionsCompactionRestoreResult,
  type SessionsCompactionBranchResult,
  type SessionsCompactionGetResult,
  type SessionsCompactionRestoreResult,
} from './sessionInspection';
import { resolveOpenClawSessionTarget } from './OpenClawSessionTarget';

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
    const target = resolveOpenClawSessionTarget(sessionKey, agentId);
    return this.deps.request(
      'sessions.compaction.get',
      { ...buildSessionsCompactionCheckpointParams(target.key, checkpointId, target.agentId) },
    ).then((result) => parseSessionsCompactionGetResult(result, target.key));
  }

  async branch(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ): Promise<SessionsCompactionBranchResult> {
    const target = resolveOpenClawSessionTarget(sessionKey, agentId);
    return this.deps.runMutation(target.localKey, async () => parseSessionsCompactionBranchResult(
      await this.deps.request(
        'sessions.compaction.branch',
        { ...buildSessionsCompactionCheckpointParams(target.key, checkpointId, target.agentId) },
      ),
      target.key,
    ));
  }

  async restore(
    sessionKey: string,
    checkpointId: string,
    agentId?: string,
  ): Promise<SessionsCompactionRestoreResult> {
    const target = resolveOpenClawSessionTarget(sessionKey, agentId);
    return this.deps.runMutation(target.localKey, async () => parseSessionsCompactionRestoreResult(
      await this.deps.requestPrivileged(
        'sessions.compaction.restore',
        { ...buildSessionsCompactionCheckpointParams(target.key, checkpointId, target.agentId) },
      ),
      target.key,
    ));
  }
}
