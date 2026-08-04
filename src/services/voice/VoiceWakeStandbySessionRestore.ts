export interface VoiceWakeStandbySessionCandidate {
  readonly key: string;
}

export interface VoiceWakeStandbySessionRestoreInput {
  readonly attestedConnectionId: string | null;
  readonly standbySessionKey: string | null;
  readonly sessions: readonly VoiceWakeStandbySessionCandidate[];
  readonly restoredBinding: string | null;
}

export interface VoiceWakeStandbySessionRestore {
  readonly binding: string;
  readonly sessionKey: string;
}

/**
 * 仅依据当前认证连接和 Gateway 已投影的精确 session key 恢复待命目标。
 * 不存在的本地绑定保持待验证，不能据此创建会话或覆盖用户同连接内的后续选择。
 */
export function resolveVoiceWakeStandbySessionRestore(
  input: VoiceWakeStandbySessionRestoreInput,
): VoiceWakeStandbySessionRestore | null {
  const connectionId = input.attestedConnectionId?.trim();
  const sessionKey = input.standbySessionKey?.trim();
  if (!connectionId || !sessionKey) return null;

  const binding = `${connectionId}\u0000${sessionKey}`;
  if (binding === input.restoredBinding) return null;
  if (!input.sessions.some((session) => session.key === sessionKey)) return null;

  return { binding, sessionKey };
}
