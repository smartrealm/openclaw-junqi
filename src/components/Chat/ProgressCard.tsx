import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  currentOpenClawProgressCardStepIndex,
  type OpenClawProgressCard,
  type OpenClawProgressCardStepStatus,
} from '@/progress-card/domain';
import { StatusIcon, type StatusIconValue } from '@/components/shared/StatusIcon';
import { ChatMarkdownRenderer } from './ChatMarkdownRenderer';

const COLLAPSE_PREFERENCE_PREFIX = 'junqi:progress-card-collapsed:';
const PROGRESS_ELEMENT_PATTERN = /<progress\b([^>]*)><\/progress>/gi;
const PROGRESS_ATTRIBUTE_PATTERN = /\b(value|max)\s*=\s*["']([^"']+)["']/gi;

function readCollapsedPreference(cardId: string): boolean {
  try {
    return localStorage.getItem(`${COLLAPSE_PREFERENCE_PREFIX}${cardId}`) === 'true';
  } catch {
    // 本地偏好不可用时默认展开当前官方进度卡。
    return false;
  }
}

function persistCollapsedPreference(cardId: string, collapsed: boolean): void {
  try {
    localStorage.setItem(`${COLLAPSE_PREFERENCE_PREFIX}${cardId}`, String(collapsed));
  } catch {
    // 受限桌面 WebView 无法写入偏好时，不影响当前卡片展示。
  }
}

function iconStatus(status: OpenClawProgressCardStepStatus): StatusIconValue {
  if (status === 'in_progress') return 'running';
  return status;
}

interface MarkdownPart {
  readonly kind: 'markdown' | 'progress';
  readonly content?: string;
  readonly value?: number;
  readonly maximum?: number;
}

export function splitOpenClawProgressCardMarkdown(markdown: string): readonly MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  let cursor = 0;
  for (const match of markdown.matchAll(PROGRESS_ELEMENT_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: 'markdown', content: markdown.slice(cursor, index) });
    const attributes = new Map<string, string>();
    for (const attribute of match[1].matchAll(PROGRESS_ATTRIBUTE_PATTERN)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2]);
    }
    const value = Number(attributes.get('value'));
    const maximum = Number(attributes.get('max'));
    if (Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0 && value >= 0) {
      parts.push({ kind: 'progress', value: Math.min(value, maximum), maximum });
    } else {
      parts.push({ kind: 'markdown', content: match[0] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < markdown.length) parts.push({ kind: 'markdown', content: markdown.slice(cursor) });
  return parts;
}

function ProgressCardMarkdown({ markdown }: { markdown: string }) {
  const parts = useMemo(() => splitOpenClawProgressCardMarkdown(markdown), [markdown]);
  return (
    <div className="space-y-2 text-[11px] leading-5 text-aegis-text-muted">
      {parts.map((part, index) => part.kind === 'progress' ? (
        <progress
          key={`progress-${index}`}
          value={part.value}
          max={part.maximum}
          className="h-2 w-full overflow-hidden rounded-full accent-aegis-primary"
        />
      ) : (
        <div key={`markdown-${index}`} className="break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <ChatMarkdownRenderer markdown={part.content ?? ''} />
        </div>
      ))}
    </div>
  );
}

function ProgressCardDetails({ card }: { card: OpenClawProgressCard }) {
  const { t } = useTranslation();
  return (
    <div
      className="chat-scrollbar max-h-[min(42vh,360px)] overflow-y-auto overscroll-contain px-3 py-2.5 motion-safe:animate-fade-in"
    >
      {card.markdown && <ProgressCardMarkdown markdown={card.markdown} />}
      {card.markdown && card.steps.length > 0 && <div className="my-2 border-t border-aegis-border" />}
      {card.steps.length > 0 && (
        <ol className="space-y-0.5">
          {card.steps.map((step, index) => (
            <li
              key={step.id}
              data-progress-card-step-state={step.status}
              className="relative grid min-w-0 grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2.5 py-1.5"
            >
              {index < card.steps.length - 1 && (
                <span aria-hidden="true" className="absolute start-[7px] top-[22px] h-[calc(100%-8px)] w-px bg-aegis-border" />
              )}
              <span className="relative z-10 mt-0.5 grid size-4 shrink-0 place-items-center bg-aegis-card">
                <StatusIcon status={iconStatus(step.status)} size={14} />
              </span>
              <span className={clsx(
                'min-w-0 break-words text-[12px] leading-5',
                step.status === 'completed' ? 'text-aegis-text-dim' : 'text-aegis-text',
              )}>
                {step.step}
              </span>
              <span className={clsx(
                'mt-0.5 shrink-0 text-[9px] font-medium',
                step.status === 'in_progress'
                  ? 'text-aegis-primary'
                  : step.status === 'completed'
                    ? 'text-aegis-success'
                    : 'text-aegis-text-dim',
              )}>
                {t(`chat.trace.nodeStatus.${step.status === 'in_progress' ? 'running' : step.status}`)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ProgressCard({ card }: { card: OpenClawProgressCard }) {
  const { t } = useTranslation();
  const regionId = useId();
  const [collapsed, setCollapsed] = useState(() => readCollapsedPreference(card.id));
  const currentStepIndex = currentOpenClawProgressCardStepIndex(card);
  const currentStep = card.steps[currentStepIndex];
  const progress = currentStep
    ? t('chat.executionPlan.progress', { current: currentStepIndex + 1, total: card.steps.length })
    : t('chat.executionPlan.noteOnly');

  useEffect(() => {
    setCollapsed(readCollapsedPreference(card.id));
  }, [card.id]);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      persistCollapsedPreference(card.id, next);
      return next;
    });
  };

  return (
    <section
      data-progress-card="true"
      data-progress-card-revision={card.revision}
      className="flex w-full flex-col items-center"
      aria-label={t('chat.executionPlan.ariaLabel')}
      aria-live="polite"
    >
      <div
        id={regionId}
        hidden={collapsed}
        className="mb-2 w-full max-w-[640px] overflow-hidden rounded-xl border border-aegis-border bg-aegis-card shadow-popover"
      >
        <div className="flex min-h-10 items-center gap-2 border-b border-aegis-border px-3 py-2">
          <ListChecks size={15} className="shrink-0 text-aegis-primary" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-aegis-text">
            {t('chat.executionPlan.title')}
          </span>
          <span className="shrink-0 text-[9px] text-aegis-text-dim">
            {t('chat.executionPlan.revision', { revision: card.revision })}
          </span>
        </div>
        <ProgressCardDetails card={card} />
      </div>
      <button
        type="button"
        data-progress-card-trigger="true"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={regionId}
        aria-label={`${t('chat.executionPlan.title')}，${progress}`}
        className="flex min-h-10 items-center gap-2 rounded-full border border-aegis-border bg-aegis-card px-4 py-2 text-aegis-text-secondary shadow-sm transition-[background-color,border-color,color,transform] duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] motion-reduce:transition-none hover:border-aegis-primary/35 hover:bg-aegis-hover/35 hover:text-aegis-text active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40"
      >
        {currentStep
          ? <StatusIcon status={iconStatus(currentStep.status)} size={17} />
          : <ListChecks size={16} className="text-aegis-primary" />}
        <span className="text-[12px] font-medium tabular-nums">{progress}</span>
        <ChevronDown
          size={14}
          className={clsx(
            'text-aegis-text-dim transition-transform duration-[var(--aegis-duration-normal)] ease-[var(--aegis-ease-standard)] motion-reduce:transition-none',
            !collapsed && 'rotate-180',
          )}
        />
      </button>
    </section>
  );
}
