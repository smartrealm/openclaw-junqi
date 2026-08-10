function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** 只接受 OpenClaw Gateway 当前未知方法错误，并绑定到本次实际请求的方法。 */
export function isOpenClawUnknownMethodError(value: unknown, method: string): boolean {
  const requestedMethod = method.trim();
  if (!requestedMethod) return false;
  const source = record(value);
  return source?.code === 'INVALID_REQUEST'
    && source.message === `unknown method: ${requestedMethod}`;
}
