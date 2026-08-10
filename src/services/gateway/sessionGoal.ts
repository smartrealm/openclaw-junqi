export type GatewaySessionGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usage_limited'
  | 'budget_limited'
  | 'complete';

export interface GatewaySessionGoal {
  id: string;
  objective: string;
  status: GatewaySessionGoalStatus;
}

const STATUSES = new Set<GatewaySessionGoalStatus>([
  'active',
  'paused',
  'blocked',
  'usage_limited',
  'budget_limited',
  'complete',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/**
 * 只接受 OpenClaw 持久化会话目标的完整必填字段及类型正确的可选字段。
 * 本地 UI 投影和协作 Run 均不得转换为该 Gateway 状态。
 */
export function parseGatewaySessionGoal(value: unknown): GatewaySessionGoal | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.id !== 'string' || !value.id.trim()
    || typeof value.objective !== 'string' || !value.objective.trim()
    || typeof value.status !== 'string' || !STATUSES.has(value.status as GatewaySessionGoalStatus)
    || !isNonNegativeInteger(value.createdAt)
    || !isNonNegativeInteger(value.updatedAt)
    || !isNonNegativeInteger(value.tokenStart)
    || !isNonNegativeInteger(value.tokensUsed)
    || !isNonNegativeInteger(value.continuationTurns)
    || !isOptionalBoolean(value.tokenStartFresh)
    || !isOptionalNonNegativeInteger(value.tokenBudget)
    || !isOptionalString(value.lastStatusNote)
    || !isOptionalNonNegativeInteger(value.pausedAt)
    || !isOptionalNonNegativeInteger(value.blockedAt)
    || !isOptionalNonNegativeInteger(value.completedAt)
    || !isOptionalNonNegativeInteger(value.usageLimitedAt)
    || !isOptionalNonNegativeInteger(value.budgetLimitedAt)) return null;
  return {
    id: value.id,
    objective: value.objective,
    status: value.status as GatewaySessionGoalStatus,
  };
}
