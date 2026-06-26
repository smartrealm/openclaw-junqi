import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Copy, Check, User, RotateCcw, RefreshCw, Pencil,
  ChevronDown, ChevronRight, AlertTriangle, Trash2, Eye, Code2,
  Sparkles, Bot, ExternalLink, Globe, FileText,
  FileSpreadsheet, FileArchive, FileJson, FileCode2, Music, Film,
  Kanban, Wrench, Brain, CheckCircle2, Info,
} from 'lucide-react';
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
import { usePreviewStore } from '@/stores/previewStore';
import { Icon } from '@/components/shared/icons';
import clsx from 'clsx';

// ── Error Action Detection ──
interface ErrorAction {
  label: string;
  action: string;
}

const ERROR_ACTION_PATTERNS: Array<{ re: RegExp; result: ErrorAction }> = [
  { re: /context overflow/i, result: { label: 'chat.resetSession', action: 'reset-session' } },
  { re: /use \/new to start a fresh session/i, result: { label: 'chat.resetSession', action: 'reset-session' } },
  { re: /message ordering conflict/i, result: { label: 'chat.resetSession', action: 'reset-session' } },
];

function detectErrorAction(content: string): ErrorAction | null {
  for (const { re, result } of ERROR_ACTION_PATTERNS) {
    if (re.test(content)) return result;
  }
  return null;
}

