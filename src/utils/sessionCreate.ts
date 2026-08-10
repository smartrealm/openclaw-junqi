import { gateway } from '@/services/gateway';
import type { OpenClawCreatedSession } from '@/services/gateway/OpenClawSessionLifecycleClient';
import { useChatStore, type Session } from '@/stores/chatStore';
import { useGatewayDataStore, type SessionInfo } from '@/stores/gatewayDataStore';
import { notifyNativeSessionCommit } from '@/utils/sessionLifecycle';
import { sessionListMutationFence } from '@/utils/sessionListMutationFence';

export interface CreateNativeSessionInput {
  readonly agentId: string;
  /**
   * Explicit title only. Omit it for ordinary sessions so OpenClaw can derive
   * the title from the first user message.
   */
  readonly label?: string;
  readonly parentSessionKey?: string;
  /** Copy the parent transcript instead of only recording a parent relation. */
  readonly fork?: boolean;
}

export type CreateNativeSessionResult =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly error: string };

type SessionCreateDependencies = {
  createRemote: (input: CreateNativeSessionInput) => Promise<OpenClawCreatedSession>;
  commit: (created: OpenClawCreatedSession, input: CreateNativeSessionInput) => Session;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Gateway rejected session creation';
}

export function projectCreatedNativeSession(
  created: OpenClawCreatedSession,
  input: CreateNativeSessionInput,
): Session {
  const entry = created.entry;
  return {
    key: created.key,
    sessionId: created.sessionId,
    label: entry.label?.trim() ?? '',
    agentId: created.agentId,
    // 创建时间只能来自 OpenClaw 的创建回执，不能以更新时间或本机时间伪造。
    ...(typeof entry.createdAt === 'number' ? { createdAt: entry.createdAt } : {}),
    ...(input.fork === true ? {} : { activeLeafEntryId: null }),
    ...(entry.model ? { model: entry.model } : {}),
    ...(entry.parentSessionKey ? { parentSessionKey: entry.parentSessionKey } : {}),
  };
}

function projectGatewaySession(session: Session): SessionInfo {
  return {
    key: session.key,
    sessionId: session.sessionId,
    label: session.label,
    agentId: session.agentId,
    createdAt: session.createdAt,
    activeLeafEntryId: session.activeLeafEntryId,
    ...(session.model ? { model: session.model } : {}),
    ...(session.parentSessionKey ? { parentSessionKey: session.parentSessionKey } : {}),
  };
}

const defaultDependencies: SessionCreateDependencies = {
  createRemote: (input) => gateway.createSession(input),
  commit: (created, input) => {
    const session = projectCreatedNativeSession(created, input);
    useChatStore.getState().addNativeSession(session);
    const gatewayState = useGatewayDataStore.getState();
    gatewayState.setSessions([
      ...gatewayState.sessions.filter((candidate) => candidate.key !== session.key),
      projectGatewaySession(session),
    ]);
    return session;
  },
};

let dependencies = defaultDependencies;

export function setSessionCreateDependenciesForTests(
  overrides?: Partial<SessionCreateDependencies>,
): void {
  dependencies = overrides ? { ...defaultDependencies, ...overrides } : defaultDependencies;
}

/** Creates a real Gateway session and only then exposes it to the desktop UI. */
export function createNativeSession(input: CreateNativeSessionInput): Promise<CreateNativeSessionResult> {
  const agentId = input.agentId.trim();
  const label = input.label?.trim();
  if (!agentId) {
    return Promise.resolve({ ok: false, error: 'agentId is required' });
  }

  const request: CreateNativeSessionInput = {
    agentId,
    ...(label ? { label } : {}),
    ...(input.parentSessionKey?.trim() ? { parentSessionKey: input.parentSessionKey.trim() } : {}),
    ...(input.fork === true ? { fork: true } : {}),
  };
  if (request.fork === true && !request.parentSessionKey) {
    return Promise.resolve({ ok: false, error: 'fork requires parentSessionKey' });
  }

  return dependencies.createRemote(request)
    .then((created) => {
      const session = dependencies.commit(created, request);
      sessionListMutationFence.invalidate();
      notifyNativeSessionCommit();
      return { ok: true as const, session };
    })
    .catch((error) => ({ ok: false as const, error: errorMessage(error) }));
}
