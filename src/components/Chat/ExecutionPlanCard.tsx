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
    // Storage is optional; the component remains usable without persistence.
  }
  return outcome !== 'running';
}

function persistCollapsedPreference(planId: string, collapsed: boolean): void {
  try {
    localStorage.setItem(`${COLLAPSE_PREFERENCE_PREFIX}${planId}`, String(collapsed));
  } catch {
    // Ignore storage failures in restricted desktop webviews.
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
  /**
   * Required: `plan.state` alone cannot tell a running plan from one whose run
   * died mid-step, and defaulting either way would mislabel the other.
   */
  outcome: ExecutionPlanOutcome;
  /** Opens the response trace, the only surface holding every plan snapshot. */
  onOpenTrace?: () => void;
}) {
  const { t } = useTranslation();
  const regionId = useId();
  const [collapsed, setCollapsed] = useState(() => readCollapsedPreference(plan, outcome));
  const currentStep = plan.steps[plan.currentStepIndex] ?? plan.steps[0];
  const completedCount = plan.steps.filter((step) => step.state === 'completed').length;
  // Running and interrupted plans summarise where they are; a completed plan
  // summarises what it finished with, since "5/5" already carries the count.
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
      className="w-full overflow-hidden rounded-xl border border-aegis-border bg-aegis-surface"
      aria-label={t('chat.executionPlan.ariaLabel')}
      aria-live="polite"
    >
      <div className="flex items-stretch">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={regionId}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
      >
        <ListChecks size={16} className="shrink-0 text-aegis-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[12px] font-semibold text-aegis-text">
              {t('chat.executionPlan.title')}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-aegis-text-dim">
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
              <span className="shrink-0 rounded border border-aegis-status-failed/40 px-1.5 py-0.5 text-[9px] text-aegis-status-failed">
                {t('chat.executionPlan.interruptedBadge')}
              </span>
            )}
            {plan.revision > 1 && (
              <span className="shrink-0 rounded border border-aegis-border px-1.5 py-0.5 text-[9px] text-aegis-text-dim">
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
            'shrink-0 text-aegis-text-dim transition-transform motion-reduce:transition-none',
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
          className="grid w-11 shrink-0 place-items-center border-s border-aegis-border text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.04)] hover:text-aegis-text"
        >
          <History size={14} />
        </button>
      )}
      </div>

      {!collapsed && (
        <div id={regionId} className="border-t border-aegis-border px-3 py-2.5">
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
          <ol className="space-y-1.5">
            {plan.steps.map((step) => (
              <li key={step.id} className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
                  <StatusIcon status={iconStatus(step.state)} size={14} />
                </span>
                <span className={clsx(
                  'min-w-0 break-words text-[12px] leading-5',
                  step.state === 'completed' ? 'text-aegis-text-dim' : 'text-aegis-text',
                )}>
                  {step.title}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
