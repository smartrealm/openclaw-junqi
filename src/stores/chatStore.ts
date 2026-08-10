import { create } from 'zustand';
import type { DecisionOption, FileRef, SessionEvent, WorkshopEvent } from '@/types/RenderBlock';
import type { RenderBlock } from '@/types/RenderBlock';
import type { ResponseGroup } from '@/types/ResponseGroup';
import { normalizeGatewayMessage } from '@/processing/normalizeGatewayMessage';
import { buildSemanticBlocks, projectSemanticBlocksToRenderBlocks } from '@/processing/buildSemanticBlocks';
import { buildResponseGroups } from '@/processing/buildResponseGroups';
import type { OpenClawChatRunStartup } from '@/processing/openClawChatEvent';
import { isOpenClawChatSendDeliveryUncertain } from '@/processing/openClawChatEvent';
import { OpenClawSessionGroupsUnsupportedError } from '@/services/gateway/OpenClawSessionGroupsClient';
import type {
  OutboundChatPayload,
  PreparedAttachment,
  QueuedChatMessage,
} from '@/services/chat/types';
import {
  MAX_SESSION_MESSAGE_QUEUE_SIZE,
  MAX_SESSION_MESSAGE_QUEUE_BYTES,
  SessionMessageQueueFullError,
  SessionMessageQueuePayloadLimitError,
  queuedChatMessageBytes,
} from '@/services/chat/types';
import { sessionMutationGate } from '@/services/chat/sessionMutationGate';
import {
  collectSessionIdentityTransitions,
  publishSessionIdentityTransitions,
} from '@/services/chat/sessionIdentityTransition';
import { useSettingsStore } from './settingsStore';
import {
  coalesceSessionsByKey,
  hasSessionIdentityChanged,
  isSessionDeleted,
  restoreSessionKey,
  withoutDeletedSessions,
} from '@/utils/sessionLifecycle';
import { preserveConfirmedEmptyTranscriptLeaf } from '@/utils/confirmedEmptyTranscript';
import type { OpenClawChatSendTiming } from '@/services/gateway/chatSendTiming';
import type { GatewayThinkingLevelOption } from '@/processing/sessionThinkingProfile';
import type { GatewaySessionAgentRuntime } from '@/services/gateway/sessionAgentRuntime';
import type { GatewaySessionAgentStatus } from '@/services/gateway/sessionAgentStatus';
import type { GatewaySessionContextBudgetStatus } from '@/processing/sessionContextBudgetStatus';
import type { GatewaySessionGoal } from '@/services/gateway/sessionGoal';
import { getChatGatewayOperations } from './chatGatewayOperations';
import type { ModelEntry } from '@/services/gateway/modelLoaders';

// ═══════════════════════════════════════════════════════════
// Chat Store — Message, Session, Tabs & Usage State
// ═══════════════════════════════════════════════════════════

const MAIN_SESSION = 'agent:main:main';
const OPEN_TABS_PREFS_KEY = 'aegis-open-tabs';
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
    // 本地偏好写入失败不应阻断当前会话操作。
  }
}

function normalizeOpenTabs(tabs: readonly string[], defaultMainSessionKey: string): string[] {
  const mainKey = defaultMainSessionKey.trim() || MAIN_SESSION;
  const seen = new Set<string>([mainKey]);
  const remaining = tabs.flatMap((candidate) => {
    const key = typeof candidate === 'string' ? candidate.trim() : '';
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [key];
  });
  return [mainKey, ...remaining];
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

function resolveSessionProjectionTopic(
  session: Pick<Session, 'key' | 'sessionId' | 'topic'>,
  messages: ChatMessage[],
  fallbackText?: string,
): string | undefined {
  return resolveSessionTopic(session.topic, messages, fallbackText);
}

const clearSessionAttentionState = (session: Session): Session => ({
  ...session,
  hasPendingCompletion: false,
});

const sessionReadWrites = new Set<string>();

function persistSessionAsRead(session: Session | undefined): void {
  if (!session || unreadCount(session.unread) === 0) return;
  if (sessionReadWrites.has(session.key)) return;
  sessionReadWrites.add(session.key);
  void getChatGatewayOperations().setSessionUnread(false, session.key).then(() => {
    useChatStore.setState((state) => ({
      sessions: updateSession(state.sessions, session.key, (item) => ({
        ...item,
        unread: 0,
        hasPendingCompletion: false,
      })),
    }));
  }).catch(() => undefined).finally(() => sessionReadWrites.delete(session.key));
}

function unreadCount(value: number | boolean | undefined): number {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value ?? 0;
}

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

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'toolResult' | 'compaction' | 'unknown';

export interface ChatMessage {
  id: string;
  /** Stable Desktop idempotency key for an optimistic user message. */
  clientMessageId?: string;
  /** OpenClaw transcript message id. Required before a collaboration can anchor here. */
  nativeMessageId?: string;
  /** Stable display projection within one native transcript record. */
  nativeProjectionId?: string;
  role: ChatMessageRole;
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
    fileName?: string;
  }>;
  /** Local delivery metadata. Never serialized into the OpenClaw transcript. */
  outboundAttachments?: Array<{ fileName?: string; mimeType: string }>;
  /** Retained only while a delivery is queued or failed so retry is lossless. */
  retryPayload?: OutboundChatPayload;
  // Tool call metadata (role === 'tool')
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  /** Original tool result value retained for non-destructive trace presentation. */
  toolOutputValue?: unknown;
  toolStatus?: 'running' | 'done' | 'error' | 'cancelled' | 'verification_required';
  toolDurationMs?: number;
  toolCallId?: string;
  /** Gateway-provided execution error, separate from the display result. */
  toolError?: string;
  /** The tool output is a bounded display projection, not necessarily complete. */
  toolOutputTruncated?: boolean;
  toolOutputOriginalLength?: number;
  /** Formal-review relation only when an upstream integration establishes it. */
  formalReviewId?: string;
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
  /** OpenClaw 计算出的只读展示名称。 */
  displayName?: string;
  /** OpenClaw 从已确认 transcript 派生的标题。 */
  derivedTitle?: string;
  /** OpenClaw 返回的最近消息预览。 */
  lastMessagePreview?: string;
  /** OpenClaw 用户定义的会话分类；`null` 表示未分组。 */
  category?: string | null;
  agentId?: string;
  createdAt?: number | string;
  topic?: string;
  lastMessage?: string;
  lastTimestamp?: string | number;
  lastActive?: string;
  updatedAt?: string | number;
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
  /** Gateway 已过滤有效期的会话 Agent 状态说明；缺失时不保留旧值。 */
  agentStatus?: GatewaySessionAgentStatus | null;
  /** Gateway 明确记录的最近一次运行已中止；缺失时不保留旧值。 */
  abortedLastRun?: true | null;
  /** Gateway 预提示估算出的上下文预算路线；客户端不得自行推导。 */
  contextBudgetStatus?: GatewaySessionContextBudgetStatus | null;
  /** Gateway 持久化的会话目标；本地 UI 投影与协作 Run 不得写入或替代它。 */
  goal?: GatewaySessionGoal | null;
  /** Gateway 记录的最近失败或超时运行摘要；缺失时不保留旧值。 */
  lastRunError?: string | null;
  /** Gateway 当前 transcript 分支 leaf；缺失表示当前客户端尚未取得该事实。 */
  activeLeafEntryId?: string | null;
  hasActiveRun?: boolean;
  hasActiveSubagentRun?: boolean;
  subagentRunState?: string;
  systemSent?: boolean;
  // 从 sessions.list 缓存的每会话模型、思考、快速模式、输出、追踪、推理和用量数据。
  model?: string | null;
  /** Gateway 明确锁定模型选择时为 true；客户端不得发起模型写入。 */
  modelSelectionLocked?: boolean;
  /** Gateway 已解析的实际 Agent Runtime；缺失时客户端不得推测。 */
  agentRuntime?: GatewaySessionAgentRuntime | null;
  thinkingLevel?: string | null;
  /** Gateway 按当前模型 profile 下发的可选思考等级；缺失时客户端不得猜测。 */
  thinkingLevels?: readonly GatewayThinkingLevelOption[] | null;
  /** Gateway 解析出的当前模型默认思考等级；仅用于说明继承结果。 */
  thinkingDefault?: string | null;
  /** OpenClaw 会话快速模式覆盖；null 表示继承运行时默认值。 */
  fastMode?: boolean | 'auto' | null;
  /** OpenClaw 会话详细工具输出覆盖；null 表示继承运行时默认值。 */
  verboseLevel?: 'on' | 'full' | 'off' | null;
  /** OpenClaw 会话插件追踪覆盖；未知字符串须保留，不能由客户端猜测替换。 */
  traceLevel?: string | null;
  /** OpenClaw 响应使用量页脚覆盖；保留兼容别名和未知字符串供控制面判定。 */
  responseUsage?: string | null;
  /** OpenClaw 会话推理可见性覆盖；null 表示继承运行时默认值。 */
  reasoningLevel?: 'on' | 'off' | 'stream' | null;
  totalTokens?: number;
  contextTokens?: number;
  compactionCount?: number;
  // Runtime state from gateway
  running?: boolean;
  // User-controlled lifecycle flags (SPEC: archive + pin)
  pinned?: boolean;
  archived?: boolean;
}

