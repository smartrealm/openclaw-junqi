import { lazy, memo, Suspense, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Copy, Check, User, RotateCcw, Pencil,
  ChevronDown, ChevronRight, AlertTriangle, Eye, Code2,
  Sparkles, Bot, Globe, FileText,
  FileSpreadsheet, FileArchive, FileJson, FileCode2, Music, Film,
  Kanban, Wrench, Brain, CheckCircle2, Info, GitFork, Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import { getDirection } from '@/i18n';
import type { MessageBlock, Artifact, MetaItem } from '@/types/RenderBlock';
import { Icon } from '@/components/shared/icons';
import { StatusIcon } from '@/components/shared/StatusIcon';
import clsx from 'clsx';
import { debugError } from '@/utils/debugLog';

const CodeBlock = lazy(() => import('./CodeBlock').then((m) => ({ default: m.CodeBlock })));
const ChatImage = lazy(() => import('./ChatImage').then((m) => ({ default: m.ChatImage })));
const ChatVideo = lazy(() => import('./ChatVideo').then((m) => ({ default: m.ChatVideo })));
const AudioPlayer = lazy(() => import('./AudioPlayer').then((m) => ({ default: m.AudioPlayer })));
const SystemNoteBubble = lazy(() => import('./SystemNoteBubble').then((m) => ({ default: m.SystemNoteBubble })));

function MediaFallback({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'flex items-center justify-center rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.04)] text-[11px] text-aegis-text-dim animate-pulse',
        className,
      )}
    >
      ...
    </div>
  );
}

