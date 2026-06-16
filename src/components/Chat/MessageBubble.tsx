import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, User, RotateCcw, RefreshCw, Pencil, ChevronDown, ChevronRight, AlertTriangle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import { getDirection } from '@/i18n';
import { CodeBlock } from './CodeBlock';
import { ChatImage } from './ChatImage';
import { ChatVideo } from './ChatVideo';
import { AudioPlayer } from './AudioPlayer';
import { SystemNoteBubble } from './SystemNoteBubble';
import type { MessageBlock, Artifact, MetaItem } from '@/types/RenderBlock';
import clsx from 'clsx';

// ── Error Action Detection ──
// Patterns map message content to an actionable button.
// Add new entries here to support more error types.
interface ErrorAction {
  label: string;
  /** Opaque action ID forwarded to the onErrorAction callback */
  action: string;
}

const ERROR_ACTION_PATTERNS: Array<{ re: RegExp; result: ErrorAction }> = [
  {
    re: /context overflow/i,
    result: { label: 'chat.resetSession', action: 'reset-session' },
  },
  {
    re: /use \/new to start a fresh session/i,
    result: { label: 'chat.resetSession', action: 'reset-session' },
  },
  {
    re: /message ordering conflict/i,
    result: { label: 'chat.resetSession', action: 'reset-session' },
  },
];

function detectErrorAction(content: string): ErrorAction | null {
  for (const { re, result } of ERROR_ACTION_PATTERNS) {
    if (re.test(content)) return result;
  }
  return null;
}

// ── Artifact Card Component ──
function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);

  const typeIcons: Record<string, string> = {
    html: '🌐', react: '⚛️', svg: '🎨', mermaid: '📊', code: '📝',
  };

  const handleOpen = async () => {
    setOpening(true);
    try {
      await window.aegis?.artifact?.open(artifact);
    } catch (err) {
      console.error('[Artifact] Failed to open preview:', err);
    } finally {
      setTimeout(() => setOpening(false), 500);
    }
  };

  return (
    <div className="my-3 rounded-xl border border-aegis-primary/20 bg-aegis-primary/[0.04] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-aegis-primary/10">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{typeIcons[artifact.type] || '📄'}</span>
          <div>
            <div className="text-[13px] font-medium text-aegis-text">{artifact.title}</div>
            <div className="text-[10px] text-aegis-text-dim uppercase tracking-wider">{artifact.type}</div>
          </div>
        </div>
        <button
          onClick={handleOpen}
          disabled={opening}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all',
            'bg-aegis-primary/15 text-aegis-primary hover:bg-aegis-primary/25',
            'border border-aegis-primary/20 hover:border-aegis-primary/40',
            opening && 'opacity-60'
          )}
        >
          <Eye size={13} />
          {t('resultCards.preview', 'Preview')}
        </button>
      </div>
      {/* Code preview (collapsed) */}
      <details className="group">
        <summary className="px-4 py-1.5 text-[11px] text-aegis-text-dim cursor-pointer hover:text-aegis-text-muted flex items-center gap-1.5 select-none">
          <Code2 size={11} />
          {t('resultCards.viewSource', 'View source')} ({artifact.content.length} {t('resultCards.chars', 'chars')})
        </summary>
        <div className="px-4 pb-3 max-h-[200px] overflow-auto">
          <pre className="text-[11px] text-aegis-text-dim font-mono whitespace-pre-wrap bg-[rgb(var(--aegis-overlay)/0.08)] rounded-lg p-3">
            {artifact.content.slice(0, 2000)}{artifact.content.length > 2000 ? '\n...(truncated)' : ''}
          </pre>
        </div>
      </details>
    </div>
  );
}