function recordsHaveEqualValues(
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}

function sessionsHaveEqualProjection(left: Session, right: Session): boolean {
  if (left === right) return true;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]) as Set<keyof Session>;
  for (const key of keys) {
    if (key === 'origin') {
      if (!recordsHaveEqualValues(left.origin, right.origin)) return false;
      continue;
    }
    if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}

export interface TokenUsage {
  contextTokens: number;
  maxTokens: number;
  percentage: number;
  compactions: number;
}

export interface SessionCompactionStatus {
  operationId: string;
  phase: 'active';
  startedAt: number;
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
  /** Advances when local session membership, identity, or selection changes. */
  sessionProjectionRevision: number;
  setSessions: (
    sessions: Session[],
    defaults?: { model: string | null; contextTokens: number | null },
    options?: { completeSnapshot?: boolean; sourceProjectionRevision?: number },
  ) => void;
  setSessionIdentity: (key: string, sessionId: string, agentId?: string) => void;
  /** 仅接受 Gateway 的历史或会话列表投影，不能由客户端推导。 */
  setSessionActiveLeafEntryId: (key: string, activeLeafEntryId: string | null | undefined) => void;
  /** Commit a session only after `sessions.create` confirms its Gateway identity. */
  addNativeSession: (session: Session) => void;
  /** Update a single session's label locally without a full sessions.list refetch. */
  setSessionLabel: (key: string, label: string) => void;
  /** `sessions.patch` 成功后在本地更新单个会话模型。 */
  setSessionModel: (key: string, model: string | null) => void;
  /** Gateway 模型回执确认 runtime 后，定向更新对应会话。 */
  setSessionAgentRuntime: (key: string, runtime: GatewaySessionAgentRuntime) => void;
  /** Update a single session's thinking level locally after sessions.patch succeeds. */
  setSessionThinking: (key: string, level: string | null) => void;
  /** sessions.patch 成功后在本地更新会话原生快速模式覆盖。 */
  setSessionFastMode: (key: string, mode: boolean | 'auto' | null) => void;
  /** sessions.patch 成功后在本地更新会话原生详细工具输出覆盖。 */
  setSessionVerbose: (key: string, level: 'on' | 'full' | 'off' | null) => void;
  /** sessions.patch 成功后在本地更新会话原生插件追踪覆盖。 */
  setSessionTrace: (key: string, level: string | null) => void;
  /** sessions.patch 成功后在本地更新会话原生响应使用量页脚覆盖。 */
  setSessionResponseUsage: (key: string, level: string | null) => void;
  /** sessions.patch 成功后在本地更新会话原生推理可见性覆盖。 */
  setSessionReasoning: (key: string, level: 'on' | 'off' | 'stream' | null) => void;
  /** 仅在原生 Gateway 确认置顶状态后更新本地投影。 */
  togglePinSession: (key: string) => Promise<void>;
  /** 仅在原生 Gateway 确认归档状态后更新本地投影。 */
  setSessionArchived: (key: string, archived: boolean) => Promise<void>;
  /** 仅在原生 Gateway 确认未读状态后更新本地投影。 */
  setSessionUnread: (key: string, unread: boolean) => Promise<void>;
  setSessionCategory: (key: string, category: string | null) => Promise<void>;
  /** 确认 Gateway 会话组目录包含名称，不持久化客户端副本。 */
  ensureSessionGroup: (name: string) => Promise<void>;
  /** Gateway-owned category catalog; never persisted or locally synthesized. */
  sessionGroupCatalog: readonly string[];
  sessionGroupCatalogAvailability: 'unknown' | 'ready' | 'unavailable';
  refreshSessionGroupCatalog: () => Promise<void>;
  setActiveSession: (key: string) => void;
  incrementSessionUnread: (key: string, amount?: number) => void;
  markSessionCompleted: (key: string) => void;
  clearSessionAttention: (key: string) => void;

  // Remove session entirely (after gateway deletion) — closes tab + removes from sessions list + clears cache
  removeSession: (key: string) => void;

  // Zero out a session's token data immediately (after reset) without waiting for next poll
  clearSessionTokens: (key: string) => void;

  // Tabs
  defaultMainSessionKey: string;
  setDefaultMainSessionKey: (key: string) => void;
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

  // 默认智能体的通用模型目录，来自官方 models.list。
  availableModels: ModelEntry[];
  setAvailableModels: (models: ModelEntry[]) => void;
  modelsLoading: boolean;
  /** 会话智能体的模型目录，仅来自官方 chat.metadata。 */
  sessionAvailableModelsByAgentId: Record<string, ModelEntry[]>;
  sessionModelsLoadingByAgentId: Record<string, boolean>;
  setSessionAvailableModels: (agentId: string, models: ModelEntry[]) => void;
  setSessionModelsLoading: (agentId: string, loading: boolean) => void;
  clearSessionAvailableModels: () => void;

  // Drafts (per-session)
  drafts: Record<string, string>;
  setDraft: (key: string, text: string) => void;
  getDraft: (key: string) => string;
  consumeComposerSnapshot: (key: string, snapshot: {
    text: string;
    attachmentIds: readonly string[];
  }) => void;

