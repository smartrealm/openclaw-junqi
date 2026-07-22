import { create } from 'zustand';
import type { DecisionOption, FileRef, SessionEvent, WorkshopEvent } from '@/types/RenderBlock';
import type { RenderBlock } from '@/types/RenderBlock';
import type { ResponseGroup } from '@/types/ResponseGroup';
import { normalizeGatewayMessage } from '@/processing/normalizeGatewayMessage';
import { buildSemanticBlocks, projectSemanticBlocksToRenderBlocks } from '@/processing/buildSemanticBlocks';
import { buildResponseGroups } from '@/processing/buildResponseGroups';
import { gateway } from '@/services/gateway';
import type {
  OutboundChatPayload,
  PreparedAttachment,
  QueuedChatMessage,
} from '@/services/chat/types';
import {
  MAX_SESSION_MESSAGE_QUEUE_SIZE,
  SessionMessageQueueFullError,
} from '@/services/chat/types';
import { sessionMutationGate } from '@/services/chat/sessionMutationGate';
import { useSettingsStore } from './settingsStore';
import {
  coalesceSessionsByKey,
  isAgentMainSession,
  isSessionDeleted,
  markSessionDeleted,
  restoreSessionKey,
  withoutDeletedSessions,
} from '@/utils/sessionLifecycle';

// ═══════════════════════════════════════════════════════════
// Chat Store — Message, Session, Tabs & Usage State
// ═══════════════════════════════════════════════════════════

const MAIN_SESSION = 'agent:main:main';
const SESSION_TOPIC_PREFS_KEY = 'aegis:session-topic-prefs';
const OPEN_TABS_PREFS_KEY = 'aegis-open-tabs';
const SESSION_PIN_PREFS_KEY = 'aegis:session-pin-prefs';
const drainingQueueSessions = new Set<string>();

function outboundPayloadFromQueue(message: QueuedChatMessage): OutboundChatPayload {
  return {
    text: message.text,
    ...(message.sessionId ? { sessionId: message.sessionId } : {}),
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.displayAttachments?.length
      ? { displayAttachments: message.displayAttachments }
      : {}),
  };
}

function persistOpenTabs(tabs: string[]): void {
  try {
    localStorage.setItem(OPEN_TABS_PREFS_KEY, JSON.stringify(tabs));
  } catch {
    // ignore persistence errors
  }
}

function readSessionPinPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SESSION_PIN_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => (
        typeof entry[0] === 'string' && entry[0].trim().length > 0 && typeof entry[1] === 'boolean'
      )),
    );
  } catch {
    return {};
  }
}

function persistSessionPin(sessionKey: string, pinned: boolean): void {
  try {
    const prefs = readSessionPinPrefs();
    prefs[sessionKey] = pinned;
    localStorage.setItem(SESSION_PIN_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore persistence errors
  }
}

function clearSessionPinPref(sessionKey: string): void {
  try {
    const prefs = readSessionPinPrefs();
    delete prefs[sessionKey];
    localStorage.setItem(SESSION_PIN_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore persistence errors
  }
}

function readSessionTopicPrefs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SESSION_TOPIC_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => (
        typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1].trim().length > 0
      )),
    );
  } catch {
    return {};
  }
}

function getSessionTopicPref(sessionKey: string): string | undefined {
  const prefs = readSessionTopicPrefs();
  const topic = prefs[sessionKey];
  return typeof topic === 'string' && topic.trim().length > 0 ? topic : undefined;
}

