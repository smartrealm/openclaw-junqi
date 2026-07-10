import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { AlertCircle, Bot, CheckCircle2, FileText, HeartPulse, Loader2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { GatewayRescueChat } from './GatewayRescueChat';

export interface GatewaySelfRescuePanelProps {
  connected?: boolean;
  busy?: boolean;
  port?: string | number;
  progressMessage?: string | null;
  progressPercent?: number | null;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  onReconnect?: () => void;
  onOpenLogs?: () => void;
  error?: string;
  logs?: string;
  variant?: 'popover' | 'full';
  className?: string;
}

type DoctorFixState = 'idle' | 'running' | 'success' | 'failed';

export function GatewaySelfRescuePanel({
  connected = false,
  busy = false,
  port,
  progressMessage,
  progressPercent,
  primaryActionLabel,
  onPrimaryAction,
  onReconnect,
  onOpenLogs,
  error,
  logs,
  variant = 'full',
  className,
}: GatewaySelfRescuePanelProps) {
  const { t } = useTranslation();
  const [doctorFixState, setDoctorFixState] = useState<DoctorFixState>('idle');
  const [showAiRescue, setShowAiRescue] = useState(false);

  const doctorFixBusy = doctorFixState === 'running';
  const actionDisabled = busy || doctorFixBusy;
  const statusLabel = busy
    ? t('gatewaySelfRescue.statusBusy', '处理中')
    : connected
      ? t('gatewaySelfRescue.statusConnected', '已连接')
      : t('gatewaySelfRescue.statusDisconnected', '未连接');
  const doctorFixLabel = doctorFixState === 'running'
    ? t('gatewaySelfRescue.doctorFixRunning', '正在修复…')
    : doctorFixState === 'success'
      ? t('gatewaySelfRescue.doctorFixSuccess', '修复完成')
      : doctorFixState === 'failed'
        ? t('gatewaySelfRescue.doctorFixFailed', '修复失败')
        : t('gatewaySelfRescue.doctorFix', '自动修复');

  const runDoctorFix = async () => {
    if (actionDisabled) return;
    setDoctorFixState('running');
    try {
      const repaired = await invoke<boolean>('openclaw_doctor_repair');
      setDoctorFixState(repaired ? 'success' : 'failed');
      if (repaired) onPrimaryAction();
    } catch {
      setDoctorFixState('failed');
    } finally {
      window.setTimeout(() => setDoctorFixState('idle'), 4_000);
    }
  };

  return (
    <div className={clsx(
      'overflow-hidden rounded-xl border border-aegis-border bg-aegis-bg-primary/80',
      variant === 'popover' ? 'text-[11px]' : 'text-xs',
      className,
    )}>
      <div className="border-b border-aegis-border px-3.5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-aegis-text">
              <ShieldCheck size={15} className="text-aegis-primary" />
              <span>{t('gatewaySelfRescue.title', 'Gateway 自救中心')}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-aegis-text-muted">
              {t('gatewaySelfRescue.subtitle', '统一处理 Gateway 重连、doctor 修复和 AI 诊断。')}
            </p>
          </div>
          <span className={clsx(
            'shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold',
            connected && !busy && 'border-aegis-success/25 bg-aegis-success/10 text-aegis-success',
            busy && 'border-aegis-warning/25 bg-aegis-warning/10 text-aegis-warning',
            !connected && !busy && 'border-aegis-danger/25 bg-aegis-danger/10 text-aegis-danger',
          )}>
            {statusLabel}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-[11px]">
          {port != null && (
            <>
              <span className="text-aegis-text-muted">{t('gatewaySelfRescue.port', '端口')}</span>
              <span className="font-mono text-aegis-text">127.0.0.1:{port}</span>
            </>
          )}
          <span className="text-aegis-text-muted">{t('gatewaySelfRescue.status', '状态')}</span>
          <span className={clsx(connected && !busy ? 'text-aegis-success' : busy ? 'text-aegis-warning' : 'text-red-300')}>
            {statusLabel}
          </span>
          {progressMessage && (
            <>
              <span className="text-aegis-text-muted">{t('gatewaySelfRescue.progress', '进度')}</span>
              <span className="min-w-0 truncate text-aegis-warning" title={progressMessage}>
                {progressMessage}
              </span>
            </>
          )}
        </div>

        {busy && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-aegis-warning transition-all duration-300"
              style={{ width: `${progressPercent ?? 12}%` }}
            />
          </div>
        )}
      </div>

      <div className="space-y-2 px-3.5 py-3">
        <button
          onClick={onPrimaryAction}
          disabled={busy}
          className={clsx(
            'flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors',
            busy
              ? 'cursor-not-allowed border-aegis-warning/25 bg-aegis-warning/8 text-aegis-warning'
              : 'border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary hover:bg-aegis-primary/16',
          )}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
          {primaryActionLabel}
        </button>

        {(onReconnect || onOpenLogs) && (
          <div className="grid grid-cols-2 gap-2">
            {onReconnect && (
              <button
                onClick={onReconnect}
                disabled={actionDisabled}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-aegis-border bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-aegis-text-secondary transition-colors hover:border-aegis-primary/30 hover:text-aegis-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={12} />
                {t('offline.retryGateway', '重新连接')}
              </button>
            )}
            {onOpenLogs && (
              <button
                onClick={onOpenLogs}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-aegis-border bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-aegis-text-secondary transition-colors hover:border-aegis-primary/30 hover:text-aegis-primary"
              >
                <FileText size={12} />
                {t('offline.viewLogs', '查看日志')}
              </button>
            )}
          </div>
        )}

        <button
          onClick={() => void runDoctorFix()}
          disabled={actionDisabled}
          title={t('gatewaySelfRescue.doctorFixHint', '运行 openclaw doctor --fix，自动修复 OpenClaw 环境、配置与运行时问题。')}
          className={clsx(
            'flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors',
            doctorFixState === 'success' && 'border-aegis-success/30 bg-aegis-success/10 text-aegis-success',
            doctorFixState === 'failed' && 'border-aegis-danger/30 bg-aegis-danger/10 text-aegis-danger',
            doctorFixState === 'idle' && !busy && 'border-aegis-border bg-white/[0.03] text-aegis-text-secondary hover:border-aegis-warning/35 hover:bg-aegis-warning/8 hover:text-aegis-warning',
            actionDisabled && doctorFixState !== 'success' && doctorFixState !== 'failed' && 'cursor-not-allowed border-aegis-border bg-white/[0.02] text-aegis-text-muted',
          )}
        >
          {doctorFixState === 'success' ? (
            <CheckCircle2 size={13} />
          ) : doctorFixState === 'failed' ? (
            <AlertCircle size={13} />
          ) : (
            <HeartPulse size={13} className={doctorFixBusy ? 'animate-pulse' : ''} />
          )}
          {doctorFixLabel}
        </button>

        <button
          onClick={() => setShowAiRescue((value) => !value)}
          className={clsx(
            'flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors',
            showAiRescue
              ? 'border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
              : 'border-aegis-border bg-white/[0.03] text-aegis-text-secondary hover:border-aegis-primary/35 hover:bg-aegis-primary/8 hover:text-aegis-primary',
          )}
        >
          <Bot size={13} />
          {showAiRescue ? t('gatewaySelfRescue.hideAiRescue', '收起 AI 诊断') : t('gatewaySelfRescue.aiRescue', 'AI 诊断')}
        </button>

        <div className="rounded-lg border border-aegis-border/60 bg-white/[0.02] px-3 py-2 text-[10.5px] leading-relaxed text-aegis-text-muted">
          {t('gatewaySelfRescue.hint', '先重连/重启；仍失败再运行自动修复；配置或日志不明朗时使用 AI 诊断。')}
        </div>
      </div>

      {showAiRescue && (
        <div className="border-t border-aegis-border px-3.5 pb-3">
          <GatewayRescueChat
            error={error || progressMessage || t('gatewaySelfRescue.defaultAiContext', 'Gateway 需要诊断。')}
            logs={logs}
          />
        </div>
      )}
    </div>
  );
}
