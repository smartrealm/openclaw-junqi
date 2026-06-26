import { Check, Loader2, Circle, AlertTriangle, RotateCw, RefreshCw, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { getBootProgressSummary, useBootSequenceStore, type BootStage } from '@/stores/bootSequenceStore';

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

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-aegis-bg/95 backdrop-blur-xl"
      initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
      animate={{ opacity: 1, backdropFilter: 'blur(18px)' }}
      exit={{ opacity: 0, scale: 0.985, backdropFilter: 'blur(0px)' }}
      transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="w-[440px] max-w-[calc(100vw-48px)] rounded-2xl border border-aegis-border bg-aegis-elevated shadow-2xl overflow-hidden">
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

        {recovery && (recovery.attempt > 0 || recovery.showRestart) && (
          <div className="mx-5 mb-5 rounded-xl border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.035)] overflow-hidden">
            <div className="px-4 py-3 border-b border-aegis-border flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-aegis-text">{t('boot.gatewayRecoveryTitle', 'Gateway connection recovery')}</div>
                <div className="text-[11px] text-aegis-text-muted mt-0.5">
                  {recovery.showRestart
                    ? t('boot.gatewayRecoveryManual', 'Auto retries did not finish the handshake. Try restarting Gateway manually.')
                    : t('boot.gatewayRecoveryRetrying', { attempt: recovery.attempt, defaultValue: `Retrying connection (${recovery.attempt}/3)` })}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={recovery.onReconnect}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-aegis-text-dim hover:text-aegis-text border border-aegis-border/30 hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
                >
                  <RotateCw size={12} /> {t('offline.retryGateway', 'Reconnect')}
                </button>
                {recovery.showRestart && (
                  <button
                    onClick={recovery.onRestart}
                    disabled={recovery.restarting}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] bg-aegis-primary text-white hover:bg-aegis-primary/90 disabled:opacity-60 transition-colors"
                  >
                    {recovery.restarting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {recovery.restarting ? t('gatewayError.actions.retrying', 'Restarting…') : t('boot.restartGateway', 'Restart Gateway')}
                  </button>
                )}
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
              <div className="max-h-28 overflow-y-auto px-4 py-2 bg-black/20">
                <pre className="text-[10px] leading-relaxed font-mono text-aegis-text-dim whitespace-pre-wrap">
                  {recovery.logs.slice(-8).join('\\n')}
                </pre>
              </div>
            )}
          </div>
        )}

      </div>
    </motion.div>
  );
}
