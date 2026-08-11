// 上游明确提供的思考内容以流式展开或完成后收起的方式呈现，不生成额外内容。

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { AgentActivityIndicator } from '@/components/shared/AgentActivityIndicator';

interface ThinkingBubbleProps {
  content: string;
  isStreaming?: boolean;
}

export function ThinkingBubble({ content, isStreaming = false }: ThinkingBubbleProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(isStreaming);
  const contentRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion() ?? false;

  useEffect(() => {
    if (isStreaming) setExpanded(true);
    else setExpanded(false);
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming && expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, isStreaming, expanded]);

  if (!content) return null;

  const lineCount = content.split('\n').length;
  const charCount = content.length;
  const sizeLabel = charCount > 1000 ? `${(charCount / 1000).toFixed(1)}k` : `${charCount}`;
  const compactSummary = t('thinking.compactSummary', { lines: lineCount, chars: sizeLabel });

  // 收起态与助手消息左边缘对齐，保持工具调用和轨迹卡片的阅读轴一致。
  if (!isStreaming && !expanded) {
    return (
      <div className="pl-[46px] py-[2px] min-w-0">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded="false"
          className="inline-flex min-h-[28px] items-center gap-2 rounded-lg border border-aegis-primary/15 bg-aegis-primary/[0.04] px-2.5 py-1.5 text-start transition-colors hover:bg-aegis-primary/[0.07] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"
        >
          <span className="w-3 h-3 flex items-center justify-center shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-aegis-primary/55" />
          </span>
          <span className="text-[11px] font-medium text-aegis-primary/85">
            {t('thinking.thoughtProcess')}
          </span>
          <span className="text-[9px] text-aegis-text-dim/55 font-mono tabular-nums">
            {compactSummary}
          </span>
          <ChevronRight size={10} className="text-aegis-text-dim/40" />
        </button>
      </div>
    );
  }

  // 展开态与流式状态复用同一容器，避免状态切换时改变消息的水平锚点。
  return (
    <div className="pl-[46px] py-[2px] min-w-0">
      <div
        className={clsx(
          'rounded-xl overflow-hidden transition-[border-color,background-color] duration-200',
          isStreaming
            ? 'border border-aegis-primary/20 bg-aegis-primary/[0.04]'
            : 'border border-aegis-primary/12 bg-aegis-primary/[0.02]',
        )}
      >
        <button
          type="button"
          onClick={() => !isStreaming && setExpanded(false)}
          disabled={isStreaming}
          aria-expanded={!isStreaming || undefined}
          className={clsx(
            'flex min-h-[32px] w-full items-center gap-2 px-2.5 py-1.5 text-start',
            !isStreaming && 'cursor-pointer transition-colors hover:bg-aegis-hover/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-aegis-primary/60',
          )}
        >
          {isStreaming ? (
            <AgentActivityIndicator
              activity="thinking"
              size={20}
              decorative
              paused={reduceMotion}
              className="-m-1 shrink-0 text-aegis-primary/75"
            />
          ) : (
            <span className="w-3 h-3 flex items-center justify-center shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-aegis-primary/45" />
            </span>
          )}

          <span className={clsx(
            'text-[11px] font-medium',
            isStreaming ? 'text-aegis-primary/75' : 'text-aegis-primary/70',
          )}>
            {isStreaming ? t('thinking.thinking') : t('thinking.thoughtProcess')}
          </span>

          {!isStreaming && (
            <span className="text-[9px] text-aegis-text-dim/45 font-mono tabular-nums">
              {compactSummary}
            </span>
          )}

          <span className="flex-1" />

          {!isStreaming && (
            <ChevronDown size={10} className="text-aegis-text-dim/30 shrink-0" />
          )}

        </button>

        {/* 上游提供的内容 */}
        <div className="border-t border-[rgb(var(--aegis-overlay)/0.04)]">
          <div
            ref={contentRef}
            className={clsx(
              'px-2.5 py-2 text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-words overflow-y-auto overflow-x-hidden',
              isStreaming ? 'text-aegis-text-muted/58 max-h-[250px]' : 'text-aegis-text-dim/52 max-h-[300px]',
            )}
          >
            {content}
            {isStreaming && (
              <span className={clsx(
                'ms-0.5 inline-block h-[12px] w-[2px] align-text-bottom bg-aegis-primary/35',
                !reduceMotion && 'animate-pulse',
              )} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
