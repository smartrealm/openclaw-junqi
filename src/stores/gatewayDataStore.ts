import { create } from 'zustand';
import { debugLog } from '@/utils/debugLog';
import {
  coalesceSessionsByKey,
  createLatestRequestGate,
  markSessionDeleted,
  normalizeSessionKey,
  withoutDeletedSessions,
} from '@/utils/sessionLifecycle';
import { parseOpenClawSessionListSnapshot } from '@/services/gateway/OpenClawChatRunProjection';
import { GatewayRpcError } from '@/services/gateway/Connection';
import {
  OPENCLAW_SESSIONS_PREVIEW_MAX_KEYS,
  OPENCLAW_SESSIONS_PREVIEW_METHOD,
  OpenClawSessionPreviewClient,
  OpenClawSessionPreviewResponseError,
  type OpenClawSessionPreviewEntry,
} from '@/services/gateway/OpenClawSessionPreviewClient';
import {
  OPENCLAW_TOOLS_EFFECTIVE_METHOD,
  OpenClawToolsEffectiveClient,
  OpenClawToolsEffectiveResponseError,
  type OpenClawToolsEffectiveResult,
} from '@/services/gateway/OpenClawToolsEffectiveClient';
import {
  OPENCLAW_TOOLS_CATALOG_METHOD,
  OpenClawToolsCatalogClient,
  OpenClawToolsCatalogResponseError,
  type OpenClawToolsCatalogResult,
} from '@/services/gateway/OpenClawToolsCatalogClient';
import {
  OPENCLAW_ARTIFACTS_DOWNLOAD_METHOD,
  OPENCLAW_ARTIFACTS_LIST_METHOD,
  OpenClawArtifactsClient,
  OpenClawArtifactsResponseError,
  type OpenClawArtifactSummary,
  type OpenClawArtifactsDownloadResult,
} from '@/services/gateway/OpenClawArtifactsClient';
import { saveChatMedia } from '@/services/chat/mediaSaveRuntime';

export type { OpenClawSessionPreviewEntry } from '@/services/gateway/OpenClawSessionPreviewClient';
export type {
  OpenClawToolsEffectiveEntry,
  OpenClawToolsEffectiveGroup,
  OpenClawToolsEffectiveNotice,
  OpenClawToolsEffectiveResult,
} from '@/services/gateway/OpenClawToolsEffectiveClient';
export type {
  OpenClawToolsCatalogEntry,
  OpenClawToolsCatalogGroup,
  OpenClawToolsCatalogProfile,
  OpenClawToolsCatalogProfileId,
  OpenClawToolsCatalogResult,
} from '@/services/gateway/OpenClawToolsCatalogClient';
export type {
  OpenClawArtifactDownloadMode,
  OpenClawArtifactSummary,
  OpenClawArtifactsDownloadResult,
  OpenClawArtifactsGetResult,
  OpenClawArtifactsListResult,
} from '@/services/gateway/OpenClawArtifactsClient';

// ═══════════════════════════════════════════════════════════
// Gateway Data Store — Central data layer for all pages
//
// DESIGN:
//   All pages READ from this store — nobody calls gateway directly.
//   Smart polling fetches at 3 speeds:
//     Fast  (10s):  sessions.list         (who's running now?)
//     Mid   (30s):  agents.list + cron    (rarely change)
//     Slow  (120s): usage.cost + sessions.usage (heavy, slow-changing)
//
//   Gateway events (session.started, etc.) update the store
//   in real-time without polling.
// ═══════════════════════════════════════════════════════════

// ── Types ────────────────────────────────────────────────

export interface SessionInfo {
  key: string;
  sessionId?: string;
  label?: string;
  category?: string;
  model?: string;
  running?: boolean;
  totalTokens?: number;
  contextTokens?: number;
  maxTokens?: number;
  compactions?: number;
  lastActive?: string;
  kind?: string;
  [k: string]: any;
}

export interface AgentInfo {
  id: string;
  name?: string;
  model?: string;
  workspace?: string;
  [k: string]: any;
}

export interface DailyEntry {
  date: string;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalTokens: number;
  missingCostEntries: number;
  requests?: number;
  [k: string]: any;
}

export interface CostSummary {
  days: number;
  daily: DailyEntry[];
  totals: {
    totalCost: number;
    inputCost: number;
    outputCost: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheReadCost: number;
    cacheWriteCost: number;
    totalTokens: number;
    missingCostEntries: number;
    requests?: number;
    [k: string]: any;
  };
  updatedAt?: number;
}

export interface SessionsUsage {
  updatedAt: number;
  startDate: string;
  endDate: string;
  sessions: any[];
  totals: CostUsageTotals;
  aggregates: Record<string, any>;
  cacheStatus?: Record<string, any>;
  [k: string]: any;
}

export interface CostUsageTotals {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalTokens: number;
  missingCostEntries: number;
  [k: string]: any;
}

export type SessionsUsageRange = '7d' | '30d' | '90d' | '1y' | 'all';

export interface SessionsUsageQuery {
  range?: SessionsUsageRange;
  startDate?: string;
  endDate?: string;
  mode?: 'utc' | 'gateway' | 'specific';
  utcOffset?: string;
  timeZone?: string;
}

export interface CronJob {
  id: string;
  name?: string;
  agentId?: string;
  schedule?: any;
  enabled?: boolean;
  lastRun?: string;
  state?: any;
  // Gateway 2026.2.22+: split run vs delivery status
  lastRunStatus?: string;
  lastDeliveryStatus?: string;
  [k: string]: any;
}

// task_id to session_key map, populated by task-session events
const taskToSession = new Map<string, string>();
function taskIdToSessionKey(taskId: string): string | undefined {
  return taskToSession.get(taskId);
}

// ── Pending task-status buffer ────────────────────────────────────────────
// task-status can arrive before task-session, which maps task_id to session_key.
// We buffer the latest status per task_id and replay when task-session arrives,
// instead of falling back to activeSessionKey (which would pollute the wrong session).
const pendingTaskStatus = new Map<string, { status: string; ts: number }>();
const PENDING_TASK_TTL = 30_000; // discard unresolved entries after 30s

/** Apply a task-status result to a specific session key. */
function applyTaskStatus(store: ReturnType<typeof useGatewayDataStore.getState>, sessionKey: string, isActive: boolean) {
  store.setSessions(
    store.sessions.map((s) =>
      s.key === sessionKey ? { ...s, running: isActive, runningUpdatedAt: Date.now() } : s,
    ),
  );
}

// ── Running Sub-Agent Tracking ───────────────────────────
// Detected from sessions polling (every 10s).
// Gateway WebSocket does NOT send stream:"tool" events,
// so we scan sessions.list for key "agent:<id>:subagent:<uuid>" + running=true.

export interface RunningSubAgent {
  agentId: string;
  startTime: number;
  label?: string;
  sessionKey?: string;
}

// ── Store State ──────────────────────────────────────────

interface GatewayDataState {
  // Data
  sessions: SessionInfo[];
  sessionPreviews: Record<string, OpenClawSessionPreviewEntry>;
  sessionPreviewsUpdatedAt: number;
  sessionPreviewsLoading: boolean;
  sessionPreviewsError: string | null;
  toolsEffective: Record<string, OpenClawToolsEffectiveResult>;
  toolsEffectiveUpdatedAt: Record<string, number>;
  toolsEffectiveLoading: boolean;
  toolsEffectiveLoadingSessionKey: string | null;
  toolsEffectiveError: string | null;
  toolsCatalog: Record<string, OpenClawToolsCatalogResult>;
  toolsCatalogUpdatedAt: Record<string, number>;
  toolsCatalogLoading: boolean;
  toolsCatalogLoadingAgentId: string | null;
  toolsCatalogError: string | null;
  sessionArtifacts: Record<string, readonly OpenClawArtifactSummary[]>;
  sessionArtifactsUpdatedAt: Record<string, number>;
  sessionArtifactsLoading: boolean;
  sessionArtifactsLoadingKey: string | null;
  sessionArtifactsError: string | null;
  agents: AgentInfo[];
  costSummary: CostSummary | null;
  sessionsUsage: SessionsUsage | null;
  cronJobs: CronJob[];
  runningSubAgents: RunningSubAgent[];

  // Timestamps (ms) — when each group was last fetched
  lastFetch: {
    sessions: number;
    agents: number;
    cost: number;
    usage: number;
    cron: number;
  };

  // Loading states per group
  loading: {
    sessions: boolean;
    agents: boolean;
    cost: boolean;
    usage: boolean;
    cron: boolean;
  };

  // Error states per group
  errors: {
    sessions: string | null;
    agents: string | null;
    cost: string | null;
    usage: string | null;
    cron: string | null;
  };

  // Polling active flag
  polling: boolean;
  connectionStartedAt: number | null;

  // ── Actions ──

