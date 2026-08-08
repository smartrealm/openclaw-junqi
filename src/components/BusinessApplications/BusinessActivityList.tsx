import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/shared/button/Button';
import { useBusinessActivityStore, type BusinessAttemptState } from '@/business-applications/activityStore';

const STATE_LABEL: Record<BusinessAttemptState, string> = {
  pending: '执行中',
  approval_required: '等待 OpenClaw 审批',
  succeeded: '已完成',
  failed: '失败',
  unknown: '结果待核验',
};

function StateIcon({ state }: { state: BusinessAttemptState }) {
  if (state === 'pending') return <LoaderCircle size={14} className="animate-spin text-aegis-primary" />;
  if (state === 'approval_required') return <ShieldAlert size={14} className="text-aegis-warning" />;
  if (state === 'succeeded') return <CheckCircle2 size={14} className="text-aegis-success" />;
  if (state === 'unknown') return <AlertTriangle size={14} className="text-aegis-warning" />;
  return <AlertTriangle size={14} className="text-aegis-danger" />;
}

export function BusinessActivityList() {
  const attempts = useBusinessActivityStore((state) => state.attempts);
  const clear = useBusinessActivityStore((state) => state.clear);
  if (attempts.length === 0) {
    return (
      <EmptyState
        density="compact"
        iconStyle="bare"
        icon={<Clock3 size={24} />}
        title="本次窗口尚无业务操作"
        description="这里只保留操作元数据，不保存参数、业务正文或原始结果。"
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center justify-between border-b border-aegis-border px-3">
        <span className="text-[10.5px] text-aegis-text-dim">本次窗口，共 {attempts.length} 条</span>
        <Button size="xs" variant="ghost" onClick={clear}>清空</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {attempts.map((attempt) => (
          <div key={attempt.id} className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-2 border-b border-aegis-border/70 px-3 py-3">
            <span className="pt-0.5"><StateIcon state={attempt.state} /></span>
            <div className="min-w-0">
              <div className="truncate text-[11.5px] font-medium text-aegis-text-secondary">{attempt.toolLabel}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-aegis-text-dim">
                <span>{attempt.effect === 'write' ? '写入' : '读取'}</span>
                <span>风险 {attempt.risk}</span>
                <span>{attempt.profileRef ?? '无租户参数'}</span>
                {attempt.errorCode && <span>错误 {attempt.errorCode}</span>}
              </div>
            </div>
            <div className="text-right text-[10px] text-aegis-text-dim">
              <div>{STATE_LABEL[attempt.state]}</div>
              <time dateTime={new Date(attempt.startedAt).toISOString()}>
                {new Date(attempt.startedAt).toLocaleTimeString()}
              </time>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
