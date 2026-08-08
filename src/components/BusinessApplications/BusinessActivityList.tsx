import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/shared/button/Button';
import { useBusinessActivityStore, type BusinessAttemptState } from '@/business-applications/activityStore';
import { useDingTalkBusinessAudit } from '@/hooks/useDingTalkBusinessAudit';

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
  const audit = useDingTalkBusinessAudit();
  if (attempts.length === 0 && audit.events.length === 0 && !audit.loading) {
    return (
      <EmptyState
        density="compact"
        iconStyle="bare"
        icon={<Clock3 size={24} />}
        title="当前 Session 尚无钉钉业务审计"
        description={audit.unavailable ? 'OpenClaw 审计账本当前不可用；不会以本地状态替代官方记录。' : '这里只展示 OpenClaw 的 metadata-only 审计和本窗口调用投影，不保存参数、业务正文或原始结果。'}
      />
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center justify-between border-b border-aegis-border px-3">
        <span className="text-[10.5px] text-aegis-text-dim">跨 Session 官方审计 {audit.events.length} 条，本窗口投影 {attempts.length} 条</span>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" loading={audit.loading} leadingIcon={<RefreshCw size={12} />} onClick={() => void audit.refresh()}>刷新审计</Button>
          <Button size="xs" variant="ghost" onClick={clear}>清空本窗口</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {audit.unavailable && <div className="border-b border-aegis-warning/25 bg-aegis-warning/[0.05] px-3 py-2 text-[10px] text-aegis-warning">OpenClaw 官方审计账本不可用；本窗口投影不能替代三方审计证据。</div>}
        {audit.events.map((event) => (
          <div key={`${event.eventId}:${event.sequence}`} className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-2 border-b border-aegis-border/70 px-3 py-3">
            <span className="pt-0.5"><ShieldAlert size={14} className={event.status === 'succeeded' ? 'text-aegis-success' : event.status === 'failed' || event.status === 'blocked' ? 'text-aegis-danger' : 'text-aegis-warning'} /></span>
            <div className="min-w-0">
              <div className="truncate text-[11.5px] font-medium text-aegis-text-secondary">{event.toolName ?? event.action}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-aegis-text-dim">
                <span>Agent {event.agentId ?? event.actor.id}</span>
                {event.runId && <span className="max-w-[180px] truncate font-mono" title={event.runId}>run {event.runId}</span>}
                {event.toolCallId && <span className="max-w-[180px] truncate font-mono" title={event.toolCallId}>call {event.toolCallId}</span>}
                {event.errorCode && <span>错误 {event.errorCode}</span>}
                <span>官方 metadata-only</span>
              </div>
            </div>
            <div className="text-right text-[10px] text-aegis-text-dim">
              <div>{event.status}</div>
              <time dateTime={new Date(event.occurredAt).toISOString()}>{new Date(event.occurredAt).toLocaleTimeString()}</time>
            </div>
          </div>
        ))}
        {attempts.length > 0 && <div className="border-b border-aegis-border bg-aegis-surface/35 px-3 py-1.5 text-[9.5px] text-aegis-text-dim">本窗口调用投影：仅关联当前调用与 DWS 证据，不推断 Agent 委派关系。</div>}
        {attempts.map((attempt) => (
          <div key={attempt.id} className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-2 border-b border-aegis-border/70 px-3 py-3">
            <span className="pt-0.5"><StateIcon state={attempt.state} /></span>
            <div className="min-w-0">
              <div className="truncate text-[11.5px] font-medium text-aegis-text-secondary">{attempt.toolLabel}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-aegis-text-dim">
                <span>{attempt.effect === 'write' ? '写入' : '读取'}</span>
                <span>风险 {attempt.risk}</span>
                <span>{attempt.profileRef ?? '无租户参数'}</span>
                <span>Agent {attempt.agentId ?? '待 OpenClaw 核验'}</span>
                {attempt.sessionId && <span className="max-w-[180px] truncate font-mono" title={attempt.sessionId}>session {attempt.sessionId}</span>}
                {attempt.evidence?.dwsCanonicalPath && <span className="max-w-[180px] truncate font-mono" title={attempt.evidence.dwsCanonicalPath}>{attempt.evidence.dwsCanonicalPath}</span>}
                {attempt.evidence?.recoveryEventId && <span className="max-w-[150px] truncate font-mono" title={attempt.evidence.recoveryEventId}>recovery {attempt.evidence.recoveryEventId}</span>}
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
        {audit.nextCursor && (
          <div className="flex justify-center border-b border-aegis-border px-3 py-2">
            <Button size="xs" variant="ghost" loading={audit.loadingMore} onClick={() => void audit.loadMore()}>加载更早审计</Button>
          </div>
        )}
      </div>
    </div>
  );
}