  // Setters (called by polling engine or event handler)
  setSessions: (sessions: SessionInfo[]) => void;
  setSessionPreviews: (entries: readonly OpenClawSessionPreviewEntry[]) => void;
  clearSessionPreviews: (keys?: readonly string[]) => void;
  setSessionPreviewsLoading: (value: boolean) => void;
  setSessionPreviewsError: (value: string | null) => void;
  setToolsEffective: (sessionKey: string, result: OpenClawToolsEffectiveResult) => void;
  clearToolsEffective: (sessionKey?: string) => void;
  setToolsEffectiveLoading: (sessionKey: string | null) => void;
  setToolsEffectiveError: (value: string | null) => void;
  setToolsCatalog: (agentId: string, result: OpenClawToolsCatalogResult) => void;
  clearToolsCatalog: (agentId?: string) => void;
  setToolsCatalogLoading: (agentId: string | null) => void;
  setToolsCatalogError: (value: string | null) => void;
  setSessionArtifacts: (sessionKey: string, artifacts: readonly OpenClawArtifactSummary[]) => void;
  clearSessionArtifacts: (sessionKey?: string) => void;
  setSessionArtifactsLoading: (sessionKey: string | null) => void;
  setSessionArtifactsError: (value: string | null) => void;
  setAgents: (agents: AgentInfo[]) => void;
  setCostSummary: (data: CostSummary) => void;
  setSessionsUsage: (data: SessionsUsage) => void;
  setCronJobs: (jobs: CronJob[]) => void;

  setLoading: (group: keyof GatewayDataState['loading'], val: boolean) => void;
  setError: (group: keyof GatewayDataState['errors'], err: string | null) => void;

  // Sub-agent tracking (synced from sessions polling)
  setRunningSubAgents: (list: RunningSubAgent[]) => void;

  // Mark polling active/inactive
  setPolling: (active: boolean) => void;

  // ── Derived helpers (convenience) ──
  getMainSession: () => SessionInfo | undefined;
}

// ── Store ────────────────────────────────────────────────

export const useGatewayDataStore = create<GatewayDataState>((set, get) => ({
  // Data
  sessions: [],
  sessionPreviews: {},
  sessionPreviewsUpdatedAt: 0,
  sessionPreviewsLoading: false,
  sessionPreviewsError: null,
  toolsEffective: {},
  toolsEffectiveUpdatedAt: {},
  toolsEffectiveLoading: false,
  toolsEffectiveLoadingSessionKey: null,
  toolsEffectiveError: null,
  toolsCatalog: {},
  toolsCatalogUpdatedAt: {},
  toolsCatalogLoading: false,
  toolsCatalogLoadingAgentId: null,
  toolsCatalogError: null,
  sessionArtifacts: {},
  sessionArtifactsUpdatedAt: {},
  sessionArtifactsLoading: false,
  sessionArtifactsLoadingKey: null,
  sessionArtifactsError: null,
  agents: [],
  costSummary: null,
  sessionsUsage: null,
  cronJobs: [],
  runningSubAgents: [],

  // Timestamps
  lastFetch: { sessions: 0, agents: 0, cost: 0, usage: 0, cron: 0 },

  // Loading
  loading: { sessions: false, agents: false, cost: false, usage: false, cron: false },

  // Errors
  errors: { sessions: null, agents: null, cost: null, usage: null, cron: null },

  polling: false,
  connectionStartedAt: null,

  // ── Setters ──

  setSessions: (sessions) => {
    // Merge incoming sessions with existing ones, preserving event-driven fields
    // (runningUpdatedAt) that the polling API does not return. Without this,
    // Every 10s poll would wipe the freshness stamp, making isFreshRunning false
    // and showing the pet as idle while an agent is actively working.
    const visibleSessions = coalesceSessionsByKey(withoutDeletedSessions(sessions));
    const existing = get().sessions;
    const existingByKey = new Map(existing.map((s) => [s.key, s]));
    const merged = visibleSessions.map((s) => {
      const prev = existingByKey.get(s.key);
      if (!prev) return s;
      // A false running state drops the freshness stamp because the task ended.
      // A true running state without an earlier stamp mints one now.
      const runningUpdatedAt = s.running === false
        ? undefined
        : (prev.runningUpdatedAt ?? (s.running ? Date.now() : undefined));
      return { ...s, runningUpdatedAt };
    });
    const sessionKeys = new Set(merged.map((session) => session.key));
    const sessionPreviews = Object.fromEntries(
      Object.entries(get().sessionPreviews).filter(([key]) => sessionKeys.has(key)),
    );
    const toolsEffective = Object.fromEntries(
      Object.entries(get().toolsEffective).filter(([key]) => sessionKeys.has(key)),
    );
    const toolsEffectiveUpdatedAt = Object.fromEntries(
      Object.entries(get().toolsEffectiveUpdatedAt).filter(([key]) => sessionKeys.has(key)),
    );
    const sessionArtifacts = Object.fromEntries(
      Object.entries(get().sessionArtifacts).filter(([key]) => sessionKeys.has(key)),
    );
    const sessionArtifactsUpdatedAt = Object.fromEntries(
      Object.entries(get().sessionArtifactsUpdatedAt).filter(([key]) => sessionKeys.has(key)),
    );
    const loadingSessionKey = get().toolsEffectiveLoadingSessionKey;
    const sessionToolsLoading = loadingSessionKey !== null && sessionKeys.has(loadingSessionKey);
    const loadingArtifactsKey = get().sessionArtifactsLoadingKey;
    const sessionArtifactsLoading = loadingArtifactsKey !== null && sessionKeys.has(loadingArtifactsKey);
    set({
      sessions: merged,
      sessionPreviews,
      toolsEffective,
      toolsEffectiveUpdatedAt,
      sessionArtifacts,
      sessionArtifactsUpdatedAt,
      ...(loadingSessionKey !== null && !sessionToolsLoading
        ? { toolsEffectiveLoading: false, toolsEffectiveLoadingSessionKey: null }
        : {}),
      ...(loadingArtifactsKey !== null && !sessionArtifactsLoading
        ? { sessionArtifactsLoading: false, sessionArtifactsLoadingKey: null }
        : {}),
      lastFetch: { ...get().lastFetch, sessions: Date.now() },
      loading: { ...get().loading, sessions: false },
      errors: { ...get().errors, sessions: null },
    });
  },

  setSessionPreviews: (entries) => {
    const sessionPreviews = { ...get().sessionPreviews };
    for (const entry of entries) sessionPreviews[entry.key] = entry;
    set({
      sessionPreviews,
      sessionPreviewsUpdatedAt: Date.now(),
      sessionPreviewsLoading: false,
      sessionPreviewsError: null,
    });
  },

  clearSessionPreviews: (keys) => {
    if (!keys) {
      set({ sessionPreviews: {}, sessionPreviewsUpdatedAt: 0 });
      return;
    }
    const sessionPreviews = { ...get().sessionPreviews };
    for (const key of keys) delete sessionPreviews[normalizeSessionKey(key)];
    set({ sessionPreviews });
  },

  setSessionPreviewsLoading: (value) => set({ sessionPreviewsLoading: value }),

  setSessionPreviewsError: (value) => set({ sessionPreviewsError: value }),

  setToolsEffective: (sessionKey, result) => set({
    toolsEffective: { ...get().toolsEffective, [sessionKey]: result },
    toolsEffectiveUpdatedAt: { ...get().toolsEffectiveUpdatedAt, [sessionKey]: Date.now() },
    toolsEffectiveLoading: false,
    toolsEffectiveLoadingSessionKey: null,
    toolsEffectiveError: null,
  }),

  clearToolsEffective: (sessionKey) => {
    if (!sessionKey) {
      set({ toolsEffective: {}, toolsEffectiveUpdatedAt: {} });
      return;
    }
    const toolsEffective = { ...get().toolsEffective };
    const toolsEffectiveUpdatedAt = { ...get().toolsEffectiveUpdatedAt };
    delete toolsEffective[normalizeSessionKey(sessionKey)];
    delete toolsEffectiveUpdatedAt[normalizeSessionKey(sessionKey)];
    set({ toolsEffective, toolsEffectiveUpdatedAt });
  },

  setToolsEffectiveLoading: (sessionKey) => set({
    toolsEffectiveLoading: sessionKey !== null,
    toolsEffectiveLoadingSessionKey: sessionKey,
  }),

  setToolsEffectiveError: (value) => set({ toolsEffectiveError: value }),

  setToolsCatalog: (agentId, result) => set({
    toolsCatalog: { ...get().toolsCatalog, [agentId]: result },
    toolsCatalogUpdatedAt: { ...get().toolsCatalogUpdatedAt, [agentId]: Date.now() },
    toolsCatalogLoading: false,
    toolsCatalogLoadingAgentId: null,
    toolsCatalogError: null,
  }),

  clearToolsCatalog: (agentId) => {
    if (!agentId) {
      set({ toolsCatalog: {}, toolsCatalogUpdatedAt: {} });
      return;
    }
    const toolsCatalog = { ...get().toolsCatalog };
    const toolsCatalogUpdatedAt = { ...get().toolsCatalogUpdatedAt };
    const normalizedAgentId = agentId.trim();
    delete toolsCatalog[normalizedAgentId];
    delete toolsCatalogUpdatedAt[normalizedAgentId];
    set({ toolsCatalog, toolsCatalogUpdatedAt });
  },

  setToolsCatalogLoading: (agentId) => set({
    toolsCatalogLoading: agentId !== null,
    toolsCatalogLoadingAgentId: agentId,
  }),

  setToolsCatalogError: (value) => set({ toolsCatalogError: value }),

  setSessionArtifacts: (sessionKey, artifacts) => set({
    sessionArtifacts: { ...get().sessionArtifacts, [sessionKey]: artifacts },
    sessionArtifactsUpdatedAt: { ...get().sessionArtifactsUpdatedAt, [sessionKey]: Date.now() },
    sessionArtifactsLoading: false,
    sessionArtifactsLoadingKey: null,
    sessionArtifactsError: null,
  }),

  clearSessionArtifacts: (sessionKey) => {
    if (!sessionKey) {
      set({ sessionArtifacts: {}, sessionArtifactsUpdatedAt: {} });
      return;
    }
    const normalizedSessionKey = normalizeSessionKey(sessionKey);
    const sessionArtifacts = { ...get().sessionArtifacts };
    const sessionArtifactsUpdatedAt = { ...get().sessionArtifactsUpdatedAt };
    delete sessionArtifacts[normalizedSessionKey];
    delete sessionArtifactsUpdatedAt[normalizedSessionKey];
    set({ sessionArtifacts, sessionArtifactsUpdatedAt });
  },

  setSessionArtifactsLoading: (sessionKey) => set({
    sessionArtifactsLoading: sessionKey !== null,
    sessionArtifactsLoadingKey: sessionKey,
  }),

  setSessionArtifactsError: (value) => set({ sessionArtifactsError: value }),

  setAgents: (agents) =>
    set({
      agents,
      toolsCatalog: Object.fromEntries(
        Object.entries(get().toolsCatalog).filter(([agentId]) => agents.some((agent) => agent.id === agentId)),
      ),
      toolsCatalogUpdatedAt: Object.fromEntries(
        Object.entries(get().toolsCatalogUpdatedAt).filter(([agentId]) => agents.some((agent) => agent.id === agentId)),
      ),
      ...(get().toolsCatalogLoadingAgentId !== null
        && !agents.some((agent) => agent.id === get().toolsCatalogLoadingAgentId)
        ? { toolsCatalogLoading: false, toolsCatalogLoadingAgentId: null }
        : {}),
      lastFetch: { ...get().lastFetch, agents: Date.now() },
      loading: { ...get().loading, agents: false },
      errors: { ...get().errors, agents: null },
    }),

  setCostSummary: (data) =>
    set({
      costSummary: data,
      lastFetch: { ...get().lastFetch, cost: Date.now() },
      loading: { ...get().loading, cost: false },
      errors: { ...get().errors, cost: null },
    }),

  setSessionsUsage: (data) =>
    set({
      sessionsUsage: data,
      lastFetch: { ...get().lastFetch, usage: Date.now() },
      loading: { ...get().loading, usage: false },
      errors: { ...get().errors, usage: null },
    }),

  setCronJobs: (jobs) =>
    set({
      cronJobs: jobs,
      lastFetch: { ...get().lastFetch, cron: Date.now() },
      loading: { ...get().loading, cron: false },
      errors: { ...get().errors, cron: null },
    }),

  setLoading: (group, val) =>
    set({ loading: { ...get().loading, [group]: val } }),

  setError: (group, err) =>
    set({ errors: { ...get().errors, [group]: err } }),

  // ── Sub-agent tracking ──

  setRunningSubAgents: (list) => set({ runningSubAgents: list }),

  setPolling: (active) => set((state) => ({
    polling: active,
    connectionStartedAt: resolveGatewayConnectionStartedAt(
      state.connectionStartedAt,
      active,
    ),
  })),

  // ── Derived ──

  getMainSession: () =>
    get().sessions.find((s) => s.key === 'agent:main:main'),
}));


