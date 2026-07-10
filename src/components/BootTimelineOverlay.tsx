import { Check, Loader2, Circle, AlertTriangle, RotateCw, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { getBootProgressSummary, useBootSequenceStore, type BootStage } from '@/stores/bootSequenceStore';
import { useEffect, useRef } from 'react';
import { GatewaySelfRescuePanel } from './GatewaySelfRescuePanel';

function StageIcon({ stage }: { stage: BootStage }) {
  if (stage.status === 'completed') return <Check size={13} className="text-aegis-success" />;
  if (stage.status === 'running') return <Loader2 size={13} className="text-aegis-primary animate-spin" />;
  if (stage.status === 'error') return <AlertTriangle size={13} className="text-aegis-error" />;
  return <Circle size={11} className="text-aegis-text-dim" />;
}

interface BootTimelineOverlayProps {
  recovery?: {
    attempt: number;
    showRestart: boolean;
    restarting: boolean;
    logs: string[];
    onReconnect: () => void;
    onRestart: () => void;
    onOpenLogs: () => void;
  };
}

export function BootTimelineOverlay({ recovery }: BootTimelineOverlayProps) {
  const { t } = useTranslation();
  const stages = useBootSequenceStore((s) => s.stages);
  const summary = getBootProgressSummary(stages);
  const list = Object.values(stages);
  const pct = Math.round((summary.completed / summary.total) * 100);
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [recovery?.logs]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-aegis-bg/95 backdrop-blur-xl"
      style={{ animation: 'boot-overlay-enter 0.85s cubic-bezier(0.22, 1, 0.36, 1)' }}
    >
      <style>{`
        @keyframes boot-overlay-enter {
          from { opacity: 0; backdrop-filter: blur(0px); }
          to { opacity: 1; backdrop-filter: blur(18px); }
        }
      `}</style>
      <div className="w-[680px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-48px)] overflow-y-auto rounded-2xl border border-aegis-border bg-aegis-elevated shadow-2xl">
        <div className="p-5 border-b border-aegis-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-aegis-primary/10 border border-aegis-primary/20 flex items-center justify-center">
              <Loader2 size={18} className="text-aegis-primary animate-spin" />
            </div>
            <div>
              <h2 className="text-base font-bold text-aegis-text">{t('boot.preparingGateway')}</h2>
              <p className="text-xs text-aegis-text-muted mt-0.5">{t('boot.preparingGatewayDesc')}</p>
            </div>
          </div>
          <div className="mt-4 h-1.5 rounded-full bg-aegis-surface overflow-hidden">
            <div className="h-full bg-aegis-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="p-5 space-y-3">
          {list.map((stage, idx) => (
            <div key={stage.id} className="relative flex items-start gap-3">
              {idx < list.length - 1 && <div className="absolute left-[10px] top-6 bottom-[-14px] w-px bg-aegis-border" />}
              <div className={clsx(
                'relative z-10 w-5 h-5 rounded-full flex items-center justify-center border bg-aegis-elevated',
                stage.status === 'running' && 'border-aegis-primary shadow-[0_0_20px_rgba(59,130,246,0.35)]',
                stage.status === 'completed' && 'border-aegis-success',
                stage.status === 'error' && 'border-aegis-error',
                stage.status === 'pending' && 'border-aegis-border',
              )}>
                <StageIcon stage={stage} />
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className={clsx('text-sm font-semibold', stage.status === 'running' ? 'text-aegis-primary' : 'text-aegis-text')}>
                  {t(`boot.stage.${stage.id}`, stage.title)}
                </div>
                <div className="text-[11px] text-aegis-text-muted truncate">{t(`boot.detail.${stage.id}`, stage.detail)}</div>
              </div>
            </div>
          ))}
        </div>

        {recovery?.showRestart ? (
          <GatewaySelfRescuePanel
            className="mx-5 mb-5"
            variant="full"
            connected={false}
            busy={recovery.restarting}
            progressMessage={recovery.restarting
              ? t('gatewayError.actions.retrying', '正在重启…')
              : t('boot.gatewayRecoveryManual', '连接重试仍未完成握手。可以进入自救流程。')}
            progressPercent={recovery.restarting ? 35 : null}
            primaryActionLabel={recovery.restarting
              ? t('gatewayError.actions.retrying', '正在重启…')
              : t('boot.restartGateway', '重启 Gateway')}
            onPrimaryAction={recovery.onRestart}
            onReconnect={recovery.onReconnect}
            onOpenLogs={recovery.onOpenLogs}
            error={t('boot.gatewayRecoveryManual', '连接重试仍未完成握手。可以进入自救流程。')}
            logs={recovery.logs.slice(-40).join('\n')}
          />
        ) : recovery && (
          recovery.attempt > 0
          || recovery.restarting
          || recovery.logs.length > 0
        ) && (
          <div className="mx-5 mb-5 rounded-xl border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.035)] overflow-hidden">
            <div className="px-4 py-3 border-b border-aegis-border flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-aegis-text">{t('boot.gatewayRecoveryTitle', 'Gateway connection recovery')}</div>
                <div className="text-[11px] text-aegis-text-muted mt-0.5">
                  {t('boot.gatewayRecoveryRetrying', { attempt: recovery.attempt, defaultValue: `Retrying WebSocket connection (${recovery.attempt}/3)` })}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={recovery.onReconnect}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-aegis-text-dim hover:text-aegis-text border border-aegis-border/30 hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
                >
                  <RotateCw size={12} /> {t('offline.retryGateway', 'Reconnect')}
                </button>
                <button
                  onClick={recovery.onOpenLogs}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-aegis-text-dim hover:text-aegis-text border border-aegis-border/30 hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
                >
                  <FileText size={12} /> {t('offline.viewLogs', 'Logs')}
                </button>
              </div>
            </div>
            <div className="h-1 bg-aegis-surface">
              <div className="h-full bg-aegis-primary transition-all duration-700" style={{ width: `${Math.min(100, recovery.attempt * 33 + (recovery.restarting ? 20 : 0))}%` }} />
            </div>
            {recovery.logs.length > 0 && (
              <div ref={logsRef} className="max-h-64 min-h-28 overflow-y-auto px-4 py-2 bg-black/20">
                <pre className="text-[10px] leading-relaxed font-mono text-aegis-text-dim whitespace-pre-wrap">
                  {recovery.logs.slice(-40).join('\n')}
                </pre>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
