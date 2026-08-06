import { gateway } from '@/services/gateway';
import type { OpenClawCreatedSession } from '@/services/gateway/OpenClawSessionLifecycleClient';
import { useChatStore, type Session } from '@/stores/chatStore';
import { useGatewayDataStore, type SessionInfo } from '@/stores/gatewayDataStore';
import { notifyNativeSessionCommit } from '@/utils/sessionLifecycle';
import { sessionListMutationFence } from '@/utils/sessionListMutationFence';

export interface CreateNativeSessionInput {
  readonly agentId: string;
  readonly label: string;
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
  const createdAt = typeof entry.createdAt === 'number'
    ? entry.createdAt
    : typeof entry.updatedAt === 'number'
      ? entry.updatedAt
      : Date.now();
  return {
    key: created.key,
    sessionId: created.sessionId,
    label: entry.label ?? input.label,
    ...(input.fork !== true && entry.label === input.label ? { initialLabel: input.label } : {}),
    agentId: input.agentId,
    createdAt,
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
const creationInFlight = new Map<string, Promise<CreateNativeSessionResult>>();

export function setSessionCreateDependenciesForTests(
  overrides?: Partial<SessionCreateDependencies>,
): void {
  dependencies = overrides ? { ...defaultDependencies, ...overrides } : defaultDependencies;
  creationInFlight.clear();
}

/** Creates a real Gateway session and only then exposes it to the desktop UI. */
export function createNativeSession(input: CreateNativeSessionInput): Promise<CreateNativeSessionResult> {
  const agentId = input.agentId.trim();
  const label = input.label.trim();
  if (!agentId || !label) {
    return Promise.resolve({ ok: false, error: 'agentId and label are required' });
  }

  const request: CreateNativeSessionInput = {
    agentId,
    label,
    ...(input.parentSessionKey?.trim() ? { parentSessionKey: input.parentSessionKey.trim() } : {}),
    ...(input.fork === true ? { fork: true } : {}),
  };
  if (request.fork === true && !request.parentSessionKey) {
    return Promise.resolve({ ok: false, error: 'fork requires parentSessionKey' });
  }

  // A retry is duplicate work only when every protocol-visible part of its
  // creation intent is identical. Different labels and fork semantics must
  // remain separate Gateway operations.
  const inflightKey = JSON.stringify([
    request.agentId,
    request.label,
    request.parentSessionKey ?? null,
    request.fork === true,
  ]);
  const existing = creationInFlight.get(inflightKey);
  if (existing) return existing;

  const task = dependencies.createRemote(request)
    .then((created) => {
      const session = dependencies.commit(created, request);
      sessionListMutationFence.invalidate();
      notifyNativeSessionCommit();
      return { ok: true as const, session };
    })
    .catch((error) => ({ ok: false as const, error: errorMessage(error) }))
    .finally(() => {
      if (creationInFlight.get(inflightKey) === task) creationInFlight.delete(inflightKey);
    });
  creationInFlight.set(inflightKey, task);
  return task;
}
