import { requireOpenClawSessionTarget } from './OpenClawSessionTarget';

export const OPENCLAW_SESSION_BRANCHES_LIST_METHOD = 'sessions.branches.list' as const;
export const OPENCLAW_SESSION_BRANCHES_SWITCH_METHOD = 'sessions.branches.switch' as const;

export interface OpenClawSessionBranch {
  readonly leafEntryId: string;
  readonly headline: string;
  readonly messageCount: number;
  readonly updatedAt?: string;
  readonly active: boolean;
}

export interface OpenClawSessionBranchesClientDependencies {
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  runMutation: <T>(sessionKey: string, operation: () => Promise<T>) => Promise<T>;
}

export class OpenClawSessionBranchesResponseError extends Error {
  readonly code = 'OPENCLAW_SESSION_BRANCHES_RESPONSE_INVALID';

  constructor(method: string) {
    super(`The OpenClaw Gateway returned an invalid ${method} response`);
    this.name = 'OpenClawSessionBranchesResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, method: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OpenClawSessionBranchesResponseError(method);
  }
  return value.trim();
}

function optionalString(value: unknown, method: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new OpenClawSessionBranchesResponseError(method);
  }
  return value;
}

function branch(value: unknown): OpenClawSessionBranch {
  const source = record(value);
  const method = OPENCLAW_SESSION_BRANCHES_LIST_METHOD;
  const messageCount = source?.messageCount;
  if (
    !source
    || typeof source.headline !== 'string'
    || typeof messageCount !== 'number'
    || !Number.isSafeInteger(messageCount)
    || messageCount < 0
    || typeof source.active !== 'boolean'
  ) {
    throw new OpenClawSessionBranchesResponseError(method);
  }
  const updatedAt = optionalString(source.updatedAt, method);
  return {
    leafEntryId: requiredText(source.leafEntryId, method),
    headline: source.headline,
    messageCount,
    active: source.active,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

export function parseOpenClawSessionBranches(value: unknown): readonly OpenClawSessionBranch[] {
  const source = record(value);
  if (!source || !Array.isArray(source.branches)) {
    throw new OpenClawSessionBranchesResponseError(OPENCLAW_SESSION_BRANCHES_LIST_METHOD);
  }
  return source.branches.map(branch);
}

function params(sessionKey: string, agentId?: string): Record<string, string> {
  const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
  const targetAgentId = agentId?.trim();
  return {
    sessionKey: targetSessionKey,
    ...(targetAgentId ? { agentId: targetAgentId } : {}),
  };
}

export class OpenClawSessionBranchesClient {
  constructor(private readonly dependencies: OpenClawSessionBranchesClientDependencies) {}

  async list(sessionKey: string, agentId?: string): Promise<readonly OpenClawSessionBranch[]> {
    return parseOpenClawSessionBranches(
      await this.dependencies.request(OPENCLAW_SESSION_BRANCHES_LIST_METHOD, params(sessionKey, agentId)),
    );
  }

  async switch(sessionKey: string, leafEntryId: string, agentId?: string): Promise<void> {
    const targetSessionKey = requireOpenClawSessionTarget(sessionKey);
    const targetLeafEntryId = requiredText(leafEntryId, OPENCLAW_SESSION_BRANCHES_SWITCH_METHOD);
    await this.dependencies.runMutation(targetSessionKey, async () => {
      const response = await this.dependencies.request(OPENCLAW_SESSION_BRANCHES_SWITCH_METHOD, {
        ...params(targetSessionKey, agentId),
        leafEntryId: targetLeafEntryId,
      });
      if (!record(response)) {
        throw new OpenClawSessionBranchesResponseError(OPENCLAW_SESSION_BRANCHES_SWITCH_METHOD);
      }
    });
  }
}
