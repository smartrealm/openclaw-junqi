import { lazy, Suspense, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import {
  selectActiveSessionThinking,
  selectActiveSessionTyping,
  useChatStore,
  type ChatMessage,
} from '@/stores/chatStore';
import { useBootSequenceStore } from '@/stores/bootSequenceStore';
import { gateway } from '@/services/gateway';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import { showConfirm } from '@/components/shared/AlertDialog';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { chatSendCoordinator } from '@/services/chat/sendTransaction';
import { resolveHistoryPageMetadata } from '@/services/chat/historyPagination';
import { sessionTranscriptFence } from '@/services/chat/sessionTranscriptFence';
import { dedupeHistoryMessages, reconcileHistoryMessageIds } from '@/processing/historyReconcile';
import {
  normalizeCachedChatMessageContent,
  normalizeHistoryMessage,
  normalizeHistoryMessages,
} from '@/processing/normalizeHistoryMessage';
import {
  projectResponseGroupChrome,
  projectResponseGroupMessagePositions,
  type ResponseGroupMessagePosition,
} from '@/processing/buildResponseGroups';
import { projectResponseGroupToRenderBlocks } from '@/processing/projectResponseGroup';
import type {
  DecisionBlock,
  MessageBlock,
  RenderBlock,
  SessionEventBlock,
  ThinkingBlock,
  ToolBlock,
  WorkshopEventBlock,
} from '@/types/RenderBlock';
import type { ResponseGroup } from '@/types/ResponseGroup';
import { ExecutionProcessGroup } from './ExecutionProcessGroup';
import { groupExecutionProcessBlocks } from './executionProcessGrouping';
import clsx from 'clsx';
import { debugError, debugLog, debugWarn } from '@/utils/debugLog';
import { defaultGatewayWsUrl } from '@/config/runtimeDefaults';
import { isSessionDeleted } from '@/utils/sessionLifecycle';
import { resetSessionEverywhere } from '@/utils/sessionReset';
import {
  buildCollaborationChatTimeline,
  type ChatTimelineItem,
} from '@/processing/collaborationTimeline';
import {
  CollaborationChatProvider,
  CollaborationRunAnchor,
  CollaborationSessionDock,
  CollaborationUnanchoredBanner,
  useCollaborationChat,
} from './CollaborationChatProvider';

const HISTORY_LIMIT = 500;
const HISTORY_REQUEST_TIMEOUT_MS = 12_000;
const HISTORY_BACKGROUND_RETRY_BASE_MS = 30_000;
const HISTORY_BACKGROUND_RETRY_MAX_MS = 120_000;
const HISTORY_STARTUP_RETRY_BASE_MS = 3_000;
const HISTORY_STARTUP_RETRY_MAX_MS = 12_000;
const DEFAULT_GATEWAY_WS_URL = defaultGatewayWsUrl();

const InlineButtonBar = lazy(() => import('./InlineButtonBar').then((m) => ({ default: m.InlineButtonBar })));
const DecisionCard = lazy(() => import('./ResultCards').then((m) => ({ default: m.DecisionCard })));
const FileResultCard = lazy(() => import('./ResultCards').then((m) => ({ default: m.FileResultCard })));
const AssistantResponseAvatar = lazy(() => import('./MessageBubble').then((m) => ({ default: m.AssistantResponseAvatar })));
const AssistantResponseFooter = lazy(() => import('./MessageBubble').then((m) => ({ default: m.AssistantResponseFooter })));
const MessageBubble = lazy(() => import('./MessageBubble').then((m) => ({ default: m.MessageBubble })));
const MessageInput = lazy(() => import('./MessageInput').then((m) => ({ default: m.MessageInput })));
const SessionEventCard = lazy(() => import('./ResultCards').then((m) => ({ default: m.SessionEventCard })));
const ThinkingBubble = lazy(() => import('./ThinkingBubble').then((m) => ({ default: m.ThinkingBubble })));
const ToolCallBubble = lazy(() => import('./ToolCallBubble').then((m) => ({ default: m.ToolCallBubble })));
const TypingIndicator = lazy(() => import('./TypingIndicator').then((m) => ({ default: m.TypingIndicator })));
const QuickReplyBar = lazy(() => import('./QuickReplyBar').then((m) => ({ default: m.QuickReplyBar })));
const WorkshopEventCard = lazy(() => import('./ResultCards').then((m) => ({ default: m.WorkshopEventCard })));

function MessageBubbleFallback({
  block,
  groupPosition = 'standalone',
}: {
  block: MessageBlock;
  groupPosition?: ResponseGroupMessagePosition;
}) {
  const isUser = block.role === 'user';
  const usesGroupChrome = !isUser && groupPosition === 'middle';
  return (
    <div className={clsx(
      'flex py-2.5',
      usesGroupChrome ? 'pl-[46px] pr-4' : 'px-5',
      isUser ? 'justify-end' : 'justify-start',
    )}>
      <div
        className={clsx(
          'max-w-[82%] rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words',
          isUser
            ? 'bg-aegis-primary/15 text-aegis-text border border-aegis-primary/20'
            : 'bg-[rgb(var(--aegis-overlay)/0.04)] text-aegis-text-muted border border-[rgb(var(--aegis-overlay)/0.08)]',
        )}
      >
        {block.markdown || '...'}
      </div>
    </div>
  );
}

function ToolCallFallback({ block }: { block: ToolBlock }) {
  return (
    <div className="ml-[46px] mr-4 py-[2px]">
      <div className="inline-flex max-w-[min(640px,72%)] items-center gap-2 rounded-lg px-0 py-1 text-[11px] text-aegis-text-dim">
        <span className={clsx('h-1.5 w-1.5 rounded-full', block.status === 'error' ? 'bg-aegis-danger' : 'bg-aegis-success/60')} />
        <span className="font-medium">{block.toolName}</span>
      </div>
    </div>
  );
}

function ThinkingFallback({ block }: { block: ThinkingBlock | { content: string } }) {
  const lineCount = block.content ? block.content.split('\n').length : 0;
  return (
    <div className="pl-[46px] py-[2px] min-w-0">
      <div className="inline-flex items-center gap-2 px-2.5 py-1.5 min-h-[28px] rounded-full border border-aegis-primary/15 bg-aegis-primary/[0.04]">
        <span className="w-1.5 h-1.5 rounded-full bg-aegis-primary/55" />
        <span className="text-[11px] font-medium text-aegis-primary/85">Thinking</span>
        {lineCount > 0 && <span className="text-[9px] text-aegis-text-dim/55 font-mono">{lineCount}L</span>}
      </div>
    </div>
  );
}

function ResultCardFallback({ block }: { block: DecisionBlock | SessionEventBlock | WorkshopEventBlock | { type: 'file-output'; files: unknown[] } }) {
  const label =
    block.type === 'decision'
      ? 'Decision'
      : block.type === 'session-event'
        ? block.event.text
        : block.type === 'workshop-event'
          ? 'Workshop update'
          : `${block.files.length} file${block.files.length === 1 ? '' : 's'}`;
  return (
    <div className="pl-[42px] py-[2px]">
      <div className="inline-flex rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2 text-[12px] text-aegis-text-muted">
        {label}
      </div>
    </div>
  );
}

interface HistoryMeta {
  loaded: boolean;
  loadedCount: number;
  hasMore: boolean;
  nextOffset?: number;
  source: 'gateway' | 'cache';
}

// ═══════════════════════════════════════════════════════════
// Compact Divider — shimmer animated line
// ═══════════════════════════════════════════════════════════

function CompactDivider({ timestamp, label }: { timestamp?: string; label: string }) {
  const time = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className="flex items-center gap-0 py-5 px-4 group">
      {/* Left line with shimmer */}
      <div className="flex-1 h-px relative overflow-visible">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
        <div
          className="absolute top-[-1px] h-[3px] w-[60%] bg-gradient-to-r from-transparent via-amber-400/50 to-transparent rounded-full"
          style={{ animation: 'compact-shimmer 4s ease-in-out infinite' }}
        />
      </div>
      {/* Badge */}
      <div className="flex items-center gap-1.5 px-3.5 py-1 bg-amber-500/[0.06] border border-amber-500/[0.12] rounded-full shrink-0 mx-1 transition-colors group-hover:bg-amber-500/[0.1] group-hover:border-amber-500/[0.2]">
        <Zap size={10} className="text-amber-500/50" />
        <span className="text-[9px] font-bold uppercase tracking-[1.5px] text-amber-500/50 group-hover:text-amber-500/70 transition-colors">
          {label}
        </span>
        {time && <span className="text-[9px] text-amber-500/25 font-mono">· {time}</span>}
      </div>
      {/* Right line with shimmer */}
      <div className="flex-1 h-px relative overflow-visible">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
        <div
          className="absolute top-[-1px] h-[3px] w-[60%] bg-gradient-to-r from-transparent via-amber-400/50 to-transparent rounded-full"
          style={{ animation: 'compact-shimmer 4s ease-in-out infinite 2s', right: 0 }}
        />
      </div>
      <style>{`
        @keyframes compact-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(260%); }
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Chat View — Virtualized chat area
// ═══════════════════════════════════════════════════════════

export function ChatView() {
  return (
    <CollaborationChatProvider>
      <ChatViewContent />
    </CollaborationChatProvider>
  );
}

function ChatViewContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const collaboration = useCollaborationChat();

  // ── Store selectors (split to minimize re-renders) ──
  const renderBlocks = useChatStore((s) => s.renderBlocks);
  const responseGroups = useChatStore((s) => s.responseGroups);
  const messages = useChatStore((s) => s.messages);
  const isTyping = useChatStore(selectActiveSessionTyping);
  const { text: thinkingText, runId: thinkingRunId } = useChatStore(selectActiveSessionThinking);
  const quickReplies = useChatStore((s) => s.quickReplies);

  const { connected, connecting, connectionError } = useChatStore(
    useShallow((s) => ({ connected: s.connected, connecting: s.connecting, connectionError: s.connectionError }))
  );

  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const isLoadingHistory = useChatStore(
    (s) => Boolean(s.loadingHistoryBySession[activeSessionKey]),
  );
  const activeSessionId = useChatStore(
    (s) => s.sessions.find((session) => session.key === activeSessionKey)?.sessionId,
  );
  const activeAgentId = useChatStore(
    (s) => s.sessions.find((session) => session.key === activeSessionKey)?.agentId,
  );
  const messageQueue = useChatStore((s) => s.messageQueue);
  const queueCount = (messageQueue[activeSessionKey] || []).length;
  const availableModels = useChatStore((s) => s.availableModels);
  const modelsLoading = useChatStore((s) => s.modelsLoading);
  const providerHealth = (() => {
    try { return JSON.parse(localStorage.getItem('aegis-provider-health') || '{}'); } catch { return {}; }
  })();
  const hasConfiguredProvidersOnDisk = Number(providerHealth?.profiles || 0) > 0 || Number(providerHealth?.providers || 0) > 0 || Number(providerHealth?.modelDefs || 0) > 0;
  const hasProviders = availableModels.length > 0;

  // Actions (stable references)
  const setMessages = useChatStore((s) => s.setMessages);
  const setIsLoadingHistory = useChatStore((s) => s.setIsLoadingHistory);
  const cacheMessagesForSession = useChatStore((s) => s.cacheMessagesForSession);
  const getCachedMessages = useChatStore((s) => s.getCachedMessages);
  const setHistoryLoader = useChatStore((s) => s.setHistoryLoader);
  const setQuickReplies = useChatStore((s) => s.setQuickReplies);
  const setSessionIdentity = useChatStore((s) => s.setSessionIdentity);

  const { timelineItems, anchoredRunIds } = useMemo(
    () => buildCollaborationChatTimeline(responseGroups, messages, collaboration.runs),
    [collaboration.runs, messages, responseGroups],
  );

  // ── Virtuoso ref & scroll state ──
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scrollLockedRef = useRef(false);
  const prevResponseGroupsLenRef = useRef(0);

  // Reset scroll lock when switching sessions — new session should start at bottom
  useEffect(() => { scrollLockedRef.current = false; setAtBottom(true); }, [activeSessionKey]);

  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
  const [hasSeenConnectionAttempt, setHasSeenConnectionAttempt] = useState(false);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  const inFlightHistoryBySession = useRef<Record<string, Promise<void> | undefined>>({});
  const queuedForcedHistoryBySession = useRef<Record<string, { force: true; background?: boolean } | undefined>>({});
  const historyRetryTimerBySession = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
  const latestHistoryRequestBySession = useRef<Record<string, number>>({});
  const historyRequestSeq = useRef(0);
  const historyTimeoutCountBySession = useRef<Record<string, number>>({});
  const historyStartupRetryCountBySession = useRef<Record<string, number>>({});
  const [historyMetaBySession, setHistoryMetaBySession] = useState<Record<string, HistoryMeta>>({});
  const [historyErrorBySession, setHistoryErrorBySession] = useState<Record<string, string | undefined>>({});
  const bottomSeenSignatureRef = useRef('');
  const lastAutoRevealedUserMessageIdRef = useRef('');

  useEffect(() => { prevResponseGroupsLenRef.current = responseGroups.length; });

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      behavior: 'smooth',
      align: 'end',
    });
  }, [atBottom]);

  const revealConversationTail = useCallback((opts?: { instant?: boolean }) => {
    if (scrollLockedRef.current || !atBottom) return;
    const bh = (opts?.instant ? 'auto' : 'smooth') as 'auto' | 'smooth';
    const fn = () => {
      virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: bh, align: 'end' });
      virtuosoRef.current?.scrollBy?.({ top: Number.MAX_SAFE_INTEGER, behavior: bh });
    };
    fn();
    requestAnimationFrame(fn);
    setTimeout(fn, 150);
  }, []);

  const tailMessage = messages[messages.length - 1];
  const tailRenderBlock = renderBlocks[renderBlocks.length - 1];
  const bottomContentSignature = [
    activeSessionKey,
    responseGroups.length,
    timelineItems.length,
    renderBlocks.length,
    tailMessage?.id || '',
    tailMessage?.content?.length || 0,
    tailMessage?.toolOutput?.length || 0,
    tailMessage?.isStreaming ? 'streaming' : 'stable',
    tailRenderBlock?.id || '',
    tailRenderBlock?.type || '',
    tailRenderBlock?.type === 'tool' ? (tailRenderBlock.output?.length || 0) : 0,
    tailRenderBlock?.type === 'thinking' ? tailRenderBlock.content.length : 0,
    thinkingRunId || '',
    thinkingText.length,
    isTyping ? 'typing' : 'idle',
  ].join('|');

  useEffect(() => {
    if (atBottom) {
      bottomSeenSignatureRef.current = bottomContentSignature;
      setHasUnreadBelow(false);
      return;
    }

    if (!bottomSeenSignatureRef.current) {
      bottomSeenSignatureRef.current = bottomContentSignature;
      return;
    }

    if (bottomContentSignature !== bottomSeenSignatureRef.current) {
      setHasUnreadBelow(true);
    }
  }, [atBottom, bottomContentSignature]);

  // ── Auto-scroll to bottom when opening a session ──
  useEffect(() => {
    if (renderBlocks.length === 0) return;
    scrollLockedRef.current = false;
    const raf = requestAnimationFrame(() => revealConversationTail());
    return () => cancelAnimationFrame(raf);
  }, [activeSessionKey, renderBlocks.length]);


  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!isTyping || !lastMessage || lastMessage.role !== 'user') return;
    if (lastMessage.id === lastAutoRevealedUserMessageIdRef.current) return;

    lastAutoRevealedUserMessageIdRef.current = lastMessage.id;
    revealConversationTail({ instant: true });
  }, [messages, isTyping, revealConversationTail]);

  useEffect(() => {
    if (!isTyping || !atBottom || scrollLockedRef.current) return;
    revealConversationTail({ instant: true });
  }, [isTyping, atBottom, bottomContentSignature, revealConversationTail]);

  useEffect(() => {
    if (connecting) setHasSeenConnectionAttempt(true);
    if (connected) {
      setHasSeenConnectionAttempt(true);
      setHasConnectedOnce(true);
    }
  }, [connecting, connected]);

  // ── History loading (dedupe, timeout, retries — aligned with control-ui) ──
  const loadHistory = useCallback(
    async (targetSessionKey?: string, options?: { force?: boolean; background?: boolean }) => {
      const sessionKey = targetSessionKey || activeSessionKey;
      if (isSessionDeleted(sessionKey)) return;

      if (inFlightHistoryBySession.current[sessionKey]) {
        if (options?.force) {
          const pending = queuedForcedHistoryBySession.current[sessionKey];
          queuedForcedHistoryBySession.current[sessionKey] = {
            force: true,
            // A foreground request wins over any already queued background refresh.
            background: pending?.background === false || options.background !== true ? false : true,
          };
        }
        let inFlightError: unknown;
        try {
          await inFlightHistoryBySession.current[sessionKey];
        } catch (error) {
          inFlightError = error;
        }
        const queued = queuedForcedHistoryBySession.current[sessionKey];
        if (queued) {
          delete queuedForcedHistoryBySession.current[sessionKey];
          await loadHistory(sessionKey, queued);
          return;
        }
        if (inFlightError) throw inFlightError;
        return;
      }

      const pendingRetry = historyRetryTimerBySession.current[sessionKey];
      if (pendingRetry) {
        clearTimeout(pendingRetry);
        delete historyRetryTimerBySession.current[sessionKey];
      }

      const cached = getCachedMessages(sessionKey);
      if (!options?.force && cached && cached.length > 0) {
        const normalizedCached = cached.map(normalizeCachedChatMessageContent);
        setMessages(normalizedCached, sessionKey);
        setHistoryMetaBySession((prev) => ({
          ...prev,
          [sessionKey]: prev[sessionKey] ?? {
            loaded: true,
            loadedCount: normalizedCached.length,
            hasMore: false,
            source: 'cache',
          },
        }));
        const boot = useBootSequenceStore.getState();
        const shouldTrackConversationStage =
          boot.stages.conversation.status === 'pending' || boot.stages.conversation.status === 'running';
        if (shouldTrackConversationStage && !options?.background) {
          boot.markStageCompleted('conversation', `Recent conversation loaded from cache (${normalizedCached.length} messages)`);
        }
        queueMicrotask(() => {
          if (isSessionDeleted(sessionKey)) return;
          void loadHistory(sessionKey, { force: true, background: true });
        });
        return;
      }

      const task = (async () => {
        const requestId = ++historyRequestSeq.current;
        const transcriptToken = sessionTranscriptFence.capture(
          sessionKey,
          useChatStore.getState().sessions.find((session) => session.key === sessionKey)?.sessionId,
        );
        const boot = useBootSequenceStore.getState();
        const shouldTrackConversationStage =
          boot.stages.conversation.status === 'pending' || boot.stages.conversation.status === 'running';
        if (shouldTrackConversationStage) {
          boot.markStageRunning(
            'conversation',
            options?.background ? 'Syncing recent conversation in background' : 'Loading recent conversation',
          );
        }

        latestHistoryRequestBySession.current[sessionKey] = requestId;
        const requestStartedAt = performance.now();
        if (!options?.background) setIsLoadingHistory(true, sessionKey);
        try {
          const runObservation = gateway.captureChatSessionRunObservation(sessionKey);
          const result = await gateway.getHistory(
            sessionKey,
            HISTORY_LIMIT,
            HISTORY_REQUEST_TIMEOUT_MS,
            { offset: 0 },
          );
          const requestMs = Math.round(performance.now() - requestStartedAt);
          const historySessionId = typeof result?.sessionId === 'string' ? result.sessionId : undefined;
          if (
            latestHistoryRequestBySession.current[sessionKey] !== requestId
            || isSessionDeleted(sessionKey)
            || !sessionTranscriptFence.isCurrent(transcriptToken, historySessionId)
          ) return;

          const normalizeStartedAt = performance.now();
          const rawMessages = Array.isArray(result?.messages) ? result.messages : [];
          const historyAgentId = typeof result?.sessionInfo?.agentId === 'string'
            ? result.sessionInfo.agentId
            : undefined;
          if (historySessionId) setSessionIdentity(sessionKey, historySessionId, historyAgentId);
          const { hasMore, nextOffset } = resolveHistoryPageMetadata(result, 0);
          const mappedMessages = normalizeHistoryMessages(rawMessages);
          const canonicalMessages = dedupeHistoryMessages(mappedMessages);

          const previousMessages = getCachedMessages(sessionKey) ?? [];
          const messages = reconcileHistoryMessageIds(previousMessages, canonicalMessages);
          const normalizeMs = Math.round(performance.now() - normalizeStartedAt);

          const shouldProgressivelyHydrate =
            !options?.force && !options?.background && messages.length > 20;
          if (shouldProgressivelyHydrate) {
            setMessages(messages.slice(-20), sessionKey);
            requestAnimationFrame(() => {
              if (
                latestHistoryRequestBySession.current[sessionKey] !== requestId
                || isSessionDeleted(sessionKey)
                || !sessionTranscriptFence.isCurrent(transcriptToken, historySessionId)
              ) return;
              const latestMessages = useChatStore.getState().messagesPerSession[sessionKey] ?? [];
              // Reconcile the immutable Gateway snapshot against the newest
              // local tail. Reusing the first-pass result here would reinsert a
              // one-frame-old streaming snapshot beside its newer copy.
              const hydratedMessages = reconcileHistoryMessageIds(latestMessages, canonicalMessages);
              setMessages(hydratedMessages, sessionKey);
              cacheMessagesForSession(sessionKey, hydratedMessages);
              setHistoryMetaBySession((prev) => ({
                ...prev,
                [sessionKey]: {
                  loaded: true,
                  loadedCount: hydratedMessages.length,
                  hasMore,
                  nextOffset,
                  source: 'gateway',
                },
              }));
            });
          } else {
            setMessages(messages, sessionKey);
            cacheMessagesForSession(sessionKey, messages);
            setHistoryMetaBySession((prev) => ({
              ...prev,
              [sessionKey]: {
                loaded: true,
                loadedCount: messages.length,
                hasMore,
                nextOffset,
                source: 'gateway',
              },
            }));
          }

          // OpenClaw includes the authoritative live run and buffered text in
          // chat.history so switching sessions or reconnecting does not lose
          // the in-progress response. Adopt it after durable rows are applied.
          gateway.reconcileChatHistoryRunState(sessionKey, result, runObservation);

          debugLog(
            'app',
            `[ChatView] History metrics session=${sessionKey} requestMs=${requestMs} normalizeMs=${normalizeMs} totalMessages=${messages.length}`,
          );
          if (shouldTrackConversationStage && !options?.background) {
            boot.markStageCompleted('conversation', `Recent conversation ready (${messages.length} messages)`);
          }
          const retryTimer = historyRetryTimerBySession.current[sessionKey];
          if (retryTimer) {
            clearTimeout(retryTimer);
            delete historyRetryTimerBySession.current[sessionKey];
          }
          historyTimeoutCountBySession.current[sessionKey] = 0;
          historyStartupRetryCountBySession.current[sessionKey] = 0;
          setHistoryErrorBySession((previous) => ({ ...previous, [sessionKey]: undefined }));
        } catch (err) {
          if (isSessionDeleted(sessionKey)) return;
          const errText = String(err);
          setHistoryErrorBySession((previous) => ({ ...previous, [sessionKey]: errText }));
          const isHistoryUnavailableDuringStartup =
            /chat\.history/i.test(errText) &&
            /(unavailable|not available|not ready|warming|startup)/i.test(errText);
          if (isHistoryUnavailableDuringStartup) {
            if (shouldTrackConversationStage) {
              boot.markStageCompleted(
                'conversation',
                'Recent conversation is syncing in the background — you can chat now.',
              );
            }
            debugLog('app', '[ChatView] History not ready yet during startup, scheduling quick retry');
            const startupRetryCount = (historyStartupRetryCountBySession.current[sessionKey] ?? 0) + 1;
            historyStartupRetryCountBySession.current[sessionKey] = startupRetryCount;
            const retryDelay = Math.min(
              HISTORY_STARTUP_RETRY_BASE_MS * Math.pow(2, startupRetryCount - 1),
              HISTORY_STARTUP_RETRY_MAX_MS,
            );
            if (!historyRetryTimerBySession.current[sessionKey]) {
              historyRetryTimerBySession.current[sessionKey] = setTimeout(() => {
                delete historyRetryTimerBySession.current[sessionKey];
                if (isSessionDeleted(sessionKey)) return;
                void loadHistory(sessionKey, { force: true, background: true });
              }, retryDelay);
            }
            if (!options?.background) {
              throw err instanceof Error ? err : new Error(errText);
            }
            return;
          }
          debugError('app', '[ChatView] History load failed:', err);
          if (errText.includes('Request timeout')) {
            if (shouldTrackConversationStage) {
              boot.markStageCompleted(
                'conversation',
                'Recent conversation is syncing in the background after a slow response.',
              );
            }
            const timeoutCount = (historyTimeoutCountBySession.current[sessionKey] ?? 0) + 1;
            historyTimeoutCountBySession.current[sessionKey] = timeoutCount;
            const retryDelay = Math.min(
              HISTORY_BACKGROUND_RETRY_BASE_MS * Math.pow(2, timeoutCount - 1),
              HISTORY_BACKGROUND_RETRY_MAX_MS,
            );
            if (!historyRetryTimerBySession.current[sessionKey]) {
              historyRetryTimerBySession.current[sessionKey] = setTimeout(() => {
                delete historyRetryTimerBySession.current[sessionKey];
                if (isSessionDeleted(sessionKey)) return;
                void loadHistory(sessionKey, { force: true, background: true });
              }, retryDelay);
            }
            if (!options?.background) {
              throw err instanceof Error ? err : new Error(errText);
            }
            return;
          }
          if (!options?.background) {
            throw err instanceof Error ? err : new Error(errText);
          }
        } finally {
          delete inFlightHistoryBySession.current[sessionKey];
          if (
            !options?.background
            && latestHistoryRequestBySession.current[sessionKey] === requestId
          ) {
            setIsLoadingHistory(false, sessionKey);
          }
        }
      })();

      inFlightHistoryBySession.current[sessionKey] = task;
      await task;
    },
    [activeSessionKey, setMessages, setIsLoadingHistory, getCachedMessages, cacheMessagesForSession, setSessionIdentity],
  );

  useEffect(
    () => () => {
      Object.values(historyRetryTimerBySession.current).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
      historyRetryTimerBySession.current = {};
    },
    [],
  );

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (isRefreshing || isLoadingHistory) return;
    setIsRefreshing(true);
    try {
      await loadHistory(undefined, { force: true });
    } catch (error) {
      debugError('app', '[ChatView] Manual history refresh failed:', error);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }, [isRefreshing, isLoadingHistory, loadHistory]);

  // ── Load older messages through the official chat.history offset contract ──
  const isLoadingOlderRef = useRef(false);
  const loadOlderMessages = useCallback(async () => {
    const sk = activeSessionKey;
    if (isSessionDeleted(sk)) return;
    if (isLoadingOlderRef.current) return;
    const meta = historyMetaBySession[sk];
    if (!meta || !meta.hasMore) return;
    isLoadingOlderRef.current = true;
    const transcriptToken = sessionTranscriptFence.capture(
      sk,
      useChatStore.getState().sessions.find((session) => session.key === sk)?.sessionId,
    );
    setHasUnreadBelow(false);
    try {
      const { prependOlderMessages } = await import('@/processing/mergeHistory');
      const requestedOffset = meta.nextOffset ?? 0;
      const page = await gateway.getHistory(
        sk,
        HISTORY_LIMIT,
        HISTORY_REQUEST_TIMEOUT_MS,
        { offset: requestedOffset },
      );
      const pageSessionId = typeof page?.sessionId === 'string' ? page.sessionId : undefined;
      if (isSessionDeleted(sk) || !sessionTranscriptFence.isCurrent(transcriptToken, pageSessionId)) return;
      const normalized = normalizeHistoryMessages(
        Array.isArray(page?.messages) ? page.messages : [],
      );
      const existing = useChatStore.getState().messagesPerSession[sk] || [];
      const { merged, addedCount } = prependOlderMessages(existing, normalized);
      const { hasMore, nextOffset } = resolveHistoryPageMetadata(page, requestedOffset);
      if (addedCount === 0) {
        setHistoryMetaBySession((prev) => ({
          ...prev,
          [sk]: { ...prev[sk], hasMore, nextOffset },
        }));
        return;
      }
      useChatStore.getState().setMessages(merged, sk);
      useChatStore.getState().cacheMessagesForSession(sk, merged);
      setHistoryMetaBySession((prev) => ({
        ...prev,
        [sk]: {
          loaded: true,
          loadedCount: merged.length,
          hasMore,
          nextOffset,
          source: 'gateway',
        },
      }));
    } catch (err) {
      debugWarn('app', '[ChatView] loadOlderMessages failed', err);
    } finally {
      isLoadingOlderRef.current = false;
    }
  }, [activeSessionKey, historyMetaBySession]);

  const startReachedFiredRef = useRef(false);
  const handleStartReached = useCallback(() => {
    if (startReachedFiredRef.current) return;
    const meta = historyMetaBySession[activeSessionKey];
    if (!meta?.hasMore) return;
    startReachedFiredRef.current = true;
    loadOlderMessages().finally(() => {
      startReachedFiredRef.current = false;
    });
  }, [activeSessionKey, historyMetaBySession, loadOlderMessages]);


  // Auto-load history when connected and the active session changes (tab switch).
  // loadHistory already checks the per-session cache first, so repeated calls are cheap.
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!connected) return;
    // Load on first connect, or whenever the active session changes.
    if (prevSessionRef.current !== activeSessionKey || messages.length === 0) {
      prevSessionRef.current = activeSessionKey;
      void loadHistory();
    }
  }, [connected, activeSessionKey, messages.length, loadHistory]);

  // Register loadHistory in store so MessageInput can trigger it before first send
  useEffect(() => {
    setHistoryLoader(loadHistory);
    return () => setHistoryLoader(null);
  }, [loadHistory, setHistoryLoader]);

  useEffect(() => {
    const handler = () => handleRefresh();
    window.addEventListener('aegis:refresh', handler);
    return () => window.removeEventListener('aegis:refresh', handler);
  }, [handleRefresh]);

  // Quick actions from Dashboard / CommandPalette → gateway chat
  const handleQuickAction = useCallback(async (e: Event) => {
    const detail = (e as CustomEvent<{ message: string; autoSend?: boolean }>).detail;
    if (!detail?.message) return;
    const key = activeSessionKey || 'agent:main:main';
    const clientMessageId = createClientMessageId();
    try {
      voiceRuntime.interruptGlobally(key);
      await chatSendCoordinator.send({
        sessionKey: key,
        message: detail.message,
        clientMessageId,
        sessionId: activeSessionId,
      });
    } catch (error) {
      debugError('app', '[Quick action] Send error:', error);
    }
  }, [activeSessionKey, activeSessionId]);
  useEffect(() => {
    window.addEventListener('aegis:quick-action', handleQuickAction as EventListener);
    return () => window.removeEventListener('aegis:quick-action', handleQuickAction as EventListener);
  }, [handleQuickAction]);

  const activeHistoryMeta = historyMetaBySession[activeSessionKey];

  // Scroll to bottom when history first loads (or session switches)
  useEffect(() => {
    if (!activeHistoryMeta?.loaded) return;
    if (scrollLockedRef.current) return;
    revealConversationTail({ instant: true });
  }, [activeSessionKey, activeHistoryMeta?.loaded, revealConversationTail]);

  const handleRecallMessage = useCallback((content: string) => {
    useChatStore.getState().setDraft(activeSessionKey, content);
    window.dispatchEvent(new Event('aegis:focus-composer'));
  }, [activeSessionKey]);

  const handleRetryMessage = useCallback(async (sourceMessage: ChatMessage) => {
    const payload = sourceMessage.retryPayload ?? { text: sourceMessage.content };
    const clientMessageId = sourceMessage.clientMessageId ?? sourceMessage.id;
    revealConversationTail({ instant: true });
    try {
      await chatSendCoordinator.send({
        sessionKey: activeSessionKey,
        message: payload.text,
        clientMessageId,
        sessionId: payload.sessionId ?? activeSessionId,
        attachments: payload.attachments,
        displayAttachments: payload.displayAttachments,
        optimisticMessage: false,
      });
    } catch (error) {
      debugError('app', '[Retry] Send error:', error);
    }
  }, [activeSessionKey, activeSessionId, revealConversationTail]);

  // ── Error Action Handler — called by MessageBubble when user clicks an error action button ──
  const handleErrorAction = useCallback(async (action: string) => {
    if (action === 'reset-session') {
      showConfirm(
        t('chat.resetSession', 'Reset session'),
        t('chat.resetSessionConfirm', 'Clear this session history? The session itself will remain.'),
        async () => {
          await resetSessionEverywhere(activeSessionKey);
        },
      );
    }
  }, [activeSessionKey, t]);

  const handleInlineButtonClick = useCallback(async (callbackData: string) => {
    const text = callbackData;
    voiceRuntime.interruptGlobally(activeSessionKey);
    const clientMessageId = createClientMessageId();
    try {
      await chatSendCoordinator.send({
        sessionKey: activeSessionKey,
        message: text,
        clientMessageId,
        sessionId: activeSessionId,
      });
    } catch (err) {
      debugError('app', '[InlineButtons] Send error:', err);
    }
  }, [activeSessionKey, activeSessionId]);

  const handleDecisionSelect = useCallback(async (value: string) => {
    const text = value;
    voiceRuntime.interruptGlobally(activeSessionKey);
    const clientMessageId = createClientMessageId();
    setQuickReplies([], activeSessionKey);
    try {
      await chatSendCoordinator.send({
        sessionKey: activeSessionKey,
        message: text,
        clientMessageId,
        sessionId: activeSessionId,
      });
    } catch (err) {
      debugError('app', '[DecisionCard] Send error:', err);
    }
  }, [activeSessionKey, activeSessionId, setQuickReplies]);

  const handleLoadFullMessage = useCallback(async (sourceMessage: ChatMessage) => {
    if (!sourceMessage.nativeMessageId) {
      throw new Error(t('chat.fullMessageUnavailable', '该消息没有可查询的 OpenClaw 消息 ID'));
    }
    const result = await gateway.getMessage(
      activeSessionKey,
      sourceMessage.nativeMessageId,
      activeAgentId,
    );
    if (result?.ok !== true || !result.message) {
      throw new Error(
        result?.unavailableReason
          ? `${t('chat.fullMessageUnavailable', '完整消息不可用')}: ${result.unavailableReason}`
          : t('chat.fullMessageUnavailable', '完整消息不可用'),
      );
    }
    const normalized = normalizeHistoryMessage(result.message);
    const { id: _normalizedId, ...replacement } = normalized;
    useChatStore.getState().updateMessage(activeSessionKey, sourceMessage.id, {
      ...replacement,
      clientMessageId: normalized.clientMessageId ?? sourceMessage.clientMessageId,
      nativeMessageId: normalized.nativeMessageId ?? sourceMessage.nativeMessageId,
      historyTruncated: false,
      historyTruncationReason: undefined,
    });
  }, [activeAgentId, activeSessionKey, t]);

  // ── Render a single block (used by Virtuoso) ──
  const renderBlock = useCallback((
    block: RenderBlock,
    groupPosition: ResponseGroupMessagePosition = 'standalone',
    responseSessionKey: string = activeSessionKey,
  ) => {
    switch (block.type) {
      case 'compaction':
        return <CompactDivider timestamp={block.timestamp} label={t('chat.contextCompactedLabel', 'Context Compacted')} />;

      case 'inline-buttons':
        return (
          <Suspense fallback={null}>
            <InlineButtonBar
              buttons={block.rows.map(r => r.buttons.map(b => ({ text: b.text, callback_data: b.callback_data })))}
              onCallback={handleInlineButtonClick}
            />
          </Suspense>
        );

      case 'tool':
        return (
          <Suspense fallback={<ToolCallFallback block={block} />}>
            <ToolCallBubble
              tool={{
                toolName: block.toolName,
                input: block.input,
                output: block.output,
                status: block.status,
                durationMs: block.durationMs,
              }}
            />
          </Suspense>
        );

      case 'thinking':
        return (
          <Suspense fallback={<ThinkingFallback block={block} />}>
            <ThinkingBubble content={block.content} />
          </Suspense>
        );

      case 'file-output':
        return (
          <Suspense fallback={<ResultCardFallback block={block} />}>
            <FileResultCard files={block.files} />
          </Suspense>
        );

      case 'decision':
        return (
          <Suspense fallback={<ResultCardFallback block={block} />}>
            <DecisionCard options={block.options} onSelect={handleDecisionSelect} />
          </Suspense>
        );

      case 'workshop-event':
        return (
          <Suspense fallback={<ResultCardFallback block={block} />}>
            <WorkshopEventCard events={block.events} />
          </Suspense>
        );

      case 'session-event':
        return (
          <Suspense fallback={<ResultCardFallback block={block} />}>
            <SessionEventCard event={block.event} />
          </Suspense>
        );

      case 'message':
        const sourceMessage = messages.find((message) => message.id === block.id);
        return (
          <Suspense fallback={<MessageBubbleFallback block={block} groupPosition={groupPosition} />}>
            <MessageBubble
              block={block}
              sessionKey={responseSessionKey}
              groupPosition={groupPosition}
              onRecall={block.role === 'user' ? handleRecallMessage : undefined}
              onRetry={block.role === 'user' && sourceMessage?.status === 'failed'
                ? () => handleRetryMessage(sourceMessage)
                : undefined}
              onErrorAction={block.role === 'assistant' ? handleErrorAction : undefined}
              deliveryStatus={sourceMessage?.status}
              deliveryError={sourceMessage?.deliveryError}
              outboundAttachments={sourceMessage?.outboundAttachments}
              historyTruncated={sourceMessage?.historyTruncated}
              historyTruncationReason={sourceMessage?.historyTruncationReason}
              onLoadFullMessage={sourceMessage?.historyTruncated
                ? () => handleLoadFullMessage(sourceMessage)
                : undefined}
              collaborationAction={block.role === 'user'
                ? collaboration.getMessageAction(sourceMessage)
                : undefined}
            />
          </Suspense>
        );

      default:
        return <div />;
    }
  }, [
    collaboration,
    handleRecallMessage,
    handleRetryMessage,
    handleInlineButtonClick,
    handleDecisionSelect,
    handleErrorAction,
    handleLoadFullMessage,
    activeSessionKey,
    messages,
  ]);

  const renderGroup = useCallback((index: number, group: ResponseGroup) => {
    const blocks = projectResponseGroupToRenderBlocks(group);
    const chrome = projectResponseGroupChrome(group);
    const messagePositions = projectResponseGroupMessagePositions(group);
    const groupedBlocks = groupExecutionProcessBlocks(blocks);
    const isStreaming = group.status === 'streaming' || blocks.some((block) => block.isStreaming);
    const representativeBlock = chrome.owner === 'group' && chrome.representativeMessageId
      ? blocks.find((block): block is MessageBlock => (
          block.type === 'message' && block.id === chrome.representativeMessageId
        )) ?? null
      : null;
    const footerTimestamp = representativeBlock?.timestamp
      ?? group.blocks[group.blocks.length - 1]?.timestamp
      ?? group.timestamp;
    return (
      <div
        className={clsx(
          'relative px-1',
          group.role === 'assistant' ? 'space-y-2.5 py-1.5' : 'space-y-2 py-0.5',
        )}
        data-group-id={group.id}
        data-group-index={index}
        data-response-chrome-owner={chrome.owner}
      >
        {chrome.owner === 'group' && (
          <Suspense fallback={<div className="absolute left-2 top-2 h-8 w-8 rounded-full bg-aegis-primary/15 animate-pulse" />}>
            <AssistantResponseAvatar
              sessionKey={group.sessionKey}
              className="absolute left-1 top-1 z-[1]"
            />
          </Suspense>
        )}
        {groupedBlocks.map((row, rowIndex) => {
          if (row.type === 'execution') {
            return (
              <ExecutionProcessGroup
                key={`execution-${row.blocks[0]?.id ?? rowIndex}`}
                blocks={row.blocks}
                streaming={isStreaming}
                renderBlock={(block) => renderBlock(block, 'middle', group.sessionKey)}
              />
            );
          }

          const groupPosition = chrome.owner === 'group'
            ? 'middle'
            : row.block.type === 'message'
            ? messagePositions.get(row.block.id) ?? 'standalone'
            : 'standalone';
          return (
            <div key={row.block.id}>
              {renderBlock(row.block, groupPosition, group.sessionKey)}
            </div>
          );
        })}
        {chrome.owner === 'group' && (
          <Suspense fallback={<div className="ml-[46px] h-4 w-32 rounded bg-[rgb(var(--aegis-overlay)/0.04)] animate-pulse" />}>
            <AssistantResponseFooter
              sessionKey={group.sessionKey}
              block={representativeBlock}
              timestamp={footerTimestamp}
              status={group.status}
              className="ml-[46px] mr-4 mt-1"
            />
          </Suspense>
        )}
      </div>
    );
  }, [renderBlock]);

  const renderTimelineItem = useCallback((index: number, item: ChatTimelineItem) => {
    if (item.type === 'collaboration') return <CollaborationRunAnchor runId={item.runId} />;
    return renderGroup(index, item.group);
  }, [renderGroup]);

  // ── Header: loading indicator / session start divider ──
  const Header = useCallback(() => {
    const meta = historyMetaBySession[activeSessionKey];
    if (!meta) return null;
    if (isLoadingOlderRef.current) {
      return (
        <div className="flex items-center justify-center py-2">
          <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-aegis-primary/40 to-transparent animate-pulse" />
        </div>
      );
    }
    if (!meta.hasMore && meta.loadedCount > 0) {
      return (
        <div className="flex items-center gap-2 px-5 py-3">
          <div className="flex-1 h-px bg-aegis-border" />
          <span className="text-[9px] text-aegis-text-dim shrink-0 uppercase tracking-wider">
            {t('chat.historyExhausted', 'Session start')}
          </span>
          <div className="flex-1 h-px bg-aegis-border" />
        </div>
      );
    }
    return null;
  }, [activeSessionKey, historyMetaBySession, t]);

  // ── Footer: thinking stream + typing indicator inside Virtuoso list ──
  const lastGroup = responseGroups[responseGroups.length - 1];
  const tailBlock = lastGroup?.blocks[lastGroup.blocks.length - 1];
  const tailIsStreamingMessage = tailBlock?.type === 'message-content' && tailBlock.isStreaming;
  const Footer = useCallback(() => (
    <div className="pb-1">
      {thinkingText && (
        <Suspense fallback={<ThinkingFallback block={{ content: thinkingText }} />}>
          <ThinkingBubble content={thinkingText} isStreaming />
        </Suspense>
      )}
      {isTyping && !tailIsStreamingMessage && (
        <Suspense fallback={null}>
          <TypingIndicator />
        </Suspense>
      )}
    </div>
  ), [thinkingText, isTyping, tailIsStreamingMessage]);

  // ── Debounce "no providers" state so gateway restart doesn't flash the banner
  const [showNoProviderBanner, setShowNoProviderBanner] = useState(false);
  const noProviderSignal = connected && !hasProviders && !modelsLoading && !hasConfiguredProvidersOnDisk;
  useEffect(() => {
    if (noProviderSignal) {
      const timer = setTimeout(() => setShowNoProviderBanner(true), 3000);
      return () => clearTimeout(timer);
    }
    setShowNoProviderBanner(false);
  }, [noProviderSignal]);

  const latestGroupHasDecision = responseGroups[responseGroups.length - 1]?.blocks.some((block) => block.type === 'decision') ?? false;
  const shouldShowConnectionBanner =
    !connected &&
    (
      connecting ||
      hasConnectedOnce ||
      (hasSeenConnectionAttempt && Boolean(connectionError))
    );

  return (
    <div className="flex flex-1 min-h-0 bg-aegis-bg">
      {/* ── Left: chat ── */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* Connection Banner */}
      {shouldShowConnectionBanner && (
        <div className={clsx(
          'shrink-0 px-4 py-2 text-center text-[12px] border-b',
          connecting ? 'bg-aegis-warning-surface text-aegis-warning border-aegis-warning/10' : 'bg-aegis-danger-surface text-aegis-danger border-aegis-danger/10'
        )}>
          {connecting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-1.5 h-1.5 bg-aegis-warning rounded-full animate-pulse-soft" />
              {t('connection.connectingBanner')}
            </span>
          ) : (
            <span>
              {t('connection.disconnectedBanner')}
              {connectionError && <span className="opacity-60"> — {connectionError}</span>}
              <button onClick={() => {
                window.aegis?.config.get().then((c: any) => {
                  gatewayManager.connect(
                    c.gatewayUrl || c.gatewayWsUrl || DEFAULT_GATEWAY_WS_URL,
                    c.gatewayBootstrapToken ?? c.gatewayToken ?? '',
                    c.gatewayDeviceToken ?? '',
                  );
                });
              }} className="mx-2 underline hover:no-underline">
                {t('connection.reconnect')}
              </button>
            </span>
          )}
        </div>
      )}

      {historyErrorBySession[activeSessionKey] && connected && (
        <div className="shrink-0 border-b border-aegis-warning/20 bg-aegis-warning/[0.06] px-4 py-2">
          <div className="flex items-center justify-between gap-3 text-[11px] text-aegis-warning">
            <span className="min-w-0 truncate" title={historyErrorBySession[activeSessionKey]}>
              {t('chat.historySyncFailed', 'Conversation history could not be synchronized.')}
            </span>
            <button
              type="button"
              onClick={() => { void handleRefresh(); }}
              disabled={isRefreshing || isLoadingHistory}
              className="shrink-0 rounded-md border border-aegis-warning/35 px-2 py-1 font-medium hover:bg-aegis-warning/10 disabled:opacity-50"
            >
              {t('common.retry', 'Retry')}
            </button>
          </div>
        </div>
      )}

      {showNoProviderBanner && (
        <div className="shrink-0 px-4 py-3 border-b border-aegis-warning/20 bg-aegis-warning/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[12px] text-aegis-warning">
              <Zap size={14} className="shrink-0" />
              <span>{t('dashboard.setupProviderBanner', 'No AI provider configured. Set up a provider to start chatting.')}</span>
            </div>
            <button
              onClick={() => navigate('/config')}
              className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-aegis-warning/40 text-aegis-warning hover:bg-aegis-warning/[0.1] transition-colors"
            >
              {t('dashboard.setupProviderAction', 'Go to Config →')}
            </button>
          </div>
        </div>
      )}

      <CollaborationUnanchoredBanner anchoredRunIds={anchoredRunIds} />
      <CollaborationSessionDock />



      {/* Messages Area — Virtualized */}
      <div
        className={clsx('flex-1 min-h-0 relative', queueCount > 0 && 'pb-[100px]')}
        onWheelCapture={(e) => {
          if (e.deltaY < -2) {
            scrollLockedRef.current = true;
            setAtBottom(false);
          }
        }}
        onTouchMoveCapture={() => {
          if (!atBottom) scrollLockedRef.current = true;
        }}
      >
        {timelineItems.length === 0 ? (
          <div className="flex-1 h-full" />
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={timelineItems}
            followOutput={() => {
              // Honor explicit user lock OR if atBottom is false. Without the
              // atBottom gate, virtuoso auto-anchors to the tail during stream
              // growth even when the user is reading history — the bug the user
              // reported ("上拉时自己向下").
              if (scrollLockedRef.current) return false;
              if (!atBottom) return false;
              return isTyping ? 'smooth' : 'auto';
            }}
            overscan={{ main: 600, reverse: 600 }}
            increaseViewportBy={{ top: 400, bottom: 400 }}
            defaultItemHeight={120}
            initialTopMostItemIndex={timelineItems.length - 1}
            atBottomStateChange={(b) => {
              setAtBottom(b);
              if (b) {
                // User scrolled back to bottom → re-enable auto-follow.
                scrollLockedRef.current = false;
                prevResponseGroupsLenRef.current = responseGroups.length;
                return;
              }
              // b === false: user left the bottom.
              // If the user already locked the scroll (explicit wheel up /
              // touch drag), respect that — don't let content growth override
              // the user's reading position. Pre-fix: the grew check below
              // would unlock the scroll when new tokens arrived, pushing the
              // user back to the bottom against their will.
              if (scrollLockedRef.current) {
                prevResponseGroupsLenRef.current = responseGroups.length;
                return;
              }
              // Auto-lock when the user scrolls up while content is NOT
              // growing (reading idle history — harmless to lock).
              const grew = responseGroups.length !== prevResponseGroupsLenRef.current;
              if (!grew) {
                scrollLockedRef.current = true;
              } else {
                prevResponseGroupsLenRef.current = responseGroups.length;
              }
            }}
            atBottomThreshold={100}
            itemContent={renderTimelineItem}
            startReached={handleStartReached}
            components={{ Footer }}
            className="h-full py-3 scrollbar-thin"
            style={{ overflowX: 'clip', scrollBehavior: 'smooth' }}
          />
        )}

        {/* Scroll to bottom */}
        {!atBottom && hasUnreadBelow && responseGroups.length > 3 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
            <button onClick={() => { scrollLockedRef.current = false; scrollToBottom(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass shadow-float text-[11px] text-aegis-text-muted hover:text-aegis-text transition-colors">
              <ArrowDown size={13} />
              <span>{t('chat.newMessages')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Quick Reply buttons */}
      {quickReplies.length > 0 && !isTyping && !latestGroupHasDecision && (
        <Suspense fallback={null}>
          <QuickReplyBar
            buttons={quickReplies}
            onSend={async (text) => {
              voiceRuntime.interruptGlobally(activeSessionKey);
              setQuickReplies([], activeSessionKey);
              const clientMessageId = createClientMessageId();
              try {
                await chatSendCoordinator.send({
                  sessionKey: activeSessionKey,
                  message: text,
                  clientMessageId,
                  sessionId: activeSessionId,
                });
              } catch (err) {
                debugError('app', '[QuickReplyBar] Send error:', err);
              }
            }}
            onDismiss={() => setQuickReplies([], activeSessionKey)}
          />
        </Suspense>
      )}

      <Suspense fallback={<div className="h-[76px] border-t border-aegis-border/20" />}>
        <MessageInput />
      </Suspense>
    </div>
  </div>
  );
}