// ── Artifact Card ──
//
// Renders an <openclaw_artifact> block inline. HTML/React/SVG artifacts are
// embedded as sandboxed iframes so the user sees the actual preview without
// leaving the chat (the original behavior was a separate preview window).
// Mermaid is rendered via <pre> + the renderer (if loaded); plain code falls
// through to a syntax-highlighted <pre>.
function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [tab, setTab] = useState<'preview' | 'source'>(
    artifact.type === 'html' || artifact.type === 'react' || artifact.type === 'svg'
      ? 'preview'
      : 'source',
  );
  const typeIcons: Record<string, React.ReactNode> = {
    html:    Icon.chat.artifact.html,
    react:   Icon.chat.artifact.react,
    svg:     Icon.chat.artifact.svg,
    mermaid: Icon.chat.artifact.mermaid,
    markdown:Icon.chat.artifact.markdown,
    code:    Icon.chat.artifact.code,
  };

  const defaultArtifactIcon = Icon.chat.artifact.generic;

  const handleOpen = async () => {
    setOpening(true);
    try { await window.aegis?.artifact?.open(artifact); } catch (err) {
      console.error('[Artifact] Failed to open preview:', err);
    } finally { setTimeout(() => setOpening(false), 500); }
  };

  const supportsPreview = artifact.type === 'html' || artifact.type === 'react' || artifact.type === 'svg';

  const openInPreview = usePreviewStore((s) => s.open);
  const previewType = artifact.type === 'html' ? 'html'
    : artifact.type === 'svg' ? 'svg'
    : artifact.type === 'markdown' || artifact.type === 'md' ? 'markdown'
    : 'code';

  return (
    <div className="my-3 rounded-xl border border-aegis-primary/20 bg-aegis-primary/[0.04] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-aegis-primary/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 flex items-center">{typeIcons[artifact.type] || defaultArtifactIcon}</span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-aegis-text truncate">{artifact.title}</div>
            <div className="text-[10px] text-aegis-text-dim uppercase tracking-wider">{artifact.type} · {artifact.content.length} chars</div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {supportsPreview && (
            <div className="inline-flex rounded-md overflow-hidden border border-aegis-primary/20 text-[11px]">
              <button onClick={() => setTab('preview')}
                className={clsx('px-2.5 py-1 transition-colors',
                  tab === 'preview' ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-muted hover:text-aegis-text')}>
                {t('resultCards.preview', 'Preview')}
              </button>
              <button onClick={() => setTab('source')}
                className={clsx('px-2.5 py-1 transition-colors',
                  tab === 'source' ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-muted hover:text-aegis-text')}>
                {t('resultCards.source', 'Source')}
              </button>
            </div>
          )}
          <button onClick={() => openInPreview(artifact.content, artifact.type as 'html' | 'svg' | 'markdown', artifact.title || 'Artifact')} disabled={opening}
            title={t('resultCards.preview', 'Preview in side panel')}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all',
              'text-aegis-text-muted hover:text-aegis-text hover:bg-aegis-overlay/5',
              opening && 'opacity-60',
            )}>
            <Eye size={12} />
          </button>
          <button onClick={handleOpen} disabled={opening}
            title={t('resultCards.openExternal', 'Open in external window')}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all',
              'text-aegis-text-muted hover:text-aegis-text hover:bg-aegis-overlay/5',
              opening && 'opacity-60',
            )}>
            <ExternalLink size={12} />
          </button>
        </div>
      </div>

      {tab === 'preview' && supportsPreview ? (
        // Inline sandboxed iframe — sandbox="allow-scripts" only (no allow-same-origin)
        // so the artifact cannot access our origin's storage/cookies.
        <div className="bg-white" style={{ minHeight: 320 }}>
          <iframe
            srcDoc={artifact.content}
            title={artifact.title}
            sandbox="allow-scripts"
            className="w-full border-0"
            style={{ height: 480, display: 'block', background: '#fff' }}
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="px-4 pb-3 pt-2 max-h-[400px] overflow-auto">
          <pre className="text-[11px] text-aegis-text-dim font-mono whitespace-pre-wrap bg-[rgb(var(--aegis-overlay)/0.08)] rounded-lg p-3">
            {artifact.content.slice(0, 4000)}{artifact.content.length > 4000 ? '\n...(truncated)' : ''}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Collapsed Meta ──
function CollapsedMeta({ items }: { items: MetaItem[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const systemItems = items.filter((item) => item.kind === 'system');
  const otherItems = items.filter((item) => item.kind !== 'system' && item.kind !== 'context');

  const metaIcon = (name?: string) => {
    if (!name) return null;
    switch (name) {
      case 'Workshop': return <Kanban size={12} strokeWidth={1.75} />;
      case 'Tool':     return <Wrench size={12} strokeWidth={1.75} />;
      case 'Thinking': return <Brain size={12} strokeWidth={1.75} />;
      case 'Decision': return <CheckCircle2 size={12} strokeWidth={1.75} />;
      default:         return <Info size={12} strokeWidth={1.75} />;
    }
  };

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
                transition-colors">
              {expandedIdx === idx ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {metaIcon(item.icon)}
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
// Message Bubble — Interactive design with proper action bar
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
  return v && (v.startsWith('/') || v.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(v) || v.startsWith('file://'));
}

// ── File Card ──
function FileCard({ path, meta }: { path: string; meta?: string }) {
  const { t } = useTranslation();
  const name = path.split(/[/\\]/).pop() || path;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const fileIcon = (() => {
    const imageExts = new Set(['png','jpg','jpeg','gif','svg','webp','ico','bmp']);
    const audioExts = new Set(['mp3','wav','ogg','flac','aac','m4a']);
    const videoExts = new Set(['mp4','mkv','mov','avi','webm']);
    const archiveExts = new Set(['zip','tar','gz','7z','rar','bz2']);
    const codeExts = new Set(['ts','tsx','js','jsx','py','rs','go','java','c','cpp','h','rb','swift','kt']);
    const configExts = new Set(['json','yaml','yml','toml','xml']);
    const docExts = new Set(['pdf','doc','docx','md','txt','rst']);
    const sheetExts = new Set(['xls','xlsx','csv']);
    if (imageExts.has(ext)) return Icon.chat.attachment.image;
    if (audioExts.has(ext)) return Icon.chat.attachment.audio;
    if (videoExts.has(ext)) return Icon.chat.attachment.video;
    if (archiveExts.has(ext)) return Icon.chat.attachment.archive;
    if (codeExts.has(ext)) return Icon.chat.attachment.code;
    if (configExts.has(ext)) return Icon.chat.attachment.config;
    if (sheetExts.has(ext)) return Icon.chat.attachment.sheet;
    if (docExts.has(ext)) return Icon.chat.attachment.document;
    return Icon.chat.attachment.generic;
  })();

  const handleOpen = async () => {
    try {
      const openManagedPath = window.aegis?.managedFiles?.open || window.aegis?.uploads?.open;
      if (openManagedPath) { await openManagedPath(path); return; }
      const url = path.startsWith('file://') ? path : `file://${path}`;
      window.open(url, '_blank');
    } catch (err) { console.error('[MessageBubble] Failed to open file card path:', err); }
  };

  return (
    <div onClick={handleOpen} title={path}
      className="relative inline-flex items-center gap-2 px-3 py-1.5 my-1 rounded-lg
      bg-[rgb(var(--aegis-overlay)/0.05)] border border-[rgb(var(--aegis-overlay)/0.08)]
      hover:border-aegis-primary/20 transition-colors cursor-pointer max-w-full text-start group/filecard">
      <span className="shrink-0 flex items-center">{fileIcon}</span>
      <div className="min-w-0 flex flex-col">
        <span className="text-[12px] font-medium text-aegis-text truncate">{name}</span>
        <span className="text-[10px] text-aegis-text-dim truncate">{meta || t('resultCards.open', 'Open')}</span>
      </div>
      <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(path); }}
        className="absolute top-0.5 right-0.5 p-1 rounded-md opacity-0 group-hover/filecard:opacity-100
          hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-all text-aegis-text-muted hover:text-aegis-text-secondary"
        title="Copy path">
        <Copy size={12} />
      </button>
    </div>
  );
}

// ── Action Button (icon-only, hover tooltip via title) ──
function ActionBtn({ icon, label, onClick, danger }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button onClick={onClick}
      className={clsx(
        'inline-flex items-center justify-center w-7 h-7 rounded transition-all duration-150',
        'hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted hover:text-aegis-text',
        danger && 'hover:bg-aegis-danger/10 hover:text-aegis-danger',
      )}
      title={label}
      aria-label={label}>
      {icon}
    </button>
  );
}

// ── Markdown Components ──
const markdownComponents = {
  table({ children }: any) {
    return <div className="table-wrapper"><table>{children}</table></div>;
  },
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match || codeString.includes('\n')) {
      return <CodeBlock language={match?.[1] || ''} code={codeString} />;
    }
    return (
      <code className="text-[13px] font-mono px-1.5 py-0.5 rounded"
        style={{ background: 'rgb(var(--aegis-primary) / 0.12)', color: 'rgb(var(--aegis-primary))' }}
        {...props}>{children}</code>
    );
  },
  img({ src, alt }: any) {
    if (!src) return null;
    const videoExtensions = /\.(mp4|webm|mov|avi|mkv|m4v|ogg)(\?.*)?$/i;
    if (videoExtensions.test(src)) return <ChatVideo src={src} alt={alt} maxWidth="100%" maxHeight="400px" />;
    return <ChatImage src={src} alt={alt} maxWidth="100%" maxHeight="400px" />;
  },
  p({ children }: any) {
    if (typeof children === 'string' || (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string')) {
      const text = typeof children === 'string' ? children : children[0];
      const fileMatch = text.match(/^📎\s*file:\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/);
      if (fileMatch) return <FileCard path={fileMatch[1].trim()} meta={fileMatch[2]?.trim()} />;
      const attachedFileMatch = text.match(/^\[file attached:\s*(.+?)\]\s*$/i);
      if (attachedFileMatch) return <FileCard path={attachedFileMatch[1].trim()} meta="attachment" />;
      const attachedMediaMatch = text.match(/^\[media attached:\s*(.+?)\]\s*$/i);
      if (attachedMediaMatch) return <FileCard path={attachedMediaMatch[1].trim()} meta="media" />;
      const voiceMatch = text.match(/^🎤\s*\[voice\]\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/);
      if (voiceMatch) return <FileCard path={voiceMatch[1].trim()} meta={voiceMatch[2]?.trim() || 'voice'} />;
    }
    return <p>{children}</p>;
  },
  a({ href, children }: any) {
    if (href && isLocalFilePath(href)) {
      const label = typeof children === 'string' ? children : (Array.isArray(children) ? children.join('') : '');
      return <FileCard path={href} meta={label || 'file'} />;
    }
    const videoExtensions = /\.(mp4|webm|mov|avi|mkv|m4v|ogg)(\?.*)?$/i;
    if (href && videoExtensions.test(href)) return <ChatVideo src={href} alt={String(children) || 'video'} maxWidth="100%" maxHeight="400px" />;
    return (
      <a href={href} onClick={async (e) => {
        e.preventDefault();
        if (!href) return;
        const openManagedPath = window.aegis?.managedFiles?.open || window.aegis?.uploads?.open;
        if (isLocalFilePath(href) && openManagedPath) { await openManagedPath(href); return; }
        window.open(href, '_blank');
      }} className="text-aegis-primary hover:text-aegis-primary/70 underline underline-offset-2">
        {children}
      </a>
    );
  },
};

export const MessageBubble = memo(function MessageBubble({
  block, onResend, onRegenerate, onErrorAction, onDelete,
}: MessageBubbleProps) {
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
  const [hovered, setHovered] = useState(false);
  const [footerHovered, setFooterHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [errorActionDone, setErrorActionDone] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const contextMeta = block.meta?.find(m => m.kind === 'context') ?? null;
  const contextContent = contextMeta?.content
    ? (() => { try { return JSON.parse(contextMeta.content) as { input?: number; inputTokens?: number; output?: number; outputTokens?: number; cacheRead?: number; cacheReadInputTokens?: number; cacheWrite?: number; cacheCreationInputTokens?: number; contextPercent?: number | null; model?: string; formatted?: string; duration?: number }; } catch { return null; } })()
    : null;
  const ctxFmt = (n: number) => {
    if (!Number.isFinite(n)) return '0';
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}k`;
    return String(n);
  };
  const contextInputTokens = contextContent?.input ?? contextContent?.inputTokens ?? 0;
  const contextOutputTokens = contextContent?.output ?? contextContent?.outputTokens ?? 0;
  const contextCacheRead = contextContent?.cacheRead ?? contextContent?.cacheReadInputTokens ?? 0;
  const contextCacheWrite = contextContent?.cacheWrite ?? contextContent?.cacheCreationInputTokens ?? 0;
  const contextTotalTokens = contextInputTokens + contextOutputTokens + contextCacheRead + contextCacheWrite;
  const inlineUsageParts = [
    contextInputTokens ? `↑${ctxFmt(contextInputTokens)}` : '',
    contextOutputTokens ? `↓${ctxFmt(contextOutputTokens)}` : '',
    contextCacheRead ? `R${ctxFmt(contextCacheRead)}` : '',
    contextCacheWrite ? `W${ctxFmt(contextCacheWrite)}` : '',
    contextContent?.contextPercent != null ? `${contextContent.contextPercent}% ctx` : '',
  ].filter(Boolean);
  const isUser = block.role === 'user';
  const dir = getDirection(i18n.language);
  const content = block.markdown;
  const errorAction = !isUser && !block.isStreaming && onErrorAction ? detectErrorAction(content) : null;

  // Strip markdown wrapper around code so the copied text is "clean" when
// pasted into Notion / Slack / email (those clients have their own markdown
// rendering — raw backticks look ugly). Other markdown (headings, lists,
// bold, links) is preserved because the target app renders it.
//
// Rules:
//   `code`              → code                       (inline code: strip `` ``)
//   ```lang\n...\n```    → ...                         (fenced: strip fence)
//   ~~~lang\n...\n~~~   → ...                         (fenced: strip fence)
//   ```\n...\n```        → ...                         (fenced: strip fence, no lang)
//   plain text          → plain text                  (unchanged)
function stripCodeFences(md: string): string {
  // Fenced code blocks (``` or ~~~), with or without a language tag.
  const fenced = /^[ \t]{0,3}(```+|~~~+)[^\n]*\n([\s\S]*?)\n?[ \t]{0,3}\1[ \t]*(?:\n|$)/gm;
  return md.replace(fenced, (_m, _fence, body: string) => body.replace(/\n+$/, ''));
}

// Remove backticks around inline code spans — keep the contents, drop the `.
function stripInlineCodeTicks(md: string): string {
  // `` `code` `` → code
  return md.replace(/`([^`\n]+)`/g, (_m, inner: string) => inner);
}

  const handleCopy = async () => {
    const cleaned = stripInlineCodeTicks(stripCodeFences(content));
    await navigator.clipboard.writeText(cleaned);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Timestamp formatting ──────────────────────────────────────────────────
  const msgDate = (() => { try { const d = new Date(block.timestamp); return isNaN(d.getTime()) ? null : d; } catch { return null; } })();

  const dateLabel = msgDate
    ? (i18n.language.startsWith('zh')
        ? `${msgDate.getFullYear()}年${msgDate.getMonth() + 1}月${msgDate.getDate()}日`
        : msgDate.toLocaleString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }))
    : '';

  const timeLabel = msgDate
    ? `${String(msgDate.getHours()).padStart(2, '0')}:${String(msgDate.getMinutes()).padStart(2, '0')}`
    : '';

  // Duration string from base.block timestamp diff — approximate, not millisecond-exact,
  // but good enough for the footer readout.
  const durationStr = (() => {
    if (!contextContent?.duration && contextContent?.duration !== 0) return '';
    const sec = contextContent.duration;
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  })();

  const modelInfo = (() => {
    if (block.role !== 'assistant' || !block.model) return null;
    const trimmed = block.model.trim();
    if (!trimmed) return null;
    const slashIndex = trimmed.indexOf('/');
    if (slashIndex === -1 || slashIndex === trimmed.length - 1) return { provider: '', model: trimmed, full: trimmed };
    return { provider: trimmed.slice(0, slashIndex), model: trimmed.slice(slashIndex + 1), full: trimmed };
  })();
  const contextModel = contextContent?.model || modelInfo?.full || block.model || '';
  const isEmptyAssistantStreaming = !isUser && block.isStreaming && !content.trim() && block.images.length === 0 && block.artifacts.length === 0 && !block.audio;

  // ── Avatar gradient per agent ──
  const avatarGradient = (() => {
    const idx = activeAgentId.charCodeAt(0) % 5;
    const gradients = [
      'from-violet-500 to-purple-700',
      'from-blue-500 to-cyan-600',
      'from-emerald-500 to-teal-600',
      'from-amber-500 to-orange-600',
      'from-rose-500 to-pink-600',
    ];
    return gradients[idx];
  })();

  return (
    <div
      className={clsx('group flex gap-2.5 items-start mx-1 mr-4 mb-2', isUser ? 'flex-row-reverse' : '')}
      dir={dir}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>

      {/* ── Avatar ── */}
      {isUser ? (
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5
          bg-aegis-primary/15 border border-aegis-primary/25">
          <User size={13} className="text-aegis-primary" />
        </div>
      ) : (
        <div className={clsx(
          'w-7 h-7 rounded-full bg-gradient-to-br flex items-center justify-center shrink-0 mt-0.5',
          'shadow-sm ring-1 ring-white/5',
          avatarGradient,
        )}>
          {activeAgentName === 'Claude Code' ? (
            <Sparkles size={13} className="text-white" />
          ) : activeAgentName === 'Codex' ? (
            <Bot size={13} className="text-white" />
          ) : (
            <span className="text-[10px] font-bold text-white">{activeAgentLetter}</span>
          )}
        </div>
      )}

      {/* ── Content Column ── */}
      <div className="flex flex-col min-w-0"
        style={{ width: '100%', maxWidth: 'min(1000px, 78%)', alignItems: isUser ? 'flex-end' : 'flex-start' }}>

        {/* Bubble */}

        {/* Bubble */}
        <div className={clsx(
          'relative block border rounded-2xl py-3 transition-colors duration-150',
          // Always reserve right padding for the Copy button (kooky/Claude-style).
          // The button sits absolutely on the right edge; text wraps around the
          // reserved gutter so it never gets covered, even when the button is
          // invisible. `pl-4 pr-9` = 16px left, 36px right (28px button + 8px gap).
          'pl-4 pr-9 max-w-full box-border min-w-0 break-words group/bubble',
          isEmptyAssistantStreaming
            ? 'bg-transparent border-transparent shadow-none py-1 pl-0 pr-0'
            : isUser
              ? 'bg-aegis-primary/[0.10] border-aegis-primary/15 hover:border-aegis-primary/30'
              : 'bg-[rgb(var(--aegis-overlay)/0.03)] border-[rgb(var(--aegis-overlay)/0.05)] hover:border-[rgb(var(--aegis-overlay)/0.10)]',
          block.isStreaming && !isEmptyAssistantStreaming && 'border-aegis-primary/35 streaming-border',
        )} style={{ width: 'auto' }}>

          {/* Floating Copy button — top-right corner of the FIRST line, hugging
              the bubble border (4px inset). opacity-0 by default and reveals on
              bubble hover, focus, or after a successful copy. Sits in the
              reserved pr-9 gutter so it never overlaps text. */}
          {!block.isStreaming && !isEditing && !isEmptyAssistantStreaming && (
            <button onClick={handleCopy}
              className={clsx(
                'absolute right-1 top-1 z-10',
                'inline-flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150',
                'opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100',
                copied && 'opacity-100',
                'bg-[rgb(var(--aegis-bg)/0.92)] border border-aegis-border backdrop-blur-sm shadow-sm',
                'hover:bg-[rgb(var(--aegis-elevated))] hover:border-aegis-border-hover',
                'text-aegis-text-muted hover:text-aegis-text',
              )}
              title={copied ? t('chat.copied', 'Copied') : t('chat.copy', 'Copy')}
              aria-label={copied ? t('chat.copied', 'Copied') : t('chat.copy', 'Copy')}>
              {copied ? <Check size={14} className="text-aegis-success" /> : <Copy size={14} />}
            </button>
          )}

          {/* Audio Player */}
          {block.audio && !block.isStreaming && (
            <div className="mb-2"><AudioPlayer src={block.audio} /></div>
          )}

          {/* Images */}
          {block.images.length > 0 && (
            <div className={clsx('mb-2 gap-1.5',
              block.images.length === 1 ? 'flex' :
              block.images.length === 2 ? 'grid grid-cols-2' :
              block.images.length === 3 ? 'grid grid-cols-2' :
              'grid grid-cols-2 sm:grid-cols-3')}>
              {block.images.map((img, i) => (
                <ChatImage key={i} src={img.src} alt={img.alt || t('media.attachment')}
                  maxWidth={block.images.length === 1 ? '360px' : '100%'}
                  maxHeight={block.images.length === 1 ? '300px' : '180px'} />
              ))}
            </div>
          )}

          {/* Content */}
          {isEditing ? (
            <div className="w-full">
              <textarea autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
                className="w-full min-w-[320px] bg-[rgb(var(--aegis-overlay)/0.04)] rounded-lg p-2 text-[13px] text-aegis-text border border-aegis-border outline-none focus:border-aegis-primary/30 resize-y min-h-[60px]"
                rows={Math.min(editText.split('\n').length + 1, 8)} />
              <div className="flex gap-1.5 mt-1.5">
                <button onClick={() => { onResend?.(editText); setIsEditing(false); }}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-aegis-primary/10 text-aegis-primary border border-aegis-primary/20 hover:bg-aegis-primary/20 transition-colors">
                  {t('chat.sendEdit', 'Send')}
                </button>
                <button onClick={() => setIsEditing(false)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-aegis-text-muted hover:text-aegis-text-secondary transition-colors">
                  {t('chat.cancel', 'Cancel')}
                </button>
              </div>
            </div>
          ) : block.isStreaming ? (
            <div className="flex flex-col gap-2">
              {content.trim() && (
                <pre className="markdown-body text-[14px] leading-relaxed text-aegis-text whitespace-pre-wrap break-words font-[inherit]">
                  {content}
                  {/* Blinking caret — visually anchors the current write position
                      and signals "agent is still typing" even on long pauses. */}
                  <span
                    aria-hidden
                    className="inline-block w-[2px] h-[1em] ml-0.5 align-text-bottom"
                    style={{
                      background: 'rgb(var(--aegis-primary))',
                      animation: 'aegis-caret 1s steps(2) infinite',
                    }}
                  />
                </pre>
              )}
              {/* Thinking prelude — no text label; just a subtle three-dot motion. */}
              <div
                className={clsx(
                  'inline-flex items-center gap-1.5 select-none',
                  isEmptyAssistantStreaming && 'px-3 py-2 rounded-2xl border border-[rgb(var(--aegis-overlay)/0.06)] bg-[rgb(var(--aegis-overlay)/0.025)] shadow-sm',
                )}
                aria-label={t('chat.assistantPreparing', 'Assistant is preparing a response')}
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="inline-block rounded-full"
                    style={{
                      width: i === 1 ? 7 : 6,
                      height: i === 1 ? 7 : 6,
                      background: i === 1 ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-primary)/0.55)',
                      boxShadow: i === 1 ? '0 0 10px rgb(var(--aegis-primary)/0.35)' : 'none',
                      animation: `typing-dot 1.15s ease-in-out ${i * 0.16}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="markdown-body text-[15px] leading-relaxed text-aegis-text">
              {content && (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {content}
                </ReactMarkdown>
              )}
              {/* Blinking caret — gives a clear "still typing" signal while the
                  LLM is streaming tokens in. Goes inside the markdown flow so
                  it sits right after the latest content. */}
              {block.isStreaming && (
                <span
                  className="inline-block w-[7px] h-[16px] ms-0.5 align-text-bottom -mb-[3px] rounded-sm bg-aegis-primary/70 animate-pulse"
                  style={{ animationDuration: '0.9s' }}
                  aria-hidden
                />
              )}
            </div>
          )}

          {/* Artifacts */}
          {block.artifacts.map((art, idx) => (
            <ArtifactCard key={`art-${idx}`} artifact={art} />
          ))}

          {/* Collapsed Meta */}
          {block.meta && block.meta.length > 0 && !block.isStreaming && (
            <CollapsedMeta items={block.meta} />
          )}

          {/* Error Action */}
          {errorAction && (
            <div className="mt-3 pt-2.5 border-t border-aegis-warning/15">
              <button onClick={() => { setErrorActionDone(true); onErrorAction?.(errorAction.action); }}
                disabled={errorActionDone}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                  'bg-aegis-warning/10 border border-aegis-warning/25 text-aegis-warning',
                  'hover:bg-aegis-warning/20 hover:border-aegis-warning/40',
                  errorActionDone && 'opacity-40 pointer-events-none',
                )}>
                <AlertTriangle size={14} />
                {t(errorAction.label, 'Reset Session')}
              </button>
            </div>
          )}
        </div>

        {/* ── Footer: agent | time + duration | context | model | actions ── */}
        <div className={clsx(
          'flex items-center mt-1 flex-wrap select-none',
          isUser && 'justify-end',
        )} style={{ gap: 6, rowGap: 3 }}
          onMouseEnter={() => setFooterHovered(true)}
          onMouseLeave={() => setFooterHovered(false)}
        >

          {/* Sender name (assistant only) */}
          {!isUser && (
            <span className="text-[11px] font-medium text-aegis-text-muted">
              {activeAgentName}
            </span>
          )}

          {/* Timestamp + duration — AI: "Jun 25 14:32 · 12s", User: "14:32" */}
          {isUser ? (
            <time className="text-[10px] text-aegis-text-muted tabular-nums" dateTime={block.timestamp || ''}>
              {timeLabel}
            </time>
          ) : (
            <span className="inline-flex items-center text-[10px] text-aegis-text-muted" style={{ gap: 4 }}>
              <span>{dateLabel}</span>
              <time className="tabular-nums" dateTime={block.timestamp || ''}>{timeLabel}</time>
              {durationStr && (
                <>
                  <span className="text-aegis-border">·</span>
                  <span className="tabular-nums text-aegis-text-dim">{durationStr}</span>
                </>
              )}
            </span>
          )}

          {/* Edit indicator */}
          {(block as { editedAt?: string }).editedAt && (
            <span className="text-[10px] text-aegis-text-dim italic">· {t('chat.edited', 'edited')}</span>
          )}

          {/* Context / usage metadata — always visible for assistant messages */}
          {!isUser && (
            <button onClick={() => setCtxOpen(v => !v)}
              className="inline-flex items-center gap-1 text-[10px] rounded-full px-1.5 py-0.5 transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim font-mono tabular-nums">
              <ChevronRight size={10} className={clsx('shrink-0 transition-transform', ctxOpen && 'rotate-90')} style={{ strokeWidth: 2 }} />
              {inlineUsageParts.length > 0 ? inlineUsageParts.map((part, idx) => <span key={part} className={idx >= 2 ? 'text-aegis-text-dim/80' : undefined}>{part}</span>) : <span>ctx</span>}
            </button>
          )}

          {/* ── Action buttons (show on footer hover, independent of bubble) ── */}
          <span className={clsx(
            'inline-flex items-center gap-0.5 transition-opacity duration-150',
            (footerHovered || isUser) ? 'opacity-100' : 'opacity-0',
          )}>
            {/* Dot separator */}
            <span className="text-aegis-border text-[10px] select-none">·</span>
            {/* Edit (user only) */}
            {isUser && onResend && (
              <ActionBtn icon={<Pencil size={14} />} label={t('chat.edit', 'Edit')}
                onClick={() => { setIsEditing(true); setEditText(block.markdown); }} />
            )}

            {/* Regenerate (assistant only) */}
            {!isUser && onRegenerate && (
              <ActionBtn icon={<RefreshCw size={14} />} label={t('chat.regenerate', 'Regenerate')}
                onClick={onRegenerate} />
            )}

            {/* Retry (user only, as resend) */}
            {isUser && onResend && (
              <ActionBtn icon={<RotateCcw size={14} />} label={t('chat.resend', 'Resend')}
                onClick={() => onResend(block.markdown)} />
            )}

            {/* Delete */}
            {onDelete && (
              <ActionBtn icon={<Trash2 size={14} />} label={t('chat.delete', 'Delete')}
                onClick={onDelete} danger />
            )}
          </span>
        </div>

        {!isUser && ctxOpen && (
          <div className="mt-1 w-full max-w-[min(900px,100%)] rounded-lg border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)] px-2.5 py-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums">
              <span className="text-aegis-text-dim">agent <span className="text-aegis-text">{activeAgentName}</span></span>
              <span className="text-aegis-text-dim">model <span className="text-aegis-text">{contextModel || '—'}</span></span>
              <span className="text-blue-400">input {contextInputTokens ? ctxFmt(contextInputTokens) : '—'}</span>
              <span className="text-emerald-400">output {contextOutputTokens ? ctxFmt(contextOutputTokens) : '—'}</span>
              <span className="text-aegis-text-dim">total <span className="text-aegis-text">{contextTotalTokens > 0 ? ctxFmt(contextTotalTokens) : '—'}</span></span>
              <span className="text-aegis-text-dim">R {contextCacheRead ? ctxFmt(contextCacheRead) : '0'}</span>
              <span className="text-aegis-text-dim">W {contextCacheWrite ? ctxFmt(contextCacheWrite) : '0'}</span>
              <span className="text-aegis-text-dim">ctx <span className="text-aegis-text">{contextContent?.contextPercent != null ? `${contextContent.contextPercent}%` : '—'}</span></span>
              {durationStr && <span className="text-aegis-text-dim">duration <span className="text-aegis-text">{durationStr}</span></span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
