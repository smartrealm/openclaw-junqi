import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

const OPENCLAW_SESSION_GROUPS_LIST_METHOD = 'sessions.groups.list';
const OPENCLAW_SESSION_GROUPS_PUT_METHOD = 'sessions.groups.put';

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

function requiredGroupName(value: string): string {
  const name = value.trim();
  if (!name) throw new OpenClawSessionGroupsResponseError();
  return name;
}

function parseMutationResult(value: unknown): readonly OpenClawSessionGroup[] {
  const source = record(value);
  if (!source || source.ok !== true) throw new OpenClawSessionGroupsResponseError();
  return parseOpenClawSessionGroups(source);
}

/** Read-only OpenClaw group catalog adapter. It never synthesizes a local catalog. */
export class OpenClawSessionGroupsClient {
  constructor(private readonly request: OpenClawSessionGroupsRequester) {}

  async list(): Promise<readonly OpenClawSessionGroup[]> {
    try {
      return parseOpenClawSessionGroups(
        await this.request<unknown>(OPENCLAW_SESSION_GROUPS_LIST_METHOD, {}),
      );
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_SESSION_GROUPS_LIST_METHOD)) {
        throw new OpenClawSessionGroupsUnsupportedError();
      }
      throw error;
    }
  }

  /** 以刚读取的 Gateway 目录追加一个名称，绝不合成客户端目录。 */
  async ensure(name: string): Promise<readonly OpenClawSessionGroup[]> {
    const target = requiredGroupName(name);
    const current = await this.list();
    if (current.some((group) => group.name === target)) return current;
    try {
      const groups = parseMutationResult(await this.request<unknown>(OPENCLAW_SESSION_GROUPS_PUT_METHOD, {
        names: [...current.map((group) => group.name), target],
      }));
      if (!groups.some((group) => group.name === target)) {
        throw new OpenClawSessionGroupsResponseError();
      }
      return groups;
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, OPENCLAW_SESSION_GROUPS_PUT_METHOD)) {
        throw new OpenClawSessionGroupsUnsupportedError();
      }
      throw error;
    }
  }
}
