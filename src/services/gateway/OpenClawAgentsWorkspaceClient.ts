import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
} from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

export const OPENCLAW_AGENTS_WORKSPACE_LIST_METHOD = 'agents.workspace.list' as const;
export const OPENCLAW_AGENTS_WORKSPACE_GET_METHOD = 'agents.workspace.get' as const;

const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

type OpenClawAgentWorkspaceImageMimeType = typeof SUPPORTED_IMAGE_MIME_TYPES[number];

export interface OpenClawAgentWorkspaceEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: 'file' | 'directory';
  readonly size?: number;
  readonly updatedAtMs?: number;
}

export interface OpenClawAgentWorkspaceList {
  readonly agentId: string;
  readonly path: string;
  readonly parentPath?: string;
  readonly entries: readonly OpenClawAgentWorkspaceEntry[];
  readonly totalEntries: number;
  readonly offset: number;
}

export interface OpenClawAgentWorkspaceFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly updatedAtMs: number;
  readonly mimeType: string;
  readonly encoding: 'utf8' | 'base64';
  readonly content: string;
}

export interface OpenClawAgentsWorkspaceListInput {
  readonly agentId: string;
  readonly path?: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface OpenClawAgentsWorkspaceClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawAgentsWorkspaceUnavailableError extends Error {
  readonly code = 'OPENCLAW_AGENTS_WORKSPACE_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawAgentsWorkspaceUnavailableError';
  }
}

export class OpenClawAgentsWorkspaceResponseError extends Error {
  readonly code = 'OPENCLAW_AGENTS_WORKSPACE_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid agents.workspace response');
    this.name = 'OpenClawAgentsWorkspaceResponseError';
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

function relativePath(value: unknown, allowRoot: boolean): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f]/.test(value)) return null;
  if (value === '') return allowRoot ? '' : null;
  if (value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(value)) return null;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
    return null;
  }
  return value;
}

function entryName(value: unknown): string | null {
  return typeof value === 'string'
    && value.trim()
    && !/[\\/\u0000-\u001f]/.test(value)
    ? value
    : null;
}

function optionalNonNegativeInteger(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return nonNegativeInteger(value);
}

function isSupportedImageMimeType(value: string): value is OpenClawAgentWorkspaceImageMimeType {
  return SUPPORTED_IMAGE_MIME_TYPES.includes(value as OpenClawAgentWorkspaceImageMimeType);
}

function validBase64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function parseEntry(value: unknown): OpenClawAgentWorkspaceEntry {
  const source = record(value);
  const path = relativePath(source?.path, false);
  const name = entryName(source?.name);
  const kind = source?.kind;
  const size = optionalNonNegativeInteger(source?.size);
  const updatedAtMs = optionalNonNegativeInteger(source?.updatedAtMs);
  if (!source || !path || !name || (kind !== 'file' && kind !== 'directory') || size === null || updatedAtMs === null) {
    throw new OpenClawAgentsWorkspaceResponseError();
  }
  return {
    path,
    name,
    kind,
    ...(size === undefined ? {} : { size }),
    ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
  };
}

function parseList(value: unknown, expectedAgentId: string, expectedPath: string): OpenClawAgentWorkspaceList {
  const source = record(value);
  const agentId = nonEmptyText(source?.agentId);
  const path = relativePath(source?.path, true);
  const parentPath = source?.parentPath === undefined ? undefined : relativePath(source.parentPath, true);
  const totalEntries = nonNegativeInteger(source?.totalEntries);
  const offset = nonNegativeInteger(source?.offset);
  if (
    !source
    || agentId !== expectedAgentId
    || path !== expectedPath
    || parentPath === null
    || !Array.isArray(source.entries)
    || totalEntries === null
    || offset === null
  ) {
    throw new OpenClawAgentsWorkspaceResponseError();
  }
  return {
    agentId,
    path,
    ...(parentPath === undefined ? {} : { parentPath }),
    entries: source.entries.map(parseEntry),
    totalEntries,
    offset,
  };
}

