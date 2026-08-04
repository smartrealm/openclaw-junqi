/** 仅接受 Gateway 会话行中非空的用户可见失败摘要。 */
export function parseGatewaySessionLastRunError(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
