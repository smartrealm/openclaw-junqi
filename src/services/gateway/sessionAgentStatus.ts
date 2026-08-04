export interface GatewaySessionAgentStatus {
  note: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 只投影 Gateway 已过滤且带非空说明的会话 Agent 状态。 */
export function parseGatewaySessionAgentStatus(value: unknown): GatewaySessionAgentStatus | null {
  if (!isRecord(value)) return null;
  const note = value.note;
  return typeof note === 'string' && note.trim() ? { note: note.trim() } : null;
}