function parseFile(value: unknown, expectedAgentId: string, expectedPath: string): OpenClawAgentWorkspaceFile {
  const source = record(value);
  const agentId = nonEmptyText(source?.agentId);
  const file = record(source?.file);
  const path = relativePath(file?.path, false);
  const name = entryName(file?.name);
  const size = nonNegativeInteger(file?.size);
  const updatedAtMs = nonNegativeInteger(file?.updatedAtMs);
  const mimeType = nonEmptyText(file?.mimeType);
  const encoding = file?.encoding;
  const content = file?.content;
  if (
    !source
    || !file
    || agentId !== expectedAgentId
    || path !== expectedPath
    || !name
    || size === null
    || updatedAtMs === null
    || !mimeType
    || (encoding !== 'utf8' && encoding !== 'base64')
    || typeof content !== 'string'
    || (encoding === 'base64' && (!isSupportedImageMimeType(mimeType) || !validBase64(content)))
  ) {
    throw new OpenClawAgentsWorkspaceResponseError();
  }
  return { path, name, size, updatedAtMs, mimeType, encoding, content };
}

function inputAgentId(value: string): string {
  const agentId = value.trim();
  if (!agentId) throw new OpenClawAgentsWorkspaceResponseError();
  return agentId;
}

function optionalPositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) throw new OpenClawAgentsWorkspaceResponseError();
  return value;
}

function optionalOffset(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new OpenClawAgentsWorkspaceResponseError();
  return value;
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

/** 仅通过 OpenClaw Gateway 的官方只读协议浏览 Agent 工作区。 */
export class OpenClawAgentsWorkspaceClient {
  constructor(private readonly dependencies: OpenClawAgentsWorkspaceClientDependencies) {}

  async list(input: OpenClawAgentsWorkspaceListInput): Promise<OpenClawAgentWorkspaceList> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) throw this.unavailable('No attested Gateway connection is available for agents.workspace.list');
    return this.listForConnection(input, connectionId);
  }

  async get(agentId: string, path: string): Promise<OpenClawAgentWorkspaceFile> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) throw this.unavailable('No attested Gateway connection is available for agents.workspace.get');
    return this.getForConnection(agentId, path, connectionId);
  }

  async listForConnection(
    input: OpenClawAgentsWorkspaceListInput,
    connectionId: string,
  ): Promise<OpenClawAgentWorkspaceList> {
    const agentId = inputAgentId(input.agentId);
    const path = relativePath(input.path ?? '', true);
    const offset = optionalOffset(input.offset);
    const limit = optionalPositiveInteger(input.limit);
    if (path === null) throw new OpenClawAgentsWorkspaceResponseError();
    return this.request(
      OPENCLAW_AGENTS_WORKSPACE_LIST_METHOD,
      {
        agentId,
        ...(path ? { path } : {}),
        ...(offset === undefined ? {} : { offset }),
        ...(limit === undefined ? {} : { limit }),
      },
      connectionId,
      (response) => parseList(response, agentId, path),
    );
  }

  async getForConnection(agentIdInput: string, pathInput: string, connectionId: string): Promise<OpenClawAgentWorkspaceFile> {
    const agentId = inputAgentId(agentIdInput);
    const path = relativePath(pathInput, false);
    if (!path) throw new OpenClawAgentsWorkspaceResponseError();
    return this.request(
      OPENCLAW_AGENTS_WORKSPACE_GET_METHOD,
      { agentId, path },
      connectionId,
      (response) => parseFile(response, agentId, path),
    );
  }

  private unavailable(message: string): OpenClawAgentsWorkspaceUnavailableError {
    return new OpenClawAgentsWorkspaceUnavailableError(message);
  }

  private async request<T>(
    method: string,
    params: Record<string, unknown>,
    connectionId: string,
    parse: (response: unknown) => T,
  ): Promise<T> {
    if (!this.dependencies.isConnectionCurrent(connectionId)) {
      throw this.unavailable(`No attested Gateway connection is available for ${method}`);
    }
    try {
      const response = await this.dependencies.requestFenced(method, params, connectionId);
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw this.unavailable(`Gateway connection changed while reading ${method}`);
      }
      return parse(response);
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, method)) {
        throw this.unavailable(`The connected OpenClaw Gateway does not support ${method}`);
      }
      if (connectionUnavailable(error)) {
        throw this.unavailable(`No attested Gateway connection is available for ${method}`);
      }
      throw error;
    }
  }
}
