import { assertVerifiedSessionMutationResult, gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { useCollaborationStore } from '@/stores/collaborationStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import type { CollaborationCapabilities } from './types';
import type {
  SessionMutationAction,
  SessionMutationExecutionResult,
  SessionMutationRequest,
} from './SessionMutationCoordinator';
import { requestSessionMutationDialog } from './sessionMutationDialogStore';
import { isCollaborationMethodUnavailable as isExactCollaborationMethodUnavailable } from './client';
import { sessionMutationGate } from '@/services/chat/sessionMutationGate';

export interface SessionLifecycleMutationOutcome {
  success: boolean;
  cancelled: boolean;
  coordinated: boolean;
  sessionId: string | null;
  result?: SessionMutationExecutionResult;
  coreResult?: unknown;
}

interface SessionLifecycleDependencies {
  bootstrapCollaboration(): Promise<CollaborationCapabilities>;
  requestDialog(request: SessionMutationRequest): Promise<SessionMutationExecutionResult | null>;
  listSessions(): Promise<unknown>;
  deleteSession(sessionKey: string, deleteTranscript: true): Promise<unknown>;
  resetSession(sessionKey: string): Promise<unknown>;
}

const defaultDependencies: SessionLifecycleDependencies = {
  bootstrapCollaboration: () => useCollaborationStore.getState().bootstrap(),
  requestDialog: requestSessionMutationDialog,
  listSessions: () => gateway.getSessions(),
  deleteSession: (sessionKey, deleteTranscript) => gateway.deleteSession(sessionKey, deleteTranscript),
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

/** Only an exact missing collaboration method is eligible for the native path. */
export function isCollaborationMethodUnavailable(error: unknown): boolean {
  return isExactCollaborationMethodUnavailable(error, ['junqi.collab.capabilities']);
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
  action: SessionMutationAction,
): Promise<SessionLifecycleMutationOutcome> {
  const key = sessionKey.trim();
  if (!key) throw new Error('sessionKey is required');

  return sessionMutationGate.run(key, () => executeGuardedSessionLifecycleMutation(key, action));
}

async function executeGuardedSessionLifecycleMutation(
  key: string,
  action: SessionMutationAction,
): Promise<SessionLifecycleMutationOutcome> {

  const sessionId = await resolveSessionId(key);
  let capabilities: CollaborationCapabilities | null = null;
  try {
    capabilities = await dependencies.bootstrapCollaboration();
    if (!capabilities || typeof capabilities !== 'object') {
      throw new Error('Collaboration capabilities returned an invalid response');
    }
  } catch (error) {
    if (isCollaborationMethodUnavailable(error)) return executeNativeSessionMutation(key, action, sessionId);
    throw error;
  }

  if (capabilities) {
    if (!sessionId) {
      throw new Error('The native OpenClaw session identity is unavailable. Refresh sessions and try again.');
    }
    const request: SessionMutationRequest = {
      collaborationInstanceId: capabilities.collaborationInstanceId,
      runtimeId: capabilities.collaborationInstanceId,
      sessionKey: key,
      sessionId,
      action,
    };
    const result = await dependencies.requestDialog(request);
    return {
      success: result?.success === true,
      cancelled: result === null || result.status === 'ABORTED',
      coordinated: true,
      sessionId,
      ...(result ? { result } : {}),
    };
  }

  throw new Error('Collaboration capabilities are unavailable. Session mutation was not attempted.');
}

async function executeNativeSessionMutation(
  sessionKey: string,
  action: SessionMutationAction,
  sessionId: string | null,
): Promise<SessionLifecycleMutationOutcome> {
  if (useChatStore.getState().typingBySession[sessionKey]) {
    await gateway.abortChat(sessionKey);
  }
  const coreResult = action === 'delete'
    ? await dependencies.deleteSession(sessionKey, true)
    : await dependencies.resetSession(sessionKey);
  assertVerifiedSessionMutationResult(coreResult, action, sessionKey);
  return {
    success: true,
    cancelled: false,
    coordinated: false,
    sessionId,
    coreResult,
  };
}
