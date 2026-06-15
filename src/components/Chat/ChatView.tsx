import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDown, Search, X, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useChatStore, type ChatMessage } from '@/stores/chatStore';
import { useBootSequenceStore } from '@/stores/bootSequenceStore';
import { gateway } from '@/services/gateway';
import { dedupeHistoryMessages, reconcileHistoryMessageIds } from '@/processing/historyReconcile';
import { projectResponseGroupToRenderBlocks } from '@/processing/projectResponseGroup';
import { MessageBubble } from './MessageBubble';
import { ToolCallBubble } from './ToolCallBubble';
import { ThinkingBubble } from './ThinkingBubble';
import { DecisionCard, FileResultCard, SessionEventCard, WorkshopEventCard } from './ResultCards';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';
import { InlineButtonBar } from './InlineButtonBar';
import { QuickReplyBar } from './QuickReplyBar';
import type { RenderBlock } from '@/types/RenderBlock';
import type { ResponseGroup } from '@/types/ResponseGroup';
import clsx from 'clsx';

const HISTORY_LIMIT = 500;
const HISTORY_REQUEST_TIMEOUT_MS = 12_000;
const HISTORY_BACKGROUND_RETRY_BASE_MS = 30_000;
const HISTORY_BACKGROUND_RETRY_MAX_MS = 120_000;
const HISTORY_STARTUP_RETRY_BASE_MS = 3_000;
const HISTORY_STARTUP_RETRY_MAX_MS = 12_000;
const DEFAULT_GATEWAY_WS_URL = 'ws://127.0.0.1:18789';

interface HistoryMeta {
  loaded: boolean;
  loadedCount: number;
  hasMore: boolean;
  nextCursor?: string;
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
  const { t } = useTranslation();
  const navigate = useNavigate();

  // ── Store selectors (split to minimize re-renders) ──
  const renderBlocks = useChatStore((s) => s.renderBlocks);
  const responseGroups = useChatStore((s) => s.responseGroups);
  const messages = useChatStore((s) => s.messages);
  const isTyping = useChatStore((s) => s.isTyping);
  const thinkingText = useChatStore((s) => s.thinkingText);
  const thinkingRunId = useChatStore((s) => s.thinkingRunId);
  const quickReplies = useChatStore((s) => s.quickReplies);
  const isLoadingHistory = useChatStore((s) => s.isLoadingHistory);

  const { connected, connecting, connectionError } = useChatStore(
    useShallow((s) => ({ connected: s.connected, connecting: s.connecting, connectionError: s.connectionError }))
  );

  const activeSessionKey = useChatStore((s) => s.activeSessionKey);
  const messageQueue = useChatStore((s) => s.messageQueue);
  const queueCount = (messageQueue[activeSessionKey] || []).length;
  const availableModels = useChatStore((s) => s.availableModels);
  const modelsLoading = useChatStore((s) => s.modelsLoading);
  const hasProviders = availableModels.length > 0;

  // Actions (stable references)
  const setMessages = useChatStore((s) => s.setMessages);
  const setIsLoadingHistory = useChatStore((s) => s.setIsLoadingHistory);
  const cacheMessagesForSession = useChatStore((s) => s.cacheMessagesForSession);
  const getCachedMessages = useChatStore((s) => s.getCachedMessages);
  const addMessage = useChatStore((s) => s.addMessage);
  const setHistoryLoader = useChatStore((s) => s.setHistoryLoader);
  const setQuickReplies = useChatStore((s) => s.setQuickReplies);
  const clearSessionTokens = useChatStore((s) => s.clearSessionTokens);
  const clearSessionMessages = useChatStore((s) => s.clearSessionMessages);

  // ── Search state ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]); // indices in responseGroups
  const [searchIndex, setSearchIndex] = useState(0); // current highlight index

  // ── Virtuoso ref & scroll state ──
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scrollLockedRef = useRef(false);
  const prevResponseGroupsLenRef = useRef(0);

