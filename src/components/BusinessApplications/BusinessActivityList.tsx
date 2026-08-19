import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/shared/button/Button';
import {
  useBusinessActivityStore,
  type BusinessAttemptState,
} from '@/business-applications/activityStore';
import { useDingTalkBusinessAudit } from '@/hooks/useDingTalkBusinessAudit';
import { useChatStore } from '@/stores/chatStore';
import { summarizeDingTalkBusinessActivity } from './businessActivitySummary';
import type { DingTalkAuditFailureKind } from '@/business-applications/dingtalkAuditAvailability';

const STATE_LABEL: Record<BusinessAttemptState, string> = {
  pending: '执行中',
  approval_required: '等待 OpenClaw 审批',
  succeeded: '已完成',
  failed: '失败',
  unknown: '结果待核验',
};

type ActivityScope = 'all' | 'official' | 'window';

const AUDIT_FAILURE_DESCRIPTION: Record<DingTalkAuditFailureKind, string> = {
  disconnected: '尚未连接 OpenClaw Gateway。连接并完成身份核验后才能读取官方审计账本。',
  'session-missing': '尚未选择可核验的 OpenClaw Session。选择 Session 后才能查询其官方工具审计。',
  unsupported: '当前 Gateway 不支持 audit.activity.list。升级到提供官方活动审计协议的 OpenClaw 后再重新检测。',
  unauthorized: '当前 Gateway 连接未获得 operator.read。请重新完成设备配对或连接授权后重试。',
  'invalid-response': 'Gateway 返回的审计数据不符合当前官方协议，JunQi 已拒绝猜测或降级解析。',
  failed: '官方审计请求失败。请检查 Gateway 状态后重试；JunQi 不会用本窗口状态替代官方记录。',
};

function StateIcon({ state }: { state: BusinessAttemptState }) {
  if (state === 'pending') return <LoaderCircle size={14} className="animate-spin text-aegis-primary" />;
  if (state === 'approval_required') return <ShieldAlert size={14} className="text-aegis-warning" />;
  if (state === 'succeeded') return <CheckCircle2 size={14} className="text-aegis-success" />;
  if (state === 'unknown') return <AlertTriangle size={14} className="text-aegis-warning" />;
  return <AlertTriangle size={14} className="text-aegis-danger" />;
}

function SummaryMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'warning' }) {
  return (
    <div className="min-w-0 border-r border-aegis-border px-3 py-2 last:border-r-0">
      <div className="text-[9.5px] text-aegis-text-dim">{label}</div>
      <div className={clsx('mt-0.5 font-mono text-[15px] font-semibold tabular-nums', tone === 'warning' && value > 0 ? 'text-aegis-warning' : 'text-aegis-text-secondary')}>{value}</div>
    </div>
  );
}

function includesQuery(values: readonly (string | null | undefined)[], query: string): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLocaleLowerCase().includes(query));
}

export function BusinessActivityList() {
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const attempts = useBusinessActivityStore((state) => state.attempts);
  const clear = useBusinessActivityStore((state) => state.clear);
  const audit = useDingTalkBusinessAudit(activeSessionKey);
  const [scope, setScope] = useState<ActivityScope>('all');
  const [search, setSearch] = useState('');
  const summary = useMemo(() => summarizeDingTalkBusinessActivity(audit.events, attempts), [attempts, audit.events]);
  const query = search.trim().toLocaleLowerCase();
  const filteredEvents = useMemo(() => (
    scope === 'window' ? [] : audit.events.filter((event) => includesQuery([
      event.toolName,
      event.action,
      event.agentId,
      event.actor.id,
      event.runId,
      event.toolCallId,
      event.errorCode,
      event.status,
    ], query))
  ), [audit.events, query, scope]);
  const filteredAttempts = useMemo(() => (
    scope === 'official' ? [] : attempts.filter((attempt) => includesQuery([
      attempt.toolLabel,
      attempt.toolName,
      attempt.agentId,
      attempt.sessionId,
      attempt.profileRef,
      attempt.errorCode,
      attempt.state,
    ], query))
  ), [attempts, query, scope]);
  const hasAnyActivity = attempts.length > 0 || audit.events.length > 0;
  const hasFilteredActivity = filteredAttempts.length > 0 || filteredEvents.length > 0;

  if (!hasAnyActivity && !audit.loading) {
    return (
      <EmptyState
        density="compact"
        iconStyle="bare"
        icon={<Clock3 size={24} />}
        title="当前 Session 尚无钉钉业务审计"
        description={audit.failure
          ? AUDIT_FAILURE_DESCRIPTION[audit.failure]
          : '当前没有匹配的官方记录。只有钉钉工具经 OpenClaw 实际执行，并由启用的 metadata-only 审计账本记录后才会出现在这里。'}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-2 border-b border-aegis-border bg-aegis-bg/35 sm:grid-cols-5">
        <SummaryMetric label="官方审计" value={summary.official} />
        <SummaryMetric label="本窗口投影" value={summary.local} />
        <SummaryMetric label="参与 Agent" value={summary.agents} />
        <SummaryMetric label="处理中" value={summary.active} />
        <SummaryMetric label="需关注" value={summary.attention} tone="warning" />
      </div>
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-aegis-border px-3 py-1.5">
        <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg/70 px-2 py-1.5 focus-within:border-aegis-primary/55 focus-within:ring-1 focus-within:ring-aegis-primary/25">
          <Search size={12} className="shrink-0 text-aegis-text-dim" aria-hidden="true" />
          <span className="sr-only">搜索钉钉业务审计</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索工具、Agent、run 或错误码"
            className="min-w-0 flex-1 bg-transparent text-[10.5px] text-aegis-text outline-none placeholder:text-aegis-text-dim"
          />
        </label>
        <div className="flex rounded-md border border-aegis-border bg-aegis-bg/70 p-0.5" aria-label="审计来源筛选">
          {([
            ['all', '全部'],
            ['official', '官方'],
            ['window', '本窗口'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={clsx(
                'rounded px-2 py-1 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60',
                scope === value ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" loading={audit.loading} leadingIcon={<RefreshCw size={12} />} onClick={() => void audit.refresh()}>刷新审计</Button>
          <Button size="xs" variant="ghost" disabled={attempts.length === 0} onClick={clear}>清空本窗口</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {audit.failure && <div className="border-b border-aegis-warning/25 bg-aegis-warning/[0.05] px-3 py-2 text-[10px] text-aegis-warning">{AUDIT_FAILURE_DESCRIPTION[audit.failure]}</div>}
        {!hasFilteredActivity && (
          <EmptyState
            density="compact"
            iconStyle="bare"
            icon={<Search size={22} />}
            title="没有符合条件的审计记录"
            description="调整搜索内容或来源范围后重试。"
          />
        )}
        {filteredEvents.map((event) => (
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
        {filteredAttempts.length > 0 && <div className="border-b border-aegis-border bg-aegis-surface/35 px-3 py-1.5 text-[9.5px] text-aegis-text-dim">本窗口调用投影：仅关联当前调用与 DWS 证据，不推断 Agent 委派关系。</div>}
        {filteredAttempts.map((attempt) => (
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
        {audit.nextCursor && scope !== 'window' && (
          <div className="flex justify-center border-b border-aegis-border px-3 py-2">
            <Button size="xs" variant="ghost" loading={audit.loadingMore} onClick={() => void audit.loadMore()}>加载更早审计</Button>
          </div>
        )}
      </div>
    </div>
  );
}
