import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  ClipboardCopy,
  HeartPulse,
  LockKeyhole,
  Loader2,
  Power,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  runMaintenanceScan,
  type MaintenanceCategory,
  type MaintenanceFinding,
  type MaintenanceReport,
  type MaintenanceSeverity,
} from '@/api/tauri-commands';
import { showAlert, showConfirm } from '@/components/shared/AlertDialog';
import { GlassCard } from '@/components/shared/GlassCard';
import { GatewayLifecyclePanel } from './GatewayLifecyclePanel';
import { runOpenClawRepair, useOpenClawRepairing } from '@/services/gateway/openclawRepair';
import { useCollaborationMaintenance } from '@/hooks/useCollaborationMaintenance';

const CATEGORY_ORDER: MaintenanceCategory[] = ['config', 'plugin', 'mcp', 'security', 'gateway', 'doctor'];

interface MaintenanceCenterProps {
  onOpenConfig?: (category: MaintenanceCategory) => void;
  onRecoverGateway?: () => Promise<unknown> | unknown;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function severityRank(severity: MaintenanceSeverity): number {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}

function severityClasses(severity: MaintenanceSeverity): string {
  if (severity === 'error') return 'border-aegis-danger/25 bg-aegis-danger/[0.06] text-aegis-danger';
  if (severity === 'warning') return 'border-aegis-warning/25 bg-aegis-warning/[0.06] text-aegis-warning';
  return 'border-aegis-border/40 bg-aegis-bg/35 text-aegis-text-dim';
}

function FindingIcon({ severity }: { severity: MaintenanceSeverity }) {
  if (severity === 'error') return <CircleAlert size={16} />;
  if (severity === 'warning') return <AlertTriangle size={16} />;
  return <CheckCircle2 size={16} />;
}

export function MaintenanceCenter({ onOpenConfig, onRecoverGateway }: MaintenanceCenterProps) {
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState<MaintenanceReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const globalRepairing = useOpenClawRepairing();
  const [gatewayRecovering, setGatewayRecovering] = useState(false);
  const [gatewayRecoveryError, setGatewayRecoveryError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const collaborationMaintenance = useCollaborationMaintenance();

  const scan = useCallback(async () => {
    if (scanning || repairing) return;
    setScanning(true);
    setRequestError(null);
    try {
      setReport(await runMaintenanceScan());
    } catch (error) {
      setRequestError(errorMessage(error));
    } finally {
      setScanning(false);
    }
  }, [repairing, scanning]);

  useEffect(() => {
    void scan();
    // Run once when the maintenance tab mounts. Manual rescan owns later runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupedFindings = useMemo(() => {
    const grouped = new Map<MaintenanceCategory, MaintenanceFinding[]>();
    for (const finding of report?.findings ?? []) {
      const items = grouped.get(finding.category) ?? [];
      items.push(finding);
      grouped.set(finding.category, items);
    }
    for (const items of grouped.values()) {
      items.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    }
    return CATEGORY_ORDER.flatMap((category) => {
      const findings = grouped.get(category);
      return findings?.length ? [{ category, findings }] : [];
    });
  }, [report]);

  const repair = useCallback(() => {
    showConfirm(
      t('maintenance.repairConfirmTitle', '运行官方修复'),
      t('maintenance.repairConfirmMessage', '将运行 OpenClaw 官方修复流程。配置可能被修改，完成后会自动重新扫描。'),
      () => {
        void (async () => {
          setRepairing(true);
          setRequestError(null);
          try {
            const repaired = await collaborationMaintenance.runGuarded(
              'openclaw-repair',
              () => runOpenClawRepair(),
            );
            if (!repaired) {
              showAlert(
                t('maintenance.repairFailedTitle', '修复未完成'),
                t('maintenance.repairFailedMessage', '官方修复命令未成功完成，请根据复检结果手动处理。'),
                'warning',
              );
            }
          } catch (error) {
            showAlert(t('maintenance.repairFailedTitle', '修复未完成'), errorMessage(error), 'error');
          } finally {
            try {
              setReport(await runMaintenanceScan());
            } catch (error) {
              setRequestError(errorMessage(error));
            } finally {
              setRepairing(false);
            }
          }
        })();
      },
    );
  }, [collaborationMaintenance, t]);

  const copyReport = useCallback(async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      showAlert(t('maintenance.copiedTitle', '已复制检修报告'), '', 'success');
    } catch (error) {
      showAlert(t('maintenance.copyFailedTitle', '复制失败'), errorMessage(error), 'error');
    }
  }, [report, t]);

  const recoverGateway = useCallback(async () => {
    if (!onRecoverGateway || gatewayRecovering) return;
    setGatewayRecovering(true);
    setGatewayRecoveryError(null);
    try {
      const result = await onRecoverGateway();
      if (result && typeof result === 'object' && 'healthy' in result && result.healthy === false) {
        throw new Error('error' in result && result.error ? String(result.error) : 'Gateway recovery failed');
      }
    } catch (error) {
      setGatewayRecoveryError(errorMessage(error));
    } finally {
      setGatewayRecovering(false);
    }
  }, [gatewayRecovering, onRecoverGateway]);

