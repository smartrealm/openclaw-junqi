import { GatewayRpcError } from './Connection';

type GatewayRequester = <T>(method: string, params: Record<string, unknown>) => Promise<T>;
type SessionMutationRunner = <T>(sessionKey: string, operation: () => Promise<T>) => Promise<T>;

export interface SessionTranscriptHistoryClientDependencies {
  readonly request: GatewayRequester;
  readonly requestPrivileged: GatewayRequester;
  readonly runMutation: SessionMutationRunner;
}

export interface SessionTranscriptBranch {
  readonly leafEntryId: string;
  readonly headline: string;
  readonly messageCount: number;
  readonly updatedAt?: string;
  readonly active: boolean;
}

export interface SessionTranscriptForkResult {
  readonly sessionKey: string;
  readonly editorText?: string;
  readonly editorAttachments?: ReadonlyArray<{ mimeType: string; data: string }>;
}

export interface SessionTranscriptRewindResult {
  readonly editorText?: string;
  readonly editorAttachments?: ReadonlyArray<{ mimeType: string; data: string }>;
}

export class SessionTranscriptHistoryResponseError extends Error {
  constructor(readonly method: string) {
    super(`${method} returned an invalid result`);
    this.name = 'SessionTranscriptHistoryResponseError';
  }
}

export class SessionTranscriptHistoryProtocolUnsupportedError extends Error {
  readonly code = 'SESSION_TRANSCRIPT_HISTORY_PROTOCOL_UNSUPPORTED';

  constructor(readonly cause: GatewayRpcError) {
    super(cause.message);
    this.name = 'SessionTranscriptHistoryProtocolUnsupportedError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function optionalAgentId(agentId?: string): { agentId?: string } {
  const normalized = agentId?.trim();
  return normalized ? { agentId: normalized } : {};
}

function isUnsupported(error: unknown): error is GatewayRpcError {
  if (!(error instanceof GatewayRpcError)) return false;
  return ['METHOD_NOT_FOUND', 'UNKNOWN_METHOD', 'UNKNOWN_COMMAND'].includes(error.code?.trim().toUpperCase() ?? '');
}

function parseEditor(value: unknown, method: string): Pick<SessionTranscriptForkResult, 'editorText' | 'editorAttachments'> {
  if (!isRecord(value)) throw new SessionTranscriptHistoryResponseError(method);
  const editorText = value.editorText;
  if (editorText !== undefined && typeof editorText !== 'string') {
    throw new SessionTranscriptHistoryResponseError(method);
  }
  if (value.editorAttachments === undefined) return editorText === undefined ? {} : { editorText };
  if (!Array.isArray(value.editorAttachments)) throw new SessionTranscriptHistoryResponseError(method);
  const editorAttachments = value.editorAttachments.map((attachment) => {
    if (!isRecord(attachment) || typeof attachment.mimeType !== 'string' || typeof attachment.data !== 'string') {
      throw new SessionTranscriptHistoryResponseError(method);
    }
    return { mimeType: attachment.mimeType, data: attachment.data };
  });
  return { ...(editorText === undefined ? {} : { editorText }), editorAttachments };
}

export function buildSessionTranscriptEntryParams(sessionKey: string, entryId: string, agentId?: string) {
  return {
    sessionKey: requiredText(sessionKey, 'session key'),
    entryId: requiredText(entryId, 'entry id'),
    ...optionalAgentId(agentId),
  };
}

export function buildSessionTranscriptParams(sessionKey: string, agentId?: string) {
  return { sessionKey: requiredText(sessionKey, 'session key'), ...optionalAgentId(agentId) };
}

export function parseSessionTranscriptBranches(value: unknown): SessionTranscriptBranch[] {
  if (!isRecord(value) || !Array.isArray(value.branches)) {
    throw new SessionTranscriptHistoryResponseError('sessions.branches.list');
  }
  return value.branches.map((branch) => {
    if (!isRecord(branch)) throw new SessionTranscriptHistoryResponseError('sessions.branches.list');
    const messageCount = branch.messageCount;
    if (typeof branch.leafEntryId !== 'string' || !branch.leafEntryId.trim()
      || typeof branch.headline !== 'string'
      || typeof messageCount !== 'number' || !Number.isSafeInteger(messageCount) || messageCount < 0
      || typeof branch.active !== 'boolean'
      || (branch.updatedAt !== undefined && typeof branch.updatedAt !== 'string')) {
      throw new SessionTranscriptHistoryResponseError('sessions.branches.list');
    }
    return {
      leafEntryId: branch.leafEntryId,
      headline: branch.headline,
      messageCount,
      ...(typeof branch.updatedAt === 'string' ? { updatedAt: branch.updatedAt } : {}),
      active: branch.active,
    };
  });
}

export class SessionTranscriptHistoryClient {
  constructor(private readonly deps: SessionTranscriptHistoryClientDependencies) {}

  private async request<T>(method: string, params: Record<string, unknown>, privileged = false): Promise<T> {
    try {
      return await (privileged ? this.deps.requestPrivileged<T>(method, params) : this.deps.request<T>(method, params));
    } catch (error) {
      if (isUnsupported(error)) throw new SessionTranscriptHistoryProtocolUnsupportedError(error);
      throw error;
    }
  }

  async listBranches(sessionKey: string, agentId?: string): Promise<SessionTranscriptBranch[]> {
    return parseSessionTranscriptBranches(await this.request(
      'sessions.branches.list', buildSessionTranscriptParams(sessionKey, agentId),
    ));
  }

  async forkAtMessage(sessionKey: string, entryId: string, agentId?: string): Promise<SessionTranscriptForkResult> {
    return this.deps.runMutation(sessionKey, async () => {
      const result = await this.request('sessions.fork', buildSessionTranscriptEntryParams(sessionKey, entryId, agentId));
      if (!isRecord(result) || typeof result.sessionKey !== 'string' || !result.sessionKey.trim()) {
        throw new SessionTranscriptHistoryResponseError('sessions.fork');
      }
      return { sessionKey: result.sessionKey.trim(), ...parseEditor(result, 'sessions.fork') };
    });
  }

  async rewindToMessage(sessionKey: string, entryId: string, agentId?: string): Promise<SessionTranscriptRewindResult> {
    return this.deps.runMutation(sessionKey, async () => parseEditor(
      await this.request(
        'sessions.rewind', buildSessionTranscriptEntryParams(sessionKey, entryId, agentId), true,
      ),
      'sessions.rewind',
    ));
  }

  async switchBranch(sessionKey: string, leafEntryId: string, agentId?: string): Promise<void> {
    await this.deps.runMutation(sessionKey, async () => {
      const result = await this.request('sessions.branches.switch', {
        ...buildSessionTranscriptParams(sessionKey, agentId),
        leafEntryId: requiredText(leafEntryId, 'branch entry id'),
      }, true);
      if (!isRecord(result)) throw new SessionTranscriptHistoryResponseError('sessions.branches.switch');
    });
  }
}
