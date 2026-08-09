import type { DingTalkPluginInstallProgress } from '@/components/BusinessApplications/DingTalkReadinessPanel';

export function dingtalkPluginInstallPresentation(progress: DingTalkPluginInstallProgress) {
  const active = progress.phase === 'checking' || progress.phase === 'installing';
  const completed = progress.phase === 'completed';
  const failed = progress.phase === 'failed';
  const progressValue = progress.phase === 'checking'
    ? 25
    : progress.phase === 'installing'
      ? 60
      : progress.phase === 'completed'
        ? 100
        : 0;
  const phaseLabel = completed
    ? '安装完成，等待重启 Gateway'
    : failed
      ? '安装未完成'
      : active
        ? progress.message ?? '正在等待 Gateway 返回安装结果'
        : '等待确认安装';
  return { active, completed, failed, progressValue, phaseLabel };
}
