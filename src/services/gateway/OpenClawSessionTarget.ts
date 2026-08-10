export class OpenClawSessionTargetError extends Error {
  readonly code = 'OPENCLAW_SESSION_TARGET_REQUIRED';

  constructor(message = 'OPENCLAW_SESSION_TARGET_REQUIRED') {
    super(message);
    this.name = 'OpenClawSessionTargetError';
  }
}

export interface OpenClawSessionTarget {
  /** JunQi 本地缓存、队列和 UI 使用的稳定作用域身份。 */
  readonly localKey: string;
  /** 发送到 OpenClaw 的规范会话 key。 */
  readonly key: string;
  /** 仅全局会话或调用方已明确指定时发送到 OpenClaw 的智能体作用域。 */
  readonly agentId?: string;
}

const GLOBAL_SESSION_KEY = 'global';
const GLOBAL_SESSION_ALIAS = /^agent:([^:\s]+):global$/i;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OpenClawSessionTargetError(`${field} is required`);
  }
  return value.trim();
}

function optionalAgentId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const agentId = requiredText(value, 'OpenClaw session agent id');
  if (agentId.includes(':')) {
    throw new OpenClawSessionTargetError('OpenClaw session agent id cannot contain a colon');
  }
  return agentId;
}

function requiredAgentId(value: unknown): string {
  const agentId = optionalAgentId(value);
  if (!agentId) {
    throw new OpenClawSessionTargetError('OpenClaw session agent id is required');
  }
  return agentId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameAgentId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** 构造 OpenClaw Control UI 已定义的全局会话本地作用域别名。 */
export function createOpenClawGlobalSessionAlias(agentId: string): string {
  return `agent:${requiredAgentId(agentId)}:${GLOBAL_SESSION_KEY}`;
}

/**
 * 将 JunQi 本地会话身份还原为 OpenClaw RPC 目标。
 *
 * `agent:<id>:global` 是 OpenClaw 已支持的 Control UI 别名；裸 `global`
 * 没有智能体所有者时不能安全路由，因此明确拒绝而非回落到默认智能体。
 */
export function resolveOpenClawSessionTarget(
  value: unknown,
  explicitAgentId?: string | null,
): OpenClawSessionTarget {
  const localKey = requiredText(value, 'OpenClaw session target');
  const requestedAgentId = optionalAgentId(explicitAgentId);
  const globalAlias = GLOBAL_SESSION_ALIAS.exec(localKey);
  if (globalAlias) {
    const aliasAgentId = requiredAgentId(globalAlias[1]);
    if (requestedAgentId && !sameAgentId(aliasAgentId, requestedAgentId)) {
      throw new OpenClawSessionTargetError('OpenClaw global session agent scope does not match its alias');
    }
    return { localKey, key: GLOBAL_SESSION_KEY, agentId: aliasAgentId };
  }
  if (localKey.toLowerCase() === GLOBAL_SESSION_KEY) {
    if (!requestedAgentId) {
      throw new OpenClawSessionTargetError('OpenClaw global session target requires an agent scope');
    }
    return {
      localKey: createOpenClawGlobalSessionAlias(requestedAgentId),
      key: GLOBAL_SESSION_KEY,
      agentId: requestedAgentId,
    };
  }
  return requestedAgentId
    ? { localKey, key: localKey, agentId: requestedAgentId }
    : { localKey, key: localKey };
}

/** 保留当前发送协调器所需的非空目标校验；具体 Gateway 作用域仍由解析函数决定。 */
export function requireOpenClawSessionTarget(value: unknown): string {
  return resolveOpenClawSessionTarget(value).localKey;
}

/**
 * 将已由请求目标证明所有者的裸全局会话行投影为本地作用域身份。
 * 仅当调用方已携带同一智能体范围时才允许使用，避免从响应内容猜测所有者。
 */
export function scopeOpenClawGlobalSessionRow<T extends Record<string, unknown>>(value: T, requestedAgentId: string): T;
export function scopeOpenClawGlobalSessionRow(value: unknown, requestedAgentId: string): unknown;
export function scopeOpenClawGlobalSessionRow(value: unknown, requestedAgentId: string): unknown {
  if (!isRecord(value)) {
    throw new OpenClawSessionTargetError('OpenClaw sessions.list returned an invalid session row');
  }
  const key = requiredText(value.key, 'OpenClaw session key');
  if (key.toLowerCase() !== GLOBAL_SESSION_KEY) return value;
  const scopedAgentId = requiredAgentId(requestedAgentId);
  const returnedAgentId = optionalAgentId(value.agentId);
  if (returnedAgentId && !sameAgentId(returnedAgentId, scopedAgentId)) {
    throw new OpenClawSessionTargetError('OpenClaw global session row returned a conflicting agent scope');
  }
  return {
    ...value,
    key: createOpenClawGlobalSessionAlias(scopedAgentId),
    agentId: scopedAgentId,
  };
}