// ═══════════════════════════════════════════════════════════
// Polling Engine — starts/stops with gateway connection
// ═══════════════════════════════════════════════════════════

// Polling intervals (ms)
const FAST_INTERVAL  = 10_000;   // 10s — sessions
const MID_INTERVAL   = 30_000;   // 30s — agents / cron
const SLOW_INTERVAL  = 120_000;  // 120s — cost / usage

let fastTimer:  ReturnType<typeof setInterval> | null = null;
let agentsTimer: ReturnType<typeof setInterval> | null = null;
let cronTimer: ReturnType<typeof setInterval> | null = null;
let costTimer: ReturnType<typeof setInterval> | null = null;
let usageTimer: ReturnType<typeof setInterval> | null = null;

export const GATEWAY_DATA_GROUPS = ['sessions', 'agents', 'cost', 'usage', 'cron'] as const;
export type GatewayDataGroup = typeof GATEWAY_DATA_GROUPS[number];
type PollGroup = GatewayDataGroup;
const DEFAULT_FRESHNESS_MS: Record<PollGroup, number> = {
  sessions: FAST_INTERVAL,
  agents: MID_INTERVAL,
  cron: MID_INTERVAL,
  cost: SLOW_INTERVAL,
  usage: SLOW_INTERVAL,
};

// These are bounded UI read parameters, while the 64-key batch size is the
// current official sessions.preview handler limit.
const SESSION_PREVIEW_LIMIT = 3;
const SESSION_PREVIEW_MAX_CHARS = 160;
const SESSION_PREVIEW_FRESHNESS_MS = 30_000;
const TOOLS_EFFECTIVE_FRESHNESS_MS = 30_000;
const TOOLS_CATALOG_FRESHNESS_MS = 30_000;
const SESSION_ARTIFACTS_FRESHNESS_MS = 30_000;

// Reference to gateway connection (set by startPolling)
// Uses request() directly to avoid circular imports with gateway facade
type GatewayRequestParams = Record<string, unknown>;
type GatewayRequester = {
  request: (method: string, params: GatewayRequestParams) => Promise<unknown>;
  hasAdvertisedMethod?: (method: string) => boolean | null;
  getHttpBaseUrl?: () => string;
};

function isGatewayRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function gatewayCollection(response: unknown, key: string): unknown[] | null {
  if (Array.isArray(response)) return response;
  if (!isGatewayRecord(response) || !Array.isArray(response[key])) return null;
  return response[key];
}

function isAgentInfo(value: unknown): value is AgentInfo {
  return isGatewayRecord(value)
    && typeof value.id === 'string'
    && value.id.trim().length > 0;
}

function isCronJob(value: unknown): value is CronJob {
  return isGatewayRecord(value)
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && (value.agentId === undefined || (typeof value.agentId === 'string' && value.agentId.trim().length > 0));
}

function gatewayCollectionOf<T>(
  response: unknown,
  key: string,
  isItem: (value: unknown) => value is T,
): T[] | null {
  const entries = gatewayCollection(response, key);
  if (!entries) return null;
  const parsed = entries.filter(isItem);
  return parsed.length === entries.length ? parsed : null;
}

const COST_METRIC_KEYS = [
  'totalCost',
  'inputCost',
  'outputCost',
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'cacheReadCost',
  'cacheWriteCost',
  'totalTokens',
  'missingCostEntries',
] as const;

