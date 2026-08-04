import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';
import { requireOpenClawSessionTarget } from './OpenClawSessionTarget';

export const OPENCLAW_SESSIONS_FILES_LIST_METHOD = 'sessions.files.list' as const;
export const OPENCLAW_SESSIONS_FILES_GET_METHOD = 'sessions.files.get' as const;

export type OpenClawSessionFileKind = 'modified' | 'read';
export type OpenClawSessionFileContentEncoding = 'utf8' | 'base64';
export type OpenClawSessionFilePreviewKind = 'text' | 'image' | 'unsupported';
export type OpenClawSessionFileRelevance = 'modified' | 'read' | 'mixed';

export interface OpenClawSessionFile {
  readonly path: string;
  readonly workspacePath?: string;
  readonly name: string;
  readonly kind: OpenClawSessionFileKind;
  readonly missing: boolean;
  readonly size?: number;
  readonly updatedAtMs?: number;
  readonly content?: string;
  readonly hash?: string;
  readonly mimeType?: string;
  readonly contentEncoding?: OpenClawSessionFileContentEncoding;
  readonly previewKind?: OpenClawSessionFilePreviewKind;
}

export interface OpenClawSessionFileBrowserEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: 'file' | 'directory';
  readonly sessionKind?: OpenClawSessionFileRelevance;
  readonly size?: number;
  readonly updatedAtMs?: number;
}

export interface OpenClawSessionFileBrowser {
  readonly path: string;
  readonly parentPath?: string;
  readonly search?: string;
  readonly entries: readonly OpenClawSessionFileBrowserEntry[];
  readonly truncated?: boolean;
}

export interface OpenClawSessionFilesList {
  readonly sessionKey: string;
  readonly root?: string;
  readonly gitCheckout?: boolean;
  readonly files: readonly OpenClawSessionFile[];
  readonly browser?: OpenClawSessionFileBrowser;
}

export interface OpenClawSessionFilesGet {
  readonly sessionKey: string;
  readonly root?: string;
  readonly file: OpenClawSessionFile;
}

export interface OpenClawSessionFilesClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (
    method: string,
    params: Record<string, unknown>,
    connectionId: string,
  ) => Promise<unknown>;
}

export class OpenClawSessionFilesResponseError extends Error {
  readonly code = 'OPENCLAW_SESSION_FILES_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid sessions.files response');
    this.name = 'OpenClawSessionFilesResponseError';
  }
}

export class OpenClawSessionFilesUnavailableError extends Error {
  readonly code = 'OPENCLAW_SESSION_FILES_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawSessionFilesUnavailableError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optionalText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return nonEmptyText(value);
}

function optionalBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'boolean' ? value : null;
}

function optionalNonNegativeInteger(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return nonNegativeInteger(value);
}

function sessionFileKind(value: unknown): OpenClawSessionFileKind | null {
  return value === 'modified' || value === 'read' ? value : null;
}

function previewKind(value: unknown): OpenClawSessionFilePreviewKind | undefined | null {
  if (value === undefined) return undefined;
  return value === 'text' || value === 'image' || value === 'unsupported' ? value : null;
}

function contentEncoding(value: unknown): OpenClawSessionFileContentEncoding | undefined | null {
  if (value === undefined) return undefined;
  return value === 'utf8' || value === 'base64' ? value : null;
}

function relevance(value: unknown): OpenClawSessionFileRelevance | undefined | null {
  if (value === undefined) return undefined;
  return value === 'modified' || value === 'read' || value === 'mixed' ? value : null;
}

function parseFile(value: unknown): OpenClawSessionFile {
  const source = record(value);
  const path = nonEmptyText(source?.path);
  const name = nonEmptyText(source?.name);
  const kind = sessionFileKind(source?.kind);
  const workspacePath = optionalText(source?.workspacePath);
  const size = optionalNonNegativeInteger(source?.size);
  const updatedAtMs = optionalNonNegativeInteger(source?.updatedAtMs);
  const hash = optionalText(source?.hash);
  const mimeType = optionalText(source?.mimeType);
  const filePreviewKind = previewKind(source?.previewKind);
  const fileContentEncoding = contentEncoding(source?.contentEncoding);
  const content = source?.content;

  if (
    !source
    || !path
    || !name
    || !kind
    || typeof source.missing !== 'boolean'
    || workspacePath === null
    || size === null
    || updatedAtMs === null
    || hash === null
    || (hash !== undefined && !/^[a-f0-9]{64}$/.test(hash))
    || mimeType === null
    || filePreviewKind === null
    || fileContentEncoding === null
    || (content !== undefined && typeof content !== 'string')
  ) {
    throw new OpenClawSessionFilesResponseError();
  }

  return {
    path,
    name,
    kind,
    missing: source.missing,
    ...(workspacePath === undefined ? {} : { workspacePath }),
    ...(size === undefined ? {} : { size }),
    ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
    ...(typeof content === 'string' ? { content } : {}),
    ...(hash === undefined ? {} : { hash }),
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(fileContentEncoding === undefined ? {} : { contentEncoding: fileContentEncoding }),
    ...(filePreviewKind === undefined ? {} : { previewKind: filePreviewKind }),
  };
}