function CodeBlockFallback({ language, code }: { language: string; code: string }) {
  const displayLang = language || 'text';
  return (
    <div
      className="my-2 rounded-xl overflow-hidden border border-[rgb(var(--aegis-overlay)/0.08)]"
      dir="ltr"
      style={{ background: 'var(--aegis-code-bg)' }}
    >
      <div
        className="flex items-center justify-between px-3.5 py-1.5 border-b border-[rgb(var(--aegis-overlay)/0.06)]"
        style={{ background: 'var(--aegis-code-header)' }}
      >
        <span className="text-[10px] font-mono font-medium text-aegis-text-muted uppercase tracking-widest">
          {displayLang}
        </span>
      </div>
      <pre
        className="m-0 p-4 text-[0.87em] font-mono text-aegis-text whitespace-pre-wrap break-words overflow-x-auto"
        style={{ background: 'var(--aegis-code-bg)' }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

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
  const [tab, setTab] = useState<'preview' | 'source'>('source');
  const typeIcons: Record<string, React.ReactNode> = {
    html:    Icon.chat.artifact.html,
    react:   Icon.chat.artifact.react,
    svg:     Icon.chat.artifact.svg,
    mermaid: Icon.chat.artifact.mermaid,
    markdown:Icon.chat.artifact.markdown,
    code:    Icon.chat.artifact.code,
  };

  const defaultArtifactIcon = Icon.chat.artifact.generic;

  const supportsPreview = artifact.type === 'html' || artifact.type === 'svg';

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
        </div>
      </div>

      {tab === 'preview' && supportsPreview ? (
        <div className="bg-white" style={{ minHeight: 320 }}>
          <iframe
            srcDoc={artifact.content}
            title={artifact.title}
            sandbox=""
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
            <Suspense key={`system-${idx}`} fallback={<MediaFallback className="h-8 w-full" />}>
              <SystemNoteBubble content={item.content} />
            </Suspense>
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
  onRecall?: (content: string) => void;
  onRetry?: () => void;
  onErrorAction?: (action: string) => void;
  deliveryStatus?: 'pending' | 'sent' | 'queued' | 'failed' | 'cancelled';
  deliveryError?: string;
  outboundAttachments?: Array<{ fileName: string; mimeType: string }>;
  historyTruncated?: boolean;
  historyTruncationReason?: string;
  onLoadFullMessage?: () => Promise<void>;
  collaborationAction?: {
    state: 'confirming' | 'ready' | 'active';
    onClick?: () => void;
  };
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
    } catch (err) { debugError('media', '[MessageBubble] Failed to open file card path:', err); }
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
function ActionBtn({ icon, label, onClick, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center w-7 h-7 rounded transition-all duration-150',
        '[@media(pointer:coarse)]:h-[40px] [@media(pointer:coarse)]:w-[40px]',
        'hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted hover:text-aegis-text',
        'disabled:cursor-wait disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-aegis-text-muted',
      )}
      title={label}
      aria-label={label}>
      {icon}
    </button>
  );
}

// ── Markdown Components ──
async function openExternalHref(href: string): Promise<void> {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(href);
  } catch {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}

const markdownComponents = {
  table({ children }: any) {
    return <div className="table-wrapper"><table>{children}</table></div>;
  },
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match || codeString.includes('\n')) {
      const language = match?.[1] || '';
      return (
        <Suspense fallback={<CodeBlockFallback language={language} code={codeString} />}>
          <CodeBlock language={language} code={codeString} />
        </Suspense>
      );
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
    if (videoExtensions.test(src)) {
      return (
        <Suspense fallback={<MediaFallback className="h-[220px] w-full max-w-[400px]" />}>
          <ChatVideo src={src} alt={alt} maxWidth="100%" maxHeight="400px" />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<MediaFallback className="h-[220px] w-full max-w-[400px]" />}>
        <ChatImage src={src} alt={alt} maxWidth="100%" maxHeight="400px" />
      </Suspense>
    );
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
    if (href && videoExtensions.test(href)) {
      return (
        <Suspense fallback={<MediaFallback className="h-[220px] w-full max-w-[400px]" />}>
          <ChatVideo src={href} alt={String(children) || 'video'} maxWidth="100%" maxHeight="400px" />
        </Suspense>
      );
    }
    return (
      <a href={href} onClick={async (e) => {
        e.preventDefault();
        if (!href) return;
        const openManagedPath = window.aegis?.managedFiles?.open || window.aegis?.uploads?.open;
        if (isLocalFilePath(href) && openManagedPath) { await openManagedPath(href); return; }
        await openExternalHref(href);
      }} className="text-aegis-primary hover:text-aegis-primary/70 underline underline-offset-2">
        {children}
      </a>
    );
  },
};

export const MessageBubble = memo(function MessageBubble({
  block, onRecall, onRetry, onErrorAction, collaborationAction,
  deliveryStatus, deliveryError, outboundAttachments,
  historyTruncated, historyTruncationReason, onLoadFullMessage,
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
  const [footerHovered, setFooterHovered] = useState(false);
  const [loadingFullMessage, setLoadingFullMessage] = useState(false);
  const [fullMessageError, setFullMessageError] = useState('');
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
  const inlineUsageParts = [
    contextInputTokens ? `↑${ctxFmt(contextInputTokens)}` : '',
    contextOutputTokens ? `↓${ctxFmt(contextOutputTokens)}` : '',
    contextCacheRead ? `R${ctxFmt(contextCacheRead)}` : '',
    contextCacheWrite ? `W${ctxFmt(contextCacheWrite)}` : '',
    contextContent?.contextPercent != null ? `${contextContent.contextPercent}% ${t('chat.context', '上下文')}` : '',
  ].filter(Boolean);

  const isUser = block.role === 'user';
  const dir = getDirection(i18n.language);
  const content = block.markdown;
  const errorAction = !isUser && !block.isStreaming && onErrorAction ? detectErrorAction(content) : null;
  const responseStatus = !isUser && block.responseState === 'aborted'
    ? 'cancelled'
    : !isUser && block.responseState === 'error'
      ? 'error'
      : null;

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
  const [waitElapsedSec, setWaitElapsedSec] = useState(0);

  useEffect(() => {
    if (!isEmptyAssistantStreaming) {
      setWaitElapsedSec(0);
      return;
    }
    const start = new Date(block.timestamp).getTime();
    const startedAt = Number.isFinite(start) ? start : Date.now();
    const update = () => setWaitElapsedSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isEmptyAssistantStreaming, block.timestamp]);

  return (
    <div
      className={clsx('group flex gap-2.5 items-start mx-1 mr-4 mb-2.5', isUser ? 'flex-row-reverse' : '')}
      dir={dir}>

      {/* ── Avatar ── */}
      {isUser ? (
        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5
          bg-aegis-primary/15 border border-aegis-primary/25">
          <User size={14} className="text-aegis-primary" />
        </div>
      ) : (
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow-sm ring-1 ring-aegis-primary/20"
          style={{ backgroundImage: 'linear-gradient(135deg, rgb(var(--aegis-primary)), rgb(var(--aegis-primary-deep)))' }}
        >
          {activeAgentName === 'Claude Code' ? (
            <Sparkles size={14} className="text-white" />
          ) : activeAgentName === 'Codex' ? (
            <Bot size={14} className="text-white" />
          ) : (
            <span className="text-[10px] font-bold text-white">{activeAgentLetter}</span>
          )}
        </div>
      )}

      {/* ── Content Column ── */}
      <div className="flex flex-col min-w-0"
        style={{ width: '100%', maxWidth: 'min(640px, 72%)', alignItems: isUser ? 'flex-end' : 'flex-start' }}>

        {/* Bubble */}
        <motion.div
          key={`${block.id}-bubble`}
          className={clsx(
          'relative block rounded-xl py-2.5 transition-colors duration-150',
          'pl-4 pr-9 max-w-full box-border min-w-0 break-words group/bubble',
          isEmptyAssistantStreaming
            ? 'bg-transparent shadow-none p-0 pl-0 pr-0 py-0'
            : isUser
              ? 'bg-aegis-primary/[0.10] border border-aegis-primary/20 shadow-sm'
              : 'bg-[rgb(var(--aegis-primary)/0.035)] hover:bg-[rgb(var(--aegis-primary)/0.055)] border border-aegis-primary/10 shadow-[inset_1px_0_0_rgb(var(--aegis-primary)/0.12)]',
          block.isStreaming && !isEmptyAssistantStreaming && 'ring-1 ring-aegis-primary/30',
          )}
          style={{ width: 'auto' }}
        >

          {/* Floating Copy button — top-right corner of the FIRST line, hugging
              the bubble border (4px inset). opacity-0 by default and reveals on
              bubble hover, focus, or after a successful copy. Sits in the
              reserved pr-9 gutter so it never overlaps text. */}
          {!block.isStreaming && !isEmptyAssistantStreaming && (
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
            <div className="mb-2">
              <Suspense fallback={<MediaFallback className="h-10 w-full" />}>
                <AudioPlayer
                  src={block.audio}
                  sessionKey={activeSessionKey}
                  trackVoiceOutput={!isUser}
                />
              </Suspense>
            </div>
          )}

          {/* Images */}
          {block.images.length > 0 && (
            <div className={clsx('mb-2 gap-1.5',
              block.images.length === 1 ? 'flex' :
              block.images.length === 2 ? 'grid grid-cols-2' :
              block.images.length === 3 ? 'grid grid-cols-2' :
              'grid grid-cols-2 sm:grid-cols-3')}>
              {block.images.map((img, i) => (
                <Suspense
                  key={i}
                  fallback={
                    <MediaFallback
                      className={block.images.length === 1 ? 'h-[220px] w-[360px] max-w-full' : 'h-[140px] w-full'}
                    />
                  }
                >
                  <ChatImage
                    src={img.src}
                    alt={img.alt || t('media.attachment')}
                    maxWidth={block.images.length === 1 ? '360px' : '100%'}
                    maxHeight={block.images.length === 1 ? '300px' : '180px'}
                  />
                </Suspense>
              ))}
            </div>
          )}

          {outboundAttachments?.some((attachment) => !attachment.mimeType.startsWith('image/')) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {outboundAttachments
                .filter((attachment) => !attachment.mimeType.startsWith('image/'))
                .map((attachment) => (
                  <span
                    key={`${attachment.fileName}:${attachment.mimeType}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] px-2 py-1 text-[10.5px] text-aegis-text-muted"
                    title={attachment.fileName}
                  >
                    <FileText size={11} className="shrink-0 text-aegis-primary" />
                    <span className="truncate">{attachment.fileName}</span>
                  </span>
                ))}
            </div>
          )}

          {/* Content */}
          {block.isStreaming ? (
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
              {/* Thinking prelude — only when empty, otherwise blink caret is enough */}
              {isEmptyAssistantStreaming && (
              <div
                className={clsx(
                  'inline-flex items-center gap-1.5 select-none',
                  'px-3 py-2 rounded-xl border border-aegis-primary/25 bg-[color-mix(in_srgb,rgb(var(--aegis-primary))_14%,rgb(var(--aegis-elevated)))] shadow-[0_0_18px_rgb(var(--aegis-primary)/0.12)]',
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
                      background: i === 1
                        ? 'rgb(var(--aegis-primary))'
                        : 'color-mix(in srgb, rgb(var(--aegis-primary)) 62%, rgb(var(--aegis-text)) 18%)',
                      boxShadow: i === 1 ? '0 0 10px rgb(var(--aegis-primary)/0.45)' : 'none',
                      animation: `typing-dot 1.15s ease-in-out ${i * 0.16}s infinite`,
                    }}
                  />
                ))}
                {isEmptyAssistantStreaming && (
                  <span className="ms-1.5 ps-2 border-s border-aegis-primary/20 text-[10px] font-mono tabular-nums text-aegis-primary/90">
                    {waitElapsedSec}s
                  </span>
                )}
              </div>
              )}
            </div>
          ) : (
            <div className="flex min-w-0 items-start gap-2 text-[15px] leading-relaxed text-aegis-text">
              {responseStatus && (
                <span
                  className="mt-[3px] inline-flex h-4 w-4 shrink-0 items-center justify-center"
                  aria-label={responseStatus === 'cancelled'
                    ? t('chat.stopped', 'Stopped')
                    : t('errors.occurred', 'An error occurred')}
                >
                  <StatusIcon status={responseStatus} size={14} />
                </span>
              )}
              <div className="markdown-body min-w-0 flex-1">
                {content && (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {content}
                  </ReactMarkdown>
                )}
              </div>
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

          {historyTruncated && onLoadFullMessage && !block.isStreaming && (
            <div className="mt-3 pt-2.5 border-t border-aegis-border/50">
              <button
                type="button"
                disabled={loadingFullMessage}
                onClick={() => {
                  setLoadingFullMessage(true);
                  setFullMessageError('');
                  void onLoadFullMessage()
                    .catch((error) => setFullMessageError(
                      error instanceof Error ? error.message : String(error),
                    ))
                    .finally(() => setLoadingFullMessage(false));
                }}
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-aegis-border px-2.5 py-1 text-[11px] font-medium text-aegis-text-muted transition-colors hover:border-aegis-primary/35 hover:text-aegis-text disabled:cursor-wait disabled:opacity-60"
                title={historyTruncationReason}
              >
                {loadingFullMessage
                  ? <Loader2 size={13} className="animate-spin" />
                  : <FileText size={13} />}
                {t('chat.loadFullMessage', '加载完整消息')}
              </button>
              {fullMessageError && (
                <p className="mt-1 text-[10px] text-aegis-danger">{fullMessageError}</p>
              )}
            </div>
          )}

          {/* Error Action */}
          {errorAction && (
            <div className="mt-3 pt-2.5 border-t border-aegis-warning/15">
              <button onClick={() => { onErrorAction?.(errorAction.action); }}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                  'bg-aegis-warning/10 border border-aegis-warning/25 text-aegis-warning',
                  'hover:bg-aegis-warning/20 hover:border-aegis-warning/40',
                )}>
                <AlertTriangle size={14} />
                {t(errorAction.label, 'Reset Session')}
              </button>
            </div>
          )}
        </motion.div>

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
            <span className="inline-flex items-center gap-1.5">
              <time className="text-[10px] text-aegis-text-muted tabular-nums" dateTime={block.timestamp || ''}>
                {timeLabel}
              </time>
              {deliveryStatus === 'pending' && (
                <span className="text-[10px] text-aegis-text-dim">{t('chat.sending', '发送中')}</span>
              )}
              {deliveryStatus === 'queued' && (
                <span className="text-[10px] text-aegis-warning">{t('chat.queued', '已排队')}</span>
              )}
              {deliveryStatus === 'failed' && (
                <span className="text-[10px] text-aegis-danger" title={deliveryError}>
                  {t('chat.sendFailed', '发送失败')}
                </span>
              )}
            </span>
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

          {/* Context / usage metadata — OpenClaw-style inline details. */}
          {!isUser && (inlineUsageParts.length > 0 || contextModel || durationStr) && (
            <details className="group/context inline-flex items-center gap-1.5 text-[10px] text-aegis-text-dim font-mono tabular-nums">
              <summary
                className={clsx(
                  'inline-flex min-h-[22px] cursor-pointer list-none items-center gap-1 rounded-full border px-1.5 py-0.5 select-none',
                  'border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] transition-colors',
                  'hover:border-aegis-primary/35 hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45',
                  '[&::-webkit-details-marker]:hidden',
                )}
                title={t('chat.showContextDetails', '显示消息上下文详情')}
              >
                <ChevronRight
                  size={10}
                  className="shrink-0 transition-transform group-open/context:rotate-90"
                  style={{ strokeWidth: 2 }}
                />
                <span>{t('chat.context', '上下文')}</span>
              </summary>
              <span className="inline-flex items-center gap-2 rounded-full border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)] px-2 py-0.5">
                {contextInputTokens > 0 && <span className="text-blue-400">↑{ctxFmt(contextInputTokens)}</span>}
                {contextOutputTokens > 0 && <span className="text-emerald-400">↓{ctxFmt(contextOutputTokens)}</span>}
                {contextCacheRead > 0 && <span className="text-aegis-text-dim/80">R{ctxFmt(contextCacheRead)}</span>}
                {contextCacheWrite > 0 && <span className="text-aegis-text-dim/80">W{ctxFmt(contextCacheWrite)}</span>}
                {contextContent?.contextPercent != null && (
                  <span className={clsx(
                    contextContent.contextPercent >= 90
                      ? 'text-aegis-danger'
                      : contextContent.contextPercent >= 75
                        ? 'text-aegis-warning'
                        : 'text-aegis-text-dim',
                  )}>
                    {contextContent.contextPercent}% {t('chat.context', '上下文')}
                  </span>
                )}
                {durationStr && <span className="text-aegis-text-dim">{t('chat.contextDuration', '耗时')} <span className="text-aegis-text">{durationStr}</span></span>}
                {contextModel && (
                  <span className="rounded bg-[rgb(var(--aegis-overlay)/0.06)] px-1.5 py-px text-aegis-text">
                    {contextModel.includes('/') ? contextModel.split('/').pop() : contextModel}
                  </span>
                )}
              </span>
            </details>
          )}

          {/* ── Action buttons (show on footer hover, independent of bubble) ── */}
          <span className={clsx(
            'inline-flex items-center gap-0.5 transition-opacity duration-150',
            (footerHovered || isUser) ? 'opacity-100' : 'opacity-0',
          )}>
            {/* Dot separator */}
            <span className="text-aegis-border text-[10px] select-none">·</span>
            {/* Recall copies the original text into the composer without mutating history. */}
            {isUser && onRecall && (
              <ActionBtn icon={<Pencil size={14} />} label={t('chat.recallToInput', 'Edit in composer')}
                onClick={() => onRecall(block.markdown)} />
            )}

            {/* Retry is available only for a delivery that actually failed. */}
            {isUser && onRetry && (
              <ActionBtn icon={<RotateCcw size={14} />} label={t('chat.retryDelivery', 'Retry delivery')}
                onClick={onRetry} />
            )}

            {isUser && collaborationAction && (
              <ActionBtn
                icon={collaborationAction.state === 'confirming'
                  ? <Loader2 size={14} className="animate-spin" />
                  : <GitFork size={14} />}
                label={collaborationAction.state === 'active'
                  ? t('collaboration.chat.viewRun', 'View collaboration')
                  : collaborationAction.state === 'ready'
                    ? t('collaboration.chat.startRun', 'Start collaboration')
                    : t('collaboration.chat.confirmingMessage', 'Confirming message identity')}
                onClick={() => collaborationAction.onClick?.()}
                disabled={collaborationAction.state === 'confirming' || !collaborationAction.onClick}
              />
            )}

          </span>
        </div>

      </div>
    </div>
  );
});
