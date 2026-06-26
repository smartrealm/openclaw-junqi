import { Check, Loader2, Circle, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { getBootProgressSummary, useBootSequenceStore, type BootStage } from '@/stores/bootSequenceStore';

function StageIcon({ stage }: { stage: BootStage }) {
  if (stage.status === 'completed') return <Check size={13} className="text-aegis-success" />;
  if (stage.status === 'running') return <Loader2 size={13} className="text-aegis-primary animate-spin" />;
  if (stage.status === 'error') return <AlertTriangle size={13} className="text-aegis-error" />;
  return <Circle size={11} className="text-aegis-text-dim" />;
}

export function BootTimelineOverlay() {
  const stages = useBootSequenceStore((s) => s.stages);
  const summary = getBootProgressSummary(stages);
  const list = Object.values(stages);
  const pct = Math.round((summary.completed / summary.total) * 100);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-aegis-bg/95 backdrop-blur-xl">
      <div className="w-[440px] max-w-[calc(100vw-48px)] rounded-2xl border border-aegis-border bg-aegis-elevated shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-aegis-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-aegis-primary/10 border border-aegis-primary/20 flex items-center justify-center">
              <Loader2 size={18} className="text-aegis-primary animate-spin" />
            </div>
            <div>
              <h2 className="text-base font-bold text-aegis-text">正在准备 OpenClaw Gateway</h2>
              <p className="text-xs text-aegis-text-muted mt-0.5">检测、连接并同步运行时状态…</p>
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
                  {stage.title}
                </div>
                <div className="text-[11px] text-aegis-text-muted truncate">{stage.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