function hasCostMetrics(value: Record<string, unknown>): boolean {
  return COST_METRIC_KEYS.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

function isDailyEntry(value: unknown): value is DailyEntry {
  return isGatewayRecord(value)
    && typeof value.date === 'string'
    && hasCostMetrics(value)
    && (value.requests === undefined || typeof value.requests === 'number');
}

function isCostSummary(value: unknown): value is CostSummary {
  if (!isGatewayRecord(value) || typeof value.days !== 'number' || !Array.isArray(value.daily)) {
    return false;
  }
  if (!isGatewayRecord(value.totals) || !hasCostMetrics(value.totals)) return false;
  if (value.totals.requests !== undefined && typeof value.totals.requests !== 'number') return false;
  if (value.updatedAt !== undefined && typeof value.updatedAt !== 'number') return false;
  return value.daily.every(isDailyEntry);
}

function isDateLabel(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isSessionUsageRow(value: unknown): boolean {
  if (!isGatewayRecord(value) || typeof value.key !== 'string' || value.key.trim().length === 0) return false;
  if (value.sessionId !== undefined
    && (typeof value.sessionId !== 'string' || value.sessionId.trim().length === 0)) return false;
  if (value.updatedAt !== undefined
    && (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt))) return false;
  return value.usage === null || isGatewayRecord(value.usage);
}

function isSessionsUsage(value: unknown): value is SessionsUsage {
  return isGatewayRecord(value)
    && typeof value.updatedAt === 'number'
    && Number.isFinite(value.updatedAt)
    && isDateLabel(value.startDate)
    && isDateLabel(value.endDate)
    && Array.isArray(value.sessions)
    && value.sessions.every(isSessionUsageRow)
    && isGatewayRecord(value.totals)
    && hasCostMetrics(value.totals)
    && isGatewayRecord(value.aggregates);
}

export function parseGatewayAgentList(response: unknown): AgentInfo[] | null {
  return gatewayCollectionOf(response, 'agents', isAgentInfo);
}

export function parseGatewayCronJobList(response: unknown): CronJob[] | null {
  return gatewayCollectionOf(response, 'jobs', isCronJob);
}

export function parseGatewayCostSummary(response: unknown): CostSummary | null {
  return isCostSummary(response) ? response : null;
}

export function parseGatewaySessionsUsage(response: unknown): SessionsUsage | null {
  return isSessionsUsage(response) ? response : null;
}

interface GatewayRequestTicket<Connection> {
  group: GatewayDataGroup;
  connection: Connection;
  requestId: number;
}

interface GatewayRequestFence<Connection> {
  begin: (group: GatewayDataGroup, connection: Connection) => GatewayRequestTicket<Connection>;
  isCurrent: (ticket: GatewayRequestTicket<Connection>, connection: Connection | null) => boolean;
  invalidate: (group: GatewayDataGroup) => void;
  invalidateAll: () => void;
}

/** Keep every polling group tied to both its latest request and its Gateway instance. */
export function createGatewayRequestFence<Connection>(): GatewayRequestFence<Connection> {
  const gates: Record<GatewayDataGroup, ReturnType<typeof createLatestRequestGate>> = {
    sessions: createLatestRequestGate(),
    agents: createLatestRequestGate(),
    cost: createLatestRequestGate(),
    usage: createLatestRequestGate(),
    cron: createLatestRequestGate(),
  };
  return {
    begin: (group, connection) => ({
      group,
      connection,
      requestId: gates[group].begin(),
    }),
    isCurrent: (ticket, connection) => (
      ticket.connection === connection && gates[ticket.group].isCurrent(ticket.requestId)
    ),
    invalidate: (group) => {
      gates[group].invalidate();
    },
    invalidateAll: () => {
      for (const group of GATEWAY_DATA_GROUPS) gates[group].invalidate();
    },
  };
}

/** Preserve a Gateway connection's start time across dashboard remounts. */
export function resolveGatewayConnectionStartedAt(
  previous: number | null,
  polling: boolean,
  now = Date.now(),
): number | null {
  if (!polling) return null;
  return previous ?? now;
}

let gw: GatewayRequester | null = null;
const requestFence = createGatewayRequestFence<GatewayRequester>();
const sessionPreviewRequestGate = createLatestRequestGate();
const toolsEffectiveRequestGate = createLatestRequestGate();
const toolsCatalogRequestGate = createLatestRequestGate();
const sessionArtifactsRequestGate = createLatestRequestGate();

interface SessionPreviewRequestTicket {
  connection: GatewayRequester;
  requestId: number;
}

function beginSessionPreviewRequest(): SessionPreviewRequestTicket | null {
  if (!gw) return null;
  return { connection: gw, requestId: sessionPreviewRequestGate.begin() };
}

function isCurrentSessionPreviewRequest(ticket: SessionPreviewRequestTicket): boolean {
  return ticket.connection === gw && sessionPreviewRequestGate.isCurrent(ticket.requestId);
}

interface ToolsEffectiveRequestTicket {
  connection: GatewayRequester;
  requestId: number;
  sessionKey: string;
}

function beginToolsEffectiveRequest(sessionKey: string): ToolsEffectiveRequestTicket | null {
  if (!gw) return null;
  return {
    connection: gw,
    requestId: toolsEffectiveRequestGate.begin(),
    sessionKey,
  };
}

function isCurrentToolsEffectiveRequest(ticket: ToolsEffectiveRequestTicket): boolean {
  return ticket.connection === gw
    && toolsEffectiveRequestGate.isCurrent(ticket.requestId)
    && useGatewayDataStore.getState().toolsEffectiveLoadingSessionKey === ticket.sessionKey;
}

interface ToolsCatalogRequestTicket {
  connection: GatewayRequester;
  requestId: number;
  agentId: string;
}

function beginToolsCatalogRequest(agentId: string): ToolsCatalogRequestTicket | null {
  if (!gw) return null;
  return {
    connection: gw,
    requestId: toolsCatalogRequestGate.begin(),
    agentId,
  };
}

function isCurrentToolsCatalogRequest(ticket: ToolsCatalogRequestTicket): boolean {
  return ticket.connection === gw
    && toolsCatalogRequestGate.isCurrent(ticket.requestId)
    && useGatewayDataStore.getState().toolsCatalogLoadingAgentId === ticket.agentId;
}

interface SessionArtifactsRequestTicket {
  connection: GatewayRequester;
  requestId: number;
  sessionKey: string;
}

function beginSessionArtifactsRequest(sessionKey: string): SessionArtifactsRequestTicket | null {
  if (!gw) return null;
  return {
    connection: gw,
    requestId: sessionArtifactsRequestGate.begin(),
    sessionKey,
  };
}

function isCurrentSessionArtifactsRequest(ticket: SessionArtifactsRequestTicket): boolean {
  return ticket.connection === gw
    && sessionArtifactsRequestGate.isCurrent(ticket.requestId)
    && useGatewayDataStore.getState().sessionArtifactsLoadingKey === ticket.sessionKey;
}

function beginGatewayRequest(group: GatewayDataGroup): GatewayRequestTicket<GatewayRequester> | null {
  return gw ? requestFence.begin(group, gw) : null;
}

function isCurrentGatewayRequest(ticket: GatewayRequestTicket<GatewayRequester>): boolean {
  return requestFence.isCurrent(ticket, gw);
}

function rejectGatewayResponse(
  store: Pick<GatewayDataState, 'setError' | 'setLoading'>,
  group: GatewayDataGroup,
  method: string,
): void {
  store.setError(group, `Gateway returned an invalid ${method} response`);
  store.setLoading(group, false);
}

// ── Fetch functions ──────────────────────────────────────

async function fetchSessions(): Promise<boolean> {
  const ticket = beginGatewayRequest('sessions');
  if (!ticket) return false;
  const store = useGatewayDataStore.getState();
  store.setLoading('sessions', true);
  try {
    let res: unknown;
    try {
      // Current OpenClaw hides archived rows by default. Request the complete
      // lifecycle projection so the sidebar can render native archives.
      res = await ticket.connection.request('sessions.list', { archived: 'all' });
    } catch (error) {
      const code = error instanceof GatewayRpcError ? error.code?.toUpperCase() : undefined;
      const legacyArchivedFilter = (code === 'INVALID_PARAMS' || code === 'VALIDATION_ERROR')
        && error instanceof GatewayRpcError
        && /archived/i.test(error.message);
      if (!legacyArchivedFilter) throw error;
      res = await ticket.connection.request('sessions.list', {});
    }
    if (!isCurrentGatewayRequest(ticket)) return false;
    const sessionListSnapshot = parseOpenClawSessionListSnapshot(res);
    const rawList = sessionListSnapshot.sessions as SessionInfo[];

    // Merge: preserve event-enriched runningUpdatedAt that the server does not return.
    // IMPORTANT: polling must NEVER generate a new runningUpdatedAt timestamp by itself.
    // runningUpdatedAt is exclusively set by real-time events (session.started/ended,
    // task-status). A server poll saying running=true is not a fresh live signal —
    // it may reflect a session that was active before app launch.
    // Rule: always carry forward the existing runningUpdatedAt; never mint a new one here.
    const prev = store.sessions;
    const prevByKey = new Map(prev.map((s) => [s.key, s]));
    const incomingList = rawList.map((s) => {
      const existing = prevByKey.get(s.key);
      if (!existing) return s; // new session: no runningUpdatedAt — isFreshRunning returns false
      // Always preserve the event-driven runningUpdatedAt regardless of running state change.
      // If running changed to false (server confirms stopped), clear the timestamp so
      // isFreshRunning() correctly returns false for this session going forward.
      return {
        ...s,
        runningUpdatedAt: s.running ? existing.runningUpdatedAt : undefined,
      };
    });
    const incomingKeys = new Set(incomingList.map((session) => session.key));
    const list = sessionListSnapshot.complete
      ? incomingList
      : [...incomingList, ...prev.filter((session) => !incomingKeys.has(session.key))];

    // Skip store update if nothing meaningful changed (avoids unnecessary React re-renders)
    const same = prev.length === list.length
      && prev.every((s, i) => s.key === list[i]?.key
        && s.label === list[i]?.label
        && s.category === list[i]?.category
        && s.running === list[i]?.running
        && s.totalTokens === list[i]?.totalTokens
        && s.runningUpdatedAt === list[i]?.runningUpdatedAt);
    if (!same) {
      store.setSessions(list);
    } else {
      store.setLoading('sessions', false);
    }
    return true;
  } catch (e: any) {
    if (!isCurrentGatewayRequest(ticket)) return false;
    store.setError('sessions', e?.message || String(e));
    store.setLoading('sessions', false);
    return false;
  }
}

async function fetchAgents(): Promise<boolean> {
  const ticket = beginGatewayRequest('agents');
  if (!ticket) return false;
  const store = useGatewayDataStore.getState();
  store.setLoading('agents', true);
  try {
    const res = await ticket.connection.request('agents.list', {});
    if (!isCurrentGatewayRequest(ticket)) return false;
    const list = parseGatewayAgentList(res);
    if (!list) {
      rejectGatewayResponse(store, 'agents', 'agents.list');
      return false;
    }
    store.setAgents(list);
    return true;
  } catch (e: any) {
    if (!isCurrentGatewayRequest(ticket)) return false;
    store.setError('agents', e?.message || String(e));
    store.setLoading('agents', false);
    return false;
  }
}

async function fetchCost() {
  const ticket = beginGatewayRequest('cost');
  if (!ticket) return;
  const store = useGatewayDataStore.getState();
  store.setLoading('cost', true);
  try {
    const res = await ticket.connection.request('usage.cost', { days: 30, agentScope: 'all' });
    if (!isCurrentGatewayRequest(ticket)) return;
    const summary = parseGatewayCostSummary(res);
    if (!summary) {
      rejectGatewayResponse(store, 'cost', 'usage.cost');
      return;
    }
    store.setCostSummary(summary);
  } catch (e: any) {
    if (!isCurrentGatewayRequest(ticket)) return;
    store.setError('cost', e?.message || String(e));
    store.setLoading('cost', false);
  }
}

async function fetchUsage() {
  const ticket = beginGatewayRequest('usage');
  if (!ticket) return;
  const store = useGatewayDataStore.getState();
  store.setLoading('usage', true);
  try {
    const res = await ticket.connection.request('sessions.usage', { limit: 100, agentScope: 'all' });
    if (!isCurrentGatewayRequest(ticket)) return;
    const usage = parseGatewaySessionsUsage(res);
    if (!usage) {
      rejectGatewayResponse(store, 'usage', 'sessions.usage');
      return;
    }
    store.setSessionsUsage(usage);
  } catch (e: any) {
    if (!isCurrentGatewayRequest(ticket)) return;
    store.setError('usage', e?.message || String(e));
    store.setLoading('usage', false);
  }
}

async function fetchCron(): Promise<boolean> {
  const ticket = beginGatewayRequest('cron');
  if (!ticket) return false;
  const store = useGatewayDataStore.getState();
  store.setLoading('cron', true);
  try {
    const res = await ticket.connection.request('cron.list', { includeDisabled: true });
    if (!isCurrentGatewayRequest(ticket)) return false;
    const list = parseGatewayCronJobList(res);
    if (!list) {
      rejectGatewayResponse(store, 'cron', 'cron.list');
      return false;
    }
    store.setCronJobs(list);
    return true;
  } catch (e: any) {
    if (!isCurrentGatewayRequest(ticket)) return false;
    store.setError('cron', e?.message || String(e));
    store.setLoading('cron', false);
    return false;
  }
}

// ── Grouped fetchers (called by timers) ─────────────────

async function tickFast() {
  if (await fetchSessions()) {
    // Detect running sub-agents only after a current Gateway snapshot.
    syncRunningSubAgents();
  }
}

async function tickMid() {
  await fetchAgents();
}

async function tickSlow() {
  await Promise.allSettled([fetchCost(), fetchUsage()]);
}

function ensureTimer(group: Exclude<PollGroup, 'sessions'>) {
  if (!gw) return;
  switch (group) {
    case 'agents':
      if (!agentsTimer) agentsTimer = setInterval(fetchAgents, MID_INTERVAL);
      return;
    case 'cron':
      if (!cronTimer) cronTimer = setInterval(fetchCron, MID_INTERVAL);
      return;
    case 'cost':
      if (!costTimer) costTimer = setInterval(fetchCost, SLOW_INTERVAL);
      return;
    case 'usage':
      if (!usageTimer) usageTimer = setInterval(fetchUsage, SLOW_INTERVAL);
      return;
  }
}

async function fetchGroup(group: PollGroup) {
  switch (group) {
    case 'sessions': return fetchSessions();
    case 'agents':   return fetchAgents();
    case 'cost':     return fetchCost();
    case 'usage':    return fetchUsage();
    case 'cron':     return fetchCron();
  }
}

// ── Public API ──────────────────────────────────────────

/**
 * Start smart polling. Call once when gateway connects.
 * @param gateway  The GatewayService instance
 */
export function startPolling(gateway: GatewayRequester) {
  // Prevent double-start
  if (gw && useGatewayDataStore.getState().polling) return;

  requestFence.invalidateAll();
  sessionPreviewRequestGate.invalidate();
  toolsEffectiveRequestGate.invalidate();
  toolsCatalogRequestGate.invalidate();
  sessionArtifactsRequestGate.invalidate();
  gw = gateway;
  useGatewayDataStore.getState().setPolling(true);
  debugLog('datastore', '[DataStore] Polling started (sessions=10s, agents=30s, demand groups lazy)');

  // Immediate initial fetch — only globally useful groups. Heavier dashboard /
  // cron / analytics data is fetched when a page asks for it.
  tickFast();
  tickMid();

  // Set up intervals
  fastTimer = setInterval(tickFast, FAST_INTERVAL);
  agentsTimer = setInterval(tickMid, MID_INTERVAL);
}

/**
 * Stop polling. Call when gateway disconnects.
 */
export function stopPolling() {
  if (fastTimer)  { clearInterval(fastTimer);  fastTimer  = null; }
  if (agentsTimer) { clearInterval(agentsTimer); agentsTimer = null; }
  if (cronTimer) { clearInterval(cronTimer); cronTimer = null; }
  if (costTimer) { clearInterval(costTimer); costTimer = null; }
  if (usageTimer) { clearInterval(usageTimer); usageTimer = null; }
  requestFence.invalidateAll();
  sessionPreviewRequestGate.invalidate();
  toolsEffectiveRequestGate.invalidate();
  toolsCatalogRequestGate.invalidate();
  sessionArtifactsRequestGate.invalidate();
  gw = null;
  const store = useGatewayDataStore.getState();
  store.setPolling(false);
  for (const group of GATEWAY_DATA_GROUPS) store.setLoading(group, false);
  store.clearSessionPreviews();
  store.setSessionPreviewsLoading(false);
  store.setSessionPreviewsError(null);
  store.clearToolsEffective();
  store.setToolsEffectiveLoading(null);
  store.setToolsEffectiveError(null);
  store.clearToolsCatalog();
  store.setToolsCatalogLoading(null);
  store.setToolsCatalogError(null);
  store.clearSessionArtifacts();
  store.setSessionArtifactsLoading(null);
  store.setSessionArtifactsError(null);
  // Clear running sub-agents on disconnect — presence-based detection is meaningless
  // without a live sessions.list feed. Without this, stale sub-agents keep the pet
  // in "working" state indefinitely after a gateway disconnect/reconnect cycle.
  if (store.runningSubAgents.length > 0) {
    store.setRunningSubAgents([]);
    debugLog('datastore', '[DataStore] Cleared runningSubAgents on disconnect');
  }
  debugLog('datastore', '[DataStore] Polling stopped');
}

/**
 * Force refresh all data now (e.g. user clicks Refresh button).
 */
export async function refreshAll() {
  if (!gw) return;
  debugLog('datastore', '[DataStore] Manual refresh - all groups');
  ensureTimer('agents');
  ensureTimer('cron');
  ensureTimer('cost');
  ensureTimer('usage');
  await Promise.allSettled([tickFast(), tickMid(), tickSlow(), fetchCron()]);
}

/**
 * Force refresh a specific group.
 */
export async function refreshGroup(group: 'sessions' | 'agents' | 'cost' | 'usage' | 'cron') {
  if (!gw) return;
  if (group !== 'sessions') ensureTimer(group);
  return fetchGroup(group);
}

/**
 * Fetch a group only when the existing data is stale or absent. Also arms the
 * group's background timer for data that is only useful on specific pages.
 */
export async function ensureGroupFresh(group: PollGroup, maxAgeMs = DEFAULT_FRESHNESS_MS[group]) {
  if (!gw) return;
  if (group !== 'sessions') ensureTimer(group);
  const store = useGatewayDataStore.getState();
  if (store.loading[group]) return;
  const last = store.lastFetch[group] ?? 0;
  if (last > 0 && Date.now() - last < maxAgeMs) return;
  return fetchGroup(group);
}

function normalizeSessionPreviewKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.flatMap((key) => {
    if (typeof key !== 'string') return [];
    const normalized = normalizeSessionKey(key);
    return normalized ? [normalized] : [];
  }))];
}