  // UI State — session activity has one source of truth.
  typingBySession: Record<string, boolean>;
  /** Started timestamps keep background activity surfaces truthful and measurable. */
  typingStartedAtBySession: Record<string, number>;
  /** OpenClaw 在首个可见活动前返回的官方运行启动阶段。 */
  chatRunStartupBySession: Record<string, OpenClawChatRunStartup>;
  setChatRunStartup: (sessionKey: string, startup: OpenClawChatRunStartup | null) => void;
  /** Read-only Gateway timing for the currently projected response, never persisted. */
  chatSendTimingBySession: Record<string, OpenClawChatSendTiming>;
  setChatSendTiming: (sessionKey: string, timing: OpenClawChatSendTiming | null) => void;
  setIsTyping: (typing: boolean, sessionKey?: string) => void;
  /** Atomically release every transient run indicator for one session. */
  settleSessionRunUi: (sessionKey?: string) => void;
  compactionStatusBySession: Record<string, SessionCompactionStatus>;
  setCompactionStatus: (sessionKey: string, status: SessionCompactionStatus | null) => void;
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

export const selectActiveSessionTyping = (state: ChatState): boolean =>
  Boolean(state.typingBySession[state.activeSessionKey]);

/** Only a Gateway-owned request can receive a native OpenClaw Stop. */
export const selectSessionRequestActive = (
  state: Pick<ChatState, 'typingBySession'>,
  sessionKey: string,
): boolean => Boolean(state.typingBySession[sessionKey]);

const EMPTY_THINKING_STATE = Object.freeze({ runId: null, text: '' });

export const selectActiveSessionThinking = (
  state: ChatState,
): { runId: string | null; text: string } =>
  state.thinkingBySession[state.activeSessionKey] ?? EMPTY_THINKING_STATE;

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

function withoutSessionKeys<T>(
  record: Record<string, T>,
  sessionKeys: ReadonlySet<string>,
): Record<string, T> {
  if (sessionKeys.size === 0) return record;
  return Object.fromEntries(
    Object.entries(record).filter(([sessionKey]) => !sessionKeys.has(sessionKey)),
  );
}

/**
 * Transcript-scoped state must never survive an OpenClaw sessionId rotation.
 * Logical conversation preferences (tabs, pin, label, draft and unsent
 * attachments) intentionally remain keyed by sessionKey.
 */
function clearTranscriptStateForIdentityChanges(
  state: ChatState,
  sessionKeys: ReadonlySet<string>,
): Partial<ChatState> {
  if (sessionKeys.size === 0) return {};
  const activeChanged = sessionKeys.has(state.activeSessionKey);
  return {
    messagesPerSession: withoutSessionKeys(state.messagesPerSession, sessionKeys),
    _blocksCache: withoutSessionKeys(state._blocksCache, sessionKeys),
    _groupsCache: withoutSessionKeys(state._groupsCache, sessionKeys),
    typingBySession: withoutSessionKeys(state.typingBySession, sessionKeys),
    compactionStatusBySession: withoutSessionKeys(state.compactionStatusBySession, sessionKeys),
    typingStartedAtBySession: withoutSessionKeys(state.typingStartedAtBySession, sessionKeys),
    chatRunStartupBySession: withoutSessionKeys(state.chatRunStartupBySession, sessionKeys),
    chatSendTimingBySession: withoutSessionKeys(state.chatSendTimingBySession, sessionKeys),
    quickRepliesBySession: withoutSessionKeys(state.quickRepliesBySession, sessionKeys),
    thinkingBySession: withoutSessionKeys(state.thinkingBySession, sessionKeys),
    sendingBySession: withoutSessionKeys(state.sendingBySession, sessionKeys),
    loadingHistoryBySession: withoutSessionKeys(state.loadingHistoryBySession, sessionKeys),
    messageQueue: withoutSessionKeys(state.messageQueue, sessionKeys),
    ...(activeChanged
      ? {
          messages: [],
          renderBlocks: [],
          responseGroups: [],
          quickReplies: [],
          manualModelOverride: null,
        }
      : {}),
  };
}

const coalesceMessagesById = (messages: ChatMessage[]): ChatMessage[] => {
  const indexById = new Map<string, number>();
  const result: ChatMessage[] = [];
  for (const message of messages) {
    const existingIndex = indexById.get(message.id);
    if (existingIndex === undefined) {
      indexById.set(message.id, result.length);
      result.push(message);
      continue;
    }

    const existing = result[existingIndex];
    const existingIsLive = existing.isStreaming === true || existing.responseState === 'streaming';
    const incomingIsLive = message.isStreaming === true || message.responseState === 'streaming';
    // A terminal projection is authoritative over a delayed live copy. For
    // equal lifecycle states, the later snapshot carries the newest fields.
    if (!existingIsLive && incomingIsLive) continue;
    result[existingIndex] = { ...existing, ...message };
  }
  return result;
};

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
    toolOutputValue: msg.toolOutputValue,
    toolStatus: msg.toolStatus,
    toolDurationMs: msg.toolDurationMs,
    toolCallId: msg.toolCallId,
    toolError: msg.toolError,
    toolOutputTruncated: msg.toolOutputTruncated,
    toolOutputOriginalLength: msg.toolOutputOriginalLength,
    formalReviewId: msg.formalReviewId,
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

const buildCanonicalSemanticBlocksForMessage = (message: ChatMessage, sessionKey: string) => {
  const [raw] = createRawHistoryPayload([message], sessionKey);
  const settings = useSettingsStore.getState();
  const chat = useChatStore.getState();
  return buildSemanticBlocks(normalizeGatewayMessage(raw), {
    toolIntentEnabled: settings.toolIntentEnabled,
    tokenUsage: chat.tokenUsage,
    currentModel: chat.currentModel,
  });
};

const buildCanonicalSemanticBlocks = (messages: ChatMessage[], sessionKey: string) =>
  messages.flatMap((message) => buildCanonicalSemanticBlocksForMessage(message, sessionKey));

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

/**
 * OpenClaw emits cumulative snapshots for the active response. When that
 * response is already the final message and final response group, preserve the
 * immutable history projection and rebuild only the affected tail. Any
 * identity or cache mismatch falls back to the canonical full projection.
 */
const recomputeStreamingTail = (
  state: ChatState,
  messages: ChatMessage[],
  sessionKey: string,
  messageId: string,
): { blocks: RenderBlock[]; groups: ResponseGroup[] } | null => {
  const previousMessages = getSessionMessages(state, sessionKey);
  const previousGroups = state._groupsCache[sessionKey];
  const previousBlocks = state._blocksCache[sessionKey];
  const previousMessage = previousMessages[previousMessages.length - 1];
  const nextMessage = messages[messages.length - 1];
  const lastGroup = previousGroups?.[previousGroups.length - 1];

  if (
    !previousGroups
    || !previousBlocks
    || previousMessages.length !== messages.length
    || previousMessage?.id !== messageId
    || nextMessage?.id !== messageId
    || !lastGroup
    || !lastGroup.sourceMessageIds.includes(messageId)
  ) return null;

  const firstTargetBlockIndex = lastGroup.blocks.findIndex((block) => block.sourceMessageId === messageId);
  if (firstTargetBlockIndex < 0) return null;
  if (lastGroup.blocks.slice(firstTargetBlockIndex).some((block) => block.sourceMessageId !== messageId)) {
    return null;
  }

  const nextMessageBlocks = buildCanonicalSemanticBlocksForMessage(nextMessage, sessionKey);
  const rebuiltTailGroups = buildResponseGroups([
    ...lastGroup.blocks.slice(0, firstTargetBlockIndex),
    ...nextMessageBlocks,
  ]);
  if (rebuiltTailGroups.length !== 1 || rebuiltTailGroups[0].id !== lastGroup.id) return null;

  const previousTailBlocks = projectSemanticBlocksToRenderBlocks(lastGroup.blocks);
  if (previousTailBlocks.length > previousBlocks.length) return null;
  const cachedTailBlocks = previousBlocks.slice(previousBlocks.length - previousTailBlocks.length);
  if (cachedTailBlocks.some((block, index) => (
    block.id !== previousTailBlocks[index]?.id || block.type !== previousTailBlocks[index]?.type
  ))) return null;

  const nextTailGroup = rebuiltTailGroups[0];
  return {
    groups: [...previousGroups.slice(0, -1), nextTailGroup],
    blocks: [
      ...previousBlocks.slice(0, previousBlocks.length - previousTailBlocks.length),
      ...projectSemanticBlocksToRenderBlocks(nextTailGroup.blocks),
    ],
  };
};

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
    ...(isActive ? { messages, renderBlocks: derived.blocks, responseGroups: derived.groups } : {}),
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
          topic: resolveSessionProjectionTopic(session, updated, session.lastMessage),
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

