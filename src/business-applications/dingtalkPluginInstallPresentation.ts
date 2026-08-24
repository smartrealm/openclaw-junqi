import type { DingTalkPluginInstallProgress } from '@/components/BusinessApplications/DingTalkReadinessPanel';

export function dingtalkPluginInstallPresentation(progress: DingTalkPluginInstallProgress) {
  const active = progress.phase === 'checking' || progress.phase === 'installing';
  const completed = progress.phase === 'completed';
  const failed = progress.phase === 'failed';
  const progressValue = completed ? 100 : failed ? 0 : null;
  const phaseLabelKey = completed
    ? 'completed'
    : failed
      ? 'failed'
      : active
        ? 'waiting'
        : 'idle';
  return { active, completed, failed, progressValue, phaseLabelKey };
}
