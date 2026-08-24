import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';
import {
  OpenClawAuditResponseError,
  parseOpenClawAuditActivityPage,
  type OpenClawAuditDirection,
  type OpenClawAuditEvent as OpenClawAuditActivityEvent,
  type OpenClawAuditKind,
  type OpenClawAuditStatus,
} from './OpenClawAuditActivityCodec';
import {
  parseAuditListPage,
  type OpenClawAuditEvent as OpenClawLegacyAuditEvent,
} from '@/processing/auditLedger';

export {
  OpenClawAuditResponseError,
  parseOpenClawAuditActivityPage,
  type OpenClawAuditActor,
  type OpenClawAuditDirection,
  type OpenClawAuditEventType,
  type OpenClawAuditKind,
  type OpenClawAuditStatus,
} from './OpenClawAuditActivityCodec';

/** 旧 Gateway 的 audit.list 仅包含运行和工具元数据，不能冒充新版活动账本。 */
export type OpenClawAuditLegacyEvent = OpenClawLegacyAuditEvent & {
  readonly source: 'legacy';
};

export type OpenClawAuditEvent = OpenClawAuditActivityEvent | OpenClawAuditLegacyEvent;

export interface OpenClawAuditListPage {
  readonly events: readonly OpenClawAuditEvent[];
  readonly nextCursor?: string;
  readonly source: 'activity' | 'legacy';
}

export const OPENCLAW_AUDIT_ACTIVITY_METHOD = 'audit.activity.list' as const;

export interface OpenClawAuditListInput {
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly runId?: string;
  readonly kind?: OpenClawAuditKind;
  readonly status?: OpenClawAuditStatus;
  readonly direction?: OpenClawAuditDirection;
  readonly channel?: string;
  readonly after?: number;
  readonly before?: number;
  readonly limit?: number;
  readonly cursor?: string;
}

export type OpenClawAuditRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawAuditUnsupportedError extends Error {
  readonly code = 'OPENCLAW_AUDIT_UNSUPPORTED';

  constructor() {
    super('The connected OpenClaw Gateway does not support activity audit queries');
    this.name = 'OpenClawAuditUnsupportedError';
  }
}

function isOpenClawAuditActivityUnavailableError(error: unknown): boolean {
  return isOpenClawUnknownMethodError(error, OPENCLAW_AUDIT_ACTIVITY_METHOD);
}

const STATUSES: readonly OpenClawAuditStatus[] = [
  'started', 'succeeded', 'failed', 'cancelled', 'timed_out', 'blocked', 'unknown',
];
const KINDS: readonly OpenClawAuditKind[] = ['agent_run', 'tool_action', 'message'];
const DIRECTIONS: readonly OpenClawAuditDirection[] = ['inbound', 'outbound'];

function requestParams(input: OpenClawAuditListInput): Record<string, unknown> {
  const textInput = (value: string | undefined, name: string, max = 2_048): string | undefined => {
    if (value === undefined) return undefined;
    const normalized = value.trim();
    if (!normalized || normalized.length > max) throw new Error(`Invalid OpenClaw audit ${name}`);
    return normalized;
  };
  const agentId = textInput(input.agentId, 'agent id');
  const sessionKey = textInput(input.sessionKey, 'session key');
  const runId = textInput(input.runId, 'run id');
  const channel = textInput(input.channel, 'channel', 256);
  if (input.kind !== undefined && !KINDS.includes(input.kind)) throw new Error('Invalid OpenClaw audit kind');
  if (input.status !== undefined && !STATUSES.includes(input.status)) throw new Error('Invalid OpenClaw audit status');
  if (input.direction !== undefined && !DIRECTIONS.includes(input.direction)) throw new Error('Invalid OpenClaw audit direction');
  for (const value of [input.after, input.before]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error('Invalid OpenClaw audit time bound');
  }
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500)) {
    throw new Error('Invalid OpenClaw audit limit');
  }
  const cursor = textInput(input.cursor, 'cursor');
  return {
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(runId ? { runId } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.direction ? { direction: input.direction } : {}),
    ...(channel ? { channel } : {}),
    ...(input.after !== undefined ? { after: input.after } : {}),
    ...(input.before !== undefined ? { before: input.before } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/** 只有旧协议原样支持的筛选条件才能使用官方兼容账本。 */
function supportsLegacyAuditFallback(input: OpenClawAuditListInput): boolean {
  return input.kind !== 'message' && input.direction === undefined && input.channel === undefined;
}

function parseOpenClawLegacyAuditPage(value: unknown): OpenClawAuditListPage {
  try {
    const page = parseAuditListPage(value);
    return {
      source: 'legacy',
      events: page.events.map((event) => ({ ...event, source: 'legacy' as const })),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  } catch {
    throw new OpenClawAuditResponseError();
  }
}

export class OpenClawAuditClient {
  constructor(private readonly request: OpenClawAuditRequester) {}

  async list(input: OpenClawAuditListInput = {}): Promise<OpenClawAuditListPage> {
    const params = requestParams(input);
    try {
      return parseOpenClawAuditActivityPage(
        await this.request(OPENCLAW_AUDIT_ACTIVITY_METHOD, params),
      );
    } catch (error) {
      if (isOpenClawAuditActivityUnavailableError(error)) {
        if (!supportsLegacyAuditFallback(input)) throw new OpenClawAuditUnsupportedError();
        return parseOpenClawLegacyAuditPage(await this.request('audit.list', params));
      }
      throw error;
    }
  }
}
