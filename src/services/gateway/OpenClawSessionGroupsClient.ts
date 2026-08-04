import { GatewayRpcError } from './Connection';

export interface OpenClawSessionGroup {
  readonly name: string;
  readonly position: number;
}

export type OpenClawSessionGroupsRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawSessionGroupsUnsupportedError extends Error {
  readonly code = 'OPENCLAW_SESSION_GROUPS_UNSUPPORTED';

  constructor() {
    super('The connected OpenClaw Gateway does not support sessions.groups.list');
    this.name = 'OpenClawSessionGroupsUnsupportedError';
  }
}

export class OpenClawSessionGroupsResponseError extends Error {
  readonly code = 'OPENCLAW_SESSION_GROUPS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid session group catalog');
    this.name = 'OpenClawSessionGroupsResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function parseGroup(value: unknown): OpenClawSessionGroup {
  const source = record(value);
  const name = typeof source?.name === 'string' ? source.name.trim() : '';
  const position = source?.position;
  if (!name || typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0) {
    throw new OpenClawSessionGroupsResponseError();
  }
  return { name, position };
}

/** Decode the complete official sessions.groups.list catalog in display order. */
export function parseOpenClawSessionGroups(value: unknown): readonly OpenClawSessionGroup[] {
  const source = record(value);
  if (!source || !Array.isArray(source.groups)) throw new OpenClawSessionGroupsResponseError();
  const groups = source.groups.map(parseGroup);
  return [...groups].sort((left, right) => left.position - right.position);
}

/** Read-only OpenClaw group catalog adapter. It never synthesizes a local catalog. */
export class OpenClawSessionGroupsClient {
  constructor(private readonly request: OpenClawSessionGroupsRequester) {}

  async list(): Promise<readonly OpenClawSessionGroup[]> {
    try {
      return parseOpenClawSessionGroups(
        await this.request<unknown>('sessions.groups.list', {}),
      );
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawSessionGroupsUnsupportedError();
      throw error;
    }
  }
}