  // Reset scroll lock when switching sessions — new session should start at bottom
  useEffect(() => { scrollLockedRef.current = false; }, [activeSessionKey]);

  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
  const [hasSeenConnectionAttempt, setHasSeenConnectionAttempt] = useState(false);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  const inFlightHistoryBySession = useRef<Record<string, Promise<void> | undefined>>({});
  const historyRetryTimerBySession = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
  const latestHistoryRequestBySession = useRef<Record<string, number>>({});
  const historyRequestSeq = useRef(0);
  const historyTimeoutCountBySession = useRef<Record<string, number>>({});
  const historyStartupRetryCountBySession = useRef<Record<string, number>>({});
  const [historyMetaBySession, setHistoryMetaBySession] = useState<Record<string, HistoryMeta>>({});
  const bottomSeenSignatureRef = useRef('');
  const lastAutoRevealedUserMessageIdRef = useRef('');

  // ── Keyboard shortcut: Ctrl+F to open search ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
        setSearchResults([]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen]);

  useEffect(() => { prevResponseGroupsLenRef.current = responseGroups.length; });

  const searchableGroups = useMemo(() => responseGroups, [responseGroups]);

  // ── Search logic: compute matching group indices ──
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.toLowerCase();
    const results: number[] = [];
    searchableGroups.forEach((group, groupIndex) => {
      const matched = group.blocks.some((block) => {
        if (block.type === 'message-content') {
          return block.markdown.toLowerCase().includes(q);
        }
        if (block.type === 'tool-activity') {
          return block.toolName.toLowerCase().includes(q) || (block.output || '').toLowerCase().includes(q);
        }
        return false;
      });
      if (matched) results.push(groupIndex);
    });
    setSearchResults(results);
    setSearchIndex(0);
  }, [searchQuery, searchableGroups]);

  // ── Navigate to current search result ──
  useEffect(() => {
    if (searchResults.length > 0 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: searchResults[searchIndex], behavior: 'smooth', align: 'center' });
    }
  }, [searchIndex, searchResults]);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      behavior: 'smooth',
      align: 'end',
    });
  }, []);

  const revealConversationTail = useCallback((opts?: { instant?: boolean }) => {
    if (scrollLockedRef.current) return;
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
    if (!isTyping) return;
    revealConversationTail({ instant: true });
  }, [isTyping, bottomContentSignature, revealConversationTail]);

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

      if (inFlightHistoryBySession.current[sessionKey]) {
        await inFlightHistoryBySession.current[sessionKey];
        return;
      }

      const pendingRetry = historyRetryTimerBySession.current[sessionKey];
      if (pendingRetry) {
        clearTimeout(pendingRetry);
        delete historyRetryTimerBySession.current[sessionKey];
      }

      const cached = getCachedMessages(sessionKey);
      if (!options?.force && cached && cached.length > 0) {
        setMessages(cached, sessionKey);
        setHistoryMetaBySession((prev) => ({
          ...prev,
          [sessionKey]: prev[sessionKey] ?? {
            loaded: true,
            loadedCount: cached.length,
            hasMore: cached.length >= HISTORY_LIMIT,
            source: 'cache',
          },
        }));
        const boot = useBootSequenceStore.getState();
        const shouldTrackConversationStage =
          boot.stages.conversation.status === 'pending' || boot.stages.conversation.status === 'running';
        if (shouldTrackConversationStage && !options?.background) {
          boot.markStageCompleted('conversation', `Recent conversation loaded from cache (${cached.length} messages)`);
        }
        return;
      }

      const task = (async () => {
        const requestId = ++historyRequestSeq.current;
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
        if (!options?.background) setIsLoadingHistory(true);
        try {
          const result = await gateway.getHistory(sessionKey, HISTORY_LIMIT, HISTORY_REQUEST_TIMEOUT_MS);
          const requestMs = Math.round(performance.now() - requestStartedAt);
          if (latestHistoryRequestBySession.current[sessionKey] !== requestId) return;

          const normalizeStartedAt = performance.now();
          const rawMessages = Array.isArray(result?.messages) ? result.messages : [];
          const hasMore = rawMessages.length >= HISTORY_LIMIT;
          const nextCursor = rawMessages.length > 0 ? rawMessages[0]?.id || undefined : undefined;

          const mappedMessages = rawMessages.map((msg: any) => ({
            id: msg.id || msg.messageId || `hist-${crypto.randomUUID()}`,
            runId: msg.runId || msg.run_id || null,
            role: msg.role || 'unknown',
            content: msg.content,
            timestamp: msg.timestamp || msg.createdAt || new Date().toISOString(),
            responseState:
              msg.state === 'error' || msg.state === 'aborted' ? msg.state : ('final' as const),
            model: msg.model ?? null,
            mediaUrl: msg.mediaUrl || undefined,
            mediaType: msg.mediaType || undefined,
            attachments: msg.attachments,
            toolName: msg.toolName || msg.name,
            toolInput: msg.toolInput || msg.input,
            toolCallId: msg.toolCallId || msg.tool_call_id,
            thinkingContent: msg.thinkingContent,
            fileRefs: Array.isArray(msg.fileRefs) ? msg.fileRefs : undefined,
            decisionOptions: Array.isArray(msg.decisionOptions) ? msg.decisionOptions : undefined,
            workshopEvents: Array.isArray(msg.workshopEvents) ? msg.workshopEvents : undefined,
            sessionEvents: Array.isArray(msg.sessionEvents) ? msg.sessionEvents : undefined,
          })) as ChatMessage[];

          const previousMessages = getCachedMessages(sessionKey) ?? [];
          const messages = reconcileHistoryMessageIds(previousMessages, dedupeHistoryMessages(mappedMessages));
          const normalizeMs = Math.round(performance.now() - normalizeStartedAt);

          const shouldProgressivelyHydrate =
            !options?.force && !options?.background && messages.length > 20;
          if (shouldProgressivelyHydrate) {
            setMessages(messages.slice(-20), sessionKey);
            requestAnimationFrame(() => {
              if (latestHistoryRequestBySession.current[sessionKey] !== requestId) return;
              setMessages(messages, sessionKey);
              cacheMessagesForSession(sessionKey, messages);
              setHistoryMetaBySession((prev) => ({
                ...prev,
                [sessionKey]: {
                  loaded: true,
                  loadedCount: messages.length,
                  hasMore,
                  nextCursor,
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
                nextCursor,
                source: 'gateway',
              },
            }));
          }

          console.info(
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
        } catch (err) {
          const errText = String(err);
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
            console.info('[ChatView] History not ready yet during startup, scheduling quick retry');
            const startupRetryCount = (historyStartupRetryCountBySession.current[sessionKey] ?? 0) + 1;
            historyStartupRetryCountBySession.current[sessionKey] = startupRetryCount;
            const retryDelay = Math.min(
              HISTORY_STARTUP_RETRY_BASE_MS * Math.pow(2, startupRetryCount - 1),
              HISTORY_STARTUP_RETRY_MAX_MS,
            );
            if (!historyRetryTimerBySession.current[sessionKey]) {
              historyRetryTimerBySession.current[sessionKey] = setTimeout(() => {
                delete historyRetryTimerBySession.current[sessionKey];
                void loadHistory(sessionKey, { force: true, background: true });
              }, retryDelay);
            }
            return;
          }
          console.error('[ChatView] History load failed:', err);
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
                void loadHistory(sessionKey, { force: true, background: true });
              }, retryDelay);
            }
            return;
          }
        } finally {
          delete inFlightHistoryBySession.current[sessionKey];
          if (latestHistoryRequestBySession.current[sessionKey] === requestId) {
            setIsLoadingHistory(false);
          }
        }
      })();

      inFlightHistoryBySession.current[sessionKey] = task;
      await task;
    },
    [activeSessionKey, setMessages, setIsLoadingHistory, getCachedMessages, cacheMessagesForSession],
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
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }, [isRefreshing, isLoadingHistory, loadHistory]);

  // ── Load older messages via HTTP cursor pagination ──
  const isLoadingOlderRef = useRef(false);
  const loadOlderMessages = useCallback(async () => {
    const sk = activeSessionKey;
    if (isLoadingOlderRef.current) return;
    const meta = historyMetaBySession[sk];
    if (!meta || !meta.hasMore) return;
    isLoadingOlderRef.current = true;
    setHasUnreadBelow(false);
    try {
      const { baseUrl, token } = (await import('@/api/gatewayAuth')).getGatewayAuth() || {};
      if (!baseUrl || !token) return;
      const { fetchSessionHistoryPage } = await import('@/api/http/historyClient');
      const { normalizeHistoryMessages } = await import('@/processing/normalizeHistoryMessage');
      const { prependOlderMessages } = await import('@/processing/mergeHistory');
      const page = await fetchSessionHistoryPage({
        baseUrl, token, sessionKey: sk,
        limit: HISTORY_LIMIT,
        cursor: meta.nextCursor,
      });
      const normalized = normalizeHistoryMessages(page.messages as unknown[]);
      const existing = useChatStore.getState().messagesPerSession[sk] || [];
      const { merged, addedCount } = prependOlderMessages(existing, normalized);
      if (addedCount === 0) {
        setHistoryMetaBySession((prev) => ({
          ...prev,
          [sk]: { ...prev[sk], hasMore: page.hasMore, nextCursor: page.nextCursor },
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
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          source: 'gateway',
        },
      }));
    } catch (err) {
      console.warn('[ChatView] loadOlderMessages failed', err);
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

  const activeHistoryMeta = historyMetaBySession[activeSessionKey];

  // Scroll to bottom when history first loads (or session switches)
  useEffect(() => {
    if (!activeHistoryMeta?.loaded) return;
    if (scrollLockedRef.current) return;
    revealConversationTail({ instant: true });
  }, [activeSessionKey, activeHistoryMeta?.loaded, revealConversationTail]);

  const handleResend = useCallback(async (content: string, prevId?: string) => {
    const text = content;
    if (prevId) {
      useChatStore.getState().addMessage({ id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date().toISOString() }, activeSessionKey);
      // Strip old message and trailing aborted assistant
      const st = useChatStore.getState();
      const oldIdx = st._blocksCache[activeSessionKey]?.findIndex((b) => b.id === prevId) ?? -1;
      if (oldIdx >= 0) {
        const filtered = st._blocksCache[activeSessionKey]?.filter((_, i) => i < oldIdx) ?? [];
        useChatStore.setState((s) => ({ _blocksCache: { ...s._blocksCache, [activeSessionKey]: filtered } }));
      }
      useChatStore.getState().setIsTyping(true, activeSessionKey);
      try { await gateway.sendMessage(text, undefined, activeSessionKey); } catch {}
      return;
    }
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMsg, activeSessionKey);
    revealConversationTail({ instant: true });
    useChatStore.getState().setIsTyping(true, activeSessionKey);
    try {
      await gateway.sendMessage(text, undefined, activeSessionKey);
    } catch (err) {
      console.error('[Resend] Send error:', err);
    }
  }, [activeSessionKey, addMessage, revealConversationTail]);

  // Regenerate: re-send the last user message
  const handleRegenerate = useCallback(() => {
    const lastUserMsg = [...renderBlocks].reverse().find(
      (b) => b.type === 'message' && b.role === 'user'
    );
    if (lastUserMsg && lastUserMsg.type === 'message') {
      revealConversationTail({ instant: true });
      useChatStore.getState().setIsTyping(true, activeSessionKey);
      gateway.sendMessage(lastUserMsg.markdown, undefined, activeSessionKey);
    }
  }, [renderBlocks, activeSessionKey, revealConversationTail]);

  // ── Error Action Handler — called by MessageBubble when user clicks an error action button ──
  const handleErrorAction = useCallback(async (action: string) => {
    if (action === 'reset-session') {
      try {
        await gateway.resetSession(activeSessionKey);
      } catch { /* ignore — session may already be fresh */ }
      clearSessionMessages(activeSessionKey);
      clearSessionTokens(activeSessionKey);
      // Trigger App-level session refresh to sync token counts from gateway
      window.dispatchEvent(new CustomEvent('aegis:session-reset'));
    }
  }, [activeSessionKey, clearSessionMessages, clearSessionTokens]);

  const handleInlineButtonClick = useCallback(async (callbackData: string) => {
    const text = callbackData;
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMsg, activeSessionKey);
    const { setIsTyping } = useChatStore.getState();
    setIsTyping(true, activeSessionKey);
    try {
      await gateway.sendMessage(text, undefined, activeSessionKey);
    } catch (err) {
      console.error('[InlineButtons] Send error:', err);
    }
  }, [addMessage, activeSessionKey]);

  const handleDecisionSelect = useCallback(async (value: string) => {
    const text = value;
    setQuickReplies([], activeSessionKey);
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMsg, activeSessionKey);
    const { setIsTyping } = useChatStore.getState();
    setIsTyping(true, activeSessionKey);
    try {
      await gateway.sendMessage(text, undefined, activeSessionKey);
    } catch (err) {
      console.error('[DecisionCard] Send error:', err);
    }
  }, [activeSessionKey, addMessage, setQuickReplies]);

  // ── Render a single block (used by Virtuoso) ──
  const renderBlock = useCallback((block: RenderBlock) => {
    switch (block.type) {
      case 'compaction':
        return <CompactDivider timestamp={block.timestamp} label={t('chat.contextCompactedLabel', 'Context Compacted')} />;

      case 'inline-buttons':
        return (
          <InlineButtonBar
            buttons={block.rows.map(r => r.buttons.map(b => ({ text: b.text, callback_data: b.callback_data })))}
            onCallback={handleInlineButtonClick}
          />
        );

      case 'tool':
        return (
          <ToolCallBubble
            tool={{
              toolName: block.toolName,
              input: block.input,
              output: block.output,
              status: block.status,
              durationMs: block.durationMs,
            }}
          />
        );

      case 'thinking':
        return <ThinkingBubble content={block.content} />;

      case 'file-output':
        return <FileResultCard files={block.files} />;

      case 'decision':
        return <DecisionCard options={block.options} onSelect={handleDecisionSelect} />;

      case 'workshop-event':
        return <WorkshopEventCard events={block.events} />;

      case 'session-event':
        return <SessionEventCard event={block.event} />;

      case 'message':
        return (
          <MessageBubble
            block={block}
            onResend={block.role === 'user' ? handleResend : undefined}
            onRegenerate={block.role === 'assistant' ? handleRegenerate : undefined}
            onErrorAction={block.role === 'assistant' ? handleErrorAction : undefined}
            onDelete={() => {
              const st = useChatStore.getState();
              const key = st.activeSessionKey;
              st.setMessages((st.messagesPerSession[key] || []).filter((m) => m.id !== block.id), key);
            }}
          />
        );

      default:
        return <div />;
    }
  }, [handleResend, handleRegenerate, handleInlineButtonClick, handleDecisionSelect, handleErrorAction]);

  const renderGroup = useCallback((index: number, group: ResponseGroup) => (
    <div
      className={clsx(
        'px-1',
        group.role === 'assistant' ? 'space-y-2.5 py-1.5' : 'space-y-2 py-0.5',
      )}
      data-group-id={group.id}
      data-group-index={index}
    >
      {projectResponseGroupToRenderBlocks(group).map((block) => (
        <div key={block.id}>
          {renderBlock(block)}
        </div>
      ))}
    </div>
  ), [renderBlock]);

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

  // ── Footer: thinking stream + typing indicator ──
  const Footer = useCallback(() => (
    <div className="pb-1">
      {thinkingText && (
        <ThinkingBubble content={thinkingText} isStreaming />
      )}
      {isTyping && <TypingIndicator />}
    </div>
  ), [thinkingText, isTyping]);

  const latestGroupHasDecision = responseGroups[responseGroups.length - 1]?.blocks.some((block) => block.type === 'decision') ?? false;
  const shouldShowConnectionBanner =
    !connected &&
    (
      connecting ||
      hasConnectedOnce ||
      (hasSeenConnectionAttempt && Boolean(connectionError))
    );

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-aegis-bg">
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
                  gateway.connect(c.gatewayUrl || c.gatewayWsUrl || DEFAULT_GATEWAY_WS_URL, c.gatewayToken || '');
                });
              }} className="mx-2 underline hover:no-underline">
                {t('connection.reconnect')}
              </button>
            </span>
          )}
        </div>
      )}

      {connected && !hasProviders && !modelsLoading && (
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



      {/* Search Bar */}
      {searchOpen && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-aegis-border bg-aegis-elevated/50">
          <Search size={14} className="text-aegis-text-muted shrink-0" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearchIndex((prev) => (prev + 1) % Math.max(searchResults.length, 1));
              if (e.key === 'Enter' && e.shiftKey) setSearchIndex((prev) => (prev - 1 + searchResults.length) % Math.max(searchResults.length, 1));
            }}
            placeholder={t('chat.searchMessages', 'Search messages...')}
            className="flex-1 bg-transparent text-[12px] text-aegis-text outline-none placeholder:text-aegis-text-dim"
          />
          {searchResults.length > 0 && (
            <span className="text-[10px] font-mono text-aegis-text-muted shrink-0">
              {searchIndex + 1}/{searchResults.length}
            </span>
          )}
          {searchQuery && searchResults.length === 0 && (
            <span className="text-[10px] text-aegis-text-dim shrink-0">{t('chat.noSearchResults', 'No results')}</span>
          )}
          <button onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }}
            className="p-1 rounded hover:bg-[rgb(var(--aegis-overlay)/0.06)]">
            <X size={12} className="text-aegis-text-muted" />
          </button>
        </div>
      )}

      {/* Messages Area — Virtualized */}
      <div className={clsx('flex-1 min-h-0 relative', queueCount > 0 && 'pb-[100px]')}>
        {responseGroups.length === 0 ? (
          <div className="flex-1 h-full" />
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={responseGroups}
            followOutput={() => (scrollLockedRef.current || !atBottom ? false : (isTyping ? 'smooth' : 'auto'))}
            overscan={{ main: 600, reverse: 600 }}
            increaseViewportBy={{ top: 400, bottom: 400 }}
            defaultItemHeight={120}
            initialTopMostItemIndex={responseGroups.length - 1}
            atBottomStateChange={(b) => {
              setAtBottom(b);
              if (b) {
                // User scrolled back to bottom → re-enable auto-follow.
                scrollLockedRef.current = false;
              } else if (responseGroups.length === prevResponseGroupsLenRef.current) {
                // User manually scrolled up (not content growth) → lock, don't follow new output.
                scrollLockedRef.current = true;
              }
            }}
            atBottomThreshold={100}
            itemContent={renderGroup}
            startReached={handleStartReached}
            components={{ Footer, Header }}
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
        <QuickReplyBar
          buttons={quickReplies}
          onSend={async (text) => {
            setQuickReplies([], activeSessionKey);
            const userMsg: ChatMessage = {
              id: `user-${Date.now()}`,
              role: 'user',
              content: text,
              timestamp: new Date().toISOString(),
            };
            addMessage(userMsg, activeSessionKey);
            const { setIsTyping } = useChatStore.getState();
            setIsTyping(true, activeSessionKey);
            try {
              await gateway.sendMessage(text, undefined, activeSessionKey);
            } catch (err) {
              console.error('[QuickReplyBar] Send error:', err);
            }
          }}
          onDismiss={() => setQuickReplies([], activeSessionKey)}
        />
      )}

      <MessageInput />
    </div>
  );
}
