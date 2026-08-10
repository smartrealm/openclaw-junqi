import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
} from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

export const OPENCLAW_AGENT_FILES_LIST_METHOD = 'agents.files.list' as const;
export const OPENCLAW_AGENT_FILES_GET_METHOD = 'agents.files.get' as const;

export interface OpenClawAgentBootstrapFile {
  readonly name: string;
  readonly missing: boolean;
  readonly expectedAbsent?: boolean;
  readonly size?: number;
  readonly updatedAtMs?: number;
  readonly content?: string;
}

export interface OpenClawAgentBootstrapFilesList {
  readonly agentId: string;
  readonly files: readonly OpenClawAgentBootstrapFile[];
}

export interface OpenClawAgentBootstrapFileGet {
  readonly agentId: string;
  readonly file: OpenClawAgentBootstrapFile;
}

export interface OpenClawAgentFilesClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawAgentFilesUnavailableError extends Error {
  readonly code = 'OPENCLAW_AGENT_FILES_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawAgentFilesUnavailableError';
  }
}

export class OpenClawAgentFilesResponseError extends Error {
  readonly code = 'OPENCLAW_AGENT_FILES_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid agents.files response');
    this.name = 'OpenClawAgentFilesResponseError';
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

function fileName(value: unknown): string | null {
  return typeof value === 'string'
    && value.trim()
    && !/[\\/\u0000-\u001f]/.test(value)
    ? value
    : null;
}

function optionalBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'boolean' ? value : null;
}

function optionalNonNegativeInteger(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return nonNegativeInteger(value);
}

function parseFile(value: unknown, requireContent = false): OpenClawAgentBootstrapFile {
  const source = record(value);
  const name = fileName(source?.name);
  const path = nonEmptyText(source?.path);
  const expectedAbsent = optionalBoolean(source?.expectedAbsent);
  const size = optionalNonNegativeInteger(source?.size);
  const updatedAtMs = optionalNonNegativeInteger(source?.updatedAtMs);
  const content = source?.content;
  if (
    !source
    || !name
    || !path
    || typeof source.missing !== 'boolean'
    || expectedAbsent === null
    || size === null
    || updatedAtMs === null
    || (content !== undefined && typeof content !== 'string')
    || (requireContent && !source.missing && typeof content !== 'string')
  ) {
    throw new OpenClawAgentFilesResponseError();
  }
  return {
    name,
    missing: source.missing,
    ...(expectedAbsent === undefined ? {} : { expectedAbsent }),
    ...(size === undefined ? {} : { size }),
    ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
    ...(typeof content === 'string' ? { content } : {}),
  };
}

function parseList(value: unknown, expectedAgentId: string): OpenClawAgentBootstrapFilesList {
  const source = record(value);
  const agentId = nonEmptyText(source?.agentId);
  const workspace = nonEmptyText(source?.workspace);
  if (!source || agentId !== expectedAgentId || !workspace || !Array.isArray(source.files)) {
    throw new OpenClawAgentFilesResponseError();
  }
  return { agentId, files: source.files.map((file) => parseFile(file)) };
}

function parseGet(value: unknown, expectedAgentId: string, expectedName: string): OpenClawAgentBootstrapFileGet {
  const source = record(value);
  const agentId = nonEmptyText(source?.agentId);
  const workspace = nonEmptyText(source?.workspace);
  const file = parseFile(source?.file, true);
  if (!source || agentId !== expectedAgentId || !workspace || file.name !== expectedName) {
    throw new OpenClawAgentFilesResponseError();
  }
  return { agentId, file };
}

function agentId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new OpenClawAgentFilesResponseError();
  return normalized;
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

/** 只读取 OpenClaw Gateway 公开的 Agent 引导文件，不扩散主机路径。 */
export class OpenClawAgentFilesClient {
  constructor(private readonly dependencies: OpenClawAgentFilesClientDependencies) {}

  async list(agentIdInput: string): Promise<OpenClawAgentBootstrapFilesList> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) throw this.unavailable('No attested Gateway connection is available for agents.files.list');
    return this.listForConnection(agentIdInput, connectionId);
  }

  async get(agentIdInput: string, nameInput: string): Promise<OpenClawAgentBootstrapFileGet> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) throw this.unavailable('No attested Gateway connection is available for agents.files.get');
    return this.getForConnection(agentIdInput, nameInput, connectionId);
  }

  async listForConnection(agentIdInput: string, connectionId: string): Promise<OpenClawAgentBootstrapFilesList> {
    const targetAgentId = agentId(agentIdInput);
    return this.request(
      OPENCLAW_AGENT_FILES_LIST_METHOD,
      { agentId: targetAgentId },
      connectionId,
      (response) => parseList(response, targetAgentId),
    );
  }

  async getForConnection(
    agentIdInput: string,
    nameInput: string,
    connectionId: string,
  ): Promise<OpenClawAgentBootstrapFileGet> {
    const targetAgentId = agentId(agentIdInput);
    const name = fileName(nameInput);
    if (!name) throw new OpenClawAgentFilesResponseError();
    return this.request(
      OPENCLAW_AGENT_FILES_GET_METHOD,
      { agentId: targetAgentId, name },
      connectionId,
      (response) => parseGet(response, targetAgentId, name),
    );
  }

  private unavailable(message: string): OpenClawAgentFilesUnavailableError {
    return new OpenClawAgentFilesUnavailableError(message);
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
