import { assertVerifiedSessionMutationResult, gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { sessionMutationGate } from '@/services/chat/sessionMutationGate';

export type SessionLifecycleMutationAction = 'delete' | 'reset';

export interface SessionLifecycleMutationOutcome {
  success: boolean;
  cancelled: boolean;
  sessionId: string | null;
  previousSessionId: string | null;
  coreResult?: unknown;
}

interface SessionLifecycleDependencies {
  listSessions(): Promise<unknown>;
  deleteSession(sessionKey: string, deleteTranscript: true, expectedSessionId: string): Promise<unknown>;
  resetSession(sessionKey: string): Promise<unknown>;
}

const defaultDependencies: SessionLifecycleDependencies = {
  listSessions: () => gateway.getSessions(),
  deleteSession: (sessionKey, deleteTranscript, expectedSessionId) => (
    gateway.deleteSession(sessionKey, deleteTranscript, expectedSessionId)
  ),
  resetSession: (sessionKey) => gateway.resetSession(sessionKey),
};

let dependencies = defaultDependencies;

export function setSessionLifecycleDependenciesForTests(
  overrides?: Partial<SessionLifecycleDependencies>,
): void {
  dependencies = overrides ? { ...defaultDependencies, ...overrides } : defaultDependencies;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function resetSessionId(result: unknown): string | null {
  const entry = record(record(result)?.entry);
  const sessionId = entry?.sessionId;
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null;
}

function knownSessionId(sessionKey: string): string | null {
  const chatSession = useChatStore.getState().sessions.find((session) => session.key === sessionKey);
  if (typeof chatSession?.sessionId === 'string' && chatSession.sessionId.trim()) {
    return chatSession.sessionId.trim();
  }
  const gatewaySession = useGatewayDataStore.getState().sessions.find((session) => session.key === sessionKey);
  if (typeof gatewaySession?.sessionId === 'string' && gatewaySession.sessionId.trim()) {
    return gatewaySession.sessionId.trim();
  }
  return null;
}

async function resolveSessionId(sessionKey: string): Promise<string | null> {
  const known = knownSessionId(sessionKey);
  if (known) return known;
  const response = record(await dependencies.listSessions());
  const sessions = Array.isArray(response?.sessions) ? response.sessions : [];
  const match = sessions
    .map(record)
    .find((session) => (session?.key ?? session?.sessionKey) === sessionKey);
  const sessionId = match?.sessionId;
  if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
  useChatStore.getState().setSessionIdentity(
    sessionKey,
    sessionId.trim(),
    typeof match?.agentId === 'string' ? match.agentId : undefined,
  );
  return sessionId.trim();
}

export async function executeSessionLifecycleMutation(
  sessionKey: string,
  action: SessionLifecycleMutationAction,
): Promise<SessionLifecycleMutationOutcome> {
  const key = sessionKey.trim();
  if (!key) throw new Error('sessionKey is required');

  return sessionMutationGate.run(key, () => executeGuardedSessionLifecycleMutation(key, action));
}

async function executeGuardedSessionLifecycleMutation(
  key: string,
  action: SessionLifecycleMutationAction,
): Promise<SessionLifecycleMutationOutcome> {
  // OpenClaw 的 sessions.delete 和 sessions.reset 各自负责运行中工作及生命周期互斥。
  // 客户端只提交官方请求并以结构化结果决定本地投影是否收敛。
  const sessionId = action === 'delete' ? await resolveSessionId(key) : knownSessionId(key);
  if (action === 'delete' && !sessionId) {
    throw new Error('The native OpenClaw session identity is unavailable. Refresh sessions and try again.');
  }
  const coreResult = action === 'delete'
    ? await dependencies.deleteSession(key, true, sessionId!)
    : await dependencies.resetSession(key);
  assertVerifiedSessionMutationResult(coreResult, action, key);
  return {
    success: true,
    cancelled: false,
    sessionId: action === 'reset' ? resetSessionId(coreResult) : sessionId,
    previousSessionId: sessionId,
    coreResult,
  };
}