  const busy = scanning || repairing || globalRepairing;
  const canRepair = Boolean(report && (report.configValid === false || report.doctorOk === false));
  const checkedTime = report
    ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(report.checkedAtMs)
    : null;

  return (
    <div className="space-y-6">
      <GlassCard delay={0.05}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className={clsx(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
              report?.healthy
                ? 'border-aegis-success/25 bg-aegis-success/10 text-aegis-success'
                : report
                  ? 'border-aegis-warning/25 bg-aegis-warning/10 text-aegis-warning'
                  : 'border-aegis-border/40 bg-aegis-bg/40 text-aegis-text-dim',
            )}>
              {scanning ? <Loader2 size={18} className="animate-spin" /> : report?.healthy ? <ShieldCheck size={18} /> : <Stethoscope size={18} />}
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-aegis-text">
                {scanning
                  ? t('maintenance.scanning', '正在检修')
                  : report?.healthy
                    ? t('maintenance.healthy', '未发现问题')
                    : report
                      ? t('maintenance.issuesFound', '发现 {{count}} 项问题', { count: report.summary.errors + report.summary.warnings })
                      : t('maintenance.ready', '系统检修')}
              </h2>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-aegis-text-dim">
                {report && <span>{t('maintenance.configStatus', '配置')}：{report.configValid === true ? t('maintenance.valid', '有效') : report.configValid === false ? t('maintenance.invalid', '无效') : t('maintenance.unknown', '未知')}</span>}
                {report?.checksRun != null && <span>{t('maintenance.checksRun', '{{count}} 项检查', { count: report.checksRun })}</span>}
                {checkedTime && <span>{t('maintenance.checkedAt', '检查于 {{time}}', { time: checkedTime })}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void copyReport(); }}
              disabled={!report || busy}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-aegis-border/30 text-aegis-text-dim transition-colors hover:border-aegis-border/60 hover:text-aegis-text disabled:opacity-40"
              title={t('maintenance.copyReport', '复制检修报告')}
            >
              <ClipboardCopy size={14} />
            </button>
            <button
              type="button"
              onClick={() => { void scan(); }}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-border/35 px-3 text-[12px] font-medium text-aegis-text-dim transition-colors hover:border-aegis-border/60 hover:text-aegis-text disabled:opacity-50"
            >
              <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
              {t('maintenance.rescan', '重新扫描')}
            </button>
            <button
              type="button"
              onClick={repair}
              disabled={busy || !canRepair}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-primary/30 bg-aegis-primary/10 px-3 text-[12px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/20 disabled:opacity-40"
            >
              {repairing ? <Loader2 size={13} className="animate-spin" /> : <HeartPulse size={13} />}
              {t('maintenance.officialRepair', '官方修复')}
            </button>
          </div>
        </div>

        {report && (
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-aegis-border/20 pt-4">
            {([
              ['errors', report.summary.errors, t('maintenance.errors', '错误'), 'text-aegis-danger'],
              ['warnings', report.summary.warnings, t('maintenance.warnings', '警告'), 'text-aegis-warning'],
              ['info', report.summary.info, t('maintenance.info', '提示'), 'text-aegis-text-dim'],
            ] as const).map(([key, count, label, tone]) => (
              <div key={key} className="min-w-0 text-center">
                <div className={clsx('text-[18px] font-semibold tabular-nums', tone)}>{count}</div>
                <div className="text-[10px] text-aegis-text-dim">{label}</div>
              </div>
            ))}
          </div>
        )}

        {(requestError || report?.scanErrors.length) ? (
          <div role="alert" className="mt-4 rounded-md border border-aegis-danger/25 bg-aegis-danger/[0.06] px-3 py-2 text-[11px] text-aegis-danger">
            {[requestError, ...(report?.scanErrors ?? [])].filter(Boolean).join('\n')}
          </div>
        ) : null}
      </GlassCard>

      {(collaborationMaintenance.status?.active || collaborationMaintenance.error) && (
        <section
          className="border-y border-aegis-warning/30 bg-aegis-warning/[0.05] px-4 py-3"
          aria-label={t('maintenance.collaborationGate', '协作维护闸门')}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <LockKeyhole size={17} className="mt-0.5 shrink-0 text-aegis-warning" />
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-aegis-text">
                  {collaborationMaintenance.status?.active
                    ? t('maintenance.collaborationGateActive', '协作分派已因维护暂停')
                    : t('maintenance.collaborationGateUnknown', '无法确认协作维护状态')}
                </h3>
                {collaborationMaintenance.status?.lease && (
                  <p className="mt-1 break-words text-[11px] text-aegis-text-dim">
                    {collaborationMaintenance.status.lease.reason}
                    {' · '}
                    {collaborationMaintenance.status.lease.owner}
                  </p>
                )}
                {collaborationMaintenance.status?.activeRuns.length ? (
                  <div className="mt-2 space-y-1">
                    {collaborationMaintenance.status.activeRuns.slice(0, 5).map((run) => (
                      <div key={run.runId} className="flex min-w-0 items-center gap-2 text-[11px] text-aegis-warning">
                        <span className="min-w-0 flex-1 truncate">{run.goal || run.runId}</span>
                        <span className="shrink-0 font-mono text-[10px] opacity-75">{run.status}</span>
                      </div>
                    ))}
                    <p className="text-[10.5px] text-aegis-text-dim">
                      {t('maintenance.collaborationRunsMustSettle', '活动运行必须先在会话中收敛；检修不会自动取消它们。')}
                    </p>
                  </div>
                ) : null}
                {collaborationMaintenance.error && (
                  <p role="alert" className="mt-2 break-words text-[11px] text-aegis-danger">
                    {collaborationMaintenance.error}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => { void collaborationMaintenance.refresh(); }}
                disabled={collaborationMaintenance.loading || collaborationMaintenance.recovering}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-aegis-border/35 text-aegis-text-dim transition-colors hover:border-aegis-border/60 hover:text-aegis-text disabled:opacity-50"
                title={t('maintenance.refreshCollaborationGate', '刷新协作维护状态')}
              >
                <RefreshCw size={13} className={collaborationMaintenance.loading ? 'animate-spin' : ''} />
              </button>
              {collaborationMaintenance.status?.active && (
                <button
                  type="button"
                  onClick={() => { void collaborationMaintenance.recover(); }}
                  disabled={collaborationMaintenance.recovering}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-warning/35 bg-aegis-warning/10 px-3 text-[11px] font-semibold text-aegis-warning transition-colors hover:bg-aegis-warning/15 disabled:opacity-50"
                >
                  {collaborationMaintenance.recovering
                    ? <Loader2 size={12} className="animate-spin" />
                    : <ShieldCheck size={12} />}
                  {t('maintenance.verifyAndReleaseGate', '验证并解除')}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="space-y-2">
        <GatewayLifecyclePanel variant="full" />
        {onRecoverGateway && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {gatewayRecoveryError && (
              <span role="alert" className="min-w-0 flex-1 break-words text-[11px] text-aegis-danger">
                {t('maintenance.gatewayRecoveryFailed', 'Gateway 恢复失败：{{error}}', { error: gatewayRecoveryError })}
              </span>
            )}
            <button
              type="button"
              onClick={() => { void recoverGateway(); }}
              disabled={gatewayRecovering}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-primary/30 bg-aegis-primary/10 px-3 text-[11px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/20 disabled:opacity-50"
            >
              {gatewayRecovering ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
              {t('maintenance.recoverGateway', '检查并恢复 Gateway')}
            </button>
          </div>
        )}
      </div>

      {report && groupedFindings.length === 0 && report.scanErrors.length === 0 && (
        <div className="flex min-h-[120px] items-center justify-center border-y border-aegis-border/25 text-[12px] text-aegis-success">
          <CheckCircle2 size={15} className="mr-2" />
          {t('maintenance.noFindings', '配置、插件与 Doctor 检查均通过')}
        </div>
      )}

      {groupedFindings.map(({ category, findings }) => (
        <section key={category} className="border-t border-aegis-border/35 pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-aegis-text">
              {t(`maintenance.category.${category}`, {
                defaultValue: ({ config: '配置', plugin: '插件', mcp: 'MCP', security: '安全', gateway: 'Gateway', doctor: 'Doctor' } as Record<MaintenanceCategory, string>)[category],
              })}
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] tabular-nums text-aegis-text-dim">{findings.length}</span>
              {onOpenConfig && ['config', 'plugin', 'mcp', 'security'].includes(category) && (
                <button
                  type="button"
                  onClick={() => onOpenConfig(category)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-aegis-border/35 px-2 text-[10.5px] font-medium text-aegis-text-dim transition-colors hover:border-aegis-primary/35 hover:text-aegis-primary"
                >
                  {t('maintenance.openConfiguration', '配置管理')}
                  <ArrowRight size={11} />
                </button>
              )}
            </div>
          </div>
          <div className="divide-y divide-aegis-border/20 border-y border-aegis-border/20">
            {findings.map((finding, index) => (
              <div key={`${finding.checkId ?? finding.path ?? finding.message}-${index}`} className="flex items-start gap-3 py-3">
                <div className={clsx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border', severityClasses(finding.severity))}>
                  <FindingIcon severity={finding.severity} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-[12px] leading-relaxed text-aegis-text">{finding.message}</p>
                  {finding.path && <code className="mt-1 block break-all text-[10.5px] text-aegis-primary">{finding.path}</code>}
                  {finding.requirement && <p className="mt-1 break-words text-[10.5px] leading-relaxed text-aegis-text-dim">{finding.requirement}</p>}
                  {finding.fixHint && <p className="mt-1 break-words text-[10.5px] leading-relaxed text-aegis-text-muted">{finding.fixHint}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
