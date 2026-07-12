// ═══════════════════════════════════════════════════════════
// SessionViewPage — JSONL session playback with interactive bubbles
//
// Reads Claude/Codex JSONL via `read_session_messages` (Tauri backend)
// and renders user/assistant messages with collapsible thinking blocks
// and expandable tool-use cards.
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSearchParams } from 'react-router-dom';
import { save } from '@tauri-apps/plugin-dialog';
import { marked } from 'marked';
import {
  ChevronDown, ChevronRight, Wrench, Copy, Check,
  AlertCircle, Loader2, ArrowLeft,
  User, Sparkles, Bot, Download, Braces,
  MessageSquare, Clock, FileDown,
  Play,
} from 'lucide-react';
import { debugError } from '@/utils/debugLog';

interface SessionContent {
  type: 'text' | 'tool_use' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: string;
  thinking?: string;
}

interface SessionMessage {
  role: 'user' | 'assistant';
  content: SessionContent[];
  /** Optional timestamp extracted from JSONL */
  timestamp?: string;
}

// ═══════════════════════════════════════════════════════════
// ToolUseCard — expandable tool invocation
// ═══════════════════════════════════════════════════════════

function ToolUseCard({ name, input }: { name: string; input: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyInput = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // Pretty-print if valid JSON
      const pretty = (() => { try { return JSON.stringify(JSON.parse(input), null, 2); } catch { return input; } })();
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="my-1.5 rounded-lg border overflow-hidden text-[12px] transition-colors duration-150"
      style={{
        borderColor: 'rgb(var(--aegis-primary) / 0.15)',
        background: 'rgb(var(--aegis-primary) / 0.02)',
      }}>
      <button type="button" onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-start transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.03)]">
        <span className={expanded ? 'text-aegis-primary' : 'text-aegis-text-dim'}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="p-1 rounded-md shrink-0" style={{ background: 'rgb(var(--aegis-primary) / 0.08)' }}>
          <Wrench size={12} className="text-aegis-primary" />
        </span>
        <span className="font-mono font-semibold text-aegis-text flex-1 truncate">{name}</span>
        <span className="text-[10px] text-aegis-text-dim font-mono shrink-0">
          {input.length > 100 ? `${Math.round(input.length / 100) * 100}+ chars` : `${input.length} chars`}
        </span>
      </button>
      {expanded && (
        <div className="relative">
          <pre className="m-0 px-4 py-3 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all border-t"
            style={{
              background: 'rgb(var(--aegis-bg))',
              color: 'rgb(var(--aegis-text-secondary))',
              maxHeight: 320,
              overflowY: 'auto',
              borderColor: 'rgb(var(--aegis-primary) / 0.08)',
            }}>
            {(() => { try { return JSON.stringify(JSON.parse(input), null, 2); } catch { return input; } })()}
          </pre>
          <button onClick={handleCopyInput}
            className="absolute top-2 right-2 p-1.5 rounded-md transition-all hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted hover:text-aegis-text"
            title="Copy tool input">
            {copied ? <Check size={13} className="text-aegis-success" /> : <Copy size={13} />}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ThinkingBlock — collapsible reasoning
// ═══════════════════════════════════════════════════════════

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mb-1.5">
      <button type="button" onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1.5 text-[11px] italic transition-colors hover:text-aegis-text-muted py-0.5"
        style={{ color: 'rgb(var(--aegis-text-dim))' }}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <BrainIcon />
        <span>thinking</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 text-[12px] italic border-l-2 mt-1 ml-1 whitespace-pre-wrap break-words rounded-r-md"
          style={{
            borderColor: 'rgb(var(--aegis-primary) / 0.2)',
            color: 'rgb(var(--aegis-text-muted))',
            background: 'rgb(var(--aegis-primary) / 0.02)',
            lineHeight: 1.6,
          }}>
          {thinking}
        </div>
      )}
    </div>
  );
}

// Inline brain SVG (matching lucide style)
function BrainIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">
      <path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46 2.5 2.5 0 0 0-1.98 3 2.5 2.5 0 0 0-1.32 4.24 3 3 0 0 0 .34 5.58 2.5 2.5 0 0 0 2.96 3.08 2.5 2.5 0 0 0 4.96.46 2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3 2.5 2.5 0 0 0-4.96.46Z" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// UserMessageBubble — right-aligned with copy action
// ═══════════════════════════════════════════════════════════