function parseBrowserEntry(value: unknown): OpenClawSessionFileBrowserEntry {
  const source = record(value);
  const name = nonEmptyText(source?.name);
  const kind = source?.kind;
  const sessionKind = relevance(source?.sessionKind);
  const size = optionalNonNegativeInteger(source?.size);
  const updatedAtMs = optionalNonNegativeInteger(source?.updatedAtMs);

  if (
    !source
    || typeof source.path !== 'string'
    || !name
    || (kind !== 'file' && kind !== 'directory')
    || sessionKind === null
    || size === null
    || updatedAtMs === null
  ) {
    throw new OpenClawSessionFilesResponseError();
  }

  return {
    path: source.path,
    name,
    kind,
    ...(sessionKind === undefined ? {} : { sessionKind }),
    ...(size === undefined ? {} : { size }),
    ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
  };
}

function parseBrowser(value: unknown): OpenClawSessionFileBrowser {
  const source = record(value);
  const parentPath = source?.parentPath;
  const search = source?.search;
  const truncated = optionalBoolean(source?.truncated);
  if (
    !source
    || typeof source.path !== 'string'
    || !Array.isArray(source.entries)
    || (parentPath !== undefined && typeof parentPath !== 'string')
    || (search !== undefined && typeof search !== 'string')
    || truncated === null
  ) {
    throw new OpenClawSessionFilesResponseError();
  }
  return {
    path: source.path,
    entries: source.entries.map(parseBrowserEntry),
    ...(typeof parentPath === 'string' ? { parentPath } : {}),
    ...(typeof search === 'string' ? { search } : {}),
    ...(truncated === undefined ? {} : { truncated }),
  };
}

function parseList(value: unknown, expectedSessionKey: string): OpenClawSessionFilesList {
  const source = record(value);
  const sessionKey = nonEmptyText(source?.sessionKey);
  const root = optionalText(source?.root);
  const gitCheckout = optionalBoolean(source?.gitCheckout);
  if (
    !source
    || sessionKey !== expectedSessionKey
    || !Array.isArray(source.files)
    || root === null
    || gitCheckout === null
    || (source.browser !== undefined && record(source.browser) === null)
  ) {
    throw new OpenClawSessionFilesResponseError();
  }
  return {
    sessionKey,
    files: source.files.map(parseFile),
    ...(root === undefined ? {} : { root }),
    ...(gitCheckout === undefined ? {} : { gitCheckout }),
    ...(source.browser === undefined ? {} : { browser: parseBrowser(source.browser) }),
  };
}

function parseGet(value: unknown, expectedSessionKey: string): OpenClawSessionFilesGet {
  const source = record(value);
  const sessionKey = nonEmptyText(source?.sessionKey);
  const root = optionalText(source?.root);
  if (!source || sessionKey !== expectedSessionKey || root === null) {
    throw new OpenClawSessionFilesResponseError();
  }
  return {
    sessionKey,
    file: parseFile(source.file),
    ...(root === undefined ? {} : { root }),
  };
}

function optionalAgentId(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND'
      || error.code === 'UNKNOWN_METHOD'
      || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export class OpenClawSessionFilesClient {
  constructor(private readonly dependencies: OpenClawSessionFilesClientDependencies) {}

  async list(
    sessionKey: string,
    options: { agentId?: string; path?: string; search?: string } = {},
  ): Promise<OpenClawSessionFilesList> {
    const key = requireOpenClawSessionTarget(sessionKey);
    const normalizedAgentId = optionalAgentId(options.agentId);
    const response = await this.request(OPENCLAW_SESSIONS_FILES_LIST_METHOD, key, {
      ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.search !== undefined ? { search: options.search } : {}),
    });
    return parseList(response, key);
  }

  async get(
    sessionKey: string,
    path: string,
    agentId?: string,
  ): Promise<OpenClawSessionFilesGet> {
    const key = requireOpenClawSessionTarget(sessionKey);
    const targetPath = nonEmptyText(path);
    if (!targetPath) throw new OpenClawSessionFilesResponseError();
    const normalizedAgentId = optionalAgentId(agentId);
    const response = await this.request(OPENCLAW_SESSIONS_FILES_GET_METHOD, key, {
      path: targetPath,
      ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
    });
    return parseGet(response, key);
  }

  private async request(
    method: typeof OPENCLAW_SESSIONS_FILES_LIST_METHOD | typeof OPENCLAW_SESSIONS_FILES_GET_METHOD,
    sessionKey: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawSessionFilesUnavailableError(
        'No attested Gateway connection is available for session files',
      );
    }
    try {
      const response = await this.dependencies.requestFenced(
        method,
        { sessionKey, ...params },
        connectionId,
      );
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawSessionFilesUnavailableError(
          'Gateway connection changed while reading session files',
        );
      }
      return response;
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawSessionFilesUnavailableError(
          `The connected OpenClaw Gateway does not support ${method}`,
        );
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawSessionFilesUnavailableError(
          'No attested Gateway connection is available for session files',
        );
      }
      throw error;
    }
  }
}
