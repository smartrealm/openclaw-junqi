// ═══════════════════════════════════════════════════════════
// ToolCallBubble — Console-style tool execution display
// Compact, minimal, information-dense — inspired by Control UI
//
// Tool icons: @phosphor-icons/react (regular weight, polished)
// Chrome icons: lucide-react (ChevronDown, ChevronRight)
// ═══════════════════════════════════════════════════════════

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

// ── Tool category + style ─────────────────────────────────
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
  search: 'text-blue-400',
  file:   'text-emerald-400',
  exec:   'text-amber-400',
  memory: 'text-purple-400',
  agent:  'text-rose-400',
  media:  'text-cyan-400',
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
          'w-full max-w-[min(640px,72%)] rounded-lg transition-all duration-150',
          hasDetails && 'cursor-pointer',
          expanded && 'bg-[rgb(var(--aegis-overlay)/0.03)]',
          !expanded && 'hover:bg-[rgb(var(--aegis-overlay)/0.02)]',
        )}
        onClick={() => hasDetails && setExpanded((v) => !v)}
      >
        {/* ── Inline status row (Control UI style) ── */}
        <div className="flex max-w-full items-center gap-2 px-0 py-1 min-h-[28px]">
          {/* Status indicator */}
          {tool.status === 'running' ? (
            <LoadingIndicator size={12} className="text-aegis-accent shrink-0" />
          ) : tool.status === 'error' ? (
            <span className="w-3 h-3 flex items-center justify-center shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-aegis-danger" />
            </span>
          ) : tool.status === 'verification_required' ? (
            <span className="w-3 h-3 flex items-center justify-center shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
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

          {/* Tool icon (phosphor regular, consistent weight) */}
          <span className={clsx('shrink-0 flex items-center', catColor)}>
            {info.icon}
          </span>

          {/* Tool name */}
          <span className={clsx('text-[11px] font-medium shrink-0', catColor)}>
            {toolLabel}
          </span>

          {/* Summary / key param */}
          {summary && (
            <span className="text-[10px] text-aegis-text-dim/60 font-mono truncate min-w-0">
              {summary}
            </span>
          )}

          {/* Duration + expand — 右对齐 */}
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
        </div>

        {/* ── Expanded detail panel ── */}
        {expanded && hasDetails && (
          <div className="px-2.5 py-2 space-y-2">
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
