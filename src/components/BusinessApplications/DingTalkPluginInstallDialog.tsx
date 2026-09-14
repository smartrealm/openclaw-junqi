import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/shared/button/Button';
import { Alert } from '@/components/shared/alert';
import { OpenClawUpdatePanel } from '@/components/shared/OpenClawUpdatePanel';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { DingTalkPluginInstallProgress } from './DingTalkReadinessPanel';
import { dingtalkPluginInstallPresentation } from '@/business-applications/dingtalkPluginInstallPresentation';

export function DingTalkPluginInstallDialog({
  open,
  progress,
  busy,
  compatibility,
  gatewayVersion,
  pluginApiRange,
  minimumGatewayVersion,
  onOpenChange,
  onConfirm,
  onRestartGateway,
  onUpdated,
}: {
  open: boolean;
  progress: DingTalkPluginInstallProgress;
  busy: boolean;
  compatibility: 'compatible' | 'incompatible' | 'unknown' | null;
  gatewayVersion: string | null;
  pluginApiRange: string | null;
  minimumGatewayVersion: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onRestartGateway: () => void;
  onUpdated: (version: string | null) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { active, completed, failed, progressValue, phaseLabelKey } = dingtalkPluginInstallPresentation(progress);
  const phaseLabel = progress.message ?? t(`businessApplications.pluginInstall.phase.${phaseLabelKey}`);
  const Icon = completed ? CircleCheck : failed ? CircleAlert : CircleDashed;
  const incompatible = compatibility === 'incompatible';
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!active) onOpenChange(nextOpen); }}>
      <DialogContent className={`${incompatible ? 'w-[min(680px,calc(100vw-24px))]' : 'w-[min(500px,calc(100vw-24px))]'} border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text`}>
        <DialogHeader className="border-b border-aegis-border px-4 py-3 text-left">
          <DialogTitle className="text-[13px]">{t(incompatible ? 'businessApplications.pluginInstall.updateTitle' : 'businessApplications.pluginInstall.title')}</DialogTitle>
          <DialogDescription className="text-[10.5px] text-aegis-text-dim">{t(incompatible ? 'businessApplications.pluginInstall.updateDescription' : 'businessApplications.pluginInstall.description')}</DialogDescription>
        </DialogHeader>
        {incompatible ? (
          <div className="space-y-3 px-4 py-4">
            <Alert tone="warning" size="sm" title={t('businessApplications.pluginInstall.incompatibleTitle')}>
              <div className="space-y-1">
                <p>{t('businessApplications.pluginInstall.incompatibleDescription', {
                  gatewayVersion: gatewayVersion ?? '-',
                  minimumGatewayVersion: minimumGatewayVersion ?? '-',
                })}</p>
                <p className="font-mono text-[10px] opacity-80">
                  {t('businessApplications.pluginInstall.pluginApiRequirement', { range: pluginApiRange ?? '-' })}
                </p>
              </div>
            </Alert>
            <div className="overflow-hidden rounded-md border border-aegis-border">
              <OpenClawUpdatePanel
                compact
                autoCheck
                currentVersion={gatewayVersion}
                onUpdated={onUpdated}
              />
            </div>
          </div>
        ) : <div className="space-y-3 px-4 py-4">
          <div className="rounded-md border border-aegis-border bg-aegis-surface/45 p-3" role="status" aria-live="polite">
            <div className="flex items-center gap-2 text-[10.5px] text-aegis-text-secondary">
              <Icon size={14} className={active ? 'animate-spin text-aegis-primary' : completed ? 'text-aegis-success' : failed ? 'text-aegis-danger' : 'text-aegis-text-dim'} aria-hidden="true" />
              <span>{phaseLabel}</span>
            </div>
            <div className="relative mt-2 h-1.5 overflow-hidden rounded-sm bg-aegis-border/65" role="progressbar" aria-label={t('businessApplications.pluginInstall.progressLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue ?? undefined} aria-valuetext={phaseLabel}>
              {active
                ? <span className="aegis-indeterminate-progress absolute inset-y-0 w-2/5 bg-aegis-primary" />
                : <div className="h-full bg-aegis-primary transition-[width] duration-200" style={{ width: `${progressValue ?? 0}%` }} />}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[9.5px] text-aegis-text-dim">
              <span className={progress.phase === 'idle' ? 'text-aegis-text-secondary' : 'text-aegis-success'}>{t('businessApplications.pluginInstall.checkGateway')}</span>
              <span className={progress.phase === 'installing' ? 'text-aegis-primary' : completed ? 'text-aegis-success' : undefined}>{t('businessApplications.pluginInstall.installAndEnable')}</span>
              <span className={completed ? 'text-aegis-success' : undefined}>{t('businessApplications.pluginInstall.restartGateway')}</span>
            </div>
          </div>
          {failed && <p className="text-[10.5px] leading-5 text-aegis-danger">{progress.message}</p>}
          {active && <p className="text-[10px] leading-5 text-aegis-text-dim">{t('businessApplications.pluginInstall.activeBoundary')}</p>}
          {completed && <p className="text-[10px] leading-5 text-aegis-text-dim">{t('businessApplications.pluginInstall.completedHint')}</p>}
        </div>}
        <div className="flex justify-end gap-2 border-t border-aegis-border px-4 py-3">
          {(!active || incompatible) && <Button size="xs" variant="outline" tone="neutral" onClick={() => onOpenChange(false)}>{completed && !incompatible ? t('businessApplications.pluginInstall.restartLater') : t('businessApplications.pluginInstall.cancel')}</Button>}
          {!incompatible && (completed ? <Button size="xs" variant="solid" tone="primary" loading={busy} onClick={onRestartGateway}>{t('businessApplications.pluginInstall.restartGateway')}</Button> : !active && <Button size="xs" variant="solid" tone="primary" loading={busy} onClick={onConfirm}>{failed ? t('businessApplications.pluginInstall.reinstall') : t('businessApplications.pluginInstall.confirmInstall')}</Button>)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
