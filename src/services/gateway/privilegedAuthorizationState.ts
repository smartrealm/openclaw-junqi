import type { GatewayAuthorizationIssue } from './messageRouter';

/**
 * 主连接只承担日常读写请求。它返回 scope_denied 时，说明调用方走错了连接，
 * 再次批准设备权限也不会改变该连接本次握手协商出的权限范围。
 */
export function shouldPresentMainGatewayAuthorizationIssue(
  issue: GatewayAuthorizationIssue,
): boolean {
  return issue.kind === 'pairing_required';
}

export function settlePrivilegedAuthorizationIssueAfterReconnect(
  currentIssue: GatewayAuthorizationIssue | null,
  resumedPrivilegedOperation: boolean,
): GatewayAuthorizationIssue | null {
  if (currentIssue?.kind === 'scope_denied' && resumedPrivilegedOperation) {
    return currentIssue;
  }
  return null;
}