function chunkSessionPreviewKeys(keys: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < keys.length; index += OPENCLAW_SESSIONS_PREVIEW_MAX_KEYS) {
    chunks.push(keys.slice(index, index + OPENCLAW_SESSIONS_PREVIEW_MAX_KEYS));
  }
  return chunks;
}

function sessionPreviewFailureCode(error: unknown): string {
  return error instanceof OpenClawSessionPreviewResponseError
    ? error.code
    : 'OPENCLAW_SESSIONS_PREVIEW_FAILED';
}

/** Fetch bounded, read-only transcript previews from the connected Gateway. */
export async function refreshSessionPreviews(keys: readonly string[]): Promise<boolean> {
  const normalizedKeys = normalizeSessionPreviewKeys(keys);
  const store = useGatewayDataStore.getState();
  if (normalizedKeys.length === 0) {
    sessionPreviewRequestGate.invalidate();
    store.clearSessionPreviews();
    store.setSessionPreviewsLoading(false);
    store.setSessionPreviewsError(null);
    return false;
  }
  if (!gw) return false;

  const advertised = gw.hasAdvertisedMethod?.(OPENCLAW_SESSIONS_PREVIEW_METHOD);
  if (advertised === false) {
    sessionPreviewRequestGate.invalidate();
    store.clearSessionPreviews(normalizedKeys);
    store.setSessionPreviewsLoading(false);
    store.setSessionPreviewsError('OPENCLAW_SESSIONS_PREVIEW_UNSUPPORTED');
    return false;
  }

  const ticket = beginSessionPreviewRequest();
  if (!ticket) return false;
  store.clearSessionPreviews(normalizedKeys);
  store.setSessionPreviewsLoading(true);
  store.setSessionPreviewsError(null);

  const client = new OpenClawSessionPreviewClient(
    <T>(method: string, params: Record<string, unknown>) => (
      ticket.connection.request(method, params) as Promise<T>
    ),
  );
  try {
    const entries: OpenClawSessionPreviewEntry[] = [];
    for (const chunk of chunkSessionPreviewKeys(normalizedKeys)) {
      const result = await client.preview({
        keys: chunk,
        limit: SESSION_PREVIEW_LIMIT,
        maxChars: SESSION_PREVIEW_MAX_CHARS,
      });
      if (!isCurrentSessionPreviewRequest(ticket)) return false;
      entries.push(...result.previews);
    }
    if (!isCurrentSessionPreviewRequest(ticket)) return false;
    const activeKeys = new Set(useGatewayDataStore.getState().sessions.map((session) => session.key));
    store.setSessionPreviews(entries.filter((entry) => activeKeys.has(entry.key)));
    return true;
  } catch (error) {
    if (!isCurrentSessionPreviewRequest(ticket)) return false;
    store.clearSessionPreviews(normalizedKeys);
    store.setSessionPreviewsLoading(false);
    store.setSessionPreviewsError(sessionPreviewFailureCode(error));
    return false;
  }
}

