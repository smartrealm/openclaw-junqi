import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bot, ChevronRight, PanelsTopLeft, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AgentOfficeView } from '@/components/Collaboration/AgentOfficeView';
import {
  CollaborationRunStatusIcon,
  collaborationRunStatusLabel,
  type CollaborationTranslate,
} from '@/components/Collaboration/CollaborationCard';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { useCollaborationStore } from '@/stores/collaborationStore';
import type { CollaborationRunSummary } from '@/services/collaboration/types';
import {
  selectableAgentHubOfficeRuns,
  selectAgentHubOfficeRun,
} from './agentHubOfficeRunSelection';
import { AgentHubConfiguredOffice } from './AgentHubConfiguredOffice';

interface AgentHubOfficePanelProps {
  connected: boolean;
  onOpenRun: (runId: string) => void;
  onShowAgentList: () => void;
}

function runLabel(run: CollaborationRunSummary, emptyGoal: string): string {
  return run.goal.trim() || emptyGoal;
}

export function AgentHubOfficePanel({
  connected,
  onOpenRun,
  onShowAgentList,
}: AgentHubOfficePanelProps) {
  const { t, i18n } = useTranslation();
  const capabilities = useCollaborationStore((state) => state.capabilities);
  const runsById = useCollaborationStore((state) => state.runsById);
  const snapshotsByRunId = useCollaborationStore((state) => state.snapshotsByRunId);
  const bootstrap = useCollaborationStore((state) => state.bootstrap);
  const syncGlobalRuns = useCollaborationStore((state) => state.syncGlobalRuns);
  const refreshRun = useCollaborationStore((state) => state.refreshRun);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const selectedRunRef = useRef<string | null>(null);

  const runs = useMemo(
    () => selectableAgentHubOfficeRuns(Object.values(runsById)),
    [runsById],
  );
  const selectedRun = useMemo(
    () => selectAgentHubOfficeRun(runs, selectedRunId),
    [runs, selectedRunId],
  );
  const snapshot = selectedRun ? snapshotsByRunId[selectedRun.runId] : undefined;
  const configuredAgents = capabilities?.configuredAgents ?? [];
  const text = useCallback<CollaborationTranslate>((key, fallback, values) => (
    String(t(key, { defaultValue: fallback, ...values }))
  ), [t]);

  const load = useCallback(async (preferredRunId?: string | null) => {
    if (!connected) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      await bootstrap();
      const loadedRuns = await syncGlobalRuns({ includeArchived: false });
      if (requestRef.current !== requestId) return;
      const next = selectAgentHubOfficeRun(
        loadedRuns,
        preferredRunId ?? selectedRunRef.current,
      );
      selectedRunRef.current = next?.runId ?? null;
      setSelectedRunId(next?.runId ?? null);
      if (next) await refreshRun(next.runId);
    } catch (cause) {
      if (requestRef.current === requestId) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [bootstrap, connected, refreshRun, syncGlobalRuns]);

  useEffect(() => {
    if (!connected) {
      requestRef.current += 1;
      setLoading(false);
      setError(null);
      return;
    }
    void load();
  }, [connected, load]);

  useEffect(() => {
    const next = selectAgentHubOfficeRun(runs, selectedRunRef.current);
    if (next?.runId === selectedRunRef.current) return;
    selectedRunRef.current = next?.runId ?? null;
    setSelectedRunId(next?.runId ?? null);
  }, [runs]);

  const selectRun = async (runId: string) => {
    selectedRunRef.current = runId;
    setSelectedRunId(runId);
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      await refreshRun(runId);
    } catch (cause) {
      if (requestRef.current === requestId) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  };

  if (!connected) {
    return (
      <section className="rounded-xl border border-aegis-border bg-aegis-surface-solid p-5" aria-label={t('agentHub.office.title', '协作办公室')}>
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.035)] text-aegis-text-muted">
            <PanelsTopLeft size={17} aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-aegis-text-secondary">{t('agentHub.office.disconnectedTitle', '协作办公室暂不可用')}</h2>
            <p className="mt-1 text-xs leading-5 text-aegis-text-muted">{t('agentHub.office.disconnectedDescription', '连接 Gateway 后，才能读取权威协作运行状态。')}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-label={t('agentHub.office.title', '协作办公室')} data-agent-hub-office>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-aegis-border bg-aegis-surface-solid px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-aegis-primary/25 bg-aegis-primary/[0.08] text-aegis-primary">
            <PanelsTopLeft size={16} aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-aegis-text">{t('agentHub.office.title', '协作办公室')}</h2>
            <p className="mt-0.5 text-[11px] text-aegis-text-muted">{t('agentHub.office.description', '从当前协作运行快照派生的只读视图。')}</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {runs.length > 0 && (
            <label className="min-w-0">
              <span className="sr-only">{t('agentHub.office.runSelectorLabel', '选择协作运行')}</span>
              <select
                value={selectedRun?.runId ?? ''}
                onChange={(event) => void selectRun(event.target.value)}
                disabled={loading}
                aria-label={t('agentHub.office.runSelectorLabel', '选择协作运行')}
                className="max-w-[min(26rem,calc(100vw-8rem))] rounded-lg border border-aegis-border bg-aegis-bg px-2.5 py-1.5 text-xs text-aegis-text outline-none transition-colors focus-visible:border-aegis-primary disabled:cursor-not-allowed disabled:opacity-55"
              >
                {runs.map((run) => (
                  <option key={run.runId} value={run.runId}>
                    {`${runLabel(run, t('agentHub.office.untitledRun', '未命名协作运行'))} · ${collaborationRunStatusLabel(run.status, text)}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => void load(selectedRunRef.current)}
            disabled={loading}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-aegis-border bg-aegis-bg px-2.5 text-[11px] font-medium text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:bg-aegis-elevated-solid disabled:cursor-not-allowed disabled:opacity-55"
          >
            {loading ? <LoadingIndicator size={13} /> : <RefreshCw size={13} aria-hidden />}
            <span>{t('agentHub.office.refresh', '刷新')}</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex min-w-0 items-start gap-2 rounded-lg border border-aegis-danger/30 bg-aegis-danger/[0.07] px-3 py-2.5 text-xs text-aegis-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="font-medium">{t('agentHub.office.loadFailed', '读取协作运行失败')}</div>
            <div className="mt-0.5 break-words font-mono text-[10px] opacity-85">{error}</div>
          </div>
        </div>
      )}

      {!error && loading && !snapshot && (
        <div className="flex min-h-48 items-center justify-center rounded-xl border border-aegis-border bg-aegis-surface-solid">
          <LoadingIndicator size={20} className="text-aegis-primary" label={t('agentHub.office.loading', '正在读取协作运行…')} />
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-3" data-agent-hub-office-workspace>
          <AgentHubConfiguredOffice agents={configuredAgents} />

          {!selectedRun && (
            <div className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-aegis-border bg-aegis-surface-solid px-5 text-center">
              <Bot size={20} className="text-aegis-text-dim" aria-hidden />
              <div>
                <h3 className="text-sm font-semibold text-aegis-text-secondary">{t('agentHub.office.emptyTitle', '暂无协作运行')}</h3>
                <p className="mt-1 max-w-md text-xs leading-5 text-aegis-text-muted">{t('agentHub.office.emptyDescription', '当前没有可投影到办公室的未归档协作运行。')}</p>
              </div>
              <button
                type="button"
                onClick={onShowAgentList}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-aegis-border bg-aegis-bg px-2.5 text-[11px] font-medium text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:bg-aegis-elevated-solid"
              >
                {t('agentHub.office.showAgentList', '查看智能体列表')}
                <ChevronRight size={13} aria-hidden />
              </button>
            </div>
          )}

          {snapshot && selectedRun && (
            <div className="space-y-2 rounded-xl border border-aegis-border bg-aegis-surface-solid p-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-aegis-text-muted">
            <div className="flex min-w-0 items-center gap-1.5">
              <CollaborationRunStatusIcon status={selectedRun.status} size={13} />
              <span>{collaborationRunStatusLabel(selectedRun.status, text)}</span>
              <span className="text-aegis-text-dim">{t('agentHub.office.updatedAt', '更新于 {{time}}', {
                time: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(selectedRun.updatedAt),
              })}</span>
            </div>
            <button
              type="button"
              onClick={() => onOpenRun(selectedRun.runId)}
              className="inline-flex min-h-7 items-center gap-1 text-[11px] font-medium text-aegis-primary transition-colors hover:text-aegis-primary/80"
            >
              {t('agentHub.office.openRun', '查看执行详情')}
              <ChevronRight size={13} aria-hidden />
            </button>
          </div>
          <AgentOfficeView
            snapshot={snapshot}
            configuredAgents={configuredAgents}
            coordinatorAgentId={capabilities?.coordinatorAgentId ?? null}
            text={text}
          />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
