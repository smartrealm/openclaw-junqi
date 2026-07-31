import { lazy, memo, Suspense, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  User, RotateCcw, Pencil, Trash2,
  ChevronDown, ChevronRight, AlertTriangle,
  Sparkles, Bot, FileText,

  Kanban, Wrench, Brain, CheckCircle2, Info, GitFork, History,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import { getDirection } from '@/i18n';
import type { MessageBlock, Artifact, MetaItem } from '@/types/RenderBlock';
import type { ResponseGroupMessagePosition } from '@/processing/buildResponseGroups';
import { Icon } from '@/components/shared/icons';
import { StatusIcon } from '@/components/shared/StatusIcon';
import clsx from 'clsx';
import { InlineUserMessageEditor } from './InlineUserMessageEditor';
import { MessageBubbleActions } from './MessageBubbleActions';
import { isPreviewableArtifact } from './artifactPreview';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { createChatMessagePreview, type ChatMessagePreview } from './chatMessagePreview';
import { ChatMarkdownRenderer, ChatMediaFallback } from './ChatMarkdownRenderer';
import { ChatIconButton } from './ChatIconButton';

const ChatImage = lazy(() => import('./ChatImage').then((m) => ({ default: m.ChatImage })));
const AudioPlayer = lazy(() => import('./AudioPlayer').then((m) => ({ default: m.AudioPlayer })));
const SystemNoteBubble = lazy(() => import('./SystemNoteBubble').then((m) => ({ default: m.SystemNoteBubble })));

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

  const supportsPreview = isPreviewableArtifact(artifact);

  return (
    <div className="my-3 rounded-xl border border-aegis-primary/20 bg-aegis-primary/[0.04] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-aegis-primary/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0 flex items-center">{typeIcons[artifact.type] || defaultArtifactIcon}</span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-aegis-text truncate">{artifact.title}</div>
            <div className="text-[10px] text-aegis-text-dim uppercase tracking-wider">
              {artifact.type} · {t('chat.trace.characterCount', { count: artifact.content.length })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {supportsPreview && (
            <div className="inline-flex rounded-md overflow-hidden border border-aegis-primary/20 text-[11px]">
              <button onClick={() => setTab('preview')}
                className={clsx('px-2.5 py-1 transition-colors',
                  tab === 'preview' ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-muted hover:text-aegis-text')}>
                {t('resultCards.preview')}
              </button>
              <button onClick={() => setTab('source')}
                className={clsx('px-2.5 py-1 transition-colors',
                  tab === 'source' ? 'bg-aegis-primary/15 text-aegis-primary' : 'text-aegis-text-muted hover:text-aegis-text')}>
                {t('resultCards.source')}
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
            <Suspense key={`system-${idx}`} fallback={<ChatMediaFallback className="h-8 w-full" />}>
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
  sessionKey?: string;
  groupPosition?: ResponseGroupMessagePosition;
  onEdit?: (content: string) => Promise<void>;
  onDelete?: () => void;
  onRetry?: () => void;
  onErrorAction?: (action: string) => void;
  deliveryStatus?: 'pending' | 'sent' | 'queued' | 'failed' | 'cancelled';
  deliveryError?: string;
  outboundAttachments?: Array<{ fileName: string; mimeType: string }>;
  historyTruncated?: boolean;
  historyTruncationReason?: string;
  onLoadFullMessage?: () => Promise<void>;
  onOpenPreview?: (preview: ChatMessagePreview) => void;
  collaborationAction?: {
    state: 'confirming' | 'ready' | 'active';
    onClick?: () => void;
  };
}

function agentIdFromSessionKey(sessionKey?: string | null): string {
  if (!sessionKey) return 'main';
  const parts = sessionKey.split(':');
  return parts[0] === 'agent' && parts[1] ? parts[1] : 'main';
}

function useAgentPresentation(sessionKey?: string | null) {
  const { t } = useTranslation();
  const agents = useGatewayDataStore((state) => state.agents);
  const agentId = agentIdFromSessionKey(sessionKey);
  const name = agents.find((agent) => agent.id === agentId)?.name
    || (agentId === 'main' ? t('agents.mainAgent') : agentId);
  return { name, letter: name.charAt(0) || 'M' };
}

export function AssistantResponseAvatar({
  sessionKey,
  className,
}: {
  sessionKey?: string | null;
  className?: string;
}) {
  const agent = useAgentPresentation(sessionKey);
  return (
    <div
      className={clsx(
        'w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow-sm ring-1 ring-aegis-primary/20',
        className,
      )}
      style={{ backgroundImage: 'linear-gradient(135deg, rgb(var(--aegis-primary)), rgb(var(--aegis-primary-deep)))' }}
      aria-label={agent.name}
    >
      {agent.name === 'Claude Code' ? (
        <Sparkles size={14} className="text-white" />
      ) : agent.name === 'Codex' ? (
        <Bot size={14} className="text-white" />
      ) : (
        <span className="text-[10px] font-bold text-white">{agent.letter}</span>
      )}
    </div>
  );
}

function compactTokenCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return String(value);
}

function responseDuration(block?: MessageBlock | null): string {
  const context = block?.meta?.find((item) => item.kind === 'context')?.content;
  if (!context) return '';
  try {
    const duration = (JSON.parse(context) as { duration?: number }).duration;
    if (typeof duration !== 'number' || !Number.isFinite(duration)) return '';
    if (duration < 60) return `${duration}s`;
    return `${Math.floor(duration / 60)}m ${duration % 60}s`;
  } catch {
    return '';
  }
}

export function AssistantResponseFooter({
  sessionKey,
  block,
  timestamp,
  status = 'final',
  onOpenTrace,
  className,
}: {
  sessionKey?: string | null;
  block?: MessageBlock | null;
  timestamp: string;
  status?: 'streaming' | 'final' | 'error' | 'aborted';
  onOpenTrace?: () => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const agent = useAgentPresentation(sessionKey);
  const messageDate = (() => {
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  })();
  const dateLabel = messageDate
    ? (i18n.language.startsWith('zh')
        ? `${messageDate.getFullYear()}年${messageDate.getMonth() + 1}月${messageDate.getDate()}日`
        : messageDate.toLocaleString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }))
    : '';
  const timeLabel = messageDate
    ? `${String(messageDate.getHours()).padStart(2, '0')}:${String(messageDate.getMinutes()).padStart(2, '0')}`
    : '';
  const contextMeta = block?.meta?.find((item) => item.kind === 'context')?.content;
  const context = contextMeta
    ? (() => {
        try {
          return JSON.parse(contextMeta) as {
            input?: number;
            inputTokens?: number;
            output?: number;
            outputTokens?: number;
            cacheRead?: number;
            cacheReadInputTokens?: number;
            cacheWrite?: number;
            cacheCreationInputTokens?: number;
            contextPercent?: number | null;
            model?: string;
          };
        } catch {
          return null;
        }
      })()
    : null;
  const input = context?.input ?? context?.inputTokens ?? 0;
  const output = context?.output ?? context?.outputTokens ?? 0;
  const cacheRead = context?.cacheRead ?? context?.cacheReadInputTokens ?? 0;
  const cacheWrite = context?.cacheWrite ?? context?.cacheCreationInputTokens ?? 0;
  const duration = responseDuration(block);
  const contextModel = context?.model || block?.model || '';
  const hasContext = input > 0
    || output > 0
    || cacheRead > 0
    || cacheWrite > 0
    || context?.contextPercent != null
    || Boolean(contextModel)
    || Boolean(duration);

  return (
    <div
      className={clsx('flex flex-wrap items-center gap-x-1.5 gap-y-1 select-none', className)}
      data-response-footer
    >
      {(status === 'error' || status === 'aborted') && (
        <StatusIcon
          status={status === 'error' ? 'error' : 'cancelled'}
          size={13}
        />
      )}
      <span className="text-[11px] font-medium text-aegis-text-muted">{agent.name}</span>
      <span className="inline-flex items-center gap-1 text-[10px] text-aegis-text-muted">
        <span>{dateLabel}</span>
        <time className="tabular-nums" dateTime={timestamp}>{timeLabel}</time>
        {duration && (
          <>
            <span className="text-aegis-border">·</span>
            <span className="tabular-nums text-aegis-text-dim">{duration}</span>
          </>
        )}
      </span>
      {hasContext && (
        <details className="group/context inline-flex items-center gap-1.5 text-[10px] text-aegis-text-dim font-mono tabular-nums">
          <summary
            className={clsx(
              'inline-flex min-h-[22px] cursor-pointer list-none items-center gap-1 rounded-full border px-1.5 py-0.5 select-none',
              'border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] transition-colors',
              'hover:border-aegis-primary/35 hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45',
              '[&::-webkit-details-marker]:hidden',
            )}
            title={t('chat.showContextDetails')}
          >
            <ChevronRight size={10} className="shrink-0 transition-transform group-open/context:rotate-90" />
            <span>{t('chat.context')}</span>
          </summary>
          <span className="inline-flex items-center gap-2 rounded-full border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.03)] px-2 py-0.5">
            {input > 0 && <span className="text-blue-400">↑{compactTokenCount(input)}</span>}
            {output > 0 && <span className="text-emerald-400">↓{compactTokenCount(output)}</span>}
            {cacheRead > 0 && <span className="text-aegis-text-dim/80">R{compactTokenCount(cacheRead)}</span>}
            {cacheWrite > 0 && <span className="text-aegis-text-dim/80">W{compactTokenCount(cacheWrite)}</span>}
            {context?.contextPercent != null && (
              <span className={clsx(
                context.contextPercent >= 90
                  ? 'text-aegis-danger'
                  : context.contextPercent >= 75
                    ? 'text-aegis-warning'
                    : 'text-aegis-text-dim',
              )}>
                {context.contextPercent}% {t('chat.context')}
              </span>
            )}
            {duration && <span>{t('chat.contextDuration')} <span className="text-aegis-text">{duration}</span></span>}
            {contextModel && (
              <span className="rounded bg-[rgb(var(--aegis-overlay)/0.06)] px-1.5 py-px text-aegis-text">
                {contextModel.includes('/') ? contextModel.split('/').pop() : contextModel}
              </span>
            )}
          </span>
        </details>
      )}
      {onOpenTrace && (
        <button
          type="button"
          onClick={onOpenTrace}
          className="inline-flex min-h-[22px] items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary"
          title={t('chat.trace.open')}
          aria-label={t('chat.trace.open')}
          data-open-response-trace
        >
          <History size={11} />
          <span>{t('chat.trace.open')}</span>
        </button>
      )}
    </div>
  );
}

// ── Action Button (icon-only, hover tooltip via title) ──
function ActionBtn({ icon, label, onClick, disabled, danger = false }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <ChatIconButton type="button" onClick={onClick} disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center w-7 h-7 rounded transition-all duration-150',
        '[@media(pointer:coarse)]:h-[40px] [@media(pointer:coarse)]:w-[40px]',
        danger
          ? 'text-aegis-text-muted hover:bg-aegis-danger/10 hover:text-aegis-danger'
          : 'hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-muted hover:text-aegis-text',
        'disabled:cursor-wait disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-aegis-text-muted',
      )}
      label={label}>
      {icon}
    </ChatIconButton>
  );
}

export const MessageBubble = memo(function MessageBubble({
  block, sessionKey, onEdit, onDelete, onRetry, onErrorAction, collaborationAction,
  deliveryStatus, deliveryError, outboundAttachments,
  historyTruncated, historyTruncationReason, onLoadFullMessage, onOpenPreview,
  groupPosition = 'standalone',
}: MessageBubbleProps) {
  const { t, i18n } = useTranslation();
  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const responseSessionKey = sessionKey ?? activeSessionKey;
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loadingFullMessage, setLoadingFullMessage] = useState(false);
  const [fullMessageError, setFullMessageError] = useState('');

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

  const timeLabel = msgDate
    ? `${String(msgDate.getHours()).padStart(2, '0')}:${String(msgDate.getMinutes()).padStart(2, '0')}`
    : '';

  const isEmptyAssistantStreaming = !isUser && block.isStreaming && !content.trim() && block.images.length === 0 && block.artifacts.length === 0 && !block.audio;
  const messagePreview = createChatMessagePreview(block);
  const canOpenPreview = Boolean(messagePreview && onOpenPreview);
  const messageActions = !block.isStreaming && !isEditing && !isEmptyAssistantStreaming ? (
    <MessageBubbleActions
      copied={copied}
      previewable={canOpenPreview}
      onCopy={() => { void handleCopy(); }}
      onPreview={() => {
        if (messagePreview) onOpenPreview?.(messagePreview);
      }}
    />
  ) : null;
  const hasBubbleActions = !isUser && Boolean(messageActions);
  const footerActions = isUser ? messageActions : null;
  const showAvatar = groupPosition === 'standalone' || groupPosition === 'first';
  const showFooter = groupPosition === 'standalone' || groupPosition === 'last';
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
      {showAvatar ? (
        isUser ? (
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5
            bg-aegis-primary/15 border border-aegis-primary/25">
            <User size={14} className="text-aegis-primary" />
          </div>
        ) : (
          <AssistantResponseAvatar sessionKey={responseSessionKey} />
        )
      ) : (
        <div className="w-8 shrink-0" aria-hidden />
      )}

      {/* ── Content Column ── */}
      <div className="flex flex-col min-w-0"
        style={{ width: '100%', maxWidth: 'min(640px, 72%)', alignItems: isUser ? 'flex-end' : 'flex-start' }}>

        {/* Bubble */}
        <motion.div
          key={`${block.id}-bubble`}
          className={clsx(
          'relative block rounded-xl py-2.5 transition-colors duration-150',
          'pl-4 max-w-full box-border min-w-0 break-words group/bubble',
          'pr-4',
          isEmptyAssistantStreaming
            ? 'bg-transparent shadow-none p-0 pl-0 pr-0 py-0'
            : isUser
              ? 'bg-aegis-primary/[0.10] border border-aegis-primary/20 shadow-sm'
              : 'bg-[rgb(var(--aegis-primary)/0.035)] hover:bg-[rgb(var(--aegis-primary)/0.055)] border border-aegis-primary/10 shadow-[inset_1px_0_0_rgb(var(--aegis-primary)/0.12)]',
          block.isStreaming && !isEmptyAssistantStreaming && 'ring-1 ring-aegis-primary/30',
          )}
          style={{ width: 'auto' }}
        >

          {hasBubbleActions && (
            <div
              className="absolute end-2 top-2 z-10 rounded-md bg-[rgb(var(--aegis-bg)/0.72)] p-0.5"
              data-message-bubble-actions
            >
              {messageActions}
            </div>
          )}

          {/* Audio Player */}
          {block.audio && !block.isStreaming && (
            <div className="mb-2">
              <Suspense fallback={<ChatMediaFallback className="h-10 w-full" />}>
                <AudioPlayer
                  src={block.audio}
                  sessionKey={responseSessionKey}
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
                    <ChatMediaFallback
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
          {isUser && isEditing && onEdit ? (
            <InlineUserMessageEditor
              initialValue={content}
              onCancel={() => setIsEditing(false)}
              onSave={async (nextContent) => {
                await onEdit(nextContent);
                setIsEditing(false);
              }}
            />
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
              {/* Thinking prelude — only when empty, otherwise blink caret is enough */}
              {isEmptyAssistantStreaming && (
              <div
                className={clsx(
                  'inline-flex items-center gap-1.5 select-none',
                  'px-3 py-2 rounded-xl border border-aegis-primary/25 bg-[color-mix(in_srgb,rgb(var(--aegis-primary))_14%,rgb(var(--aegis-elevated)))] shadow-[0_0_18px_rgb(var(--aegis-primary)/0.12)]',
                )}
                aria-label={t('chat.assistantPreparing')}
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
                    ? t('chat.stopped')
                    : t('errors.occurred')}
                >
                  <StatusIcon status={responseStatus} size={14} />
                </span>
              )}
              <div className="markdown-body min-w-0 flex-1">
                {content && (
                  <ChatMarkdownRenderer markdown={content} />
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
                  ? <LoadingIndicator size={13} />
                  : <FileText size={13} />}
                {t('chat.loadFullMessage')}
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

        {!showFooter && footerActions && (
          <div className="mt-1 flex w-full justify-end">
            {footerActions}
          </div>
        )}

        {showFooter && (isUser ? (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 select-none">
            <span className="inline-flex items-center gap-1.5">
              <time className="text-[10px] text-aegis-text-muted tabular-nums" dateTime={block.timestamp || ''}>
                {timeLabel}
              </time>
              {deliveryStatus === 'pending' && (
                <span className="text-[10px] text-aegis-text-dim">{t('chat.sending')}</span>
              )}
              {deliveryStatus === 'queued' && (
                <span className="text-[10px] text-aegis-warning">{t('chat.queued')}</span>
              )}
              {deliveryStatus === 'failed' && (
                <span className="text-[10px] text-aegis-danger" title={deliveryError}>
                  {t('chat.sendFailed')}
                </span>
              )}
            </span>
            <div className="inline-flex items-center gap-0.5">
            <span className="text-aegis-border text-[10px] select-none">·</span>
            {footerActions}
            {onEdit && !isEditing && (
              <ActionBtn
                icon={<Pencil size={14} />}
                label={t('chat.editMessage')}
                onClick={() => setIsEditing(true)}
              />
            )}
            {onRetry && (
              <ActionBtn icon={<RotateCcw size={14} />} label={t('chat.retryDelivery')}
                onClick={onRetry} />
            )}
            {collaborationAction && (
              <ActionBtn
                icon={collaborationAction.state === 'confirming'
                  ? <LoadingIndicator size={14} />
                  : <GitFork size={14} />}
                label={collaborationAction.state === 'active'
                  ? t('collaboration.chat.viewRun')
                  : collaborationAction.state === 'ready'
                    ? t('collaboration.chat.startRun')
                    : t('collaboration.chat.confirmingMessage')}
                onClick={() => collaborationAction.onClick?.()}
                disabled={collaborationAction.state === 'confirming' || !collaborationAction.onClick}
              />
            )}
            {onDelete && !isEditing && (
              <ActionBtn
                icon={<Trash2 size={14} />}
                label={t('chat.deleteMessage')}
                onClick={onDelete}
                danger
              />
            )}
            </div>
          </div>
        ) : (
          <div className="mt-1 flex w-full items-start justify-between gap-2">
            <AssistantResponseFooter
              sessionKey={responseSessionKey}
              block={block}
              timestamp={block.timestamp}
              status={block.responseState}
            />
          </div>
        ))}

      </div>
    </div>
  );
});
