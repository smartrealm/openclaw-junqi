export interface GatewayThinkingLevelOption {
  id: string;
  label: string;
}

export interface GatewaySessionThinkingProfile {
  level: string | null;
  levels: readonly GatewayThinkingLevelOption[] | null;
  defaultLevel: string | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 只接受 Gateway 明确下发的结构化思考能力集，避免客户端推测模型能力。 */
export function parseGatewayThinkingLevels(value: unknown): readonly GatewayThinkingLevelOption[] | null {
  if (!Array.isArray(value)) return null;

  const seen = new Set<string>();
  const levels: GatewayThinkingLevelOption[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = nonEmptyString(item.id);
    const label = nonEmptyString(item.label);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    levels.push({ id, label });
  }
  return levels.length > 0 ? levels : null;
}

/** 将 `sessions.list` 的会话思考字段投影为严格的客户端模型。 */
export function parseGatewaySessionThinkingProfile(value: unknown): GatewaySessionThinkingProfile {
  if (!isRecord(value)) {
    return { level: null, levels: null, defaultLevel: null };
  }
  return {
    level: nonEmptyString(value.thinkingLevel),
    levels: parseGatewayThinkingLevels(value.thinkingLevels),
    defaultLevel: nonEmptyString(value.thinkingDefault),
  };
}
