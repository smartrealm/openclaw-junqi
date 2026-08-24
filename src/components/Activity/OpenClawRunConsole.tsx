import { useEffect, useMemo } from 'react';
import { Activity, AlertCircle, ArrowUpRight, LoaderCircle, RefreshCw, Wrench } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '@/stores/chatStore';
import { ensureToolsEffectiveFresh, refreshToolsEffective, useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useOpenClawTaskLedgerStore } from '@/stores/openclawTaskLedgerStore';
import { useGatewayAuditLedger } from '@/hooks/useGatewayAuditLedger';

function toolCount(groups: readonly { readonly tools: readonly unknown[] }[]): number {
  return groups.reduce((total, group) => total + group.tools.length, 0);
}

export function OpenClawRunConsole({ connected }: { connected: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const sessions = useGatewayDataStore((state) => state.sessions);
  const effective = useGatewayDataStore((state) => activeSessionKey ? state.toolsEffective[activeSessionKey] : undefined);
  const effectiveUpdatedAt = useGatewayDataStore((state) => activeSessionKey ? state.toolsEffectiveUpdatedAt[activeSessionKey] : undefined);
  const toolsLoading = useGatewayDataStore((state) => state.toolsEffectiveLoading && state.toolsEffectiveLoadingSessionKey === activeSessionKey);
  const toolsError = useGatewayDataStore((state) => state.toolsEffectiveError);
  const taskPage = useOpenClawTaskLedgerStore((state) => state.page);
  const session = useMemo(() => sessions.find((entry) => entry.key === activeSessionKey), [activeSessionKey, sessions]);
  const audit = useGatewayAuditLedger(activeSessionKey ? { sessionKey: activeSessionKey } : {});
  const sessionTasks = useMemo(() => (
    taskPage?.availability === 'available' && activeSessionKey
      ? taskPage.tasks.filter((task) => task.sessionKey === activeSessionKey || task.childSessionKey === activeSessionKey)
      : []
  ), [activeSessionKey, taskPage]);
  const runningTasks = sessionTasks.filter((task) => task.status === 'running' || task.status === 'queued').length;
  const availableTools = effective ? toolCount(effective.groups) : null;

  useEffect(() => {
    if (!connected || !activeSessionKey) return;
    void ensureToolsEffectiveFresh(activeSessionKey, undefined, session?.agentId);
  }, [activeSessionKey, connected, session?.agentId]);

  const openSession = () => {
    if (!activeSessionKey) return;
    useChatStore.getState().openTab(activeSessionKey);
    navigate('/chat');
  };

  return (
    <section className="overflow-hidden rounded-lg border border-aegis-border bg-aegis-card" aria-labelledby="openclaw-run-console-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-aegis-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity size={15} className="shrink-0 text-aegis-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="openclaw-run-console-title" className="truncate text-[13px] font-semibold text-aegis-text">{t('activity.runConsole.title', '统一运行控制台')}</h2>
            <p className="mt-0.5 truncate text-[10px] text-aegis-text-dim">{activeSessionKey ?? t('activity.runConsole.noSession', '未选择会话')}</p>
          </div>
        </div>
        {activeSessionKey && (
          <button type="button" onClick={openSession} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-aegis-border px-2.5 text-[10.5px] text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50">
            {t('activity.runConsole.openSession', '打开会话')}<ArrowUpRight size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      {!connected ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.runConsole.offline', '连接 Gateway 后可查看官方运行投影。')}</p>
      ) : !activeSessionKey ? (
        <p className="px-4 py-4 text-[11px] text-aegis-text-dim">{t('activity.runConsole.noSessionHint', '选择一个会话以关联其任务、审计和有效工具。')}</p>
      ) : (
        <div className="grid divide-y divide-aegis-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="min-w-0 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] text-aegis-text-dim"><Wrench size={11} aria-hidden="true" />{t('activity.runConsole.effectiveTools', '有效工具')}</div>
            <div className="mt-1 flex items-center gap-2">
              {toolsLoading ? <LoaderCircle size={15} className="animate-spin text-aegis-text-dim" /> : <strong className="font-mono text-[18px] text-aegis-text">{availableTools ?? '—'}</strong>}
              {effectiveUpdatedAt && <span className="text-[9px] text-aegis-text-dim">{new Date(effectiveUpdatedAt).toLocaleTimeString()}</span>}
            </div>
            {toolsError ? <p className="mt-1 text-[10px] text-aegis-danger">{t('activity.runConsole.toolsUnavailable', '工具快照不可用')}</p> : <p className="mt-1 text-[10px] text-aegis-text-dim">{effective?.profile ?? t('activity.runConsole.toolsPending', '等待 Gateway 快照')}</p>}
            <button type="button" onClick={() => void refreshToolsEffective(activeSessionKey, session?.agentId)} disabled={toolsLoading} className="mt-2 inline-flex items-center gap-1 text-[10px] text-aegis-text-dim transition-colors hover:text-aegis-text disabled:opacity-50"><RefreshCw size={10} className={clsx(toolsLoading && 'animate-spin')} />{t('common.refresh', '刷新')}</button>
          </div>
          <div className="min-w-0 px-4 py-3">
            <div className="text-[10px] text-aegis-text-dim">{t('activity.runConsole.loadedNativeTasks', '已加载原生任务')}</div>
            <div className="mt-1 font-mono text-[18px] text-aegis-text">{sessionTasks.length}</div>
            <p className="mt-1 text-[10px] text-aegis-text-dim">{t('activity.runConsole.runningTasks', '{{count}} 个排队或运行中', { count: runningTasks })}</p>
          </div>
          <div className="min-w-0 px-4 py-3">
            <div className="text-[10px] text-aegis-text-dim">{t('activity.runConsole.recentAuditEvents', '最近运行审计')}</div>
            <div className="mt-1 font-mono text-[18px] text-aegis-text">{audit.loading ? '—' : audit.events.length}</div>
            {audit.unavailable ? <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-aegis-warning"><AlertCircle size={10} aria-hidden="true" />{t('activity.runConsole.auditUnavailable', '审计当前不可用')}</p> : <p className="mt-1 text-[10px] text-aegis-text-dim">{t('activity.runConsole.auditMetadataOnly', '仅显示官方 metadata-only 记录')}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
