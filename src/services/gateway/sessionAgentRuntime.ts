export interface GatewaySessionAgentRuntime {
  id: string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 仅投影 Gateway 已确认的 runtime id，不推测执行后端或回退策略。 */
export function parseGatewaySessionAgentRuntime(value: unknown): GatewaySessionAgentRuntime | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  return id ? { id } : null;
}