// ── Collapsed Meta — thinking, workshop, system under reply ──
function CollapsedMeta({ items }: { items: MetaItem[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const systemItems = items.filter((item) => item.kind === 'system');
  const otherItems = items.filter((item) => item.kind !== 'system' && item.kind !== 'context');

  return (
    <div className="mt-0.5">
      {systemItems.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {systemItems.map((item, idx) => (
            <SystemNoteBubble key={`system-${idx}`} content={item.content} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {otherItems.map((item, idx) => (
          <div key={idx} className="w-full">
            <button
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px]
                text-aegis-text-dim hover:text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.04)]
                transition-colors"
            >
              {expandedIdx === idx ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {item.label}
            </button>
            {expandedIdx === idx && (
              <pre className="mt-1 mx-1 p-2.5 rounded-lg text-[11px] leading-relaxed text-aegis-text-muted
                bg-[rgb(var(--aegis-overlay)/0.03)] border border-[rgb(var(--aegis-overlay)/0.05)]
                whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto font-[inherit]">
                {item.content}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Message Bubble — Colors fixed for dark theme visibility
// ═══════════════════════════════════════════════════════════

interface MessageBubbleProps {
  block: MessageBlock;
  onResend?: (content: string) => void;
  onRegenerate?: () => void;
  onErrorAction?: (action: string) => void;
  onDelete?: () => void;
}

function isLocalFilePath(value?: string) {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  return (
    v.startsWith('/') ||
    v.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/.test(v) ||
    v.startsWith('file://')
  );
}

// ── File Card Component ──
function FileCard({ path, meta }: { path: string; meta?: string }) {
  const { t } = useTranslation();
  const name = path.split(/[/\\]/).pop() || path;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const icon: Record<string, string> = {
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', csv: '📗',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🎨', webp: '🖼️',
    mp3: '🎵', wav: '🎵', ogg: '🎵', mp4: '🎬', mkv: '🎬', mov: '🎬',
    zip: '📦', tar: '📦', gz: '📦', '7z': '📦', rar: '📦',
    ts: '📝', tsx: '📝', js: '📝', jsx: '📝', py: '📝', rs: '📝', go: '📝',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋', md: '📝', txt: '📝',
  };

  const handleOpen = async () => {
    try {
      const openManagedPath =
        window.aegis?.managedFiles?.open ||
        window.aegis?.uploads?.open;
      if (openManagedPath) {
        await openManagedPath(path);
        return;
      }
      const url = path.startsWith('file://') ? path : `file://${path}`;
      window.open(url, '_blank');
    } catch (err) {
      console.error('[MessageBubble] Failed to open file card path:', err);
    }
  };

  return (
    <div
      onClick={handleOpen}
      title={path}
      className="relative inline-flex items-center gap-2 px-3 py-1.5 my-1 rounded-lg
      bg-[rgb(var(--aegis-overlay)/0.05)] border border-[rgb(var(--aegis-overlay)/0.08)]
      hover:border-aegis-primary/20 transition-colors cursor-pointer max-w-full text-start group/filecard"
    >
      <span className="text-base shrink-0">{icon[ext] || '📄'}</span>
      <div className="min-w-0 flex flex-col">
        <span className="text-[12px] font-medium text-aegis-text truncate">{name}</span>
        <span className="text-[10px] text-aegis-text-dim truncate">
          {meta || t('resultCards.open', 'Open')}
        </span>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(path); }}
        className="absolute top-0.5 right-0.5 p-1 rounded-md opacity-0 group-hover/filecard:opacity-100
          hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-all text-aegis-text-muted hover:text-aegis-text-secondary"
        title="Copy path"
      >
        <Copy size={11} />
      </button>
    </div>
  );
}

// ── Shared Markdown Components ──
const markdownComponents = {
  table({ children }: any) {
    return (
      <div className="table-wrapper">
        <table>{children}</table>
      </div>
    );
  },
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match || codeString.includes('\n')) {
      return <CodeBlock language={match?.[1] || ''} code={codeString} />;
    }
    return (
      <code
        className="text-[13px] font-mono px-1.5 py-0.5 rounded"
        style={{ background: 'rgb(var(--aegis-primary) / 0.12)', color: 'rgb(var(--aegis-primary))' }}
        {...props}
      >
        {children}
      </code>
    );
  },
  img({ src, alt }: any) {
    if (!src) return null;
    // Check if it's a video by extension
    const videoExtensions = /\.(mp4|webm|mov|avi|mkv|m4v|ogg)(\?.*)?$/i;
    if (videoExtensions.test(src)) {
      return <ChatVideo src={src} alt={alt} maxWidth="100%" maxHeight="400px" />;
    }
    return <ChatImage src={src} alt={alt} maxWidth="100%" maxHeight="400px" />;
  },
  p({ children }: any) {
    // Detect file references: 📎 file: <path> (mime, size)
    if (typeof children === 'string' || (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string')) {
      const text = typeof children === 'string' ? children : children[0];
      const fileMatch = text.match(/^📎\s*file:\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/);
      if (fileMatch) {
        return <FileCard path={fileMatch[1].trim()} meta={fileMatch[2]?.trim()} />;
      }
      // Staged upload marker: [file attached: /abs/path]
      const attachedFileMatch = text.match(/^\[file attached:\s*(.+?)\]\s*$/i);
      if (attachedFileMatch) {
        return <FileCard path={attachedFileMatch[1].trim()} meta="attachment" />;
      }
      // Staged media marker: [media attached: /abs/path]
      const attachedMediaMatch = text.match(/^\[media attached:\s*(.+?)\]\s*$/i);
      if (attachedMediaMatch) {
        return <FileCard path={attachedMediaMatch[1].trim()} meta="media" />;
      }
      // Voice reference: 🎤 [voice] <path> (duration)
      const voiceMatch = text.match(/^🎤\s*\[voice\]\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/);
      if (voiceMatch) {
        return <FileCard path={voiceMatch[1].trim()} meta={voiceMatch[2]?.trim() || 'voice'} />;
      }
    }
    return <p>{children}</p>;
  },
  a({ href, children }: any) {
    if (href && isLocalFilePath(href)) {
      const label = typeof children === 'string'
        ? children
        : (Array.isArray(children) ? children.join('') : '');
      return <FileCard path={href} meta={label || 'file'} />;
    }
    // Check if link is a video
    const videoExtensions = /\.(mp4|webm|mov|avi|mkv|m4v|ogg)(\?.*)?$/i;
    if (href && videoExtensions.test(href)) {
      return <ChatVideo src={href} alt={String(children) || 'video'} maxWidth="100%" maxHeight="400px" />;
    }
    return (
      <a
        href={href}
        onClick={async (e) => {
          e.preventDefault();
          if (!href) return;
          const openManagedPath =
            window.aegis?.managedFiles?.open ||
            window.aegis?.uploads?.open;
          if (isLocalFilePath(href) && openManagedPath) {
            await openManagedPath(href);
            return;
          }
          window.open(href, '_blank');
        }}
        className="text-aegis-primary hover:text-aegis-primary/70 underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
};

export const MessageBubble = memo(function MessageBubble({ block, onResend, onRegenerate, onErrorAction, onDelete }: MessageBubbleProps) {
  const { t, i18n } = useTranslation();
  const agents = useGatewayDataStore((s) => s.agents);
  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const activeAgentId = (() => {
    if (!activeSessionKey) return 'main';
    const parts = activeSessionKey.split(':');
    return parts[0] === 'agent' && parts[1] ? parts[1] : 'main';
  })();
  const activeAgentName =
    agents.find((a) => a.id === activeAgentId)?.name
    || (activeAgentId === 'main' ? t('agents.mainAgent', 'Main Agent') : activeAgentId);
  const activeAgentLetter = activeAgentName.charAt(0) || 'M';
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [errorActionDone, setErrorActionDone] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false); // openclaw-style details toggle
  const contextMeta = block.meta?.find(m => m.kind === 'context') ?? null;
  // Context bar payload is built in buildSemanticBlocks.buildAssistantMeta and
  // serialized as JSON in contextMeta.content — parse the formatted summary here.
  const contextContent = contextMeta?.content
    ? (() => { try { return JSON.parse(contextMeta.content) as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; contextPercent?: number | null; model?: string; formatted?: string }; } catch { return null; } })()
    : null;
  const ctxFmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : String(n));
  const isUser = block.role === 'user';
  const dir = getDirection(i18n.language);

  // block.markdown is already cleaned, directives stripped, code detected
  const content = block.markdown;

  // Detect actionable error patterns in assistant messages
  const errorAction = !isUser && !block.isStreaming && onErrorAction
    ? detectErrorAction(content)
    : null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const timeStr = (() => {
    try {
      const d = new Date(block.timestamp);
      if (isNaN(d.getTime())) return '';
      const locale = i18n.language?.startsWith('ar') ? 'ar-SA' : 'en-US';
      const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); const h = String(d.getHours()).padStart(2, '0'); const min = String(d.getMinutes()).padStart(2, '0'); return `${y}年${m}月${day}日 ${h}:${min}`;
    } catch {
      return '';
    }
  })();

  const modelInfo = (() => {
    if (block.role !== 'assistant' || !block.model) return null;
    const trimmed = block.model.trim();
    if (!trimmed) return null;
    const slashIndex = trimmed.indexOf('/');
    if (slashIndex === -1 || slashIndex === trimmed.length - 1) {
      return { provider: '', model: trimmed, full: trimmed };
    }
    return {
      provider: trimmed.slice(0, slashIndex),
      model: trimmed.slice(slashIndex + 1),
      full: trimmed,
    };
  })();

  return (
    <div
      className={clsx(
        'group flex gap-2.5 items-start mx-1 mr-4 mb-3.5',
        isUser ? 'flex-row-reverse' : ''
      )}
      dir={dir}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Avatar */}
      {isUser ? (
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-aegis-primary/15 border border-aegis-primary/25">
          <User size={14} className="text-aegis-primary" />
        </div>
      ) : (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-primary to-aegis-accent flex items-center justify-center shrink-0 mt-0.5 shadow-glow-sm">
          <span className="text-[10px] font-bold text-aegis-text">{activeAgentLetter}</span>
        </div>
      )}

      {/* Message Content */}
      <div className="flex flex-col min-w-0" style={{ width: '100%', maxWidth: 'min(900px, 68%)', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        {/* Bubble — openclaw chat-bubble style */}
        <div
          className={clsx(
            'relative block border rounded-2xl px-3.5 py-2.5 transition-colors duration-150',
            'max-w-full box-border min-w-0 break-words',
            isUser
              ? clsx('bg-aegis-primary/[0.12] border-aegis-primary/20', !block.isStreaming && 'pr-[70px]')
              : clsx(
                'bg-[rgb(var(--aegis-overlay)/0.04)] border-[rgb(var(--aegis-overlay)/0.06)]',
                !block.isStreaming && 'pr-[70px]',  // openclaw: .chat-bubble--has-actions
              ),
            block.isStreaming && 'border-aegis-primary/30 streaming-border'
          )}
          style={{ width: 'auto' }}
        >
          {/* Action bar — Copy button (both sides), matches openclaw */}
          {!block.isStreaming && (
            <div className={clsx(
              'absolute top-2 right-2 z-10 flex items-center gap-0.5 transition-opacity duration-120',
              showActions ? 'opacity-100' : 'opacity-0 pointer-events-none'
            )}>
              <button onClick={handleCopy}
                className="rounded p-1 hover:bg-[rgb(var(--aegis-overlay)/0.12)] transition-colors"
                title={t('chat.copy')}>
                {copied ? <Check size={12} className="text-aegis-success" /> : <Copy size={12} className="text-aegis-text-muted" />}
              </button>
            </div>
          )}

          {/* Audio Player */}
          {block.audio && !block.isStreaming && (
            <div className="mb-2">
              <AudioPlayer src={block.audio} />
            </div>
          )}

          {/* Images from attachments — grid layout for multiple */}
          {block.images.length > 0 && (
            <div className={clsx(
              'mb-2 gap-1.5',
              block.images.length === 1 ? 'flex' :
              block.images.length === 2 ? 'grid grid-cols-2' :
              block.images.length === 3 ? 'grid grid-cols-2' :
              'grid grid-cols-2 sm:grid-cols-3'
            )}>
              {block.images.map((img, i) => (
                <ChatImage
                  key={i}
                  src={img.src}
                  alt={img.alt || t('media.attachment')}
                  maxWidth={block.images.length === 1 ? '360px' : '100%'}
                  maxHeight={block.images.length === 1 ? '300px' : '180px'}
                />
              ))}
            </div>
          )}

          {/* Message text (markdown) or Edit mode */}
          {isEditing ? (
            <div className="w-full">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full bg-[rgb(var(--aegis-overlay)/0.04)] rounded-lg p-2 text-[13px] text-aegis-text border border-aegis-border outline-none focus:border-aegis-primary/30 resize-y min-h-[60px]"
                rows={Math.min(editText.split('\n').length + 1, 8)}
              />
              <div className="flex gap-1.5 mt-1.5">
                <button
                  onClick={() => { onResend?.(editText); setIsEditing(false); }}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-aegis-primary/10 text-aegis-primary border border-aegis-primary/20 hover:bg-aegis-primary/20 transition-colors"
                >
                  {t('chat.sendEdit', 'Send')}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-aegis-text-muted hover:text-aegis-text-secondary transition-colors"
                >
                  {t('chat.cancel', 'Cancel')}
                </button>
              </div>
            </div>
          ) : block.isStreaming ? (
            <pre className="markdown-body text-[14px] leading-relaxed text-aegis-text whitespace-pre-wrap break-words font-[inherit]">
              {content}
            </pre>
          ) : (
            <div className="markdown-body text-[14px] leading-relaxed text-aegis-text">
              {content && (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {content}
                </ReactMarkdown>
              )}
            </div>
          )}

          {/* Artifacts (pre-parsed by ContentParser) */}
          {block.artifacts.map((art, idx) => (
            <ArtifactCard key={`art-${idx}`} artifact={art} />
          ))}

          {/* Collapsed Meta (thinking, workshop, system) */}
          {block.meta && block.meta.length > 0 && !block.isStreaming && (
            <CollapsedMeta items={block.meta} />
          )}

          {/* Error Action Button — shown for actionable error messages */}
          {errorAction && (
            <div className="mt-3 pt-2.5 border-t border-aegis-warning/15">
              <button
                onClick={() => {
                  setErrorActionDone(true);
                  onErrorAction?.(errorAction.action);
                }}
                disabled={errorActionDone}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                  'bg-aegis-warning/10 border border-aegis-warning/25 text-aegis-warning',
                  'hover:bg-aegis-warning/20 hover:border-aegis-warning/40',
                  errorActionDone && 'opacity-40 pointer-events-none',
                )}
              >
                <AlertTriangle size={12} />
                {t(errorAction.label, 'Reset Session')}
              </button>
            </div>
          )}
        </div>

        {/* Footer — openclaw chat-group-footer: flex, mt-6px, gap-8px, flex-wrap */}
        <div className={clsx(
          'flex items-center mt-1.5 flex-wrap',
          isUser && 'justify-end',
        )} style={{ gap: 8, rowGap: 5 }}>
          {/* Sender name */}
          {!isUser && (
            <span className="text-xs font-medium text-aegis-text-muted">
              {activeAgentName}
            </span>
          )}
          {/* Time */}
          <time className="text-xs text-aegis-text-dim" dateTime={block.timestamp || ''} title={timeStr}>
            {timeStr}
          </time>

          {/* msg-meta — openclaw <details> pattern */}
          {!isUser && contextContent && (
            <span className="inline-flex items-center flex-wrap" style={{ gap: 8 }}>
              {/* summary toggle — msg-meta__summary */}
              <button
                onClick={() => setCtxOpen(v => !v)}
                className="inline-flex items-center gap-1.5 text-[10px] rounded-full px-2 py-0.5"
                style={{ background: 'rgb(var(--aegis-overlay) / 0.03)', color: 'var(--aegis-text-muted)' }}
              >
                <ChevronRight size={10} className={clsx('shrink-0 transition-transform', ctxOpen && 'rotate-90')} style={{ strokeWidth: 2 }} />
                <span>Context</span>
              </button>
              {/* details — msg-meta__details inline pill */}
              {ctxOpen && (
                <span
                  className="inline-flex items-center flex-wrap rounded-full px-1.5 py-0.5 text-[10px] font-mono tabular-nums"
                  style={{ gap: 8, border: '1px solid var(--aegis-border, rgb(var(--aegis-overlay)/0.1))', background: 'rgb(var(--aegis-overlay) / 0.03)' }}
                >
                  {(contextContent.input ?? 0) > 0 && <span>↑{ctxFmt(contextContent.input!)}</span>}
                  {(contextContent.output ?? 0) > 0 && <span>↓{ctxFmt(contextContent.output!)}</span>}
                  {(contextContent.cacheRead ?? 0) > 0 && <span>R{ctxFmt(contextContent.cacheRead!)}</span>}
                  {(contextContent.cacheWrite ?? 0) > 0 && <span>W{ctxFmt(contextContent.cacheWrite!)}</span>}
                  {contextContent.contextPercent != null && (
                    <span className={clsx((contextContent.contextPercent ?? 0) >= 90 ? 'text-aegis-danger' : (contextContent.contextPercent ?? 0) >= 75 ? 'text-aegis-warning' : 'text-aegis-text-dim')}>
                      {contextContent.contextPercent}% ctx
                    </span>
                  )}
                  {contextContent.model && (
                    <span className="rounded px-1.5 text-[10px]" style={{ background: 'rgb(var(--aegis-overlay) / 0.06)' }}>
                      {contextContent.model.includes('/') ? contextContent.model.split('/').pop() : contextContent.model}
                    </span>
                  )}
                </span>
              )}
            </span>
          )}
          {!isUser && !contextMeta && modelInfo && (
            <span className="rounded px-1.5 text-[10px]" style={{ background: 'rgb(var(--aegis-overlay) / 0.06)' }}>
              {modelInfo.model.includes('/') ? modelInfo.model.split('/').pop() : modelInfo.model}
            </span>
          )}

          {/* Action buttons — openclaw: group hover → visible, whole row triggers together */}
          {/* User: edit + delete | Assistant: retry + delete */}
          {block.role === 'user' && onResend && (
            <button onClick={() => { setIsEditing(true); setEditText(block.markdown); }}
              className="inline-flex items-center justify-center rounded p-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted transition-all"
              title={t('chat.edit', 'Edit')}
              style={{ minWidth: 24, minHeight: 24 }}>
              <Pencil size={14} />
            </button>
          )}
          {block.role === 'assistant' && onRegenerate && (
            <button onClick={onRegenerate}
              className="inline-flex items-center justify-center rounded p-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted transition-all"
              title={t('chat.regenerate', 'Regenerate')}
              style={{ minWidth: 24, minHeight: 24 }}>
              <RefreshCw size={14} />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete}
              className="inline-flex items-center justify-center rounded p-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-aegis-danger/10 text-aegis-text-muted hover:text-aegis-danger transition-all"
              title={t('chat.delete', 'Delete')}
              style={{ minWidth: 24, minHeight: 24 }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