/** Fetch previews when the current session keys are absent or stale. */
export async function ensureSessionPreviewsFresh(
  keys: readonly string[],
  maxAgeMs = SESSION_PREVIEW_FRESHNESS_MS,
): Promise<boolean> {
  const normalizedKeys = normalizeSessionPreviewKeys(keys);
  if (normalizedKeys.length === 0) {
    useGatewayDataStore.getState().clearSessionPreviews();
    return false;
  }
  if (!gw) return false;
  const store = useGatewayDataStore.getState();
  if (store.sessionPreviewsLoading) return false;
  const isFresh = store.sessionPreviewsUpdatedAt > 0
    && Date.now() - store.sessionPreviewsUpdatedAt < maxAgeMs
    && normalizedKeys.every((key) => Object.prototype.hasOwnProperty.call(store.sessionPreviews, key));
  if (isFresh) return true;
  return refreshSessionPreviews(normalizedKeys);
}

function toolsEffectiveFailureCode(error: unknown): string {
  return error instanceof OpenClawToolsEffectiveResponseError
    ? error.code
    : 'OPENCLAW_TOOLS_EFFECTIVE_FAILED';
}

/** Fetch the Gateway's server-derived effective tool inventory for one Session. */
export async function refreshToolsEffective(
  sessionKey: string,
  agentId?: string,
): Promise<boolean> {
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  const store = useGatewayDataStore.getState();
  if (!normalizedSessionKey) {
    toolsEffectiveRequestGate.invalidate();
    store.clearToolsEffective();
    store.setToolsEffectiveLoading(null);
    store.setToolsEffectiveError(null);
    return false;
  }
  if (!gw) return false;

  const advertised = gw.hasAdvertisedMethod?.(OPENCLAW_TOOLS_EFFECTIVE_METHOD);
  if (advertised === false) {
    toolsEffectiveRequestGate.invalidate();
    store.clearToolsEffective(normalizedSessionKey);
    store.setToolsEffectiveLoading(null);
    store.setToolsEffectiveError('OPENCLAW_TOOLS_EFFECTIVE_UNSUPPORTED');
    return false;
  }

  const ticket = beginToolsEffectiveRequest(normalizedSessionKey);
  if (!ticket) return false;
  store.clearToolsEffective(normalizedSessionKey);
  store.setToolsEffectiveLoading(normalizedSessionKey);
  store.setToolsEffectiveError(null);

  const client = new OpenClawToolsEffectiveClient(
    <T>(method: string, params: Record<string, unknown>) => (
      ticket.connection.request(method, params) as Promise<T>
    ),
  );
  try {
    const result = await client.get({
      sessionKey: normalizedSessionKey,
      ...(agentId?.trim() ? { agentId: agentId.trim() } : {}),
    });
    if (!isCurrentToolsEffectiveRequest(ticket)) return false;
    const active = useGatewayDataStore.getState().sessions.some(
      (session) => session.key === normalizedSessionKey,
    );
    if (!active) {
      store.clearToolsEffective(normalizedSessionKey);
      store.setToolsEffectiveLoading(null);
      return false;
    }
    store.setToolsEffective(normalizedSessionKey, result);
    return true;
  } catch (error) {
    if (!isCurrentToolsEffectiveRequest(ticket)) return false;
    store.clearToolsEffective(normalizedSessionKey);
    store.setToolsEffectiveLoading(null);
    store.setToolsEffectiveError(toolsEffectiveFailureCode(error));
    return false;
  }
}

/** Fetch effective tools only when the selected Session's snapshot is stale. */
export async function ensureToolsEffectiveFresh(
  sessionKey: string,
  maxAgeMs = TOOLS_EFFECTIVE_FRESHNESS_MS,
  agentId?: string,
): Promise<boolean> {
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  if (!normalizedSessionKey) return false;
  if (!gw) return false;
  const store = useGatewayDataStore.getState();
  if (store.toolsEffectiveLoading) {
    return store.toolsEffectiveLoadingSessionKey === normalizedSessionKey;
  }
  const updatedAt = store.toolsEffectiveUpdatedAt[normalizedSessionKey] ?? 0;
  if (
    updatedAt > 0
    && Date.now() - updatedAt < maxAgeMs
    && Object.prototype.hasOwnProperty.call(store.toolsEffective, normalizedSessionKey)
  ) {
    return true;
  }
  return refreshToolsEffective(normalizedSessionKey, agentId);
}

function toolsCatalogFailureCode(error: unknown): string {
  return error instanceof OpenClawToolsCatalogResponseError
    ? error.code
    : 'OPENCLAW_TOOLS_CATALOG_FAILED';
}

function sessionArtifactsFailureCode(error: unknown): string {
  return error instanceof OpenClawArtifactsResponseError
    ? error.code
    : 'OPENCLAW_ARTIFACTS_FAILED';
}

export interface OpenClawArtifactSaveResult {
  readonly success: boolean;
  readonly canceled?: boolean;
  readonly path?: string;
  readonly errorCode?: string;
}

function artifactSaveName(artifact: OpenClawArtifactSummary): string {
  const title = artifact.title.trim();
  const safeTitle = title.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').trim();
  return safeTitle || `artifact-${artifact.id}`;
}

/**
 * Resolve only the URL forms OpenClaw's artifact handler can advertise as safe.
 * Relative API paths must stay bound to the currently selected Gateway.
 */
export function resolveOpenClawArtifactDownloadUrl(
  source: string,
  gatewayHttpBaseUrl?: string,
): string | null {
  const normalized = typeof source === 'string' ? source.trim() : '';
  if (!normalized) return null;
  if (/^data:[^;]+;base64,/i.test(normalized)) return normalized;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (!normalized.startsWith('/api/')) return null;
  if (!gatewayHttpBaseUrl?.trim()) return null;
  try {
    const base = new URL(gatewayHttpBaseUrl.trim());
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;
    return new URL(normalized, `${base.origin}/`).toString();
  } catch {
    return null;
  }
}

/** Fetch the Gateway's session-scoped artifact summaries. */
export async function refreshSessionArtifacts(
  sessionKey: string,
  agentId?: string,
): Promise<boolean> {
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  const store = useGatewayDataStore.getState();
  if (!normalizedSessionKey) {
    sessionArtifactsRequestGate.invalidate();
    store.clearSessionArtifacts();
    store.setSessionArtifactsLoading(null);
    store.setSessionArtifactsError(null);
    return false;
  }
  if (!gw) return false;

  const advertised = gw.hasAdvertisedMethod?.(OPENCLAW_ARTIFACTS_LIST_METHOD);
  if (advertised === false) {
    sessionArtifactsRequestGate.invalidate();
    store.clearSessionArtifacts(normalizedSessionKey);
    store.setSessionArtifactsLoading(null);
    store.setSessionArtifactsError('OPENCLAW_ARTIFACTS_UNSUPPORTED');
    return false;
  }

  const ticket = beginSessionArtifactsRequest(normalizedSessionKey);
  if (!ticket) return false;
  store.clearSessionArtifacts(normalizedSessionKey);
  store.setSessionArtifactsLoading(normalizedSessionKey);
  store.setSessionArtifactsError(null);

  const client = new OpenClawArtifactsClient(
    <T>(method: string, params: Record<string, unknown>) => (
      ticket.connection.request(method, params) as Promise<T>
    ),
  );
  try {
    const result = await client.list({
      sessionKey: normalizedSessionKey,
      ...(agentId?.trim() ? { agentId: agentId.trim() } : {}),
    });
    if (!isCurrentSessionArtifactsRequest(ticket)) return false;
    const currentState = useGatewayDataStore.getState();
    const sessionsSnapshotReady = currentState.lastFetch.sessions > 0;
    const active = currentState.sessions.some(
      (session) => session.key === normalizedSessionKey,
    ) || !sessionsSnapshotReady;
    if (!active) {
      store.clearSessionArtifacts(normalizedSessionKey);
      store.setSessionArtifactsLoading(null);
      return false;
    }
    store.setSessionArtifacts(normalizedSessionKey, result.artifacts);
    return true;
  } catch (error) {
    if (!isCurrentSessionArtifactsRequest(ticket)) return false;
    store.clearSessionArtifacts(normalizedSessionKey);
    store.setSessionArtifactsLoading(null);
    store.setSessionArtifactsError(sessionArtifactsFailureCode(error));
    return false;
  }
}

/** Fetch session artifacts only when the local summary is stale. */
export async function ensureSessionArtifactsFresh(
  sessionKey: string,
  maxAgeMs = SESSION_ARTIFACTS_FRESHNESS_MS,
  agentId?: string,
): Promise<boolean> {
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  if (!normalizedSessionKey || !gw) return false;
  const store = useGatewayDataStore.getState();
  if (store.sessionArtifactsLoading) {
    return store.sessionArtifactsLoadingKey === normalizedSessionKey;
  }
  const updatedAt = store.sessionArtifactsUpdatedAt[normalizedSessionKey] ?? 0;
  if (
    updatedAt > 0
    && Date.now() - updatedAt < maxAgeMs
    && Object.prototype.hasOwnProperty.call(store.sessionArtifacts, normalizedSessionKey)
  ) {
    return true;
  }
  return refreshSessionArtifacts(normalizedSessionKey, agentId);
}

