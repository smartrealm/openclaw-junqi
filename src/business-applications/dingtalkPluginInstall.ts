import type { RuntimeIdentity } from '@/types/gatewayRuntime';

export function dingtalkPluginInstallBlocker(identity: RuntimeIdentity | null): string {
  if (!identity) return '未读取当前 Gateway 身份。请先完成 Gateway 连接与身份核验。';
  if (!identity.verified) {
    const issues = identity.issues.join('、');
    return issues ? `当前 Gateway 身份未核验：${issues}。` : '当前 Gateway 身份未核验。';
  }
  if (identity.installTarget === 'remote_manual') return '当前连接是外部或远程 Gateway，JunQi 不能修改其插件。请在该 Gateway 宿主中完成安装。';
  if (identity.endpointAttestation !== 'matched') return '当前 Gateway 端点未与 JunQi 管理的运行时核验匹配。';
  if (identity.pathAttestation !== 'matched') return '当前 Gateway 运行时路径未与 JunQi 管理的运行时核验匹配。';
  return '当前 Gateway 不允许桌面安装插件。';
}
