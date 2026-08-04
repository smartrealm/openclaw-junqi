export type GatewaySessionContextBudgetRoute =
  | 'fits'
  | 'compact_only'
  | 'truncate_tool_results_only'
  | 'compact_then_truncate';

export interface GatewaySessionContextBudgetStatus {
  route: GatewaySessionContextBudgetRoute;
  shouldCompact: boolean;
}

export type GatewaySessionContextBudgetNotice = 'compact' | 'trim-tools' | 'compact-and-trim-tools' | null;

const ROUTES = new Set<GatewaySessionContextBudgetRoute>([
  'fits',
  'compact_only',
  'truncate_tool_results_only',
  'compact_then_truncate',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** 仅接受 OpenClaw 预提示估算生成的完整上下文预算状态。 */
export function parseGatewaySessionContextBudgetStatus(value: unknown): GatewaySessionContextBudgetStatus | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.source !== 'pre-prompt-estimate'
    || typeof value.provider !== 'string' || !value.provider.trim()
    || typeof value.model !== 'string' || !value.model.trim()
    || typeof value.route !== 'string' || !ROUTES.has(value.route as GatewaySessionContextBudgetRoute)
    || typeof value.shouldCompact !== 'boolean'
    || !isNonNegativeInteger(value.updatedAt)
    || !isNonNegativeInteger(value.estimatedPromptTokens)
    || !isNonNegativeInteger(value.contextTokenBudget)
    || !isNonNegativeInteger(value.promptBudgetBeforeReserve)
    || !isNonNegativeInteger(value.reserveTokens)
    || !isNonNegativeInteger(value.effectiveReserveTokens)
    || !isNonNegativeInteger(value.remainingPromptBudgetTokens)
    || !isNonNegativeInteger(value.overflowTokens)
    || !isNonNegativeInteger(value.toolResultReducibleChars)
    || !isNonNegativeInteger(value.messageCount)
    || !isNonNegativeInteger(value.unwindowedMessageCount)) return null;
  return { route: value.route as GatewaySessionContextBudgetRoute, shouldCompact: value.shouldCompact };
}

/** 将 Gateway 已决定的预算路线收敛为只读界面提示种类。 */
export function getGatewaySessionContextBudgetNotice(
  status: GatewaySessionContextBudgetStatus | null | undefined,
): GatewaySessionContextBudgetNotice {
  if (!status) return null;
  if (status.route === 'compact_only' && status.shouldCompact) return 'compact';
  if (status.route === 'truncate_tool_results_only' && !status.shouldCompact) return 'trim-tools';
  if (status.route === 'compact_then_truncate' && status.shouldCompact) return 'compact-and-trim-tools';
  return null;
}