/** Save one Gateway-confirmed artifact through the desktop file boundary. */
export async function saveSessionArtifact(
  sessionKey: string,
  artifactId: string,
  agentId?: string,
): Promise<OpenClawArtifactSaveResult> {
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  const normalizedArtifactId = typeof artifactId === 'string' ? artifactId.trim() : '';
  if (!normalizedSessionKey || !normalizedArtifactId || !gw) {
    return { success: false, errorCode: 'OPENCLAW_ARTIFACT_SAVE_UNAVAILABLE' };
  }
  const advertised = gw.hasAdvertisedMethod?.(OPENCLAW_ARTIFACTS_DOWNLOAD_METHOD);
  if (advertised === false) {
    return { success: false, errorCode: 'OPENCLAW_ARTIFACT_DOWNLOAD_UNSUPPORTED' };
  }
  const connection = gw;
  const client = new OpenClawArtifactsClient(
    <T>(method: string, params: Record<string, unknown>) => (
      connection.request(method, params) as Promise<T>
    ),
  );
  let result: OpenClawArtifactsDownloadResult;
  try {
    result = await client.download({
      sessionKey: normalizedSessionKey,
      artifactId: normalizedArtifactId,
      ...(agentId?.trim() ? { agentId: agentId.trim() } : {}),
    });
  } catch (error) {
    return { success: false, errorCode: sessionArtifactsFailureCode(error) };
  }
  if (result.artifact.id !== normalizedArtifactId) {
    return { success: false, errorCode: 'OPENCLAW_ARTIFACT_RESPONSE_MISMATCH' };
  }
  let source: string | undefined;
  if (result.artifact.download.mode === 'bytes') {
    if (result.encoding !== 'base64' || typeof result.data !== 'string') {
      return { success: false, errorCode: 'OPENCLAW_ARTIFACT_DOWNLOAD_INVALID' };
    }
    source = `data:${result.artifact.mimeType ?? 'application/octet-stream'};base64,${result.data}`;
  } else if (result.artifact.download.mode === 'url') {
    source = result.url;
    if (!source) return { success: false, errorCode: 'OPENCLAW_ARTIFACT_DOWNLOAD_INVALID' };
  } else {
    return { success: false, errorCode: 'OPENCLAW_ARTIFACT_DOWNLOAD_UNSUPPORTED' };
  }
  if (!source) return { success: false, errorCode: 'OPENCLAW_ARTIFACT_DOWNLOAD_INVALID' };
  const resolvedSource = resolveOpenClawArtifactDownloadUrl(source, connection.getHttpBaseUrl?.());
  if (!resolvedSource) return { success: false, errorCode: 'OPENCLAW_ARTIFACT_DOWNLOAD_INVALID' };

  const saved = await saveChatMedia(resolvedSource, artifactSaveName(result.artifact));
  if (saved.success) return { success: true, ...(saved.path ? { path: saved.path } : {}) };
  if (saved.canceled) return { success: false, canceled: true, errorCode: 'OPENCLAW_ARTIFACT_SAVE_CANCELED' };
  return { success: false, errorCode: 'OPENCLAW_ARTIFACT_SAVE_FAILED' };
}

/** Fetch the Gateway's agent-scoped core/plugin tool catalog. */
export async function refreshToolsCatalog(
  agentId: string,
  includePlugins = true,
): Promise<boolean> {
  const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
  const store = useGatewayDataStore.getState();
  if (!normalizedAgentId) {
    toolsCatalogRequestGate.invalidate();
    store.clearToolsCatalog();
    store.setToolsCatalogLoading(null);
    store.setToolsCatalogError(null);
    return false;
  }
  if (!gw) return false;

  const advertised = gw.hasAdvertisedMethod?.(OPENCLAW_TOOLS_CATALOG_METHOD);
  if (advertised === false) {
    toolsCatalogRequestGate.invalidate();
    store.clearToolsCatalog(normalizedAgentId);
    store.setToolsCatalogLoading(null);
    store.setToolsCatalogError('OPENCLAW_TOOLS_CATALOG_UNSUPPORTED');
    return false;
  }

  const ticket = beginToolsCatalogRequest(normalizedAgentId);
  if (!ticket) return false;
  store.clearToolsCatalog(normalizedAgentId);
  store.setToolsCatalogLoading(normalizedAgentId);
  store.setToolsCatalogError(null);

  const client = new OpenClawToolsCatalogClient(
    <T>(method: string, params: Record<string, unknown>) => (
      ticket.connection.request(method, params) as Promise<T>
    ),
  );
  try {
    const result = await client.get({ agentId: normalizedAgentId, includePlugins });
    if (!isCurrentToolsCatalogRequest(ticket)) return false;
    const active = useGatewayDataStore.getState().agents.some(
      (agent) => agent.id === normalizedAgentId,
    );
    if (!active) {
      store.clearToolsCatalog(normalizedAgentId);
      store.setToolsCatalogLoading(null);
      return false;
    }
    store.setToolsCatalog(normalizedAgentId, result);
    return true;
  } catch (error) {
    if (!isCurrentToolsCatalogRequest(ticket)) return false;
    store.clearToolsCatalog(normalizedAgentId);
    store.setToolsCatalogLoading(null);
    store.setToolsCatalogError(toolsCatalogFailureCode(error));
    return false;
  }
}

/** Fetch an agent catalog only when the selected snapshot is stale. */
export async function ensureToolsCatalogFresh(
  agentId: string,
  maxAgeMs = TOOLS_CATALOG_FRESHNESS_MS,
  includePlugins = true,
): Promise<boolean> {
  const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
  if (!normalizedAgentId || !gw) return false;
  const store = useGatewayDataStore.getState();
  if (store.toolsCatalogLoading) {
    return store.toolsCatalogLoadingAgentId === normalizedAgentId;
  }
  const updatedAt = store.toolsCatalogUpdatedAt[normalizedAgentId] ?? 0;
  if (
    updatedAt > 0
    && Date.now() - updatedAt < maxAgeMs
    && Object.prototype.hasOwnProperty.call(store.toolsCatalog, normalizedAgentId)
  ) {
    return true;
  }
  return refreshToolsCatalog(normalizedAgentId, includePlugins);
}

/**
 * Fetch full-year cost data (for FullAnalytics).
 * NOT part of regular polling — only called on-demand.
 */
export async function fetchFullCost(days = 365): Promise<CostSummary | null> {
  if (!gw) return null;
  try {
    return parseGatewayCostSummary(await gw.request('usage.cost', { days, agentScope: 'all' }));
  } catch {
    return null;
  }
}

/**
 * Fetch heavy usage data on-demand (for FullAnalytics).
 */
export function buildSessionsUsageRequest(
  limit: number,
  query: SessionsUsageQuery = {},
): Record<string, unknown> {
  return { limit, agentScope: 'all', ...query };
}

