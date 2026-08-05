import { requireOpenClawSessionTarget } from './OpenClawSessionTarget';

export const OPENCLAW_SESSIONS_REWIND_METHOD = 'sessions.rewind' as const;
export const OPENCLAW_SESSIONS_FORK_METHOD = 'sessions.fork' as const;

export interface OpenClawSessionEditorAttachment {
  readonly mimeType: string;
  readonly data: string;
}

export interface OpenClawSessionRewindResult {
  readonly editorText?: string;
  readonly editorAttachments: readonly OpenClawSessionEditorAttachment[];
}

export interface OpenClawSessionForkResult extends OpenClawSessionRewindResult {
  readonly sessionKey: string;
}

export interface OpenClawSessionMessageCutClientDependencies {
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  requestPrivileged: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  runMutation: <T>(sessionKey: string, operation: () => Promise<T>) => Promise<T>;
}

export class OpenClawSessionMessageCutResponseError extends Error {
  readonly code = 'OPENCLAW_SESSION_MESSAGE_CUT_RESPONSE_INVALID';

  constructor(method: string) {
    super(`The OpenClaw Gateway returned an invalid ${method} response`);
    this.name = 'OpenClawSessionMessageCutResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, method: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OpenClawSessionMessageCutResponseError(method);
  }
  return value.trim();
}

function optionalString(value: unknown, method: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new OpenClawSessionMessageCutResponseError(method);
  return value;
}

function editorAttachments(value: unknown, method: string): readonly OpenClawSessionEditorAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new OpenClawSessionMessageCutResponseError(method);
  return value.map((attachment) => {
    const source = record(attachment);
    if (!source || typeof source.mimeType !== 'string' || typeof source.data !== 'string') {
      throw new OpenClawSessionMessageCutResponseError(method);
    }
    return { mimeType: source.mimeType, data: source.data };
  });
}

function parseResult(value: unknown, method: string): OpenClawSessionRewindResult {
  const source = record(value);
  if (!source) throw new OpenClawSessionMessageCutResponseError(method);
  const editorText = optionalString(source.editorText, method);
  return {
    ...(editorText === undefined ? {} : { editorText }),
    editorAttachments: editorAttachments(source.editorAttachments, method),
  };
}

function parseForkResult(value: unknown): OpenClawSessionForkResult {
  const source = record(value);
  if (!source) throw new OpenClawSessionMessageCutResponseError(OPENCLAW_SESSIONS_FORK_METHOD);
  return {
    ...parseResult(source, OPENCLAW_SESSIONS_FORK_METHOD),
    sessionKey: requiredText(source.sessionKey, OPENCLAW_SESSIONS_FORK_METHOD),
  };
}

function params(sessionKey: string, entryId: string, agentId?: string): Record<string, string> {
  const targetAgentId = agentId?.trim();
  return {
    sessionKey: requireOpenClawSessionTarget(sessionKey),
    entryId: requiredText(entryId, 'entryId'),
    ...(targetAgentId ? { agentId: targetAgentId } : {}),
  };
}

export class OpenClawSessionMessageCutClient {
  constructor(private readonly dependencies: OpenClawSessionMessageCutClientDependencies) {}

  async rewind(sessionKey: string, entryId: string, agentId?: string): Promise<OpenClawSessionRewindResult> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return this.dependencies.runMutation(targetSessionKey, async () => parseResult(
      await this.dependencies.requestPrivileged(
        OPENCLAW_SESSIONS_REWIND_METHOD,
        params(targetSessionKey, entryId, agentId),
      ),
      OPENCLAW_SESSIONS_REWIND_METHOD,
    ));
  }

  async fork(sessionKey: string, entryId: string, agentId?: string): Promise<OpenClawSessionForkResult> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    return this.dependencies.runMutation(targetSessionKey, async () => parseForkResult(
      await this.dependencies.request(
        OPENCLAW_SESSIONS_FORK_METHOD,
        params(targetSessionKey, entryId, agentId),
      ),
    ));
  }
}