function UserMessageBubble({ text, timestamp }: { text: string; timestamp?: string }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const timeLabel = timestamp ? (() => {
    try {
      const d = new Date(timestamp);
      if (isNaN(d.getTime())) return '';
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return ''; }
  })() : '';

  return (
    <div className="mb-4 flex justify-end">
      <div className="flex flex-col items-end gap-1 max-w-[72%]">
        {/* Bubble */}
        <div className="relative group" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
          <div className="px-4 py-2.5 rounded-2xl text-[13.5px] whitespace-pre-wrap break-words transition-colors duration-150"
            style={{
              background: 'rgb(var(--aegis-primary) / 0.08)',
              color: 'rgb(var(--aegis-text))',
              lineHeight: 1.6,
              border: '1px solid rgb(var(--aegis-primary) / 0.10)',
            }}>
            {text}
          </div>
          {/* Copy on hover */}
          <button type="button" onClick={handleCopy}
            className={clsx2(
              'absolute -top-1 -right-1 p-1.5 rounded-full transition-all duration-150',
              'hover:bg-[rgb(var(--aegis-overlay)/0.08)]',
              hovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none',
            )}
            style={{ background: 'rgb(var(--aegis-bg))', border: '1px solid rgb(var(--aegis-border))' }}
            title="Copy">
            {copied ? <Check size={13} className="text-aegis-success" /> : <Copy size={13} className="text-aegis-text-muted" />}
          </button>
        </div>
        {/* Timestamp */}
        {timeLabel && (
          <span className="text-[10px] text-aegis-text-dim tabular-nums px-1">{timeLabel}</span>
        )}
      </div>
    </div>
  );
}

// tiny clsx inline to avoid import
function clsx2(...args: (string | false | undefined | null)[]): string {
  return args.filter(Boolean).join(' ');
}

// ═══════════════════════════════════════════════════════════
// AssistantMessageBlock — left-aligned with avatar + content
// ═══════════════════════════════════════════════════════════