      const derived = existingIdx >= 0
        ? recomputeStreamingTail(state, updated, targetKey, id) ?? recomputeDerived(updated, targetKey)
        : recomputeDerived(updated, targetKey);
      const isActive = targetKey === state.activeSessionKey;
      const wasTyping = state.typingBySession[targetKey] === true;
      return {
        typingBySession: {
          ...state.typingBySession,
          [targetKey]: true,
        },
        typingStartedAtBySession: wasTyping
          ? state.typingStartedAtBySession
          : { ...state.typingStartedAtBySession, [targetKey]: Date.now() },
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
      const finalHasRenderablePayload = Boolean(
        finalContent.trim()
        || thinkingContent
        || extra?.mediaUrl
        || extra?.fileRefs?.length
        || extra?.decisionOptions?.length
        || extra?.workshopEvents?.length
        || extra?.sessionEvents?.length,
      );

      if (existingIdx >= 0) {
        const existing = currentMessages[existingIdx];
        if (existing.role === 'assistant' && !finalHasRenderablePayload) {
          const updated = currentMessages.filter((message) => message.id !== id);
          return projectSessionMessages(state, targetKey, updated, { clearThinking: true });
        }
        const updated = [...currentMessages];

        updated[existingIdx] = {
          ...updated[existingIdx],
          // The caller has already selected the canonical terminal snapshot or
          // its protocol-defined fallback. An empty value is therefore final.
          content: finalContent,
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
              }
            : {}),
        };
      }
      // Message not found — this happens when post-tool-call text arrives
      // with a new runId that had no preceding delta events. Create a new message.
      if (finalHasRenderablePayload) {
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
              }
            : {}),
        };
      }
      return {
        thinkingBySession: {
          ...state.thinkingBySession,
          [targetKey]: { runId: null, text: '' },
        },
      };
    });
  },

  setMessages: (msgs, sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    if (isSessionDeleted(targetKey)) return state;
    const canonicalMessages = coalesceMessagesById(msgs);
    const derived = recomputeDerived(canonicalMessages, targetKey);
    const isActive = targetKey === state.activeSessionKey;
    return {
      sessions: updateSession(state.sessions, targetKey, (session) => ({
        ...session,
        topic: resolveSessionProjectionTopic(session, canonicalMessages, session.lastMessage),
      })),
      ...(isActive ? { messages: canonicalMessages, renderBlocks: derived.blocks, responseGroups: derived.groups } : {}),
      messagesPerSession: {
        ...state.messagesPerSession,
        [targetKey]: canonicalMessages,
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
      typingStartedAtBySession: Object.fromEntries(
        Object.entries(state.typingStartedAtBySession).filter(([key]) => key !== targetKey),
      ),
      chatRunStartupBySession: Object.fromEntries(
        Object.entries(state.chatRunStartupBySession).filter(([key]) => key !== targetKey),
      ),
      chatSendTimingBySession: Object.fromEntries(
        Object.entries(state.chatSendTimingBySession).filter(([key]) => key !== targetKey),
      ),
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
            quickReplies: [],
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
    const canonicalMessages = coalesceMessagesById(msgs);
    const derived = recomputeDerived(canonicalMessages, key);
    return {
      sessions: updateSession(state.sessions, key, (session) => ({
        ...session,
        topic: resolveSessionProjectionTopic(session, canonicalMessages, session.lastMessage),
      })),
      messagesPerSession: { ...state.messagesPerSession, [key]: canonicalMessages },
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
      typingStartedAtBySession: Object.fromEntries(
        Object.entries(state.typingStartedAtBySession).filter(([sessionKey]) => sessionKey !== key),
      ),
      chatRunStartupBySession: Object.fromEntries(
        Object.entries(state.chatRunStartupBySession).filter(([sessionKey]) => sessionKey !== key),
      ),
      chatSendTimingBySession: Object.fromEntries(
        Object.entries(state.chatSendTimingBySession).filter(([sessionKey]) => sessionKey !== key),
      ),
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
            quickReplies: [],
          }
        : {}),
    };
  }),

  // ── Sessions ──
  sessions: [{ key: MAIN_SESSION, label: 'Main Session' }],
  activeSessionKey: MAIN_SESSION,
  sessionProjectionRevision: 0,

  setSessions: (sessions, defaults, options) => {
    const stateBeforeMerge = get();
    const {
      activeSessionKey,
      manualModelOverride,
      sessionDefaults: prev,
      sessions: previousSessions,
      messagesPerSession,
      sessionProjectionRevision,
    } = stateBeforeMerge;
    const defs = defaults ?? prev;
    const visibleIncomingSessions = coalesceSessionsByKey(withoutDeletedSessions(sessions));
    const previousByKey = new Map(previousSessions.map((session) => [session.key, session]));
    const isSourceProjectionCurrent = options?.sourceProjectionRevision === undefined
      || options.sourceProjectionRevision === sessionProjectionRevision;
    // An old list may still improve display metadata, but it must not rotate a
    // session back to an identity that was already replaced locally.
    const lifecycleSafeIncomingSessions = isSourceProjectionCurrent
      ? visibleIncomingSessions
      : visibleIncomingSessions.map((session) => {
          const previous = previousByKey.get(session.key);
          if (!previous?.sessionId || !session.sessionId || previous.sessionId === session.sessionId) {
            return session;
          }
          return { ...session, sessionId: previous.sessionId };
        });
    const identityTransitions = collectSessionIdentityTransitions(
      previousSessions,
      lifecycleSafeIncomingSessions,
    );
    const changedIdentityKeys = new Set(identityTransitions.map((transition) => transition.sessionKey));
    const transcriptReset = clearTranscriptStateForIdentityChanges(stateBeforeMerge, changedIdentityKeys);
    const retainedMessageCache = transcriptReset.messagesPerSession ?? messagesPerSession;
    const incomingKeys = new Set(lifecycleSafeIncomingSessions.map((session) => session.key));
    const mergedSessions = lifecycleSafeIncomingSessions.map((session) => {
      const previous = previousByKey.get(session.key);
      const hasCachedMessages = Object.prototype.hasOwnProperty.call(retainedMessageCache, session.key);
      const cachedMessages = hasCachedMessages ? retainedMessageCache[session.key] ?? [] : [];
      const hydratedTopic = changedIdentityKeys.has(session.key) ? undefined : previous?.topic;
      const merged: Session = {
        ...session,
        // OpenClaw 的 `sessions.list` 响应是标签的权威来源。
        // 用户修改只在 `sessions.patch` 确认后写入本地，因此不保留客户端影子字段。
        label: typeof session.label === 'string' ? session.label : '',
        pinned: session.pinned,
        archived: session.archived,
        topic: hasCachedMessages
          ? resolveSessionProjectionTopic({ ...session, topic: hydratedTopic }, cachedMessages, session.lastMessage)
          : resolveSessionProjectionTopic({ ...session, topic: hydratedTopic }, [], session.lastMessage),
        unread: unreadCount(session.unread),
        hasPendingCompletion: changedIdentityKeys.has(session.key)
          ? session.hasPendingCompletion ?? false
          : previous?.hasPendingCompletion ?? session.hasPendingCompletion ?? false,
      };
      const withConfirmedEmptyLeaf = preserveConfirmedEmptyTranscriptLeaf(previous, merged);
      const projected = session.key === activeSessionKey
        ? clearSessionAttentionState(withConfirmedEmptyLeaf)
        : withConfirmedEmptyLeaf;
      return previous && sessionsHaveEqualProjection(previous, projected)
        ? previous
        : projected;
    });
    // The snapshot is allowed to prune only when no local selection or
    // lifecycle transition happened after its request started. Without this
    // fence, a late complete response can erase a confirmed new session and
    // make removeSession fall back to a historical tab.
    const canPruneMissingSessions = options?.completeSnapshot !== false && isSourceProjectionCurrent;
    const retainedPreviousSessions = previousSessions.filter((session) => (
      !incomingKeys.has(session.key) && !canPruneMissingSessions
    ));
    const nextSessions = [...mergedSessions, ...retainedPreviousSessions];
    const hasAuthoritativeMainSession = lifecycleSafeIncomingSessions
      .some((session) => session.key === stateBeforeMerge.defaultMainSessionKey);
    const removedCanonicalSessionKeys = canPruneMissingSessions && hasAuthoritativeMainSession
      ? previousSessions.flatMap((session) => {
          if (incomingKeys.has(session.key) || session.key === stateBeforeMerge.defaultMainSessionKey) return [];
          return [session.key];
        })
      : [];
    const active = nextSessions.find((s) => s.key === activeSessionKey);
    if (active) persistSessionAsRead(active);
    const titleBar = titleBarStateFromSession(active, defs);
    set({
      ...transcriptReset,
      sessions: nextSessions,
      ...(defaults ? { sessionDefaults: defs } : {}),
      currentThinking: titleBar.currentThinking,
      tokenUsage: titleBar.tokenUsage,
      // Only update currentModel if there is no manual override in effect.
      ...(manualModelOverride && !changedIdentityKeys.has(activeSessionKey)
        ? {}
        : { currentModel: titleBar.currentModel }),
    });
    publishSessionIdentityTransitions(identityTransitions);
    removedCanonicalSessionKeys.forEach((key) => get().removeSession(key));
  },

  setSessionIdentity: (key, sessionId, agentId) => {
    const previousSessionId = get().sessions.find((session) => session.key === key)?.sessionId;
    const changed = hasSessionIdentityChanged(previousSessionId, sessionId);
    set((state) => ({
      ...(changed ? clearTranscriptStateForIdentityChanges(state, new Set([key])) : {}),
      sessions: upsertSession(state.sessions, key, (session) => ({
        ...session,
        sessionId,
        ...(agentId ? { agentId } : {}),
        ...(changed ? {
          topic: undefined,
          unread: 0,
          hasPendingCompletion: false,
          pinned: undefined,
          archived: undefined,
          category: null,
          activeLeafEntryId: undefined,
        } : {}),
      })),
      ...(changed ? { sessionProjectionRevision: state.sessionProjectionRevision + 1 } : {}),
    }));
    if (changed) {
      publishSessionIdentityTransitions([{
        sessionKey: key,
        previousSessionId: previousSessionId!.trim(),
        nextSessionId: sessionId.trim(),
      }]);
    }
  },

  setSessionActiveLeafEntryId: (key, activeLeafEntryId) => set((state) => {
    if (isSessionDeleted(key)) return state;
    return {
      sessions: updateSession(state.sessions, key, (session) => (
        session.activeLeafEntryId === activeLeafEntryId
          ? session
          : { ...session, activeLeafEntryId }
      )),
    };
  }),

  setActiveSession: (key) => {
    if (isSessionDeleted(key)) return;
    const state = get();
    const activeSession = state.sessions.find((session) => session.key === key);
    persistSessionAsRead(activeSession);
    const msgs = state.messagesPerSession[key] || [];
    const blocks = state._blocksCache[key];
    const groups = state._groupsCache[key];
    const clearedSessions = updateSession(state.sessions, key, clearSessionAttentionState);
    const session = clearedSessions.find((s) => s.key === key) ?? state.sessions.find((s) => s.key === key);
    const titleBar = titleBarStateFromSession(session, state.sessionDefaults);
    const openTabs = normalizeOpenTabs(
      state.openTabs.includes(key) ? state.openTabs : [...state.openTabs, key],
      state.defaultMainSessionKey,
    );
    persistOpenTabs(openTabs);
    set({
      sessions: clearedSessions,
      openTabs,
      activeSessionKey: key,
      ...(state.activeSessionKey === key ? {} : {
        sessionProjectionRevision: state.sessionProjectionRevision + 1,
      }),
      messages: msgs,
      renderBlocks: blocks ?? recomputeBlocks(msgs, key),
      responseGroups: groups ?? recomputeGroups(msgs, key),
      quickReplies: state.quickRepliesBySession[key] || [],
      ...titleBar,
    });
  },

  incrementSessionUnread: (key, amount = 1) => set((state) => {
    if (key === state.activeSessionKey) {
      const session = state.sessions.find((candidate) => candidate.key === key);
      if (session) persistSessionAsRead(session);
      return { sessions: updateSession(state.sessions, key, clearSessionAttentionState) };
    }
    return {
      sessions: updateSession(state.sessions, key, (session) => ({
        ...session,
        unread: Math.max(0, unreadCount(session.unread) + amount),
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

  clearSessionAttention: (key) => set((state) => {
    const session = state.sessions.find((candidate) => candidate.key === key);
    if (session) persistSessionAsRead(session);
    return { sessions: updateSession(state.sessions, key, clearSessionAttentionState) };
  }),

  /** 提交 Gateway 已确认的会话，并将其设为当前桌面页签。 */
  addNativeSession: (session) => {
    restoreSessionKey(session.key);
    set((state) => {
      const existingSession = state.sessions.find((candidate) => candidate.key === session.key);
      const confirmedSession = existingSession
        ? { ...existingSession, ...session }
        : session;
      const openTabs = normalizeOpenTabs(
        state.openTabs.includes(session.key) ? state.openTabs : [...state.openTabs, session.key],
        state.defaultMainSessionKey,
      );
      persistOpenTabs(openTabs);
      const msgs = state.messagesPerSession[session.key] || [];
      const blocks = state._blocksCache[session.key];
      const groups = state._groupsCache[session.key];
      const titleBar = titleBarStateFromSession(confirmedSession, state.sessionDefaults);
      const activeState = {
        openTabs,
        activeSessionKey: session.key,
        sessionProjectionRevision: state.sessionProjectionRevision + 1,
        messages: msgs,
        renderBlocks: blocks ?? recomputeBlocks(msgs, session.key),
        responseGroups: groups ?? recomputeGroups(msgs, session.key),
        quickReplies: state.quickRepliesBySession[session.key] || [],
        ...titleBar,
      };
      return {
        ...activeState,
        sessions: existingSession
          ? state.sessions.map((candidate) => (
              candidate.key === session.key ? confirmedSession : candidate
            ))
          : [...state.sessions, confirmedSession],
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

  /** 不等待 `sessions.list`，在本地应用已确认的模型切换。 */
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

  /** 仅应用 `sessions.patch.resolved` 已确认的 Agent Runtime。 */
  setSessionAgentRuntime: (key, runtime) => set((state) => (
    isSessionDeleted(key) || !state.sessions.some((session) => session.key === key)
      ? state
      : {
          sessions: state.sessions.map((session) => (
            session.key !== key || session.agentRuntime?.id === runtime.id
              ? session
              : { ...session, agentRuntime: runtime }
          )),
        }
  )),

  /** Locally apply a thinking-level switch without waiting for sessions.list. */
  setSessionThinking: (key, level) => set((state) => (
    isSessionDeleted(key)
      ? state
      : {
          sessions: upsertSession(state.sessions, key, (session) =>
            session.thinkingLevel === level ? session : { ...session, thinkingLevel: level },
          ),
          ...(state.activeSessionKey === key ? { currentThinking: level } : {}),
        }
  )),

  /** 不等待 sessions.list，在本地应用已确认的原生快速模式覆盖。 */
  setSessionFastMode: (key, mode) => set((state) => (
    isSessionDeleted(key)
      ? state
      : {
          sessions: upsertSession(state.sessions, key, (session) =>
            session.fastMode === mode ? session : { ...session, fastMode: mode },
          ),
        }
  )),

  /** 不等待 sessions.list，在本地应用已确认的原生详细工具输出覆盖。 */
  setSessionVerbose: (key, level) => set((state) => (
    isSessionDeleted(key)
      ? state
      : {
          sessions: upsertSession(state.sessions, key, (session) =>
            session.verboseLevel === level ? session : { ...session, verboseLevel: level },
          ),
        }
  )),

  /** 不等待 sessions.list，在本地应用已确认的原生插件追踪覆盖。 */
  setSessionTrace: (key, level) => set((state) => (
    isSessionDeleted(key)
      ? state
      : {
          sessions: upsertSession(state.sessions, key, (session) =>
            session.traceLevel === level ? session : { ...session, traceLevel: level },
          ),
        }
  )),

  /** 不等待 sessions.list，在本地应用已确认的原生响应使用量页脚覆盖。 */
  setSessionResponseUsage: (key, level) => set((state) => (
    isSessionDeleted(key)
      ? state
      : {
          sessions: upsertSession(state.sessions, key, (session) =>
            session.responseUsage === level ? session : { ...session, responseUsage: level },
          ),
        }
  )),

  /** 不等待 sessions.list，在本地应用已确认的原生推理可见性覆盖。 */
  setSessionReasoning: (key, level) => set((state) => (
    isSessionDeleted(key)
      ? state
      : {
          sessions: upsertSession(state.sessions, key, (session) =>
            session.reasoningLevel === level ? session : { ...session, reasoningLevel: level },
          ),
        }
  )),

  togglePinSession: async (key) => {
    const session = get().sessions.find((candidate) => candidate.key === key);
    if (!session) return;
    const pinned = !session.pinned;
    await getChatGatewayOperations().setSessionPinned(pinned, key);
    set((state) => ({ sessions: updateSession(state.sessions, key, (item) => ({ ...item, pinned })) }));
  },

  setSessionArchived: async (key, archived) => {
    const session = get().sessions.find((candidate) => candidate.key === key);
    if (!session) return;
    await getChatGatewayOperations().setSessionArchived(archived, key);
    set((state) => ({ sessions: updateSession(state.sessions, key, (item) => ({ ...item, archived })) }));
  },

  setSessionUnread: async (key, unread) => {
    const session = get().sessions.find((candidate) => candidate.key === key);
    if (!session) return;
    await getChatGatewayOperations().setSessionUnread(unread, key);
    set((state) => ({
      sessions: updateSession(state.sessions, key, (item) => ({
        ...item,
        unread: unread ? Math.max(1, unreadCount(item.unread)) : 0,
        hasPendingCompletion: false,
      })),
    }));
  },

  setSessionCategory: async (key, category) => {
    const session = get().sessions.find((candidate) => candidate.key === key);
    if (!session) return;
    const confirmedCategory = await getChatGatewayOperations().setSessionCategory(category, key);
    set((state) => ({
      sessions: updateSession(state.sessions, key, (item) => ({
        ...item,
        ...(confirmedCategory
          ? { category: confirmedCategory }
          : { category: null }),
      })),
    }));
  },
  ensureSessionGroup: async (name) => {
    const groups = await getChatGatewayOperations().ensureSessionGroup(name);
    set({
      sessionGroupCatalog: groups.map((group) => group.name),
      sessionGroupCatalogAvailability: 'ready',
    });
  },
  sessionGroupCatalog: [],
  sessionGroupCatalogAvailability: 'unknown',
  refreshSessionGroupCatalog: async () => {
    if (get().sessionGroupCatalogAvailability === 'unavailable') return;
    try {
      const groups = await getChatGatewayOperations().listSessionGroups();
      set({
        sessionGroupCatalog: groups.map((group) => group.name),
        sessionGroupCatalogAvailability: 'ready',
      });
    } catch (error) {
      if (error instanceof OpenClawSessionGroupsUnsupportedError) {
        set({ sessionGroupCatalog: [], sessionGroupCatalogAvailability: 'unavailable' });
        return;
      }
      throw error;
    }
  },

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

  // ── 会话页签 ──
  defaultMainSessionKey: MAIN_SESSION,
  setDefaultMainSessionKey: (key) => set((state) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) return state;
    const openTabs = normalizeOpenTabs(state.openTabs, normalizedKey);
    persistOpenTabs(openTabs);
    return {
      defaultMainSessionKey: normalizedKey,
      openTabs,
    };
  }),
  openTabs: (() => {
    try {
      const raw = localStorage.getItem(OPEN_TABS_PREFS_KEY);
      if (!raw) return [MAIN_SESSION];
      const arr: string[] = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length === 0) return [MAIN_SESSION];
      const valid = arr.filter((k) => typeof k === 'string' && k.trim());
      if (valid.length === 0) return [MAIN_SESSION];
      return normalizeOpenTabs(valid, MAIN_SESSION);
    } catch { return [MAIN_SESSION]; }
  })(),

  openTab: (key) => set((state) => {
    if (isSessionDeleted(key)) return state;
    const clearedSessions = updateSession(state.sessions, key, clearSessionAttentionState);
    const session = clearedSessions.find((s) => s.key === key) ?? state.sessions.find((s) => s.key === key);
    persistSessionAsRead(session);
    const titleBar = titleBarStateFromSession(session, state.sessionDefaults);
    if (state.openTabs.includes(key)) {
      const cached = state.messagesPerSession[key] || [];
      const blocks = state._blocksCache[key];
      const groups = state._groupsCache[key];
      return {
        sessions: clearedSessions,
        activeSessionKey: key,
        ...(state.activeSessionKey === key ? {} : {
          sessionProjectionRevision: state.sessionProjectionRevision + 1,
        }),
        messages: cached,
        renderBlocks: blocks ?? recomputeBlocks(cached, key),
        responseGroups: groups ?? recomputeGroups(cached, key),
        quickReplies: state.quickRepliesBySession[key] || [],
        ...titleBar,
      };
    }
    const msgs = state.messagesPerSession[key] || [];
    const blocks = state._blocksCache[key];
    const groups = state._groupsCache[key];
    const newTabs = normalizeOpenTabs([...state.openTabs, key], state.defaultMainSessionKey);
    persistOpenTabs(newTabs);
    return {
      sessions: clearedSessions,
      openTabs: newTabs,
      activeSessionKey: key,
      ...(state.activeSessionKey === key ? {} : {
        sessionProjectionRevision: state.sessionProjectionRevision + 1,
      }),
      messages: msgs,
      renderBlocks: blocks ?? recomputeBlocks(msgs, key),
      responseGroups: groups ?? recomputeGroups(msgs, key),
      quickReplies: state.quickRepliesBySession[key] || [],
      ...titleBar,
    };
  }),

  closeTab: (key) => set((state) => {
    if (key === state.defaultMainSessionKey) return state;
    const newTabs = normalizeOpenTabs(
      state.openTabs.filter((tabKey) => tabKey !== key),
      state.defaultMainSessionKey,
    );
    persistOpenTabs(newTabs);
    const newActive = state.activeSessionKey === key
      ? newTabs[newTabs.length - 1]
      : state.activeSessionKey;
    const clearedSessions = updateSession(state.sessions, newActive, clearSessionAttentionState);
    const msgs = state.messagesPerSession[newActive] || [];
    const blocks = state._blocksCache[newActive];
    const groups = state._groupsCache[newActive];
    const session = clearedSessions.find((s) => s.key === newActive) ?? state.sessions.find((s) => s.key === newActive);
    persistSessionAsRead(session);
    const titleBar = titleBarStateFromSession(session, state.sessionDefaults);
    return {
      sessions: clearedSessions,
      openTabs: newTabs,
      activeSessionKey: newActive,
      ...(newActive === state.activeSessionKey ? {} : {
        sessionProjectionRevision: state.sessionProjectionRevision + 1,
      }),
      messages: msgs,
      renderBlocks: blocks ?? recomputeBlocks(msgs, newActive),
      responseGroups: groups ?? recomputeGroups(msgs, newActive),
      quickReplies: state.quickRepliesBySession[newActive] || [],
      ...titleBar,
    };
  }),

  reorderTabs: (keys) => set((state) => {
    const openTabs = normalizeOpenTabs(keys, state.defaultMainSessionKey);
    persistOpenTabs(openTabs);
    return { openTabs };
  }),

  removeSession: (key) => set((state) => {
    if (key === state.defaultMainSessionKey) return state;
    const newTabs = normalizeOpenTabs(
      state.openTabs.filter((tabKey) => tabKey !== key),
      state.defaultMainSessionKey,
    );
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
    const { [key]: _typingStartedAt, ...restTypingStartedAt } = state.typingStartedAtBySession;
    const { [key]: _startupRm, ...restChatRunStartup } = state.chatRunStartupBySession;
    const { [key]: _timingRm, ...restChatSendTiming } = state.chatSendTimingBySession;
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
    persistSessionAsRead(session);
    const titleBar = titleBarStateFromSession(session, state.sessionDefaults);
    return {
      openTabs: newTabs,
      activeSessionKey: newActive,
      sessionProjectionRevision: state.sessionProjectionRevision + 1,
      sessions: newSessions,
      messagesPerSession: restMessages,
      _blocksCache: restBlocks,
      _groupsCache: restGroupsCache,
      typingBySession: restTyping,
      typingStartedAtBySession: restTypingStartedAt,
      chatRunStartupBySession: restChatRunStartup,
      chatSendTimingBySession: restChatSendTiming,
      quickRepliesBySession: restQuickReplies,
      thinkingBySession: restThinking,
      drafts: restDrafts,
      messageQueue: restMessageQueue,
      draftAttachments: restDraftAttachments,
      preparedAttachments: restPreparedAttachments,
      sendingBySession: restSendingBySession,
      loadingHistoryBySession: restLoadingHistoryBySession,
      quickReplies: restQuickReplies[newActive] || [],
      messages: msgs,
      renderBlocks: blocks ?? recomputeBlocks(msgs, newActive),
      responseGroups: groups ?? recomputeGroups(msgs, newActive),
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
  sessionAvailableModelsByAgentId: {},
  sessionModelsLoadingByAgentId: {},
  setSessionAvailableModels: (agentId, models) => set((state) => {
    const key = agentId.trim();
    if (!key) return state;
    return {
      sessionAvailableModelsByAgentId: {
        ...state.sessionAvailableModelsByAgentId,
        [key]: models,
      },
      sessionModelsLoadingByAgentId: {
        ...state.sessionModelsLoadingByAgentId,
        [key]: false,
      },
    };
  }),
  setSessionModelsLoading: (agentId, loading) => set((state) => {
    const key = agentId.trim();
    if (!key) return state;
    return {
      sessionModelsLoadingByAgentId: {
        ...state.sessionModelsLoadingByAgentId,
        [key]: loading,
      },
    };
  }),
  clearSessionAvailableModels: () => set({
    sessionAvailableModelsByAgentId: {},
    sessionModelsLoadingByAgentId: {},
  }),

  // ── UI State ──
  typingBySession: {},
  typingStartedAtBySession: {},
  chatRunStartupBySession: {},
  setChatRunStartup: (sessionKey, startup) => set((state) => {
    const targetKey = sessionKey.trim();
    if (!targetKey || isSessionDeleted(targetKey)) return state;
    const next = { ...state.chatRunStartupBySession };
    if (!startup) {
      delete next[targetKey];
      return { chatRunStartupBySession: next };
    }
    if (!state.typingBySession[targetKey]) return state;
    next[targetKey] = startup;
    return { chatRunStartupBySession: next };
  }),
  chatSendTimingBySession: {},
  setChatSendTiming: (sessionKey, timing) => set((state) => {
    const targetKey = sessionKey.trim();
    if (!targetKey || isSessionDeleted(targetKey)) return state;
    const next = { ...state.chatSendTimingBySession };
    if (!timing) {
      delete next[targetKey];
      return { chatSendTimingBySession: next };
    }
    if (!state.typingBySession[targetKey]) return state;
    next[targetKey] = timing;
    return { chatSendTimingBySession: next };
  }),
  compactionStatusBySession: {},
  setCompactionStatus: (sessionKey, status) => set((state) => {
    const normalizedKey = sessionKey.trim();
    if (!normalizedKey || isSessionDeleted(normalizedKey)) return state;
    const next = { ...state.compactionStatusBySession };
    if (status) next[normalizedKey] = status;
    else delete next[normalizedKey];
    return { compactionStatusBySession: next };
  }),
  messageQueue: {},
  enqueueMessage: (sessionKey, message) => set((state) => {
    const queue = state.messageQueue[sessionKey] || [];
    if (queue.length >= MAX_SESSION_MESSAGE_QUEUE_SIZE) {
      throw new SessionMessageQueueFullError();
    }
    const payloadBytes = queue.reduce((total, item) => total + queuedChatMessageBytes(item), 0)
      + queuedChatMessageBytes(message);
    if (payloadBytes > MAX_SESSION_MESSAGE_QUEUE_BYTES) {
      throw new SessionMessageQueuePayloadLimitError();
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

    // Claim the renderer-owned item before any await. A local clear/edit action
    // can only affect items that have not crossed this handoff boundary.
    set((state) => {
      const queue = state.messageQueue[sessionKey] || [];
      if (queue[0]?.id !== next.id) return state;
      return {
        messageQueue: {
          ...state.messageQueue,
          [sessionKey]: queue.slice(1),
        },
      };
    });
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
      const result = await getChatGatewayOperations().sendMessage(next.text, next.attachments, sessionKey, {
        clientMessageId: next.id,
        sessionId: next.sessionId,
      }) as { queued?: boolean } | undefined;
      const deliveryUncertain = isOpenClawChatSendDeliveryUncertain(result);
      get().updateMessage(sessionKey, next.id, deliveryUncertain
        ? { status: 'pending', deliveryError: undefined, retryPayload }
        : {
            status: result?.queued ? 'queued' : 'sent',
            deliveryError: undefined,
            retryPayload: result?.queued ? retryPayload : undefined,
          });
      if (result?.queued) get().setIsTyping(false, sessionKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Message delivery failed');
      set((state) => ({
        ...(isSessionDeleted(sessionKey) ? {} : {
          messageQueue: {
            ...state.messageQueue,
            [sessionKey]: [{ ...next, failed: true, error: message }, ...(state.messageQueue[sessionKey] || [])],
          },
        }),
      }));
      get().updateMessage(sessionKey, next.id, {
        status: 'failed',
        deliveryError: message,
        retryPayload,
      });
      get().setIsTyping(false, sessionKey);
    } finally {
      drainingQueueSessions.delete(sessionKey);
      // A cached terminal chat.send acknowledgement can settle typing before
      // this drain releases its re-entry guard. Re-arm the queue pump after
      // the guard is gone so the next item is not stranded waiting for a
      // transition that already happened.
      queueMicrotask(() => {
        const state = get();
        const queued = state.messageQueue[sessionKey]?.[0];
        if (
          queued
          && !queued.failed
          && state.connected
          && !state.typingBySession[sessionKey]
          && !sessionMutationGate.isBlocked(sessionKey)
          && !isSessionDeleted(sessionKey)
        ) {
          void state.drainQueue(sessionKey).catch(() => undefined);
        }
      });
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
      queuedIds.has(message.id)
        ? { ...message, status: 'cancelled' as const, retryPayload: undefined }
        : message
    )), sessionKey);
  },
  removeQueuedMessage: (sessionKey, id) => {
    set((state) => ({
      messageQueue: {
        ...state.messageQueue,
        [sessionKey]: (state.messageQueue[sessionKey] || []).filter((message) => message.id !== id),
      },
    }));
    get().updateMessage(sessionKey, id, { status: 'cancelled', retryPayload: undefined });
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
      const wasTyping = state.typingBySession[targetKey] === true;
      const typingStartedAtBySession = { ...state.typingStartedAtBySession };
      const chatRunStartupBySession = { ...state.chatRunStartupBySession };
      const chatSendTimingBySession = { ...state.chatSendTimingBySession };
      if (typing && !wasTyping) typingStartedAtBySession[targetKey] = Date.now();
      if (!typing) {
        delete typingStartedAtBySession[targetKey];
        delete chatRunStartupBySession[targetKey];
        delete chatSendTimingBySession[targetKey];
      }
      return {
        typingBySession: {
          ...state.typingBySession,
          [targetKey]: typing,
        },
        typingStartedAtBySession,
        chatRunStartupBySession,
        chatSendTimingBySession,
      };
    }),
  settleSessionRunUi: (sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    if (isSessionDeleted(targetKey)) return state;
    const typingStartedAtBySession = { ...state.typingStartedAtBySession };
    const chatRunStartupBySession = { ...state.chatRunStartupBySession };
    const chatSendTimingBySession = { ...state.chatSendTimingBySession };
    delete typingStartedAtBySession[targetKey];
    delete chatRunStartupBySession[targetKey];
    delete chatSendTimingBySession[targetKey];
    return {
      typingBySession: { ...state.typingBySession, [targetKey]: false },
      typingStartedAtBySession,
      chatRunStartupBySession,
      chatSendTimingBySession,
      thinkingBySession: {
        ...state.thinkingBySession,
        [targetKey]: { runId: null, text: '' },
      },
      sendingBySession: { ...state.sendingBySession, [targetKey]: false },
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
  consumeComposerSnapshot: (key, snapshot) => set((state) => {
    if (isSessionDeleted(key)) return state;
    const sentAttachmentIds = new Set(snapshot.attachmentIds);
    const currentFiles = state.preparedAttachments[key] ?? [];
    const remainingFiles = currentFiles.filter((file) => !sentAttachmentIds.has(file.id));
    const currentText = state.drafts[key] ?? '';
    return {
      ...(currentText === snapshot.text
        ? { drafts: { ...state.drafts, [key]: '' } }
        : {}),
      ...(remainingFiles.length !== currentFiles.length
        ? { preparedAttachments: { ...state.preparedAttachments, [key]: remainingFiles } }
        : {}),
    };
  }),

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
  thinkingBySession: {},
  setThinkingStream: (runId, text, sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    if (isSessionDeleted(targetKey)) return state;
    return {
      thinkingBySession: {
        ...state.thinkingBySession,
        [targetKey]: { runId, text },
      },
    };
  }),
  clearThinking: (sessionKey) => set((state) => {
    const targetKey = sessionKey ?? state.activeSessionKey;
    return {
      thinkingBySession: {
        ...state.thinkingBySession,
        [targetKey]: { runId: null, text: '' },
      },
    };
  }),

  // ── Connection ──
  connected: false,
  connecting: false,
  connectionError: null,
  restarting: false,

  setConnectionStatus: (status) =>
    set((state) => {
      const connectionError = status.error || null;
      const clearSessionGroupCatalog = !status.connected
        && (state.sessionGroupCatalog.length > 0 || state.sessionGroupCatalogAvailability !== 'unknown');
      const restarting = status.connected ? false : state.restarting;
      if (
        state.connected === status.connected
        && state.connecting === status.connecting
        && state.connectionError === connectionError
        && state.restarting === restarting
        && !clearSessionGroupCatalog
      ) {
        return state;
      }
      return {
        connected: status.connected,
        connecting: status.connecting,
        connectionError,
        ...(clearSessionGroupCatalog
          ? { sessionGroupCatalog: [], sessionGroupCatalogAvailability: 'unknown' as const }
          : {}),
        restarting,
      };
    }),

  setRestarting: (v) => set({ restarting: v }),
}));
