// 工具调用采用紧凑摘要与按需详情，内容仅来自 OpenClaw 的工具投影。

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/shared/icons';
import clsx from 'clsx';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { serializeToolOutput } from '@/processing/toolExecutionProjection';
import { getToolLabelKey, type BuiltInToolName } from './toolCallPresentation';

export interface ToolCallInfo {
  toolName: string;
  input?: Record<string, unknown>;
  output?: string;
  status: 'running' | 'done' | 'error' | 'cancelled' | 'verification_required';
  durationMs?: number;
  error?: string;
  outputTruncated?: boolean;
  outputOriginalLength?: number;
}

// 工具分类只影响语义化主题色，不改变工具能力或执行状态。
type ToolCategory = 'search' | 'file' | 'exec' | 'memory' | 'agent' | 'media' | 'misc';

interface ToolPresentation {
  icon: React.ReactNode;
  category: ToolCategory;
}

const TOOL_REGISTRY: Record<BuiltInToolName, ToolPresentation> = {
  web_search:     { icon: Icon.chat.tool.search, category: 'search' },
  web_fetch:      { icon: Icon.chat.tool.web, category: 'search' },
  browser:        { icon: Icon.chat.tool.browser, category: 'search' },
  Read:           { icon: Icon.chat.tool.read, category: 'file' },
  Write:          { icon: Icon.chat.tool.edit, category: 'file' },
  Edit:           { icon: Icon.chat.tool.edit, category: 'file' },
  exec:           { icon: Icon.chat.tool.bash, category: 'exec' },
  process:        { icon: Icon.chat.tool.process, category: 'exec' },
  memory_search:  { icon: Icon.chat.tool.memory, category: 'memory' },
  memory_get:     { icon: Icon.chat.tool.memory, category: 'memory' },
  sessions_spawn: { icon: Icon.chat.tool.agent, category: 'agent' },
  sessions_send:  { icon: Icon.chat.tool.message, category: 'agent' },
  session_status: { icon: Icon.chat.tool.stats, category: 'agent' },
  cron:           { icon: Icon.chat.tool.schedule, category: 'misc' },
  image:          { icon: Icon.chat.tool.media, category: 'media' },
  tts:            { icon: Icon.chat.tool.audio, category: 'media' },
  gateway:        { icon: Icon.chat.tool.gateway, category: 'misc' },
  message:        { icon: Icon.chat.tool.chat, category: 'misc' },
};

const CATEGORY_COLORS: Record<ToolCategory, string> = {
  search: 'text-aegis-accent',
  file:   'text-aegis-success',
  exec:   'text-aegis-warning',
  memory: 'text-aegis-primary',
  agent:  'text-aegis-primary',
  media:  'text-aegis-accent',
  misc:   'text-aegis-text-dim',
};

function getToolInfo(name: string): ToolPresentation {
  return TOOL_REGISTRY[name as BuiltInToolName] || { icon: Icon.chat.tool.default, category: 'misc' };
}

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  void toolName;
  if (!input || Object.keys(input).length === 0) return '';
  const query = input.query || input.q || input.url || input.path || input.file_path
    || input.command || input.message || input.text || input.task;
  if (query && typeof query === 'string') {
    return query.length > 80 ? query.slice(0, 77) + '…' : query;
  }
  const first = Object.entries(input)[0];
  if (first) {
    const val = typeof first[1] === 'string' ? first[1] : serializeToolOutput(first[1]);
    const truncated = val.length > 60 ? val.slice(0, 57) + '…' : val;
    return `${first[0]}: ${truncated}`;
  }
  return '';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface ToolCallBubbleProps {
  tool: ToolCallInfo;
}