function AssistantMessageBlock({ content, timestamp }: { content: SessionContent[]; timestamp?: string }) {
  const textParts = content.filter((c) => c.type === 'text');
  const toolParts = content.filter((c) => c.type === 'tool_use');
  const thinkingParts = content.filter((c) => c.type === 'thinking');

  const timeLabel = timestamp ? (() => {
    try {
      const d = new Date(timestamp);
      if (isNaN(d.getTime())) return '';
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return ''; }
  })() : '';

  if (textParts.length === 0 && toolParts.length === 0 && thinkingParts.length === 0) {
    return null;
  }

  return (
    <div className="mb-5 flex gap-3 items-start">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-700
        flex items-center justify-center shrink-0 mt-0.5 shadow-sm ring-1 ring-white/5">
        <Sparkles size={13} className="text-white" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Thinking blocks */}
        {thinkingParts.map((t, i) => (
          <ThinkingBlock key={`t-${i}`} thinking={t.thinking ?? ''} />
        ))}

        {/* Text blocks — rendered with marked */}
        {textParts.map((t, i) => (
          <div key={`tx-${i}`}
            className="text-[13.5px] leading-relaxed prose prose-invert max-w-none mb-2"
            dangerouslySetInnerHTML={{
              __html: marked.parse(t.text ?? '', { async: false }) as string,
            }}
          />
        ))}

        {/* Tool use blocks */}
        {toolParts.map((t, i) => (
          <ToolUseCard key={`tl-${i}`} name={t.name ?? ''} input={t.input ?? ''} />
        ))}

        {/* Timestamp */}
        {timeLabel && (
          <div className="flex items-center gap-1.5 mt-1">
            <Clock size={10} className="text-aegis-text-dim opacity-50" />
            <span className="text-[10px] text-aegis-text-dim tabular-nums">{timeLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════

export interface SessionViewPageProps {
  sessionPath?: string;
  embedded?: boolean;
  onBack?: () => void;
  onRun?: () => void;
}

export function SessionViewPage({
  sessionPath: providedSessionPath,
  embedded = false,
  onBack,
  onRun,
}: SessionViewPageProps = {}) {
  const [params] = useSearchParams();
  const sessionPath = providedSessionPath ?? params.get('path') ?? '';

  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    if (!sessionPath) {
      setError('No session path provided.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    invoke<SessionMessage[]>('read_session_messages', { sessionPath })
      .then((msgs) => setMessages(msgs ?? []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [sessionPath]);

  const handleCopyAll = async () => {
    try {
      const text = messages.map((msg) => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const body = msg.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n');
        return `## ${role}\n${body}`;
      }).join('\n\n---\n\n');
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch { /* ignore */ }
  };

  const handleExportFile = async () => {
    if (messages.length === 0) return;
    const defaultName = sessionPath
      ? sessionPath.split('/').pop()?.replace(/\.jsonl$/, '') ?? 'session'
      : 'session';
    try {
      const filePath = await save({
        defaultPath: `${defaultName}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!filePath) return; // user cancelled
      await invoke('export_session_markdown', {
        sessionPath,
        outputPath: filePath,
        taskMeta: {
          name: defaultName,
          prompt: '',
          agent: 'claude',
          created_at: Math.floor(Date.now() / 1000),
          session_id: null,
        },
      });
    } catch (e) {
      debugError('app', '[SessionViewPage] Export failed:', e);
    }
  };

  const userCount = messages.filter((m) => m.role === 'user').length;
  const toolCount = messages.reduce((acc, m) =>
    acc + m.content.filter((c) => c.type === 'tool_use').length, 0);

  return (
    <div className="flex flex-col h-full" style={{ background: 'rgb(var(--aegis-bg))' }}>
      {/* ── Header ── */}
      <div className="px-5 py-2.5 border-b flex items-center gap-3 shrink-0"
        style={{ borderColor: 'rgb(var(--aegis-border))' }}>
        {!embedded && (
          <button type="button" onClick={() => {
            if (onBack) onBack();
            else window.history.back();
          }}
            className="p-1.5 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-muted transition-colors"
            title="Back">
            <ArrowLeft size={15} />
          </button>
        )}

        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg" style={{ background: 'rgb(var(--aegis-primary) / 0.08)' }}>
            <MessageSquare size={15} className="text-aegis-primary" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-aegis-text">Session playback</div>
            <div className="text-[10px] font-mono text-aegis-text-dim truncate max-w-[400px]"
              title={sessionPath}>
              {sessionPath || '(no path)'}
            </div>
          </div>
        </div>

        {/* Stats pills */}
        <div className="flex items-center gap-2 ml-auto">
          {onRun && (
            <button onClick={onRun}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
              title="Run task again">
              <Play size={13} fill="currentColor" />
            </button>
          )}
          {messages.length > 0 && (
            <>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: 'rgb(var(--aegis-overlay) / 0.04)', color: 'rgb(var(--aegis-text-dim))' }}>
                <MessageSquare size={10} />
                {messages.length} msgs
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: 'rgb(var(--aegis-overlay) / 0.04)', color: 'rgb(var(--aegis-text-dim))' }}>
                <User size={10} />
                {userCount} prompts
              </span>
              {toolCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                  style={{ background: 'rgb(var(--aegis-overlay) / 0.04)', color: 'rgb(var(--aegis-text-dim))' }}>
                  <Wrench size={10} />
                  {toolCount} tools
                </span>
              )}
            </>
          )}

          {messages.length > 0 && (
            <>
              <button onClick={handleCopyAll}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all
                  hover:bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-muted hover:text-aegis-text"
                title="Copy all as Markdown">
                {copiedAll ? <Check size={13} className="text-aegis-success" /> : <Copy size={13} />}
                <span className="hidden sm:inline">{copiedAll ? 'Copied' : 'Copy'}</span>
              </button>
              <button onClick={handleExportFile}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all
                  bg-[rgb(var(--aegis-primary)/0.08)] border border-[rgb(var(--aegis-primary)/0.15)]
                  text-aegis-primary hover:bg-[rgb(var(--aegis-primary)/0.15)]"
                title="Save as .md file">
                <FileDown size={13} />
                <span className="hidden sm:inline">Save .md</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && (
          <div className="flex items-center gap-2.5 text-[13px] text-aegis-text-dim py-4">
            <Loader2 size={15} className="animate-spin text-aegis-primary" />
            <span>Loading session…</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg text-[12.5px]"
            style={{ background: 'rgb(var(--aegis-danger) / 0.08)', color: 'rgb(var(--aegis-danger))', border: '1px solid rgb(var(--aegis-danger) / 0.15)' }}>
            <AlertCircle size={15} className="mt-[1px] shrink-0" />
            <div>
              <div className="font-semibold mb-0.5">Failed to load session</div>
              <div className="font-mono text-[11px] opacity-80">{error}</div>
            </div>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="p-3 rounded-full" style={{ background: 'rgb(var(--aegis-overlay) / 0.04)' }}>
              <Braces size={24} className="text-aegis-text-dim opacity-40" />
            </div>
            <div className="text-[13px] text-aegis-text-dim">
              No messages in this session.
            </div>
            <div className="text-[11px] text-aegis-text-dim opacity-60 font-mono max-w-md truncate">
              {sessionPath}
            </div>
          </div>
        )}

        {messages.map((msg, i) =>
          msg.role === 'user' ? (
            <UserMessageBubble
              key={i}
              text={msg.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')}
              timestamp={msg.timestamp}
            />
          ) : (
            <AssistantMessageBlock
              key={i}
              content={msg.content}
              timestamp={msg.timestamp}
            />
          ),
        )}
      </div>
    </div>
  );
}

export default SessionViewPage;