function persistSessionTopicPref(sessionKey: string, topic: string | undefined): void {
  try {
    const prefs = readSessionTopicPrefs();
    if (topic && topic.trim()) {
      prefs[sessionKey] = topic.trim();
    }
    localStorage.setItem(SESSION_TOPIC_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore persistence errors
  }
}

export type HistoryLoaderOptions = { force?: boolean; background?: boolean };

const WEAK_SESSION_TOPIC_PATTERNS: RegExp[] = [
  /^\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?$/i,
  /^agent[:\s-]/i,
  /^session[:\s-]/i,
  /^new chat$/i,
  /^untitled$/i,
  /^desktop-[a-z0-9-]+$/i,
];

const WEAK_SESSION_TOPIC_FRAGMENTS = [
  'assistant',
  'chat',
  'session',
  'conversation',
  'message',
  'reply',
  'new',
  'main',
];

export const isWeakSessionTopic = (topic?: string): boolean => {
  if (!topic) return true;

  const normalized = topic.trim();
  if (!normalized) return true;
  if (normalized.length <= 2) return true;

  if (WEAK_SESSION_TOPIC_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  const lowered = normalized.toLowerCase();
  let stripped = lowered;
  for (const fragment of WEAK_SESSION_TOPIC_FRAGMENTS) {
    stripped = stripped.split(fragment).join(' ');
  }

  const meaningful = stripped.replace(/[^a-z0-9\u4e00-\u9fff]/gi, '');
  return meaningful.length < 4;
};

const SESSION_TOPIC_MAX_LENGTH = 40;

const normalizeSessionTopic = (text?: string | null): string | undefined => {
  if (typeof text !== 'string') return undefined;
  const normalized = text
    .replace(/\[OPENCLAW_DESKTOP_CONTEXT\][\s\S]*?\[\/OPENCLAW_DESKTOP_CONTEXT\]\s*/gi, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;

  const firstLine = normalized.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? normalized;
  const firstSentence = firstLine
    .split(/[。！？!?]/)
    .map((segment) => segment.trim())
    .find((segment) => segment.length >= 4) ?? firstLine;

  return firstSentence.length > SESSION_TOPIC_MAX_LENGTH
    ? `${firstSentence.slice(0, SESSION_TOPIC_MAX_LENGTH - 1).trim()}…`
    : firstSentence;
};

const deriveSessionTopic = (messages: ChatMessage[], fallbackText?: string): string | undefined => {
  const userTopic = messages
    .filter((message) => message.role === 'user')
    .map((message) => normalizeSessionTopic(message.content))
    .find((topic): topic is string => Boolean(topic) && !isWeakSessionTopic(topic));
  if (userTopic) return userTopic;

  const assistantTopic = messages
    .filter((message) => message.role === 'assistant' || message.role === 'system')
    .map((message) => normalizeSessionTopic(message.content))
    .find((topic): topic is string => Boolean(topic) && !isWeakSessionTopic(topic));
  if (assistantTopic) return assistantTopic;

  const readableFallback = normalizeSessionTopic(fallbackText);
  return readableFallback && !isWeakSessionTopic(readableFallback) ? readableFallback : undefined;
};

const resolveSessionTopic = (
  currentTopic: string | undefined,
  messages: ChatMessage[],
  fallbackText?: string,
): string | undefined => {
  const stableCurrentTopic = isWeakSessionTopic(currentTopic) ? undefined : currentTopic;
  if (messages.length > 0) {
    const derivedFromMessages = deriveSessionTopic(messages, undefined);
    if (derivedFromMessages) return derivedFromMessages;
    if (stableCurrentTopic) return stableCurrentTopic;
  }

  const derivedFromFallback = deriveSessionTopic([], fallbackText);
  if (derivedFromFallback) return derivedFromFallback;
  return stableCurrentTopic;
};

function resolveAndPersistSessionTopic(
  sessionKey: string,
  currentTopic: string | undefined,
  messages: ChatMessage[],
  fallbackText?: string,
): string | undefined {
  const hydratedCurrentTopic = currentTopic ?? getSessionTopicPref(sessionKey);
  const nextTopic = resolveSessionTopic(hydratedCurrentTopic, messages, fallbackText);
  if (nextTopic && !isWeakSessionTopic(nextTopic)) {
    persistSessionTopicPref(sessionKey, nextTopic);
  }
  return nextTopic;
}

const clearSessionAttentionState = (session: Session): Session => ({
  ...session,
  unread: 0,
  hasPendingCompletion: false,
});

const updateSession = (
  sessions: Session[],
  key: string,
  updater: (session: Session) => Session,
): Session[] => sessions.map((session) => (session.key === key ? updater(session) : session));

const upsertSession = (
  sessions: Session[],
  key: string,
  build: (session: Session) => Session,
): Session[] => {
  let found = false;
  const next = sessions.map((session) => {
    if (session.key !== key) return session;
    found = true;
    return build(session);
  });
  if (found) return next;
  return [...next, build({ key, label: key })];
};

function isLocalPlaceholderSession(session: Session): boolean {
  const createdAt = session.createdAt;
  return typeof createdAt === 'number'
    || (typeof createdAt === 'string' && createdAt.trim().length > 0);
}

export interface ChatMessage {
  id: string;
  /** Stable Desktop idempotency key for an optimistic user message. */
  clientMessageId?: string;
  /** OpenClaw transcript message id. Required before a collaboration can anchor here. */
  nativeMessageId?: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'compaction';
  /** Optional subtype — e.g. 'model-switch' for inline model-change notices. */
  kind?: 'model-switch' | string;
  content: string;
  /** Original structured Gateway blocks retained for tool/thinking projection. */
  rawContent?: unknown;
  timestamp: string;
  runId?: string | null;
  responseState?: 'streaming' | 'final' | 'error' | 'aborted';
  status?: 'pending' | 'sent' | 'queued' | 'failed' | 'cancelled';
  deliveryError?: string;
  isStreaming?: boolean;
  mediaUrl?: string;
  mediaType?: string;
  attachments?: Array<{
    mimeType: string;
    content: string;
    fileName: string;
  }>;
  /** Local delivery metadata. Never serialized into the OpenClaw transcript. */
  outboundAttachments?: Array<{ fileName: string; mimeType: string }>;
  /** Retained only while a delivery is queued or failed so retry is lossless. */
  retryPayload?: OutboundChatPayload;
  // Tool call metadata (role === 'tool')
  toolName?: string;
  toolInput?: Record<string, any>;
  toolOutput?: string;
  toolStatus?: 'running' | 'done' | 'error';
  toolDurationMs?: number;
  toolCallId?: string;
  // Thinking/reasoning content (saved after streaming completes)
  thinkingContent?: string;
  fileRefs?: FileRef[];
  decisionOptions?: DecisionOption[];
  workshopEvents?: WorkshopEvent[];
  sessionEvents?: SessionEvent[];
  usage?: Record<string, number>;
  model?: string | null;
  nativeSequence?: number;
  historyTruncated?: boolean;
  historyTruncationReason?: string;
}

export interface Session {
  key: string;
  /** Ephemeral OpenClaw session identity. Changes after reset/new. */
  sessionId?: string;
  label: string;
  agentId?: string;
  createdAt?: number | string;
  topic?: string;
  lastMessage?: string;
  lastTimestamp?: string;
  lastActive?: string;
  updatedAt?: string;
  unread?: number;
  hasPendingCompletion?: boolean;
  kind?: string;
  channel?: string | null;
  lastChannel?: string | null;
  /** OpenClaw's persisted source metadata. Kept name-for-name for projection. */
  origin?: {
    label?: string;
    provider?: string;
    surface?: string;
    chatType?: string;
    from?: string;
    to?: string;
    nativeChannelId?: string;
    nativeDirectUserId?: string;
    accountId?: string;
    threadId?: string | number;
  };
  spawnedBy?: string;
  parentSessionKey?: string;
  status?: string;
  hasActiveRun?: boolean;
  hasActiveSubagentRun?: boolean;
  subagentRunState?: string;
  systemSent?: boolean;
  // Per-session model/thinking/token data cached from sessions.list
  model?: string | null;
  thinkingLevel?: string | null;
  totalTokens?: number;
  contextTokens?: number;
  compactionCount?: number;
  // Runtime state from gateway
  running?: boolean;
  // User-controlled lifecycle flags (SPEC: archive + pin)
  pinned?: boolean;
  archived?: boolean;
}

export interface TokenUsage {
  contextTokens: number;
  maxTokens: number;
  percentage: number;
  compactions: number;
}

interface ChatState {
  // Messages (active session)
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage, sessionKey?: string) => void;
  updateMessage: (sessionKey: string, messageId: string, patch: Partial<ChatMessage>) => void;
  /** Resolve optimistic user messages after the Gateway accepts their run. */
  confirmPendingMessageDeliveries: (sessionKey: string, messageIds?: readonly string[]) => void;
  updateStreamingMessage: (
    id: string,
    content: string,
    extra?: {
      mediaUrl?: string;
      mediaType?: string;
      runId?: string | null;
      responseState?: 'streaming' | 'final' | 'error' | 'aborted';
    },
    sessionKey?: string
  ) => void;
  /** Remove a stream-only assistant placeholder that has no renderable payload. */
  discardEmptyStreamingMessage: (id: string, sessionKey?: string) => void;
  finalizeStreamingMessage: (
    id: string,
    content: string,
    extra?: {
      mediaUrl?: string;
      mediaType?: string;
      runId?: string | null;
      responseState?: 'streaming' | 'final' | 'error' | 'aborted';
      fileRefs?: FileRef[];
      decisionOptions?: DecisionOption[];
      workshopEvents?: WorkshopEvent[];
      sessionEvents?: SessionEvent[];
      usage?: Record<string, number>;
      model?: string | null;
    },
    sessionKey?: string
  ) => void;
  setMessages: (msgs: ChatMessage[], sessionKey?: string) => void;
  clearMessages: (sessionKey?: string) => void;

  // Derived render data (recomputed whenever messages change)
  renderBlocks: RenderBlock[];
  responseGroups: ResponseGroup[];

  // Per-session message cache
  messagesPerSession: Record<string, ChatMessage[]>;
  _blocksCache: Record<string, RenderBlock[]>;
  _groupsCache: Record<string, ResponseGroup[]>;
  cacheMessagesForSession: (key: string, msgs: ChatMessage[]) => void;
  getCachedMessages: (key: string) => ChatMessage[] | undefined;
  clearSessionMessages: (key: string) => void;

  // Sessions
  sessions: Session[];
  activeSessionKey: string;
  setSessions: (sessions: Session[], defaults?: { model: string | null; contextTokens: number | null }) => void;
  setSessionIdentity: (key: string, sessionId: string, agentId?: string) => void;
  /** Append a new session to the sidebar immediately (before the gateway's
   *  sessions.list reply). Used by per-agent "+ New Session" buttons in
   *  the sidebar: create the row and mark it active — the gateway catches
   *  up once the user actually sends a message. */
  addLocalSession: (session: Session) => void;
  /** Update a single session's label locally without a full sessions.list refetch. */
  setSessionLabel: (key: string, label: string) => void;
  /** Update a single session's model locally after sessions.patch succeeds. */
  setSessionModel: (key: string, model: string | null) => void;
  /** Pin/unpin a session. Pinned sessions surface at the top of the
   *  sidebar above the active/recent sections. Pure local state — no
   *  backend round-trip. */
  togglePinSession: (key: string) => void;
  /** Archive/restore a session. Archived sessions are filtered out
   *  of the default sidebar view; a "Show archived (N)" toggle at the
   *  bottom of the sidebar exposes them. Pure local state. */
  setSessionArchived: (key: string, archived: boolean) => void;
  setActiveSession: (key: string) => void;
  incrementSessionUnread: (key: string, amount?: number) => void;
  markSessionCompleted: (key: string) => void;
  clearSessionAttention: (key: string) => void;

  // Remove session entirely (after gateway deletion) — closes tab + removes from sessions list + clears cache
  removeSession: (key: string) => void;

  // Zero out a session's token data immediately (after reset) without waiting for next poll
  clearSessionTokens: (key: string) => void;

  // Tabs
  openTabs: string[];
  openTab: (key: string) => void;
  closeTab: (key: string) => void;
  reorderTabs: (keys: string[]) => void;

  // Token Usage
  tokenUsage: TokenUsage | null;
  setTokenUsage: (usage: TokenUsage | null) => void;

  // Current model (live from gateway)
  currentModel: string | null;
  setCurrentModel: (model: string | null) => void;

  // Manual model override — set when user picks manually, prevents polling from overwriting
  manualModelOverride: string | null;
  setManualModelOverride: (model: string | null) => void;
  // Clear only the override flag without touching currentModel (used on tab switch)
  clearManualOverride: () => void;

  // Current thinking level (live from gateway session)
  currentThinking: string | null;
  setCurrentThinking: (level: string | null) => void;

  // Gateway session defaults (default model, contextTokens from config)
  sessionDefaults: { model: string | null; contextTokens: number | null };

  // Available models (fetched from gateway models.list)
  availableModels: Array<{ id: string; label: string; alias?: string }>;
  setAvailableModels: (models: Array<{ id: string; label: string; alias?: string }>) => void;
  modelsLoading: boolean;

  // Drafts (per-session)
  drafts: Record<string, string>;
  setDraft: (key: string, text: string) => void;
  getDraft: (key: string) => string;

  // UI State — `isTyping` mirrors the active session's entry in `typingBySession`
  isTyping: boolean;
  typingBySession: Record<string, boolean>;
  setIsTyping: (typing: boolean, sessionKey?: string) => void;
  messageQueue: Record<string, QueuedChatMessage[]>;
  enqueueMessage: (sessionKey: string, message: QueuedChatMessage) => void;
  drainQueue: (sessionKey: string) => Promise<void>;
  retryQueuedMessage: (sessionKey: string, id: string) => Promise<void>;
  clearQueue: (sessionKey: string) => void;
  queueSize: (sessionKey: string) => number;

  // ── Drag-drop attachments ─────────────────────────────────
  /** Files dropped onto the app that should attach to the next outgoing
   *  message in `activeSessionKey`. Cleared by ChatPage / MessageInput
   *  after they've been moved into the per-session `files` list. */
  pendingFiles: string[];
  setPendingFiles: (paths: string[]) => void;
  consumePendingFiles: () => string[];
  /** Per-session attachment draft — pure UI state, not persisted. */
  draftAttachments: Record<string, string[]>;
  setDraftAttachments: (key: string, paths: string[]) => void;
  addDraftAttachment: (key: string, path: string) => void;
  removeDraftAttachment: (key: string, path: string) => void;
  /** Binary-safe, fully prepared attachments isolated by session. */
  preparedAttachments: Record<string, PreparedAttachment[]>;
  setPreparedAttachments: (key: string, files: PreparedAttachment[]) => void;
  removeQueuedMessage: (sessionKey: string, id: string) => void;
  updateQueuedMessage: (sessionKey: string, id: string, newText: string) => void;
  sendingBySession: Record<string, boolean>;
  setIsSending: (sending: boolean, sessionKey?: string) => void;
  loadingHistoryBySession: Record<string, boolean>;
  setIsLoadingHistory: (loading: boolean, sessionKey?: string) => void;
  // Called by MessageInput before first send — loads history if not yet loaded
  historyLoader: ((sessionKey?: string, options?: HistoryLoaderOptions) => Promise<void>) | null;
  setHistoryLoader: (fn: ((sessionKey?: string, options?: HistoryLoaderOptions) => Promise<void>) | null) => void;

  // Quick Replies (from [[button:...]] markers)
  quickReplies: Array<{ text: string; value: string }>;
  quickRepliesBySession: Record<string, Array<{ text: string; value: string }>>;
  setQuickReplies: (buttons: Array<{ text: string; value: string }>, sessionKey?: string) => void;

  // Thinking stream (live reasoning display)
  thinkingText: string;
  thinkingRunId: string | null;
  thinkingBySession: Record<string, { runId: string | null; text: string }>;
  setThinkingStream: (runId: string, text: string, sessionKey?: string) => void;
  clearThinking: (sessionKey?: string) => void;

  // Connection
  connected: boolean;
  connecting: boolean;
  connectionError: string | null;
  restarting: boolean;
  setConnectionStatus: (status: { connected: boolean; connecting: boolean; error?: string }) => void;
  setRestarting: (v: boolean) => void;
}

// ─── Helper: derive TitleBar state from a cached Session ───
// Called synchronously on tab switch — applies session's model/thinking/tokens instantly.
// When session has no model (e.g. brand-new tab), falls back to gateway defaults.
// Always resets manualModelOverride so the new session's own model is shown.
function titleBarStateFromSession(
  session: Session | undefined,
  defaults: { model: string | null; contextTokens: number | null },
): Pick<ChatState, 'currentModel' | 'currentThinking' | 'tokenUsage' | 'manualModelOverride'> {
  const model = session?.model ?? defaults.model;
  const thinkingLevel = session?.thinkingLevel ?? null;
  const used = session?.totalTokens ?? 0;
  const max = session?.contextTokens ?? defaults.contextTokens ?? 0;
  const pct = max > 0 ? Math.round((used / max) * 100) : 0;
  return {
    currentModel: model,
    currentThinking: thinkingLevel,
    tokenUsage: used > 0 || max > 0
      ? { contextTokens: used, maxTokens: max, percentage: pct, compactions: session?.compactionCount ?? 0 }
      : null,
    manualModelOverride: null,
  };
}

// ─── Helpers: session-scoped message / derived caches ───

const getSessionMessages = (state: ChatState, key: string): ChatMessage[] =>
  state.messagesPerSession[key] ?? (key === state.activeSessionKey ? state.messages : []);

const createRawHistoryPayload = (messages: ChatMessage[], sessionKey: string) =>
  messages.map((msg) => ({
    id: msg.id,
    sessionKey,
    runId: msg.runId,
    role: msg.role,
    content: msg.content,
    rawContent: msg.rawContent,
    timestamp: msg.timestamp,
    responseState: msg.responseState,
    toolName: msg.toolName,
    toolInput: msg.toolInput,
    toolOutput: msg.toolOutput,
    toolStatus: msg.toolStatus,
    toolDurationMs: msg.toolDurationMs,
    thinkingContent: msg.thinkingContent,
    mediaUrl: msg.mediaUrl,
    mediaType: msg.mediaType,
    attachments: msg.attachments,
    fileRefs: msg.fileRefs,
    decisionOptions: msg.decisionOptions,
    workshopEvents: msg.workshopEvents,
    sessionEvents: msg.sessionEvents,
    usage: msg.usage,
    model: msg.model,
    isStreaming: msg.isStreaming,
  }));

const normalizeComparableText = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const stripThinkingPrefix = (content: string, thinkingContent?: string): string => {
  if (!content || !thinkingContent) return content;

  const normalizedContent = normalizeComparableText(content);
  const normalizedThinking = normalizeComparableText(thinkingContent);
  if (!normalizedContent || !normalizedThinking) return content;

  if (normalizedContent === normalizedThinking) {
    return '';
  }

  if (normalizedContent.startsWith(normalizedThinking)) {
    const rawLeadingIndex = content.indexOf(thinkingContent.trim());
    if (rawLeadingIndex >= 0) {
      const stripped = content.slice(rawLeadingIndex + thinkingContent.trim().length).trimStart();
      return stripped;
    }

    const strippedNormalized = normalizedContent.slice(normalizedThinking.length).trimStart();
    return strippedNormalized;
  }

  return content;
};

const isEmptyAssistantStreamPlaceholder = (message: ChatMessage): boolean =>
  message.role === 'assistant'
  && message.isStreaming === true
  && !message.content.trim()
  && !message.mediaUrl
  && !message.attachments?.length
  && !message.fileRefs?.length
  && !message.decisionOptions?.length
  && !message.workshopEvents?.length
  && !message.sessionEvents?.length
  && !message.thinkingContent;

const buildCanonicalSemanticBlocks = (messages: ChatMessage[], sessionKey: string) => {
  const raw = createRawHistoryPayload(messages, sessionKey);
  const settings = useSettingsStore.getState();
  const chat = useChatStore.getState();
  return raw.flatMap((message) =>
    buildSemanticBlocks(normalizeGatewayMessage(message), {
      toolIntentEnabled: settings.toolIntentEnabled,
      tokenUsage: chat.tokenUsage,
      currentModel: chat.currentModel,
    }),
  );
};

const recomputeGroups = (messages: ChatMessage[], sessionKey: string): ResponseGroup[] =>
  buildResponseGroups(buildCanonicalSemanticBlocks(messages, sessionKey));

const recomputeDerived = (messages: ChatMessage[], sessionKey: string): { blocks: RenderBlock[]; groups: ResponseGroup[] } => {
  const semanticBlocks = buildCanonicalSemanticBlocks(messages, sessionKey);
  const groups = buildResponseGroups(semanticBlocks);
  const blocks = groups.flatMap((group) => projectSemanticBlocksToRenderBlocks(group.blocks));
  return { blocks, groups };
};

const recomputeBlocks = (messages: ChatMessage[], sessionKey: string): RenderBlock[] =>
  recomputeDerived(messages, sessionKey).blocks;

const projectSessionMessages = (
  state: ChatState,
  targetKey: string,
  messages: ChatMessage[],
  options: { clearThinking?: boolean } = {},
) => {
  const derived = recomputeDerived(messages, targetKey);
  const isActive = targetKey === state.activeSessionKey;
  return {
    ...(options.clearThinking
      ? {
          thinkingBySession: {
            ...state.thinkingBySession,
            [targetKey]: { runId: null, text: '' },
          },
        }
      : {}),
    messagesPerSession: {
      ...state.messagesPerSession,
      [targetKey]: messages,
    },
    _blocksCache: {
      ...state._blocksCache,
      [targetKey]: derived.blocks,
    },
    _groupsCache: {
      ...state._groupsCache,
      [targetKey]: derived.groups,
    },
    ...(isActive
      ? {
          messages,
          renderBlocks: derived.blocks,
          responseGroups: derived.groups,
          ...(options.clearThinking ? { thinkingText: '', thinkingRunId: null } : {}),
        }
      : {}),
  };
};

export const useChatStore = create<ChatState>((set, get) => ({
  // ── Messages (active session) ──
  messages: [],

  // ── Derived render data ──
  renderBlocks: [],
  responseGroups: [],

  addMessage: (msg, sessionKey) => {
    set((state) => {
      const targetKey = sessionKey ?? state.activeSessionKey;
      if (isSessionDeleted(targetKey)) return state;
      const currentMessages = getSessionMessages(state, targetKey);
      if (currentMessages.some((m) => m.id === msg.id)) return state;
      const updated = [...currentMessages, msg];
      const derived = recomputeDerived(updated, targetKey);
      const isActive = targetKey === state.activeSessionKey;

      return {
        sessions: updateSession(state.sessions, targetKey, (session) => ({
          ...session,
          topic: resolveAndPersistSessionTopic(targetKey, session.topic, updated, session.lastMessage),
        })),
        ...(isActive ? { messages: updated, renderBlocks: derived.blocks, responseGroups: derived.groups } : {}),
        messagesPerSession: {
          ...state.messagesPerSession,
          [targetKey]: updated,
        },
        _blocksCache: {
          ...state._blocksCache,
          [targetKey]: derived.blocks,
        },
        _groupsCache: {
          ...state._groupsCache,
          [targetKey]: derived.groups,
        },
      };
    });
  },

  updateMessage: (sessionKey, messageId, patch) => {
    const state = get();
    const current = getSessionMessages(state, sessionKey);
    const index = current.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const updated = [...current];
    updated[index] = { ...updated[index], ...patch };
    get().setMessages(updated, sessionKey);
  },

  confirmPendingMessageDeliveries: (sessionKey, messageIds) => {
    const state = get();
    const current = getSessionMessages(state, sessionKey);
    const targetIds = messageIds ? new Set(messageIds) : null;
    let changed = false;
    const updated = current.map((message) => {
      if (
        message.role !== 'user'
        || message.status !== 'pending'
        || (targetIds && !targetIds.has(message.id))
      ) return message;
      changed = true;
      return { ...message, status: 'sent' as const, deliveryError: undefined };
    });
    if (changed) get().setMessages(updated, sessionKey);
  },

  updateStreamingMessage: (id, content, extra, sessionKey) => {
    set((state) => {
      const targetKey = sessionKey ?? state.activeSessionKey;
      if (isSessionDeleted(targetKey)) return state;
      const currentMessages = getSessionMessages(state, targetKey);
      const existingIdx = currentMessages.findIndex((m) => m.id === id);
      // Whitespace and presentation-only directives must not allocate a new
      // assistant message. A tool boundary can otherwise strand it streaming.
      if (existingIdx < 0 && !content.trim() && !extra?.mediaUrl) return state;
      let updated: ChatMessage[];
      if (existingIdx >= 0) {
        updated = [...currentMessages];
        updated[existingIdx] = {
          ...updated[existingIdx],
          content,
          runId: extra?.runId ?? updated[existingIdx].runId ?? null,
          isStreaming: true,
          responseState: extra?.responseState ?? 'streaming',
          ...(extra?.mediaUrl ? { mediaUrl: extra.mediaUrl, mediaType: extra.mediaType } : {}),
        };
      } else {
        updated = [
          ...currentMessages,
          {
            id,
            role: 'assistant' as const,
            content,
            timestamp: new Date().toISOString(),
            runId: extra?.runId ?? null,
            isStreaming: true,
            responseState: extra?.responseState ?? 'streaming',
            ...(extra?.mediaUrl ? { mediaUrl: extra.mediaUrl, mediaType: extra.mediaType } : {}),
          },
        ];
      }

      const derived = recomputeDerived(updated, targetKey);
      const isActive = targetKey === state.activeSessionKey;
      return {
        typingBySession: {
          ...state.typingBySession,
          [targetKey]: true,
        },
        ...(isActive ? { messages: updated, renderBlocks: derived.blocks, responseGroups: derived.groups, isTyping: true } : {}),
        messagesPerSession: {
          ...state.messagesPerSession,
          [targetKey]: updated,
        },
        _blocksCache: {
          ...state._blocksCache,
          [targetKey]: derived.blocks,
        },
        _groupsCache: {
          ...state._groupsCache,
          [targetKey]: derived.groups,
        },
      };
    });
  },

  discardEmptyStreamingMessage: (id, sessionKey) => {
    set((state) => {
      const targetKey = sessionKey ?? state.activeSessionKey;
      if (isSessionDeleted(targetKey)) return state;
      const currentMessages = getSessionMessages(state, targetKey);
      const existingIdx = currentMessages.findIndex((message) => message.id === id);
      if (existingIdx < 0 || !isEmptyAssistantStreamPlaceholder(currentMessages[existingIdx])) return state;

      const updated = currentMessages.filter((message) => message.id !== id);
      return projectSessionMessages(state, targetKey, updated);
    });
  },

  finalizeStreamingMessage: (id, content, extra, sessionKey) => {
    set((state) => {
      const targetKey = sessionKey ?? state.activeSessionKey;
      if (isSessionDeleted(targetKey)) return state;
      const currentMessages = getSessionMessages(state, targetKey);
      const existingIdx = currentMessages.findIndex((m) => m.id === id);
      const sessionThinking = state.thinkingBySession[targetKey];
      const thinkingContent = sessionThinking?.text || undefined;
      const finalContent = stripThinkingPrefix(content, thinkingContent);
      const hasFinalSnapshot = Boolean(content.trim());

      if (existingIdx >= 0) {
        const existing = currentMessages[existingIdx];
        const finalHasRenderablePayload = Boolean(
          finalContent.trim()
          || thinkingContent
          || extra?.mediaUrl
          || extra?.fileRefs?.length
          || extra?.decisionOptions?.length
          || extra?.workshopEvents?.length
          || extra?.sessionEvents?.length,
        );
        if (isEmptyAssistantStreamPlaceholder(existing) && !finalHasRenderablePayload) {
          const updated = currentMessages.filter((message) => message.id !== id);
          return projectSessionMessages(state, targetKey, updated, { clearThinking: true });
        }
        const updated = [...currentMessages];

        updated[existingIdx] = {
          ...updated[existingIdx],
          // An empty result from thinking-prefix removal is intentional. Only
          // fall back to the live text when the Gateway did not send a final
          // snapshot at all.
          content: hasFinalSnapshot ? finalContent : updated[existingIdx].content,
          runId: extra?.runId ?? updated[existingIdx].runId ?? null,
          isStreaming: false,
          responseState: extra?.responseState ?? 'final',
          ...(extra?.mediaUrl ? { mediaUrl: extra.mediaUrl, mediaType: extra.mediaType } : {}),
          ...(thinkingContent ? { thinkingContent } : {}),
          ...(extra?.fileRefs ? { fileRefs: extra.fileRefs } : {}),
          ...(extra?.decisionOptions ? { decisionOptions: extra.decisionOptions } : {}),
          ...(extra?.workshopEvents ? { workshopEvents: extra.workshopEvents } : {}),
          ...(extra?.sessionEvents ? { sessionEvents: extra.sessionEvents } : {}),
          ...(extra?.usage ? { usage: extra.usage } : {}),
          ...(extra?.model !== undefined ? { model: extra.model } : {}),
        };

        const derived = recomputeDerived(updated, targetKey);
        return {
          thinkingBySession: {
            ...state.thinkingBySession,
            [targetKey]: { runId: null, text: '' },
          },
          messagesPerSession: {
            ...state.messagesPerSession,
            [targetKey]: updated,
          },
          _blocksCache: {
            ...state._blocksCache,
            [targetKey]: derived.blocks,
          },
          _groupsCache: {
            ...state._groupsCache,
            [targetKey]: derived.groups,
          },
          ...(targetKey === state.activeSessionKey
            ? {
                messages: updated,
                renderBlocks: derived.blocks,
                responseGroups: derived.groups,
                thinkingText: '',
                thinkingRunId: null,
              }
            : {}),
        };
      }
      // Message not found — this happens when post-tool-call text arrives
      // with a new runId that had no preceding delta events. Create a new message.
      if (finalContent && finalContent.trim()) {
        const newMsg: ChatMessage = {
          id,
          role: 'assistant',
          content: finalContent,
          timestamp: new Date().toISOString(),
          runId: extra?.runId ?? null,
          isStreaming: false,
          responseState: extra?.responseState ?? 'final',
          ...(extra?.mediaUrl ? { mediaUrl: extra.mediaUrl, mediaType: extra.mediaType } : {}),
          ...(thinkingContent ? { thinkingContent } : {}),
          ...(extra?.fileRefs ? { fileRefs: extra.fileRefs } : {}),
          ...(extra?.decisionOptions ? { decisionOptions: extra.decisionOptions } : {}),
          ...(extra?.workshopEvents ? { workshopEvents: extra.workshopEvents } : {}),
          ...(extra?.sessionEvents ? { sessionEvents: extra.sessionEvents } : {}),
          ...(extra?.usage ? { usage: extra.usage } : {}),
          ...(extra?.model !== undefined ? { model: extra.model } : {}),
        };
        const updated = [...currentMessages, newMsg];
        const derived = recomputeDerived(updated, targetKey);
        return {
          thinkingBySession: {
            ...state.thinkingBySession,
            [targetKey]: { runId: null, text: '' },
          },
          messagesPerSession: {
            ...state.messagesPerSession,
            [targetKey]: updated,
          },
          _blocksCache: {
            ...state._blocksCache,
            [targetKey]: derived.blocks,
          },
          _groupsCache: {
            ...state._groupsCache,
            [targetKey]: derived.groups,
          },
          ...(targetKey === state.activeSessionKey
            ? {
                messages: updated,
                renderBlocks: derived.blocks,
                responseGroups: derived.groups,
                thinkingText: '',
                thinkingRunId: null,
              }
            : {}),
        };
      }
      return {
        thinkingBySession: {
          ...state.thinkingBySession,
          [targetKey]: { runId: null, text: '' },
        },
        ...(targetKey === state.activeSessionKey
          ? { thinkingText: '', thinkingRunId: null }
          : {}),
      };
    });
  },

  setMessages: (msgs, sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    if (isSessionDeleted(targetKey)) return state;
    const derived = recomputeDerived(msgs, targetKey);
    const isActive = targetKey === state.activeSessionKey;
    const currentSession = state.sessions.find((session) => session.key === targetKey);
    return {
      sessions: updateSession(state.sessions, targetKey, (session) => ({
        ...session,
        topic: resolveAndPersistSessionTopic(targetKey, session.topic, msgs, session.lastMessage),
      })),
      ...(isActive ? { messages: msgs, renderBlocks: derived.blocks, responseGroups: derived.groups } : {}),
      messagesPerSession: {
        ...state.messagesPerSession,
        [targetKey]: msgs,
      },
      _blocksCache: {
        ...state._blocksCache,
        [targetKey]: derived.blocks,
      },
      _groupsCache: {
        ...state._groupsCache,
        [targetKey]: derived.groups,
      },
    };
  }),

  clearMessages: (sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    const isActive = targetKey === state.activeSessionKey;
    return {
      typingBySession: {
        ...state.typingBySession,
        [targetKey]: false,
      },
      quickRepliesBySession: {
        ...state.quickRepliesBySession,
        [targetKey]: [],
      },
      thinkingBySession: {
        ...state.thinkingBySession,
        [targetKey]: { runId: null, text: '' },
      },
      sendingBySession: {
        ...state.sendingBySession,
        [targetKey]: false,
      },
      loadingHistoryBySession: {
        ...state.loadingHistoryBySession,
        [targetKey]: false,
      },
      messagesPerSession: {
        ...state.messagesPerSession,
        [targetKey]: [],
      },
      _blocksCache: {
        ...state._blocksCache,
        [targetKey]: [],
      },
      _groupsCache: {
        ...state._groupsCache,
        [targetKey]: [],
      },
      ...(isActive
        ? {
            messages: [],
            renderBlocks: [],
            responseGroups: [],
            isTyping: false,
            quickReplies: [],
            thinkingText: '',
            thinkingRunId: null,
          }
        : {}),
    };
  }),

  // ── Per-session cache ──
  messagesPerSession: {},
  _blocksCache: {},
  _groupsCache: {},

  cacheMessagesForSession: (key, msgs) => set((state) => {
    if (isSessionDeleted(key)) return state;
    const derived = recomputeDerived(msgs, key);
    return {
      sessions: updateSession(state.sessions, key, (session) => ({
        ...session,
        topic: resolveAndPersistSessionTopic(key, session.topic, msgs, session.lastMessage),
      })),
      messagesPerSession: { ...state.messagesPerSession, [key]: msgs },
      _blocksCache: { ...state._blocksCache, [key]: derived.blocks },
      _groupsCache: { ...state._groupsCache, [key]: derived.groups },
    };
  }),

  getCachedMessages: (key) => get().messagesPerSession[key],

  clearSessionMessages: (key) => set((state) => {
    const isActive = state.activeSessionKey === key;
    return {
      messagesPerSession: { ...state.messagesPerSession, [key]: [] },
      _blocksCache: { ...state._blocksCache, [key]: [] },
      _groupsCache: { ...state._groupsCache, [key]: [] },
      typingBySession: { ...state.typingBySession, [key]: false },
      quickRepliesBySession: { ...state.quickRepliesBySession, [key]: [] },
      thinkingBySession: {
        ...state.thinkingBySession,
        [key]: { runId: null, text: '' },
      },
      sendingBySession: { ...state.sendingBySession, [key]: false },
      loadingHistoryBySession: { ...state.loadingHistoryBySession, [key]: false },
      ...(isActive
        ? {
            messages: [],
            renderBlocks: [],
            responseGroups: [],
            isTyping: false,
            quickReplies: [],
            thinkingText: '',
            thinkingRunId: null,
          }
        : {}),
    };
  }),

  // ── Sessions ──
  sessions: [{ key: MAIN_SESSION, label: 'Main Session' }],
  activeSessionKey: MAIN_SESSION,

  setSessions: (sessions, defaults) => {
    const {
      activeSessionKey,
      manualModelOverride,
      sessionDefaults: prev,
      sessions: previousSessions,
      messagesPerSession,
    } = get();
    const defs = defaults ?? prev;
    const visibleIncomingSessions = coalesceSessionsByKey(withoutDeletedSessions(sessions));
    const persistedPins = readSessionPinPrefs();
    const previousByKey = new Map(previousSessions.map((session) => [session.key, session]));
    const incomingKeys = new Set(visibleIncomingSessions.map((session) => session.key));
    const mergedSessions = visibleIncomingSessions.map((session) => {
      const previous = previousByKey.get(session.key);
      const hasCachedMessages = Object.prototype.hasOwnProperty.call(messagesPerSession, session.key);
      const cachedMessages = hasCachedMessages ? messagesPerSession[session.key] ?? [] : [];
      const hydratedTopic = previous?.topic ?? getSessionTopicPref(session.key);
      const merged: Session = {
        ...session,
        // OpenClaw's `sessions.list` response is authoritative for labels.
        // User mutations are only applied locally after `sessions.patch`
        // confirms them, so no client-side shadow value is needed here.
        label: typeof session.label === 'string' ? session.label : '',
        // Preserve pin/archive flags (purely local UI state).
        pinned: previous?.pinned
          ?? (Object.prototype.hasOwnProperty.call(persistedPins, session.key)
            ? persistedPins[session.key]
            : session.pinned),
        archived: previous?.archived ?? session.archived,
        topic: hasCachedMessages
          ? resolveAndPersistSessionTopic(session.key, hydratedTopic, cachedMessages, session.lastMessage)
          : resolveAndPersistSessionTopic(session.key, hydratedTopic, [], session.lastMessage),
        unread: previous?.unread ?? session.unread ?? 0,
        hasPendingCompletion: previous?.hasPendingCompletion ?? session.hasPendingCompletion ?? false,
      };
      return session.key === activeSessionKey ? clearSessionAttentionState(merged) : merged;
    });
    const localOnlySessions = previousSessions.filter((session) => {
      if (incomingKeys.has(session.key)) return false;
      if (session.archived) return false;
      return isLocalPlaceholderSession(session);
    });
    const nextSessions = [...mergedSessions, ...localOnlySessions];
    const hasAuthoritativeMainSession = visibleIncomingSessions.some((session) => isAgentMainSession(session.key));
    const removedCanonicalSessionKeys = hasAuthoritativeMainSession
      ? previousSessions.flatMap((session) => {
          if (incomingKeys.has(session.key) || isAgentMainSession(session.key)) return [];
          return isLocalPlaceholderSession(session) ? [] : [session.key];
        })
      : [];
    removedCanonicalSessionKeys.forEach(markSessionDeleted);
    const active = nextSessions.find((s) => s.key === activeSessionKey);
    const titleBar = titleBarStateFromSession(active, defs);
    set({
      sessions: nextSessions,
      ...(defaults ? { sessionDefaults: defs } : {}),
      currentThinking: titleBar.currentThinking,
      tokenUsage: titleBar.tokenUsage,
      // Only update currentModel if there is no manual override in effect.
      ...(manualModelOverride ? {} : { currentModel: titleBar.currentModel }),
    });
    removedCanonicalSessionKeys.forEach((key) => get().removeSession(key));
  },

  setSessionIdentity: (key, sessionId, agentId) => set((state) => ({
    sessions: upsertSession(state.sessions, key, (session) => ({
      ...session,
      sessionId,
      ...(agentId ? { agentId } : {}),
    })),
  })),

  setActiveSession: (key) => {
    if (isSessionDeleted(key)) return;
    const state = get();
    const msgs = state.messagesPerSession[key] || [];
    const blocks = state._blocksCache[key];
    const groups = state._groupsCache[key];
    const clearedSessions = updateSession(state.sessions, key, clearSessionAttentionState);
    const session = clearedSessions.find((s) => s.key === key) ?? state.sessions.find((s) => s.key === key);
    const titleBar = titleBarStateFromSession(session, state.sessionDefaults);
    const openTabs = state.openTabs.includes(key) ? state.openTabs : [...state.openTabs, key];
    if (openTabs !== state.openTabs) persistOpenTabs(openTabs);
    set({
      sessions: clearedSessions,
      openTabs,
      activeSessionKey: key,
      messages: msgs,
      renderBlocks: blocks ?? recomputeBlocks(msgs, key),
      responseGroups: groups ?? recomputeGroups(msgs, key),
      isTyping: state.typingBySession[key] || false,
      quickReplies: state.quickRepliesBySession[key] || [],
      thinkingText: state.thinkingBySession[key]?.text || '',
      thinkingRunId: state.thinkingBySession[key]?.runId || null,
      ...titleBar,
    });
  },

  incrementSessionUnread: (key, amount = 1) => set((state) => {
    if (key === state.activeSessionKey) {
      return { sessions: updateSession(state.sessions, key, clearSessionAttentionState) };
    }
    return {
      sessions: updateSession(state.sessions, key, (session) => ({
        ...session,
        unread: Math.max(0, (session.unread ?? 0) + amount),
      })),
    };
  }),

  markSessionCompleted: (key) => set((state) => {
    if (key === state.activeSessionKey) {
      return { sessions: updateSession(state.sessions, key, clearSessionAttentionState) };
    }
    return {
      sessions: updateSession(state.sessions, key, (session) => ({
        ...session,
        hasPendingCompletion: true,
      })),
    };
  }),

  clearSessionAttention: (key) => set((state) => ({
    sessions: updateSession(state.sessions, key, clearSessionAttentionState),
  })),

  /** Append a placeholder session to the sidebar. Idempotent: if a session
   *  with this key already exists we surface it instead of duplicating.
   *  Used by per-agent "+ New Session" buttons before the user has sent
   *  any messages. */
  addLocalSession: (session) => {
    restoreSessionKey(session.key);
    set((state) => {
      const exists = state.sessions.some((s) => s.key === session.key);
      const openTabs = state.openTabs.includes(session.key) ? state.openTabs : [...state.openTabs, session.key];
      if (openTabs !== state.openTabs) persistOpenTabs(openTabs);
      const msgs = state.messagesPerSession[session.key] || [];
      const blocks = state._blocksCache[session.key];
      const groups = state._groupsCache[session.key];
      const titleBar = titleBarStateFromSession(session, state.sessionDefaults);
      const activeState = {
        openTabs,
        activeSessionKey: session.key,
        messages: msgs,
        renderBlocks: blocks ?? recomputeBlocks(msgs, session.key),
        responseGroups: groups ?? recomputeGroups(msgs, session.key),
        isTyping: state.typingBySession[session.key] || false,
        quickReplies: state.quickRepliesBySession[session.key] || [],
        thinkingText: state.thinkingBySession[session.key]?.text || '',
        thinkingRunId: state.thinkingBySession[session.key]?.runId || null,
        ...titleBar,
      };
      if (exists) {
        return activeState;
      }
      return {
        ...activeState,
        sessions: [...state.sessions, session],
      };
    });
  },

  /** Locally apply a renamed label without refetching sessions.list. */
  setSessionLabel: (key, label) => set((state) => (
    isSessionDeleted(key)
      ? state
      : {
          sessions: coalesceSessionsByKey(updateSession(state.sessions, key, (session) =>
            session.label === label ? session : { ...session, label },
          )),
        }
  )),

  /** Locally apply a model switch without waiting for sessions.list. */
  setSessionModel: (key, model) => set((state) => (
    isSessionDeleted(key)
      ? state
      : {
          sessions: upsertSession(state.sessions, key, (session) =>
            session.model === model ? session : { ...session, model },
          ),
          ...(state.activeSessionKey === key ? { currentModel: model } : {}),
        }
  )),

  togglePinSession: (key) => set((state) => ({
    sessions: updateSession(state.sessions, key, (session) => {
      const pinned = !session.pinned;
      persistSessionPin(key, pinned);
      return { ...session, pinned };
    }),
  })),

  setSessionArchived: (key, archived) => set((state) => ({
    sessions: updateSession(state.sessions, key, (s) => ({ ...s, archived })),
  })),

  // ── Pending file attachments (drag-drop → new session) ─────
  // ChatPage drains this on mount; if a new drag-drop happens while
  // ChatPage is already mounted, the latest paths replace the previous
  // payload (we don't try to merge — drag-drop is a single user action).
  pendingFiles: [] as string[],
  setPendingFiles: (paths) => set({ pendingFiles: paths }),
  consumePendingFiles: () => {
    const out = get().pendingFiles;
    set({ pendingFiles: [] });
    return out;
  },

  /** Per-session attachment draft — files the user has attached to the
   *  next outgoing message (via drag-drop, paste, or the attach button).
   *  Cleared after the user sends. Pure UI state; not persisted. */
  draftAttachments: {} as Record<string, string[]>,
  setDraftAttachments: (key: string, paths: string[]) => set((s) => (
    isSessionDeleted(key) ? s : { draftAttachments: { ...s.draftAttachments, [key]: paths } }
  )),
  addDraftAttachment: (key: string, path: string) => set((s) => (
    isSessionDeleted(key)
      ? s
      : {
          draftAttachments: {
            ...s.draftAttachments,
            [key]: [...(s.draftAttachments[key] ?? []), path],
          },
        }
  )),
  removeDraftAttachment: (key: string, path: string) => set((s) => {
    const cur = s.draftAttachments[key] ?? [];
    const next = cur.filter((p) => p !== path);
    return {
      draftAttachments: { ...s.draftAttachments, [key]: next },
    };
  }),
  preparedAttachments: {} as Record<string, PreparedAttachment[]>,
  setPreparedAttachments: (key, files) => set((state) => (
    isSessionDeleted(key)
      ? state
      : { preparedAttachments: { ...state.preparedAttachments, [key]: files } }
  )),

  // ── Tabs ──
  openTabs: (() => {
    try {
      const raw = localStorage.getItem(OPEN_TABS_PREFS_KEY);
      if (!raw) return [MAIN_SESSION];
      const arr: string[] = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return [MAIN_SESSION];
      const valid = arr.filter((k) => typeof k === 'string' && k.trim());
      if (valid.length === 0) return [MAIN_SESSION];
      return valid.includes(MAIN_SESSION) ? valid : [MAIN_SESSION, ...valid];
    } catch { return [MAIN_SESSION]; }
  })(),

  openTab: (key) => set((state) => {
    if (isSessionDeleted(key)) return state;
    const clearedSessions = updateSession(state.sessions, key, clearSessionAttentionState);
    const session = clearedSessions.find((s) => s.key === key) ?? state.sessions.find((s) => s.key === key);
    const titleBar = titleBarStateFromSession(session, state.sessionDefaults);
    if (state.openTabs.includes(key)) {
      const cached = state.messagesPerSession[key] || [];
      const blocks = state._blocksCache[key];
      const groups = state._groupsCache[key];
      return {
        sessions: clearedSessions,
        activeSessionKey: key,
        messages: cached,
        renderBlocks: blocks ?? recomputeBlocks(cached, key),
        responseGroups: groups ?? recomputeGroups(cached, key),
        isTyping: state.typingBySession[key] || false,
        quickReplies: state.quickRepliesBySession[key] || [],
        thinkingText: state.thinkingBySession[key]?.text || '',
        thinkingRunId: state.thinkingBySession[key]?.runId || null,
        ...titleBar,
      };
    }
    const msgs = state.messagesPerSession[key] || [];
    const blocks = state._blocksCache[key];
    const groups = state._groupsCache[key];
    const newTabs = [...state.openTabs, key];
    persistOpenTabs(newTabs);
    return {
      sessions: clearedSessions,
      openTabs: newTabs,
      activeSessionKey: key,
      messages: msgs,
      renderBlocks: blocks ?? recomputeBlocks(msgs, key),
      responseGroups: groups ?? recomputeGroups(msgs, key),
      isTyping: state.typingBySession[key] || false,
      quickReplies: state.quickRepliesBySession[key] || [],
      thinkingText: state.thinkingBySession[key]?.text || '',
      thinkingRunId: state.thinkingBySession[key]?.runId || null,
      ...titleBar,
    };
  }),

  closeTab: (key) => set((state) => {
    if (key === MAIN_SESSION) return state;
    const newTabs = state.openTabs.filter((t) => t !== key);
    if (newTabs.length === 0) newTabs.push(MAIN_SESSION);
    persistOpenTabs(newTabs);
    const newActive = state.activeSessionKey === key
      ? newTabs[newTabs.length - 1]
      : state.activeSessionKey;
    const clearedSessions = updateSession(state.sessions, newActive, clearSessionAttentionState);
    const msgs = state.messagesPerSession[newActive] || [];
    const blocks = state._blocksCache[newActive];
    const groups = state._groupsCache[newActive];
    const session = clearedSessions.find((s) => s.key === newActive) ?? state.sessions.find((s) => s.key === newActive);
    const titleBar = titleBarStateFromSession(session, state.sessionDefaults);
    return {
      sessions: clearedSessions,
      openTabs: newTabs,
      activeSessionKey: newActive,
      messages: msgs,
      renderBlocks: blocks ?? recomputeBlocks(msgs, newActive),
      responseGroups: groups ?? recomputeGroups(msgs, newActive),
      isTyping: state.typingBySession[newActive] || false,
      quickReplies: state.quickRepliesBySession[newActive] || [],
      thinkingText: state.thinkingBySession[newActive]?.text || '',
      thinkingRunId: state.thinkingBySession[newActive]?.runId || null,
      ...titleBar,
    };
  }),

  reorderTabs: (keys) => {
    persistOpenTabs(keys);
    set({ openTabs: keys });
  },

  removeSession: (key) => set((state) => {
    if (isAgentMainSession(key)) return state;
    clearSessionPinPref(key);
    const newTabs = state.openTabs.filter((t) => t !== key);
    if (newTabs.length === 0) newTabs.push(MAIN_SESSION);
    persistOpenTabs(newTabs);
    const newActive = state.activeSessionKey === key
      ? newTabs[newTabs.length - 1]
      : state.activeSessionKey;
    const newSessions = updateSession(
      state.sessions.filter((s) => s.key !== key),
      newActive,
      clearSessionAttentionState,
    );
    const { [key]: _msgs, ...restMessages } = state.messagesPerSession;
    const { [key]: _blocks, ...restBlocks } = state._blocksCache;
    const { [key]: _groupsRm, ...restGroupsCache } = state._groupsCache;
    const { [key]: _typingRm, ...restTyping } = state.typingBySession;
    const { [key]: _qr, ...restQuickReplies } = state.quickRepliesBySession;
    const { [key]: _thinking, ...restThinking } = state.thinkingBySession;
    const { [key]: _draft, ...restDrafts } = state.drafts;
    const { [key]: _queue, ...restMessageQueue } = state.messageQueue;
    const { [key]: _attachments, ...restDraftAttachments } = state.draftAttachments;
    const { [key]: _prepared, ...restPreparedAttachments } = state.preparedAttachments;
    const { [key]: _sending, ...restSendingBySession } = state.sendingBySession;
    const { [key]: _historyLoading, ...restLoadingHistoryBySession } = state.loadingHistoryBySession;
    const msgs = restMessages[newActive] || [];
    const blocks = restBlocks[newActive];
    const groups = restGroupsCache[newActive];
    const session = newSessions.find((s) => s.key === newActive);
    const titleBar = titleBarStateFromSession(session, state.sessionDefaults);
    return {
      openTabs: newTabs,
      activeSessionKey: newActive,
      sessions: newSessions,
      messagesPerSession: restMessages,
      _blocksCache: restBlocks,
      _groupsCache: restGroupsCache,
      typingBySession: restTyping,
      quickRepliesBySession: restQuickReplies,
      thinkingBySession: restThinking,
      drafts: restDrafts,
      messageQueue: restMessageQueue,
      draftAttachments: restDraftAttachments,
      preparedAttachments: restPreparedAttachments,
      sendingBySession: restSendingBySession,
      loadingHistoryBySession: restLoadingHistoryBySession,
      quickReplies: restQuickReplies[newActive] || [],
      thinkingText: restThinking[newActive]?.text || '',
      thinkingRunId: restThinking[newActive]?.runId || null,
      messages: msgs,
      renderBlocks: blocks ?? recomputeBlocks(msgs, newActive),
      responseGroups: groups ?? recomputeGroups(msgs, newActive),
      isTyping: restTyping[newActive] || false,
      ...titleBar,
    };
  }),

  clearSessionTokens: (key) => set((state) => {
    const updatedSessions = state.sessions.map((s) =>
      s.key === key
        ? { ...s, totalTokens: 0, contextTokens: 0, compactionCount: 0 }
        : s,
    );
    const isActive = state.activeSessionKey === key;
    return {
      sessions: updatedSessions,
      ...(isActive ? { tokenUsage: null } : {}),
    };
  }),

  // ── Session Defaults (from gateway sessions.list response) ──
  sessionDefaults: { model: null, contextTokens: null },

  // ── Token Usage ──
  tokenUsage: null,
  setTokenUsage: (usage) => set((state) => {
    const updates: any = { tokenUsage: usage };
    // When token data arrives via polling, recompute derived state so context
    // bars appear under existing AI replies.  Do NOT call setMessages here —
    // that path changes `messages` which makes Virtuoso diff the entire data
    // list and can reset scroll position.
    if (usage && !state.tokenUsage && state.activeSessionKey) {
      const key = state.activeSessionKey;
      const msgs = state.messagesPerSession[key] || [];
      if (msgs.length > 0) {
        const derived = recomputeDerived(msgs, key);
        if (key === state.activeSessionKey) {
          updates.renderBlocks = derived.blocks;
          updates.responseGroups = derived.groups;
        }
        updates._blocksCache = { ...state._blocksCache, [key]: derived.blocks };
        updates._groupsCache = { ...state._groupsCache, [key]: derived.groups };
      }
    }
    return updates;
  }),
  currentModel: null,
  setCurrentModel: (model) => set({ currentModel: model }),
  manualModelOverride: null,
  setManualModelOverride: (model) => set({ manualModelOverride: model, currentModel: model }),
  clearManualOverride: () => set({ manualModelOverride: null }),
  currentThinking: null,
  setCurrentThinking: (level) => set({ currentThinking: level }),

  // ── Available Models ──
  availableModels: [],
  setAvailableModels: (models) => set({ availableModels: models, modelsLoading: false }),
  modelsLoading: true,

  // ── UI State ──
  isTyping: false,
  typingBySession: {},
  messageQueue: {},
  enqueueMessage: (sessionKey, message) => set((state) => {
    const queue = state.messageQueue[sessionKey] || [];
    if (queue.length >= MAX_SESSION_MESSAGE_QUEUE_SIZE) {
      throw new SessionMessageQueueFullError();
    }
    return {
      messageQueue: {
        ...state.messageQueue,
        [sessionKey]: [...queue, message],
      },
    };
  }),
  drainQueue: async (sessionKey) => {
    if (isSessionDeleted(sessionKey) || drainingQueueSessions.has(sessionKey)) return;
    if (
      !get().connected
      || get().typingBySession[sessionKey]
      || sessionMutationGate.isBlocked(sessionKey)
    ) return;
    const next = get().messageQueue[sessionKey]?.[0];
    if (!next || next.failed) return;
    drainingQueueSessions.add(sessionKey);
    const retryPayload = outboundPayloadFromQueue(next);
    // Mark typing so the drained reply is tracked through its lifecycle — its
    // completion (typing true→false) re-triggers the App.tsx drain subscription
    // to send the next queued item. Without this the subscription would fire in
    // a tight loop (typing stays false) and the reply would show no indicator.
    // User message appears in chat BEFORE AI starts replying
    get().addMessage({
      id: next.id,
      clientMessageId: next.id,
      role: 'user', content: next.text,
      timestamp: next.timestamp, status: 'pending' as const,
      ...(next.displayAttachments?.length ? { attachments: next.displayAttachments } : {}),
      retryPayload,
      ...(next.attachments?.length
        ? {
            outboundAttachments: next.attachments.map((attachment) => ({
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
            })),
          }
        : {}),
    }, sessionKey);
    get().updateMessage(sessionKey, next.id, { status: 'pending', deliveryError: undefined });
    get().setIsTyping(true, sessionKey);
    try {
      const result = await gateway.sendMessage(next.text, next.attachments, sessionKey, {
        clientMessageId: next.id,
        sessionId: next.sessionId,
      }) as { queued?: boolean } | undefined;
      set((state) => ({
        messageQueue: {
          ...state.messageQueue,
          [sessionKey]: (state.messageQueue[sessionKey] || []).filter((item) => item.id !== next.id),
        },
      }));
      get().updateMessage(sessionKey, next.id, {
        status: result?.queued ? 'queued' : 'sent',
        deliveryError: undefined,
        retryPayload: result?.queued ? retryPayload : undefined,
      });
      if (result?.queued) get().setIsTyping(false, sessionKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Message delivery failed');
      set((state) => ({
        messageQueue: {
          ...state.messageQueue,
          [sessionKey]: (state.messageQueue[sessionKey] || []).map((item) => (
            item.id === next.id ? { ...item, failed: true, error: message } : item
          )),
        },
      }));
      get().updateMessage(sessionKey, next.id, {
        status: 'failed',
        deliveryError: message,
        retryPayload,
      });
      get().setIsTyping(false, sessionKey);
    } finally {
      drainingQueueSessions.delete(sessionKey);
    }
  },
  retryQueuedMessage: async (sessionKey, id) => {
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [sessionKey]: (state.messageQueue[sessionKey] || []).map((item) => (
          item.id === id ? { ...item, failed: false, error: undefined } : item
        )),
      },
    }));
    await get().drainQueue(sessionKey);
  },
  clearQueue: (sessionKey) => {
    const queuedIds = new Set((get().messageQueue[sessionKey] || []).map((message) => message.id));
    set((state) => ({
      messageQueue: { ...state.messageQueue, [sessionKey]: [] },
    }));
    if (queuedIds.size === 0) return;

    const messages = getSessionMessages(get(), sessionKey);
    if (!messages.some((message) => queuedIds.has(message.id))) return;
    get().setMessages(messages.map((message) => (
      queuedIds.has(message.id) ? { ...message, status: 'cancelled' as const } : message
    )), sessionKey);
  },
  removeQueuedMessage: (sessionKey, id) => {
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [sessionKey]: (state.messageQueue[sessionKey] || []).filter((message) => message.id !== id),
      },
    }));
    get().updateMessage(sessionKey, id, { status: 'cancelled' });
  },
  updateQueuedMessage: (sessionKey, id, newText) => {
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [sessionKey]: (state.messageQueue[sessionKey] || []).map((message) => (
          message.id === id ? { ...message, text: newText } : message
        )),
      },
    }));
    const current = getSessionMessages(get(), sessionKey).find((message) => message.id === id);
    get().updateMessage(sessionKey, id, {
      content: newText,
      ...(current?.retryPayload
        ? { retryPayload: { ...current.retryPayload, text: newText } }
        : {}),
    });
  },
  queueSize: (sessionKey) => (get().messageQueue[sessionKey] || []).length,
  setIsTyping: (typing, sessionKey) =>
    set((state) => {
      const targetKey = sessionKey ?? state.activeSessionKey;
      if (isSessionDeleted(targetKey)) return state;
      return {
        typingBySession: {
          ...state.typingBySession,
          [targetKey]: typing,
        },
        ...(targetKey === state.activeSessionKey ? { isTyping: typing } : {}),
      };
    }),
  sendingBySession: {},
  setIsSending: (sending, sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    if (isSessionDeleted(targetKey)) return state;
    return {
      sendingBySession: {
        ...state.sendingBySession,
        [targetKey]: sending,
      },
    };
  }),
  loadingHistoryBySession: {},
  setIsLoadingHistory: (loading, sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    if (isSessionDeleted(targetKey)) return state;
    return {
      loadingHistoryBySession: {
        ...state.loadingHistoryBySession,
        [targetKey]: loading,
      },
    };
  }),
  historyLoader: null,
  setHistoryLoader: (fn) => set({ historyLoader: fn }),

  // ── Drafts ──
  drafts: {},
  setDraft: (key, text) => set((state) => (
    isSessionDeleted(key) ? state : { drafts: { ...state.drafts, [key]: text } }
  )),
  getDraft: (key) => get().drafts[key] || '',

  // ── Quick Replies ──
  quickReplies: [],
  quickRepliesBySession: {},
  setQuickReplies: (buttons, sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    if (isSessionDeleted(targetKey)) return state;
    return {
      quickRepliesBySession: {
        ...state.quickRepliesBySession,
        [targetKey]: buttons,
      },
      ...(targetKey === state.activeSessionKey ? { quickReplies: buttons } : {}),
    };
  }),

  // ── Thinking Stream ──
  thinkingText: '',
  thinkingRunId: null,
  thinkingBySession: {},
  setThinkingStream: (runId, text, sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    if (isSessionDeleted(targetKey)) return state;
    return {
      thinkingBySession: {
        ...state.thinkingBySession,
        [targetKey]: { runId, text },
      },
      ...(targetKey === state.activeSessionKey ? { thinkingRunId: runId, thinkingText: text } : {}),
    };
  }),
  clearThinking: (sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    return {
      thinkingBySession: {
        ...state.thinkingBySession,
        [targetKey]: { runId: null, text: '' },
      },
      ...(targetKey === state.activeSessionKey ? { thinkingText: '', thinkingRunId: null } : {}),
    };
  }),

  // ── Connection ──
  connected: false,
  connecting: false,
  connectionError: null,
  restarting: false,

  setConnectionStatus: (status) =>
    set((state) => ({
      connected: status.connected,
      connecting: status.connecting,
      connectionError: status.error || null,
      // Clear restarting once we (re)connect
      restarting: status.connected ? false : state.restarting,
    })),

  setRestarting: (v) => set({ restarting: v }),
}));
