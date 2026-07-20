import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Loader2,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { RenderBlock } from '@/types/RenderBlock';
import type { ExecutionProcessBlock } from './executionProcessGrouping';

interface ExecutionProcessGroupProps {
  blocks: ExecutionProcessBlock[];
  streaming: boolean;
  renderBlock: (block: RenderBlock) => ReactNode;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function toolLabel(name: string): string {
  const normalized = name.trim();
  if (!normalized) return 'tool';
  return normalized.length > 18 ? `${normalized.slice(0, 17)}…` : normalized;
}

export function ExecutionProcessGroup({ blocks, streaming, renderBlock }: ExecutionProcessGroupProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(streaming);
  const toolBlocks = useMemo(() => blocks.filter((block) => block.type === 'tool'), [blocks]);
  const thinkingCount = blocks.length - toolBlocks.length;
  const errorCount = toolBlocks.filter((block) => block.status === 'error').length;
  const runningCount = toolBlocks.filter((block) => block.status === 'running').length;
  const totalDuration = toolBlocks.reduce((sum, block) => sum + (block.durationMs ?? 0), 0);
  const uniqueTools = Array.from(new Set(toolBlocks.map((block) => toolLabel(block.toolName))));

  useEffect(() => {
    if (streaming) setExpanded(true);
    else setExpanded(false);
  }, [streaming]);

  const summary = errorCount > 0
    ? t('chat.execution.error', 'Execution error')
    : runningCount > 0
      ? t('chat.execution.running', 'Running')
      : t('chat.execution.done', 'Completed');

  return (
    <section className="ml-[46px] mr-4 py-1" aria-label={t('chat.execution.ariaLabel', 'Execution process')}>
      <div className={clsx(
        'max-w-[min(760px,88%)] overflow-hidden rounded-lg border transition-colors',
        expanded
          ? 'border-aegis-primary/15 bg-[rgb(var(--aegis-overlay)/0.025)]'
          : 'border-[rgb(var(--aegis-overlay)/0.06)] bg-transparent hover:bg-[rgb(var(--aegis-overlay)/0.025)]',
      )}>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-h-[31px] w-full items-center gap-2 px-2.5 py-1.5 text-left"
        >
          {streaming ? (
            <Loader2 size={13} className="shrink-0 animate-spin text-aegis-primary" />
          ) : errorCount > 0 ? (
            <TriangleAlert size={13} className="shrink-0 text-aegis-danger" />
          ) : (
            <Check size={13} className="shrink-0 text-aegis-success" />
          )}
          <span className="shrink-0 text-[11px] font-semibold text-aegis-text-secondary">{summary}</span>
          <span className="text-[10px] text-aegis-text-dim">
            {toolBlocks.length > 0 && t('chat.execution.toolCount', { count: toolBlocks.length, defaultValue: '{{count}} tools' })}
            {thinkingCount > 0 && `${toolBlocks.length > 0 ? ' · ' : ''}${t('chat.execution.thinkingCount', { count: thinkingCount, defaultValue: '{{count}} thoughts' })}`}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {uniqueTools.slice(0, 3).map((name) => (
              <span key={name} className="inline-flex max-w-[110px] items-center gap-1 truncate rounded bg-[rgb(var(--aegis-overlay)/0.06)] px-1.5 py-0.5 font-mono text-[9px] text-aegis-text-dim">
                <Wrench size={9} className="shrink-0" />
                {name}
              </span>
            ))}
            {uniqueTools.length > 3 && <span className="shrink-0 text-[9px] text-aegis-text-dim">+{uniqueTools.length - 3}</span>}
          </span>
          {totalDuration > 0 && (
            <span className="hidden shrink-0 items-center gap-1 font-mono text-[10px] text-aegis-text-dim sm:inline-flex">
              <Clock3 size={10} />
              {formatDuration(totalDuration)}
            </span>
          )}
          {thinkingCount > 0 && <BrainCircuit size={11} className="hidden shrink-0 text-aegis-primary/60 sm:block" />}
          {expanded ? <ChevronDown size={12} className="shrink-0 text-aegis-text-dim" /> : <ChevronRight size={12} className="shrink-0 text-aegis-text-dim" />}
        </button>
        {expanded && (
          <div className="space-y-1 border-t border-[rgb(var(--aegis-overlay)/0.06)] px-1 py-1.5">
            {blocks.map((block) => (
              <div key={block.id} className="-ml-[46px]">{renderBlock(block)}</div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