export async function fetchFullUsage(
  limit = 2000,
  query: SessionsUsageQuery = {},
): Promise<SessionsUsage | null> {
  if (!gw) return null;
  try {
    return parseGatewaySessionsUsage(await gw.request('sessions.usage', buildSessionsUsageRequest(limit, query)));
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// Sub-Agent Detection — polling-based
// Gateway WebSocket does NOT emit stream:"tool" events,
// so we detect running sub-agents from sessions.list data.
// ═══════════════════════════════════════════════════════════

const SUB_AGENT_RE = /^agent:([^:]+):subagent:/;
const SUBAGENT_STALE_ACTIVE_GRACE_MS = 60_000;

function timestampMs(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizedState(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * OpenClaw exposes active-run state on sessions.list. Older rows can omit it,
 * so only a recent timestamp with no contradictory lifecycle field is used as
 * a compatibility fallback.
 */
export function isRunningSubagentSession(session: SessionInfo, now = Date.now()): boolean {
  if (typeof session.hasActiveRun === 'boolean') return session.hasActiveRun;
  if (typeof session.hasActiveSubagentRun === 'boolean') return session.hasActiveSubagentRun;

  const state = normalizedState(session.subagentRunState || session.status);
  const explicitlyActive = state === 'running' || state === 'active' || state === 'started' || state === 'working';
  const hasExplicitTerminalState = Boolean(state) && !explicitlyActive;
  if (hasExplicitTerminalState) return false;
  if (session.running === true || explicitlyActive) {
    return true;
  }
  if (session.running === false) return false;

  const updatedAt = timestampMs(session.updatedAt ?? session.lastActivityAt ?? session.startedAt);
  return updatedAt !== null && now >= updatedAt && now - updatedAt <= SUBAGENT_STALE_ACTIVE_GRACE_MS;
}

/**
 * Sync runningSubAgents from sessions data.
 * Called every 10s in tickFast() after fetchSessions().
 * Sessions with key "agent:<id>:subagent:<uuid>" that appear in sessions.list
 * that are ACTUALLY running. sessions.list also returns ended sub-agent
 * sessions (status=done / endedAt set), so presence alone is NOT "active" —
 * we must filter out ended ones, otherwise AgentHub shows long-dead sub-agents
 * as perpetually running (and users think tokens are being burned).
 */
function syncRunningSubAgents() {
  const store = useGatewayDataStore.getState();
  const sessions = store.sessions;
  const prev = store.runningSubAgents;

  // IMPORTANT: reuse the existing RunningSubAgent object when its fields are
  // unchanged so that the resulting array elements share references with `prev`.
  // This lets `changed` (below) stay false on a no-op poll and prevents
  // subscribers (AgentHub TreeView) from re-rendering and restarting SVG
  // <animateMotion> animations, which caused the visible flicker.
  const running: RunningSubAgent[] = [];
  const now = Date.now();
  for (const s of sessions) {
    const match = s.key?.match(SUB_AGENT_RE);
    if (!match) continue;
    if (!isRunningSubagentSession(s, now)) continue;

    const agentId = match[1];
    const existing = prev.find((r) => r.sessionKey === s.key);
    const label = s.label || s.displayName || '';
    // Reuse the exact same object reference if nothing changed.
    if (existing && existing.agentId === agentId && existing.label === label) {
      running.push(existing);
    } else {
      running.push({
        agentId,
        startTime: existing?.startTime || now,
        label,
        sessionKey: s.key,
      });
    }
  }

  // Only update store if list actually changed
  const prevKeys = new Set(prev.map((r) => r.sessionKey));
  const newKeys = new Set(running.map((r) => r.sessionKey));
  const changed =
    prev.length !== running.length ||
    running.some((r) => !prevKeys.has(r.sessionKey)) ||
    prev.some((r) => !newKeys.has(r.sessionKey));

  if (!changed) return;

  // Log transitions
  for (const r of running) {
    if (!prevKeys.has(r.sessionKey)) {
      debugLog('datastore', '[DataStore] Sub-agent detected:', r.agentId, r.label);
    }
  }
  for (const old of prev) {
    if (!newKeys.has(old.sessionKey)) {
      debugLog('datastore', '[DataStore] Sub-agent done:', old.agentId);
    }
  }

  store.setRunningSubAgents(running);
}

// ═══════════════════════════════════════════════════════════
// Event Handler — real-time updates from Gateway events
// ═══════════════════════════════════════════════════════════

let sessionsChangedRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSessionsChangedDetail: { reason?: string; sessionKey?: string } | null = null;

function scheduleSessionsChangedRefresh(detail: { reason?: string; sessionKey?: string }): void {
  if (!pendingSessionsChangedDetail || detail.reason === 'delete') {
    pendingSessionsChangedDetail = detail;
  }
  if (sessionsChangedRefreshTimer) return;
  sessionsChangedRefreshTimer = setTimeout(() => {
    sessionsChangedRefreshTimer = null;
    const eventDetail = pendingSessionsChangedDetail ?? { reason: 'gateway-event' };
    pendingSessionsChangedDetail = null;
    void fetchSessions();
    try {
      window.dispatchEvent(new CustomEvent('aegis:sessions-changed', {
        detail: eventDetail,
      }));
    } catch {
      // Non-browser tests do not expose window events.
    }
  }, 80);
}

/**
 * Handle a non-chat gateway event and update the store.
 * Call this from gateway.ts handleEvent for non-chat events.
 */
export function handleGatewayEvent(event: string, payload: any) {
  const store = useGatewayDataStore.getState();

  switch (event) {
    // OpenClaw emits this for metadata, lifecycle and transcript changes to
    // subscribed clients. Refresh both data surfaces instead of manufacturing
    // local shadow state.
    case 'sessions.changed': {
      const reason = typeof payload?.reason === 'string' ? payload.reason : '';
      const phase = typeof payload?.phase === 'string' ? payload.phase : '';
      const sessionKey = typeof payload?.sessionKey === 'string'
        ? payload.sessionKey.trim()
        : typeof payload?.key === 'string'
          ? payload.key.trim()
          : '';
      if (reason === 'delete' || reason === 'deleted') {
        if (sessionKey) {
          const sessionId = typeof payload?.sessionId === 'string'
            ? payload.sessionId
            : store.sessions.find((session) => session.key === sessionKey)?.sessionId;
          markSessionDeleted(sessionKey, sessionId);
          requestFence.invalidate('sessions');
          store.setSessions(store.sessions.filter((session) => session.key !== sessionKey));
        }
      }
      // The event itself is OpenClaw's invalidation contract. Lifecycle and
      // transcript updates commonly carry `phase` rather than `reason`, so all
      // sessions.changed events refresh the authoritative session projection.
      scheduleSessionsChangedRefresh({
        reason: reason || phase || 'gateway-event',
        sessionKey: sessionKey || undefined,
      });
      break;
    }

    // ── Session events ──
    case 'session.started':
    case 'session.running': {
      const key = payload?.sessionKey || payload?.key;
      if (!key) break;
      const existing = store.sessions.find((s) => s.key === key);
      if (existing) {
        store.setSessions(
          store.sessions.map((s) => s.key === key ? { ...s, running: true, runningUpdatedAt: Date.now() } : s)
        );
      } else {
        // New session — add it
        // Spread payload first so our explicit fields (running, runningUpdatedAt) always win.
        store.setSessions([...store.sessions, { ...payload, key, running: true, runningUpdatedAt: Date.now() }]);
      }
      debugLog('datastore', '[DataStore] Session started:', key);
      break;
    }

    case 'session.ended':
    case 'session.stopped':
    case 'session.idle': {
      const key = payload?.sessionKey || payload?.key;
      if (!key) break;
      store.setSessions(
        store.sessions.map((s) => s.key === key ? { ...s, running: false, runningUpdatedAt: Date.now() } : s),
      );
      // Immediately remove from runningSubAgents if this is a sub-agent session,
      // instead of waiting up to 10s for the next tickFast() poll cycle.
      if (SUB_AGENT_RE.test(key)) {
        const filtered = store.runningSubAgents.filter((r) => r.sessionKey !== key);
        if (filtered.length !== store.runningSubAgents.length) {
          store.setRunningSubAgents(filtered);
          debugLog('datastore', '[DataStore] Sub-agent removed on session.ended:', key);
        }
      }
      debugLog('datastore', '[DataStore] Session ended:', key);
      break;
    }

    // ── Task status (from backend hook events: PostToolUse/Stop/Notification etc.) ──
    // Backend emits { task_id, status: 'running' | 'input_required' | ... }.
    // Map task_id to the session key. The map is populated by task-session
    // events which carry both fields. The running flag is what the AgentHub uses
    // to determine active vs idle vs input_required.
    case 'task-status': {
      const taskId = payload?.task_id;
      const status: string = payload?.status || 'running';
      if (!taskId) break;
      // Only 'running' is genuinely active. 'input_required' means the agent is
      // waiting for user confirmation — not actively processing — so we do not set
      // running=true for it (avoids the pet showing "working" while blocked).
      const isActive = status === 'running';
      const sessionKey = taskIdToSessionKey(taskId);
      if (!sessionKey) {
        // task-session has not arrived yet — buffer and replay when it does.
        // Do NOT fall back to activeSessionKey: that would pollute the wrong session.
        pendingTaskStatus.set(taskId, { status, ts: Date.now() });
        debugLog('datastore', '[DataStore] task-status buffered (awaiting task-session):', taskId, 'to', status);
        break;
      }
      applyTaskStatus(store, sessionKey, isActive);
      debugLog('datastore', '[DataStore] task-status:', taskId, 'to', status, '(session:', sessionKey, ')');
      break;
    }

    // task-session builds the task_id to session_key map.
    case 'task-session': {
      const taskId = payload?.task_id;
      const sessionId = payload?.session_id;
      if (taskId && sessionId) {
        taskToSession.set(taskId, sessionId);
        // Replay any buffered task-status for this task_id now that the session is known.
        const pending = pendingTaskStatus.get(taskId);
        if (pending) {
          pendingTaskStatus.delete(taskId);
          const age = Date.now() - pending.ts;
          if (age < PENDING_TASK_TTL) {
            const isActive = pending.status === 'running';
            applyTaskStatus(useGatewayDataStore.getState(), sessionId, isActive);
            debugLog('datastore', '[DataStore] task-status replayed:', taskId, 'to', pending.status,
              '(session:', sessionId, ', lag:', age, 'ms)');
          } else {
            debugLog('datastore', '[DataStore] task-status pending expired, discarding:', taskId);
          }
        }
      }
      break;
    }

    // ── Cron events ──
    case 'cron.run.started': {
      const jobId = payload?.jobId || payload?.id;
      if (!jobId) break;
      store.setCronJobs(
        store.cronJobs.map((j) => j.id === jobId ? { ...j, state: 'running' } : j)
      );
      debugLog('datastore', '[DataStore] Cron started:', jobId);
      break;
    }

    case 'cron.run.completed':
    case 'cron.run.finished': {
      const jobId = payload?.jobId || payload?.id;
      if (!jobId) break;
      store.setCronJobs(
        store.cronJobs.map((j) => j.id === jobId
          ? { ...j, state: 'idle', lastRun: new Date().toISOString() }
          : j)
      );
      debugLog('datastore', '[DataStore] Cron completed:', jobId);
      break;
    }

    // ── Agent events ──
    case 'agent.spawned':
    case 'agent.created': {
      // Trigger a full agents refresh to get accurate data
      fetchAgents();
      debugLog('datastore', '[DataStore] Agent event - refreshing agents');
      break;
    }

    // ── Heartbeat / health events ──
    case 'tick':
    case 'health':
      // Expected background events from gateway; keep console clean.
      break;

    // ── Catch-all logging ──
    default:
      debugLog('datastore', '[DataStore] Unhandled event:', event, JSON.stringify(payload).substring(0, 200));
      break;
  }
}