export function ToolCallBubble({ tool }: ToolCallBubbleProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const info = getToolInfo(tool.toolName);
  const labelKey = getToolLabelKey(tool.toolName);
  const toolLabel = labelKey ? t(labelKey) : tool.toolName;
  const catColor = CATEGORY_COLORS[info.category];
  const summary = tool.input ? summarizeInput(tool.toolName, tool.input) : '';
  const hasDetails = !!(tool.input && Object.keys(tool.input).length > 0) || !!tool.output || !!tool.error;

  return (
    <div className="ml-[46px] mr-4 py-[2px]">
      <div
        className={clsx(
          'w-full max-w-[min(640px,72%)] overflow-hidden rounded-lg border transition-[background-color,border-color,box-shadow] duration-200',
          expanded ? 'border-aegis-border bg-aegis-hover/25 shadow-[0_2px_10px_rgb(var(--aegis-overlay)/0.04)]' : 'border-transparent hover:border-aegis-border hover:bg-aegis-hover/20',
        )}
      >
        <button
          type="button"
          disabled={!hasDetails}
          aria-expanded={hasDetails ? expanded : undefined}
          onClick={() => setExpanded((value) => !value)}
          className={clsx(
            'flex min-h-[32px] w-full max-w-full items-center gap-2 px-2 text-left transition-colors',
            hasDetails ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-aegis-primary/60' : 'cursor-default',
          )}
        >
          {/* 上游工具状态 */}
          {tool.status === 'running' ? (
            <LoadingIndicator size={12} className="text-aegis-accent shrink-0" />
          ) : tool.status === 'error' ? (
            <span className="w-3 h-3 flex items-center justify-center shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-aegis-danger" />
            </span>
          ) : tool.status === 'verification_required' ? (
            <span className="w-3 h-3 flex items-center justify-center shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-aegis-warning" />
            </span>
          ) : tool.status === 'cancelled' ? (
            <span className="w-3 h-3 flex items-center justify-center shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-aegis-text-dim/50" />
            </span>
          ) : (
            <span className="w-3 h-3 flex items-center justify-center shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-aegis-success/60" />
            </span>
          )}

          {/* 工具图标 */}
          <span className={clsx('shrink-0 flex items-center', catColor)}>
            {info.icon}
          </span>

          {/* 工具名称 */}
          <span className={clsx('text-[11px] font-medium shrink-0', catColor)}>
            {toolLabel}
          </span>

          {/* 摘要或关键参数 */}
          {summary && (
            <span className="text-[10px] text-aegis-text-dim/60 font-mono truncate min-w-0">
              {summary}
            </span>
          )}

          {/* 时长与展开入口 */}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {tool.durationMs !== undefined && tool.status !== 'running' && (
              <span className="text-[11px] text-aegis-text-secondary font-mono tabular-nums font-medium px-1.5 py-0.5 rounded bg-[rgb(var(--aegis-overlay)/0.10)]">
                {formatDuration(tool.durationMs)}
              </span>
            )}
            {hasDetails && (
              expanded
                ? <ChevronDown size={10} className="text-aegis-text-dim/30" />
                : <ChevronRight size={10} className="text-aegis-text-dim/30" />
            )}
          </div>
        </button>

        {/* 按需展开的真实输入、输出与错误 */}
        {expanded && hasDetails && (
          <div className="border-t border-aegis-border/70 bg-aegis-hover/20 px-2.5 py-2.5 space-y-2">
            {tool.input && Object.keys(tool.input).length > 0 && (
              <div>
                <div className="text-[9px] font-medium text-aegis-text-dim/50 uppercase tracking-wider mb-1">
                  {t('chat.trace.input')}
                </div>
                <pre className="text-[10px] font-mono text-aegis-text-muted/80 whitespace-pre-wrap break-all
                  bg-[rgb(var(--aegis-overlay)/0.04)] rounded-md p-2 max-h-[150px] overflow-auto
                  border border-[rgb(var(--aegis-overlay)/0.04)]"
                  dir="ltr">
                  {JSON.stringify(tool.input, null, 2)}
                </pre>
              </div>
            )}
            {tool.output && (
              <div>
                <div
                  className="mb-1 text-[9px] font-medium uppercase tracking-wider text-aegis-text-dim/50"
                  data-tool-output-truncated={tool.outputTruncated || undefined}
                  title={tool.outputTruncated && tool.outputOriginalLength !== undefined
                    ? t('chat.trace.outputTruncated', { count: tool.outputOriginalLength })
                    : undefined}
                >
                  {tool.outputTruncated && tool.outputOriginalLength !== undefined
                    ? t('chat.trace.outputTruncated', { count: tool.outputOriginalLength })
                    : t('chat.trace.output')}
                </div>
                <pre className="text-[10px] font-mono text-aegis-text-muted/80 whitespace-pre-wrap break-all
                  bg-[rgb(var(--aegis-overlay)/0.04)] rounded-md p-2 max-h-[200px] overflow-auto
                  border border-[rgb(var(--aegis-overlay)/0.04)]"
                  dir="ltr">
                  {tool.output}
                </pre>
              </div>
            )}
            {tool.error && (
              <div>
                <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-aegis-danger/70">
                  {t('chat.trace.toolError')}
                </div>
                <pre
                  className="max-h-[150px] overflow-auto break-all rounded-md border border-aegis-danger/20 bg-aegis-danger/5 p-2 font-mono text-[10px] text-aegis-danger/80 whitespace-pre-wrap"
                  dir="ltr"
                >
                  {tool.error}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
