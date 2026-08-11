import { useEffect, useId, useState } from 'react';
import { ChevronDown, History, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { AgentExecutionPlan, ExecutionPlanStepState } from '@/agent-execution-plan/domain';
import { StatusIcon, type StatusIconValue } from '@/components/shared/StatusIcon';
import type { ExecutionPlanOutcome } from './executionPlanPlacement';

const COLLAPSE_PREFERENCE_PREFIX = 'junqi:chat-plan-collapsed:';

function readCollapsedPreference(plan: AgentExecutionPlan, outcome: ExecutionPlanOutcome): boolean {
  try {
    const stored = localStorage.getItem(`${COLLAPSE_PREFERENCE_PREFIX}${plan.id}`);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // 持久化不可用时仍使用当前会话的真实计划状态。
  }
  return outcome !== 'running';
}

function persistCollapsedPreference(planId: string, collapsed: boolean): void {
  try {
    localStorage.setItem(`${COLLAPSE_PREFERENCE_PREFIX}${planId}`, String(collapsed));
  } catch {
    // 受限桌面 WebView 无法写入偏好时，不影响当前计划展示。
  }
}

function iconStatus(state: ExecutionPlanStepState): StatusIconValue {
  if (state === 'running') return 'running';
  if (state === 'completed') return 'completed';
  return 'pending';
}

export function ExecutionPlanCard({
  plan,
  outcome,
  onOpenTrace,
}: {
  plan: AgentExecutionPlan;
  /** `plan.state` 不能区分运行中与运行中断，终态必须由响应组提供。 */
  outcome: ExecutionPlanOutcome;
  /** 打开包含全部上游计划快照的响应追溯。 */
  onOpenTrace?: () => void;
}) {
  const { t } = useTranslation();
  const regionId = useId();
  const [collapsed, setCollapsed] = useState(() => readCollapsedPreference(plan, outcome));
  const currentStep = plan.steps[plan.currentStepIndex] ?? plan.steps[0];
  const completedCount = plan.steps.filter((step) => step.state === 'completed').length;
  // 运行中和中断计划摘要当前步骤；完成计划摘要最后完成步骤，避免重复计数。
  const summaryStep = outcome === 'completed'
    ? plan.steps[plan.steps.length - 1] ?? currentStep
    : currentStep;

  useEffect(() => {
    setCollapsed(readCollapsedPreference(plan, outcome));
  }, [plan.id]);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      persistCollapsedPreference(plan.id, next);
      return next;
    });
  };

  return (
    <section
      data-execution-plan-card="true"
      data-execution-plan-state={outcome}
      className="w-full overflow-hidden rounded-lg border border-aegis-border bg-aegis-card"
      aria-label={t('chat.executionPlan.ariaLabel')}
      aria-live="polite"
    >
      <div className="flex items-stretch">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={regionId}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-start transition-[background-color,border-color] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] motion-reduce:transition-none hover:bg-aegis-hover/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-aegis-primary/60"
      >
        <ListChecks size={16} className="shrink-0 text-aegis-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[12px] font-semibold text-aegis-text">
              {t('chat.executionPlan.title')}
            </span>
            <span className="shrink-0 rounded bg-aegis-hover px-1.5 py-0.5 text-[10px] tabular-nums text-aegis-text-dim">
              {outcome === 'completed'
                ? t('chat.executionPlan.summaryCompleted', { total: plan.steps.length })
                : outcome === 'interrupted'
                  ? t('chat.executionPlan.summaryInterrupted', {
                    completed: completedCount,
                    total: plan.steps.length,
                  })
                  : t('chat.executionPlan.progress', {
                    current: plan.currentStepIndex + 1,
                    total: plan.steps.length,
                  })}
            </span>
            {outcome === 'interrupted' && (
              <span className="shrink-0 rounded bg-aegis-danger/10 px-1.5 py-0.5 text-[9px] text-aegis-danger">
                {t('chat.executionPlan.interruptedBadge')}
              </span>
            )}
            {plan.revision > 1 && (
              <span className="shrink-0 text-[9px] text-aegis-text-dim">
                {t('chat.executionPlan.revision', {
                  revision: plan.revision,
                })}
              </span>
            )}
          </div>
          {summaryStep && (
            <div className="mt-0.5 truncate text-[11px] text-aegis-text-muted">
              {summaryStep.title}
            </div>
          )}
        </div>
        <ChevronDown
          size={15}
          className={clsx(
            'shrink-0 text-aegis-text-dim transition-transform duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] motion-reduce:transition-none',
            collapsed && '-rotate-90',
          )}
        />
      </button>
      {onOpenTrace && (
        <button
          type="button"
          onClick={onOpenTrace}
          title={t('chat.executionPlan.openTrace')}
          aria-label={t('chat.executionPlan.openTrace')}
          className="grid w-11 shrink-0 place-items-center border-s border-aegis-border text-aegis-text-dim transition-colors motion-reduce:transition-none hover:bg-aegis-hover/35 hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-aegis-primary/60"
        >
          <History size={14} />
        </button>
      )}
      </div>

      {!collapsed && (
        <div id={regionId} className="border-t border-aegis-border px-3 py-2.5 motion-safe:animate-fade-in">
          {plan.explanation && (
            <p className="mb-2 text-[11px] leading-relaxed text-aegis-text-muted">
              {plan.explanation}
            </p>
          )}
          {plan.previousStepCount !== undefined && (
            <p className="mb-2 text-[10px] text-aegis-text-dim">
              {t('chat.executionPlan.stepCountChanged', {
                previous: plan.previousStepCount,
                current: plan.steps.length,
              })}
            </p>
          )}
          <ol className="space-y-0.5">
            {plan.steps.map((step, index) => (
              <li key={step.id} data-execution-plan-step-state={step.state} className="relative grid min-w-0 grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2.5 py-1.5">
                {index < plan.steps.length - 1 && (
                  <span aria-hidden="true" className="absolute start-[7px] top-[22px] h-[calc(100%-8px)] w-px bg-aegis-border" />
                )}
                <span className="relative z-10 mt-0.5 grid size-4 shrink-0 place-items-center bg-aegis-card">
                  <StatusIcon status={iconStatus(step.state)} size={14} />
                </span>
                <span className={clsx(
                  'min-w-0 break-words text-[12px] leading-5',
                  step.state === 'completed' ? 'text-aegis-text-dim' : 'text-aegis-text',
                )}>
                  {step.title}
                </span>
                <span className={clsx(
                  'mt-0.5 shrink-0 text-[9px] font-medium',
                  step.state === 'running'
                    ? 'text-aegis-primary'
                    : step.state === 'completed'
                      ? 'text-aegis-success'
                      : 'text-aegis-text-dim',
                )}>
                  {t(`chat.trace.nodeStatus.${step.state === 'running' ? 'running' : step.state}`)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
