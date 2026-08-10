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
import { isOpenClawUnknownMethodError } from '@/services/gateway/GatewayProtocolEvidence';
import {
  parseOpenClawCostUsageSummary,
  parseOpenClawSessionsUsage,
  type OpenClawCostUsageDailyEntry,
  type OpenClawCostUsageSummary,
  type OpenClawCostUsageTotals,
  type OpenClawSessionsUsageResult,
} from '@/services/gateway/OpenClawUsageClient';
import {
  OPENCLAW_SESSIONS_PREVIEW_METHOD,
  OPENCLAW_SESSIONS_PREVIEW_MAX_KEYS,
  OpenClawSessionPreviewClient,
  OpenClawSessionPreviewResponseError,
  type OpenClawSessionPreviewEntry,
} from '@/services/gateway/OpenClawSessionPreviewClient';
import {
  OPENCLAW_TOOLS_EFFECTIVE_METHOD,
  OpenClawToolsEffectiveClient,
  OpenClawToolsEffectiveResponseError,
  type OpenClawToolsEffectiveEntry,
  type OpenClawToolsEffectiveResult,
} from '@/services/gateway/OpenClawToolsEffectiveClient';
import {
  OPENCLAW_TOOLS_CATALOG_METHOD,
  OpenClawToolsCatalogClient,
  OpenClawToolsCatalogResponseError,
  type OpenClawToolsCatalogResult,
} from '@/services/gateway/OpenClawToolsCatalogClient';
import {
  OPENCLAW_TOOLS_INVOKE_METHOD,
  OpenClawToolsInvokeClient,
  type OpenClawToolsInvokeInput,
  type OpenClawToolsInvokeResult,
} from '@/services/gateway/OpenClawToolsInvokeClient';
import {
  OPENCLAW_ARTIFACTS_DOWNLOAD_METHOD,
  OPENCLAW_ARTIFACTS_LIST_METHOD,
  OpenClawArtifactsClient,
  OpenClawArtifactsResponseError,
  type OpenClawArtifactSummary,
  type OpenClawArtifactsDownloadResult,
} from '@/services/gateway/OpenClawArtifactsClient';
import {
  OPENCLAW_MEMORY_SEARCH_METHOD,
  OpenClawMemorySearchClient,
  OpenClawMemorySearchResponseError,
  type OpenClawMemorySearchResponse,
} from '@/services/gateway/OpenClawMemorySearchClient';
import {
  OPENCLAW_MEMORY_STATUS_METHOD,
  OpenClawMemoryDiagnosticsClient,
  OpenClawMemoryDiagnosticsResponseError,
  type OpenClawMemoryStatus,
  type OpenClawMemoryStatusInput,
} from '@/services/gateway/OpenClawMemoryDiagnosticsClient';
import {
  OPENCLAW_SESSIONS_SEARCH_METHOD,
  OpenClawSessionSearchClient,
  OpenClawSessionSearchResponseError,
  type OpenClawSessionSearchResult,
} from '@/services/gateway/OpenClawSessionSearchClient';
import { saveChatMedia } from '@/runtime/mediaSaveRuntime';
import {
  parseOpenClawAgentList,
  projectOpenClawSession,
  resolveOpenClawDefaultMainSessionKey,
} from '@/services/gateway/OpenClawSessionProjection';

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
  OpenClawToolsInvokeError,
  OpenClawToolsInvokeInput,
  OpenClawToolsInvokeResult,
} from '@/services/gateway/OpenClawToolsInvokeClient';
export type {
  OpenClawArtifactDownloadMode,
  OpenClawArtifactSummary,
  OpenClawArtifactsDownloadResult,
  OpenClawArtifactsGetResult,
  OpenClawArtifactsListResult,
} from '@/services/gateway/OpenClawArtifactsClient';
export type {
  OpenClawMemorySearchInput,
  OpenClawMemorySearchMode,
  OpenClawMemorySearchResult,
  OpenClawMemorySearchResponse,
  OpenClawMemorySource,
} from '@/services/gateway/OpenClawMemorySearchClient';
export type {
  OpenClawMemoryEmbeddingRuntime,
  OpenClawMemoryEmbeddingStatus,
  OpenClawMemoryStatus,
  OpenClawMemoryStatusInput,
} from '@/services/gateway/OpenClawMemoryDiagnosticsClient';
export type {
  OpenClawSessionSearchHit,
  OpenClawSessionSearchInput,
  OpenClawSessionSearchResult,
  OpenClawSessionSearchRole,
} from '@/services/gateway/OpenClawSessionSearchClient';
import { listOpenClawSessionLifecycle } from '@/services/gateway/OpenClawSessionListClient';
import { listAllOpenClawCronJobs } from '@/services/gateway/OpenClawCronListClient';
import { parseCronStatus, type OpenClawCronStatusSummary } from '@/services/gateway/cronStatus';
import {
  parseCronJobDetails,
  type OpenClawCronJobDetails,
} from '@/services/gateway/cronRuns';
import { sessionListMutationFence } from '@/utils/sessionListMutationFence';

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
//   官方 Gateway 事件只触发相应权威投影刷新，不创建本地生命周期语义。
// ═══════════════════════════════════════════════════════════

// ── Types ────────────────────────────────────────────────

export interface SessionInfo {
  key: string;
  sessionId?: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  category?: string | null;
  unread?: number;
  agentId?: string;
  model?: string;
  running?: boolean;
  totalTokens?: number;
  contextTokens?: number;
  maxTokens?: number;
  compactions?: number;
  lastActive?: string;
  lastTimestamp?: number | string;
  createdAt?: number | string;
  updatedAt?: number | string;
  status?: string;
  hasActiveRun?: boolean;
  hasActiveSubagentRun?: boolean;
  runningUpdatedAt?: number;
  kind?: string;
  pinned?: boolean;
  archived?: boolean;
  [k: string]: unknown;
}

export interface AgentInfo {
  id: string;
  name?: string;
  model?: string;
  workspace?: string;
  [k: string]: unknown;
}

export type DailyEntry = OpenClawCostUsageDailyEntry;
export type CostSummary = OpenClawCostUsageSummary;
export type SessionsUsage = OpenClawSessionsUsageResult;
export type CostUsageTotals = OpenClawCostUsageTotals;

export type SessionsUsageRange = '7d' | '30d' | '90d' | '1y' | 'all';

export interface SessionsUsageQuery {
  range?: SessionsUsageRange;
  startDate?: string;
  endDate?: string;
  mode?: 'utc' | 'gateway' | 'specific';
  utcOffset?: string;
  timeZone?: string;
}

export type CronJob = OpenClawCronJobDetails;

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
  memorySearch: OpenClawMemorySearchResponse | null;
  memorySearchQuery: string;
  memorySearchUpdatedAt: number;
  memorySearchLoading: boolean;
  memorySearchError: string | null;
  memoryDiagnostics: OpenClawMemoryStatus | null;
  memoryDiagnosticsUpdatedAt: number;
  memoryDiagnosticsLoading: boolean;
  memoryDiagnosticsError: string | null;
  sessionSearch: OpenClawSessionSearchResult | null;
  sessionSearchQuery: string;
  sessionSearchUpdatedAt: number;
  sessionSearchLoading: boolean;
  sessionSearchError: string | null;
  agents: AgentInfo[];
  defaultAgentId: string | null;
  mainSessionKey: string | null;
  agentScope: 'per-sender' | 'global' | null;
  costSummary: CostSummary | null;
  sessionsUsage: SessionsUsage | null;
  cronJobs: CronJob[];
  cronStatus: OpenClawCronStatusSummary | null;
  cronStatusError: string | null;
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
  setMemorySearch: (query: string, result: OpenClawMemorySearchResponse) => void;
  clearMemorySearch: () => void;
  setMemorySearchLoading: (query: string | null) => void;
  setMemorySearchError: (value: string | null) => void;
  setMemoryDiagnostics: (result: OpenClawMemoryStatus) => void;
  clearMemoryDiagnostics: () => void;
  setMemoryDiagnosticsLoading: (value: boolean) => void;
  setMemoryDiagnosticsError: (value: string | null) => void;
  setSessionSearch: (query: string, result: OpenClawSessionSearchResult) => void;
  clearSessionSearch: () => void;
  setSessionSearchLoading: (query: string | null) => void;
  setSessionSearchError: (value: string | null) => void;
  setAgents: (agents: AgentInfo[]) => void;
  setAgentSnapshot: (
    agents: AgentInfo[],
    defaultAgentId: string,
    mainSessionKey: string,
    agentScope: 'per-sender' | 'global',
  ) => void;
  setCostSummary: (data: CostSummary) => void;
  setSessionsUsage: (data: SessionsUsage) => void;
  setCronJobs: (jobs: CronJob[]) => void;
  setCronStatus: (status: OpenClawCronStatusSummary | null) => void;
  setCronStatusError: (error: string | null) => void;

  setLoading: (group: keyof GatewayDataState['loading'], val: boolean) => void;
  setError: (group: keyof GatewayDataState['errors'], err: string | null) => void;

  // Sub-agent tracking (synced from sessions polling)
  setRunningSubAgents: (list: RunningSubAgent[]) => void;

  // Mark polling active/inactive
  setPolling: (active: boolean) => void;

  // ── Derived helpers (convenience) ──
  getMainSession: () => SessionInfo | undefined;
}

const EMPTY_SESSION_ARTIFACTS: readonly OpenClawArtifactSummary[] = Object.freeze([]);

export function selectSessionArtifacts(
  state: Pick<GatewayDataState, 'sessionArtifacts'>,
  sessionKey: string,
): readonly OpenClawArtifactSummary[] {
  return state.sessionArtifacts[sessionKey] ?? EMPTY_SESSION_ARTIFACTS;
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
  memorySearch: null,
  memorySearchQuery: '',
  memorySearchUpdatedAt: 0,
  memorySearchLoading: false,
  memorySearchError: null,
  memoryDiagnostics: null,
  memoryDiagnosticsUpdatedAt: 0,
  memoryDiagnosticsLoading: false,
  memoryDiagnosticsError: null,
  sessionSearch: null,
  sessionSearchQuery: '',
  sessionSearchUpdatedAt: 0,
  sessionSearchLoading: false,
  sessionSearchError: null,
  agents: [],
  defaultAgentId: null,
  mainSessionKey: null,
  agentScope: null,
  costSummary: null,
  sessionsUsage: null,
  cronJobs: [],
  cronStatus: null,
  cronStatusError: null,
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
    // `sessions.list` 是运行状态的权威来源；本地时间戳只记录首次观察到活动状态的时刻。
    const visibleSessions = coalesceSessionsByKey(withoutDeletedSessions(sessions));
    const existing = get().sessions;
    const existingByKey = new Map(existing.map((s) => [s.key, s]));
    const merged = visibleSessions.map((s) => {
      const prev = existingByKey.get(s.key);
      if (!prev) {
        return {
          ...s,
          runningUpdatedAt: s.running ? Date.now() : undefined,
        };
      }
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

  setMemorySearch: (query, result) => set({
    memorySearch: result,
    memorySearchQuery: query,
    memorySearchUpdatedAt: Date.now(),
    memorySearchLoading: false,
    memorySearchError: null,
  }),

  clearMemorySearch: () => set({
    memorySearch: null,
    memorySearchQuery: '',
    memorySearchUpdatedAt: 0,
  }),

  setMemorySearchLoading: (query) => set((state) => ({
    memorySearchLoading: query !== null,
    ...(query !== null ? { memorySearchQuery: query } : {}),
    ...(query !== null && state.memorySearchQuery !== query
      ? { memorySearch: null, memorySearchUpdatedAt: 0 }
      : {}),
  })),

  setMemorySearchError: (value) => set({ memorySearchError: value }),

  setMemoryDiagnostics: (result) => set({
    memoryDiagnostics: result,
    memoryDiagnosticsUpdatedAt: Date.now(),
    memoryDiagnosticsLoading: false,
    memoryDiagnosticsError: null,
  }),

  clearMemoryDiagnostics: () => set({
    memoryDiagnostics: null,
    memoryDiagnosticsUpdatedAt: 0,
  }),

  setMemoryDiagnosticsLoading: (value) => set({ memoryDiagnosticsLoading: value }),

  setMemoryDiagnosticsError: (value) => set({ memoryDiagnosticsError: value }),

  setSessionSearch: (query, result) => set({
    sessionSearch: result,
    sessionSearchQuery: query,
    sessionSearchUpdatedAt: Date.now(),
    sessionSearchLoading: false,
    sessionSearchError: null,
  }),

  clearSessionSearch: () => set({
    sessionSearch: null,
    sessionSearchQuery: '',
    sessionSearchUpdatedAt: 0,
  }),

  setSessionSearchLoading: (query) => set((state) => ({
    sessionSearchLoading: query !== null,
    ...(query !== null ? { sessionSearchQuery: query } : {}),
    ...(query !== null && state.sessionSearchQuery !== query
      ? { sessionSearch: null, sessionSearchUpdatedAt: 0 }
      : {}),
  })),

  setSessionSearchError: (value) => set({ sessionSearchError: value }),

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

  setAgentSnapshot: (agents, defaultAgentId, mainSessionKey, agentScope) => {
    get().setAgents(agents);
    set({ defaultAgentId, mainSessionKey, agentScope });
  },

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

  setCronStatus: (status) => set({ cronStatus: status }),

  setCronStatusError: (error) => set({ cronStatusError: error }),

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
  recordCapabilityInvalidResponse?: (method: string) => void;
  getAttestedConnectionId?: () => string | null;
  requestFenced?: (
    method: string,
    params: GatewayRequestParams,
    expectedConnectionId: string,
  ) => Promise<unknown>;
  getHttpBaseUrl?: () => string;
};

function isGatewayRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function gatewayErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error);
}

function isAgentInfo(value: unknown): value is AgentInfo {
  return isGatewayRecord(value)
    && typeof value.id === 'string'
    && value.id.trim().length > 0;
}

export function parseGatewayAgentList(response: unknown): {
  agents: AgentInfo[];
  defaultAgentId: string;
  mainSessionKey: string;
  scope: 'per-sender' | 'global';
} | null {
  try {
    const snapshot = parseOpenClawAgentList(response);
    if (!snapshot.agents.every(isAgentInfo)) return null;
    return {
      agents: [...snapshot.agents],
      defaultAgentId: snapshot.defaultId,
      mainSessionKey: resolveOpenClawDefaultMainSessionKey(snapshot),
      scope: snapshot.scope,
    };
  } catch {
    return null;
  }
}

export function parseGatewayCronJobList(response: unknown): CronJob[] | null {
  if (!isGatewayRecord(response) || !Array.isArray(response.jobs)) return null;
  try {
    return response.jobs.map((entry) => parseCronJobDetails(entry, 'cron.list'));
  } catch {
    return null;
  }
}

export function parseGatewayCostSummary(response: unknown): CostSummary | null {
  return parseOpenClawCostUsageSummary(response);
}

export function parseGatewaySessionsUsage(response: unknown): SessionsUsage | null {
  return parseOpenClawSessionsUsage(response);
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
const memorySearchRequestGate = createLatestRequestGate();
const memoryDiagnosticsRequestGate = createLatestRequestGate();
const sessionSearchRequestGate = createLatestRequestGate();

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

interface MemorySearchRequestTicket {
  connection: GatewayRequester;
  requestId: number;
  query: string;
}

function beginMemorySearchRequest(query: string): MemorySearchRequestTicket | null {
  if (!gw) return null;
  return {
    connection: gw,
    requestId: memorySearchRequestGate.begin(),
    query,
  };
}

function isCurrentMemorySearchRequest(ticket: MemorySearchRequestTicket): boolean {
  return ticket.connection === gw
    && memorySearchRequestGate.isCurrent(ticket.requestId)
    && useGatewayDataStore.getState().memorySearchLoading
    && useGatewayDataStore.getState().memorySearchQuery === ticket.query;
}

interface MemoryDiagnosticsRequestTicket {
  connection: GatewayRequester;
  requestId: number;
}

function beginMemoryDiagnosticsRequest(): MemoryDiagnosticsRequestTicket | null {
  if (!gw) return null;
  return {
    connection: gw,
    requestId: memoryDiagnosticsRequestGate.begin(),
  };
}

function isCurrentMemoryDiagnosticsRequest(ticket: MemoryDiagnosticsRequestTicket): boolean {
  return ticket.connection === gw
    && memoryDiagnosticsRequestGate.isCurrent(ticket.requestId)
    && useGatewayDataStore.getState().memoryDiagnosticsLoading;
}

interface SessionSearchRequestTicket {
  connection: GatewayRequester;
  requestId: number;
  query: string;
}

function beginSessionSearchRequest(query: string): SessionSearchRequestTicket | null {
  if (!gw) return null;
  return {
    connection: gw,
    requestId: sessionSearchRequestGate.begin(),
    query,
  };
}

function isCurrentSessionSearchRequest(ticket: SessionSearchRequestTicket): boolean {
  return ticket.connection === gw
    && sessionSearchRequestGate.isCurrent(ticket.requestId)
    && useGatewayDataStore.getState().sessionSearchLoading
    && useGatewayDataStore.getState().sessionSearchQuery === ticket.query;
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
  const mutationRevision = sessionListMutationFence.capture();
  const store = useGatewayDataStore.getState();
  const agentIds = store.agents.map((agent) => agent.id);
  // 会话列表按 OpenClaw 已确认的智能体范围读取；首个智能体快照到达前不能把时序竞争记为会话错误。
  if (agentIds.length === 0) return false;
  store.setLoading('sessions', true);
  try {
    const responses = await listOpenClawSessionLifecycle(
      (method, params) => ticket.connection.request(method, params),
      agentIds,
    );
    if (!isCurrentGatewayRequest(ticket) || !sessionListMutationFence.isCurrent(mutationRevision)) {
      return false;
    }
    const activeSnapshot = parseOpenClawSessionListSnapshot(responses.active);
    const archivedSnapshot = responses.archived === undefined
      ? undefined
      : parseOpenClawSessionListSnapshot(responses.archived);
    const sessionListSnapshot = {
      sessions: coalesceSessionsByKey([
        ...(activeSnapshot.sessions as SessionInfo[]),
        ...((archivedSnapshot?.sessions as SessionInfo[] | undefined) ?? []),
      ]),
      complete: activeSnapshot.complete && (archivedSnapshot?.complete ?? true),
    };
    const rawList: SessionInfo[] = sessionListSnapshot.sessions.map((value) => {
      const projected = projectOpenClawSession(value);
      return {
        ...projected,
        category: projected.category ?? null,
        unread: projected.unread === true ? 1 : 0,
      };
    });

    // 保留本地观察时间；最终活动状态仍由当前官方会话快照决定。
    const prev = store.sessions;
    const prevByKey = new Map(prev.map((s) => [s.key, s]));
    const incomingList = rawList.map((s) => {
      const existing = prevByKey.get(s.key);
      if (!existing) return s;
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
    const same = JSON.stringify(prev) === JSON.stringify(list);
    if (!same) {
      store.setSessions(list);
    } else {
      store.setLoading('sessions', false);
    }
    return true;
  } catch (error: unknown) {
    if (!isCurrentGatewayRequest(ticket)) return false;
    store.setError('sessions', gatewayErrorMessage(error));
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
    const snapshot = parseGatewayAgentList(res);
    if (!snapshot) {
      rejectGatewayResponse(store, 'agents', 'agents.list');
      return false;
    }
    store.setAgentSnapshot(
      snapshot.agents,
      snapshot.defaultAgentId,
      snapshot.mainSessionKey,
      snapshot.scope,
    );
    return true;
  } catch (error: unknown) {
    if (!isCurrentGatewayRequest(ticket)) return false;
    store.setError('agents', gatewayErrorMessage(error));
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
  } catch (error: unknown) {
    if (!isCurrentGatewayRequest(ticket)) return;
    store.setError('cost', gatewayErrorMessage(error));
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
  } catch (error: unknown) {
    if (!isCurrentGatewayRequest(ticket)) return;
    store.setError('usage', gatewayErrorMessage(error));
    store.setLoading('usage', false);
  }
}

async function fetchCron(): Promise<boolean> {
  const ticket = beginGatewayRequest('cron');
  if (!ticket) return false;
  const store = useGatewayDataStore.getState();
  store.setLoading('cron', true);
  try {
    const [jobsResponse, statusResponse] = await Promise.allSettled([
      listAllOpenClawCronJobs((method, params) => ticket.connection.request(method, params)),
      ticket.connection.request('cron.status', {}),
    ]);
    if (!isCurrentGatewayRequest(ticket)) return false;
    if (jobsResponse.status === 'rejected') {
      throw jobsResponse.reason;
    }
    const list = parseGatewayCronJobList(jobsResponse.value);
    if (!list) {
      ticket.connection.recordCapabilityInvalidResponse?.('cron.list');
      rejectGatewayResponse(store, 'cron', 'cron.list');
      return false;
    }
    store.setCronJobs(list);
    if (statusResponse.status === 'fulfilled') {
      try {
        store.setCronStatus(parseCronStatus(statusResponse.value));
        store.setCronStatusError(null);
      } catch {
        ticket.connection.recordCapabilityInvalidResponse?.('cron.status');
        store.setCronStatus(null);
        store.setCronStatusError('Gateway returned an invalid cron.status response');
      }
    } else {
      store.setCronStatus(null);
      store.setCronStatusError(gatewayErrorMessage(statusResponse.reason));
    }
    return true;
  } catch (error: unknown) {
    if (!isCurrentGatewayRequest(ticket)) return false;
    store.setError('cron', gatewayErrorMessage(error));
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
  memorySearchRequestGate.invalidate();
  memoryDiagnosticsRequestGate.invalidate();
  sessionSearchRequestGate.invalidate();
  gw = gateway;
  useGatewayDataStore.getState().setPolling(true);
  debugLog('datastore', '[DataStore] Polling started (sessions=10s, agents=30s, demand groups lazy)');

  // 初始会话请求依赖 agents.list 的权威范围。先完成智能体快照，避免并发启动时
  // sessions.list 以空范围失败并在侧栏显示误导性的会话加载错误。
  void fetchAgents().then((agentsLoaded) => {
    if (agentsLoaded && gw === gateway && useGatewayDataStore.getState().polling) {
      void tickFast();
    }
  });

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
  memorySearchRequestGate.invalidate();
  memoryDiagnosticsRequestGate.invalidate();
  sessionSearchRequestGate.invalidate();
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
  store.clearMemorySearch();
  store.setMemorySearchLoading(null);
  store.setMemorySearchError(null);
  store.clearMemoryDiagnostics();
  store.setMemoryDiagnosticsLoading(false);
  store.setMemoryDiagnosticsError(null);
  store.clearSessionSearch();
  store.setSessionSearchLoading(null);
  store.setSessionSearchError(null);
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
  if (error instanceof OpenClawSessionPreviewResponseError) return error.code;
  return isOpenClawUnknownMethodError(error, OPENCLAW_SESSIONS_PREVIEW_METHOD)
    ? 'OPENCLAW_SESSIONS_PREVIEW_UNSUPPORTED'
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
  if (error instanceof OpenClawToolsEffectiveResponseError) return error.code;
  return isOpenClawUnknownMethodError(error, OPENCLAW_TOOLS_EFFECTIVE_METHOD)
    ? 'OPENCLAW_TOOLS_EFFECTIVE_UNSUPPORTED'
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

export class OpenClawToolsInvokeUnavailableError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OpenClawToolsInvokeUnavailableError';
  }
}

function effectiveToolForSession(
  sessionKey: string,
  toolName: string,
): OpenClawToolsEffectiveEntry | null {
  const snapshot = useGatewayDataStore.getState().toolsEffective[sessionKey];
  if (!snapshot) return null;
  for (const group of snapshot.groups) {
    const tool = group.tools.find((entry) => entry.id === toolName);
    if (tool) return tool;
  }
  return null;
}

function createToolsInvokeIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  throw new OpenClawToolsInvokeUnavailableError(
    'OPENCLAW_TOOLS_INVOKE_IDEMPOTENCY_UNAVAILABLE',
    'JunQi could not create an idempotency key for the OpenClaw tool call',
  );
}

/**
 * Invoke one tool that OpenClaw currently reports as effective for a Session.
 * The helper deliberately does not write a chat message or retry an uncertain
 * transport outcome. OpenClaw remains responsible for tool authorization,
 * approval and execution semantics.
 */
export async function invokeOpenClawTool(
  input: OpenClawToolsInvokeInput,
): Promise<OpenClawToolsInvokeResult> {
  const normalizedSessionKey = normalizeSessionKey(input.sessionKey ?? '');
  const normalizedToolName = typeof input.name === 'string' ? input.name.trim() : '';
  if (!normalizedSessionKey) {
    throw new OpenClawToolsInvokeUnavailableError(
      'OPENCLAW_TOOLS_INVOKE_SESSION_REQUIRED',
      'OpenClaw tools.invoke requires a Session key',
    );
  }
  if (!normalizedToolName) {
    throw new OpenClawToolsInvokeUnavailableError(
      'OPENCLAW_TOOLS_INVOKE_TOOL_REQUIRED',
      'OpenClaw tools.invoke requires a tool name',
    );
  }
  if (!gw) {
    throw new OpenClawToolsInvokeUnavailableError(
      'OPENCLAW_TOOLS_INVOKE_GATEWAY_UNAVAILABLE',
      'The OpenClaw Gateway is not connected',
    );
  }

  const session = useGatewayDataStore.getState().sessions.find(
    (entry) => entry.key === normalizedSessionKey,
  );
  if (!session) {
    throw new OpenClawToolsInvokeUnavailableError(
      'OPENCLAW_TOOLS_INVOKE_SESSION_UNKNOWN',
      'The selected OpenClaw Session is no longer available',
    );
  }

  await ensureToolsEffectiveFresh(normalizedSessionKey);
  const effectiveSnapshotState = useGatewayDataStore.getState();
  const effectiveSnapshot = effectiveSnapshotState.toolsEffective[normalizedSessionKey];
  const effectiveUpdatedAt = effectiveSnapshotState.toolsEffectiveUpdatedAt[normalizedSessionKey] ?? 0;
  if (
    !effectiveSnapshot
    || effectiveSnapshotState.toolsEffectiveLoading
    || effectiveUpdatedAt <= 0
    || Date.now() - effectiveUpdatedAt >= TOOLS_EFFECTIVE_FRESHNESS_MS
  ) {
    throw new OpenClawToolsInvokeUnavailableError(
      'OPENCLAW_TOOLS_INVOKE_EFFECTIVE_STALE',
      'JunQi could not verify a current effective tool snapshot for the selected Session',
    );
  }
  const effectiveTool = effectiveToolForSession(normalizedSessionKey, normalizedToolName);
  if (!effectiveTool) {
    throw new OpenClawToolsInvokeUnavailableError(
      'OPENCLAW_TOOLS_INVOKE_TOOL_NOT_EFFECTIVE',
      'OpenClaw did not report this tool as effective for the selected Session',
    );
  }
  if (effectiveTool.deniedBySession === true) {
    throw new OpenClawToolsInvokeUnavailableError(
      'OPENCLAW_TOOLS_INVOKE_TOOL_DENIED',
      'OpenClaw marked this tool as denied for the selected Session',
    );
  }

  const connection = gw;
  const connectionId = connection.getAttestedConnectionId?.() ?? null;
  const request = connection.requestFenced && connection.getAttestedConnectionId
    ? (connectionId
      ? (method: string, params: Record<string, unknown>) => connection.requestFenced!(method, params, connectionId)
      : null)
    : (method: string, params: Record<string, unknown>) => connection.request(method, params);
  if (!request) {
    throw new OpenClawToolsInvokeUnavailableError(
      'OPENCLAW_TOOLS_INVOKE_CONNECTION_UNATTESTED',
      'The current OpenClaw Gateway connection has no verified runtime identity',
    );
  }

  const client = new OpenClawToolsInvokeClient(
    <T>(method: string, params: Record<string, unknown>) => request(method, params) as Promise<T>,
  );
  try {
    return await client.invoke({
      ...input,
      name: normalizedToolName,
      sessionKey: normalizedSessionKey,
      agentId: typeof input.agentId === 'string' && input.agentId.trim()
        ? input.agentId.trim()
        : effectiveSnapshot.agentId,
      idempotencyKey: input.idempotencyKey?.trim() || createToolsInvokeIdempotencyKey(),
    });
  } catch (error) {
    if (isOpenClawUnknownMethodError(error, OPENCLAW_TOOLS_INVOKE_METHOD)) {
      throw new OpenClawToolsInvokeUnavailableError(
        'OPENCLAW_TOOLS_INVOKE_UNSUPPORTED',
        'The OpenClaw Gateway does not support tools.invoke',
      );
    }
    throw error;
  }
}

function toolsCatalogFailureCode(error: unknown): string {
  if (error instanceof OpenClawToolsCatalogResponseError) return error.code;
  return isOpenClawUnknownMethodError(error, OPENCLAW_TOOLS_CATALOG_METHOD)
    ? 'OPENCLAW_TOOLS_CATALOG_UNSUPPORTED'
    : 'OPENCLAW_TOOLS_CATALOG_FAILED';
}

function sessionArtifactsFailureCode(error: unknown, method: string): string {
  if (error instanceof OpenClawArtifactsResponseError) return error.code;
  return isOpenClawUnknownMethodError(error, method)
    ? 'OPENCLAW_ARTIFACTS_UNSUPPORTED'
    : 'OPENCLAW_ARTIFACTS_FAILED';
}

function memorySearchFailureCode(error: unknown): string {
  if (error instanceof OpenClawMemorySearchResponseError) return error.code;
  return isOpenClawUnknownMethodError(error, OPENCLAW_MEMORY_SEARCH_METHOD)
    ? 'OPENCLAW_MEMORY_SEARCH_UNSUPPORTED'
    : 'OPENCLAW_MEMORY_SEARCH_FAILED';
}

function memoryDiagnosticsFailureCode(error: unknown): string {
  if (error instanceof OpenClawMemoryDiagnosticsResponseError) {
    return error.code;
  }
  if (isOpenClawUnknownMethodError(error, OPENCLAW_MEMORY_STATUS_METHOD)) {
    return 'OPENCLAW_MEMORY_DIAGNOSTICS_UNSUPPORTED';
  }
  return 'OPENCLAW_MEMORY_STATUS_FAILED';
}

function sessionSearchFailureCode(error: unknown): string {
  if (error instanceof OpenClawSessionSearchResponseError) return error.code;
  return isOpenClawUnknownMethodError(error, OPENCLAW_SESSIONS_SEARCH_METHOD)
    ? 'OPENCLAW_SESSIONS_SEARCH_UNSUPPORTED'
    : 'OPENCLAW_SESSIONS_SEARCH_FAILED';
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
    store.setSessionArtifactsError(sessionArtifactsFailureCode(error, OPENCLAW_ARTIFACTS_LIST_METHOD));
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

/** Search the Gateway-owned OpenClaw memory index without synthesizing local results. */
export async function searchOpenClawMemory(
  query: string,
  options: {
    readonly maxResults?: number;
    readonly minScore?: number;
    readonly agentId?: string;
  } = {},
): Promise<boolean> {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  const store = useGatewayDataStore.getState();
  if (!normalizedQuery) {
    memorySearchRequestGate.invalidate();
    store.clearMemorySearch();
    store.setMemorySearchLoading(null);
    store.setMemorySearchError(null);
    return false;
  }
  if (!gw) {
    memorySearchRequestGate.invalidate();
    store.clearMemorySearch();
    store.setMemorySearchLoading(null);
    store.setMemorySearchError('OPENCLAW_MEMORY_SEARCH_UNAVAILABLE');
    return false;
  }

  const ticket = beginMemorySearchRequest(normalizedQuery);
  if (!ticket) return false;
  store.clearMemorySearch();
  store.setMemorySearchLoading(normalizedQuery);
  store.setMemorySearchError(null);

  const client = new OpenClawMemorySearchClient(
    <T>(method: string, params: Record<string, unknown>) => (
      ticket.connection.request(method, params) as Promise<T>
    ),
  );
  try {
    const result = await client.search({
      query: normalizedQuery,
      ...(options.maxResults !== undefined ? { maxResults: options.maxResults } : {}),
      ...(options.minScore !== undefined ? { minScore: options.minScore } : {}),
      ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
    });
    if (!isCurrentMemorySearchRequest(ticket)) return false;
    store.setMemorySearch(normalizedQuery, result);
    return true;
  } catch (error) {
    if (!isCurrentMemorySearchRequest(ticket)) return false;
    store.clearMemorySearch();
    store.setMemorySearchLoading(null);
    store.setMemorySearchError(memorySearchFailureCode(error));
    return false;
  }
}

/** Read Gateway-owned memory readiness without probing the embedding provider by default. */
export async function refreshOpenClawMemoryDiagnostics(
  options: OpenClawMemoryStatusInput = {},
): Promise<boolean> {
  const store = useGatewayDataStore.getState();
  if (!gw) {
    memoryDiagnosticsRequestGate.invalidate();
    store.clearMemoryDiagnostics();
    store.setMemoryDiagnosticsLoading(false);
    store.setMemoryDiagnosticsError('OPENCLAW_MEMORY_DIAGNOSTICS_UNAVAILABLE');
    return false;
  }

  const ticket = beginMemoryDiagnosticsRequest();
  if (!ticket) return false;
  store.clearMemoryDiagnostics();
  store.setMemoryDiagnosticsLoading(true);
  store.setMemoryDiagnosticsError(null);

  const client = new OpenClawMemoryDiagnosticsClient(
    <T>(method: string, params: Record<string, unknown>) => (
      ticket.connection.request(method, params) as Promise<T>
    ),
  );
  try {
    const result = await client.status(options);
    if (!isCurrentMemoryDiagnosticsRequest(ticket)) return false;
    store.setMemoryDiagnostics(result);
    return true;
  } catch (error) {
    if (!isCurrentMemoryDiagnosticsRequest(ticket)) return false;
    store.clearMemoryDiagnostics();
    store.setMemoryDiagnosticsLoading(false);
    store.setMemoryDiagnosticsError(memoryDiagnosticsFailureCode(error));
    return false;
  }
}

/** Search Gateway-owned session transcripts without synthesizing local hits. */
export async function searchOpenClawSessions(
  query: string,
  options: {
    readonly agentId?: string;
    readonly sessionKeys?: readonly string[];
    readonly limit?: number;
  } = {},
): Promise<boolean> {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  const store = useGatewayDataStore.getState();
  if (!normalizedQuery) {
    sessionSearchRequestGate.invalidate();
    store.clearSessionSearch();
    store.setSessionSearchLoading(null);
    store.setSessionSearchError(null);
    return false;
  }
  if (!gw) {
    sessionSearchRequestGate.invalidate();
    store.clearSessionSearch();
    store.setSessionSearchLoading(null);
    store.setSessionSearchError('OPENCLAW_SESSIONS_SEARCH_UNAVAILABLE');
    return false;
  }

  const ticket = beginSessionSearchRequest(normalizedQuery);
  if (!ticket) return false;
  store.clearSessionSearch();
  store.setSessionSearchLoading(normalizedQuery);
  store.setSessionSearchError(null);

  const client = new OpenClawSessionSearchClient(
    <T>(method: string, params: Record<string, unknown>) => (
      ticket.connection.request(method, params) as Promise<T>
    ),
  );
  try {
    const result = await client.search({
      query: normalizedQuery,
      ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
      ...(options.sessionKeys !== undefined ? { sessionKeys: options.sessionKeys } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
    if (!isCurrentSessionSearchRequest(ticket)) return false;
    store.setSessionSearch(normalizedQuery, result);
    return true;
  } catch (error) {
    if (!isCurrentSessionSearchRequest(ticket)) return false;
    store.clearSessionSearch();
    store.setSessionSearchLoading(null);
    store.setSessionSearchError(sessionSearchFailureCode(error));
    return false;
  }
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
    return {
      success: false,
      errorCode: sessionArtifactsFailureCode(error, OPENCLAW_ARTIFACTS_DOWNLOAD_METHOD),
    };
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

/**
 * 只投影 OpenClaw sessions.list 明确返回的活动运行字段。
 * 字段缺失表示运行事实未知，客户端保守显示为非活动。
 */
export function isRunningSubagentSession(session: SessionInfo): boolean {
  if (typeof session.hasActiveRun === 'boolean') return session.hasActiveRun;
  if (typeof session.hasActiveSubagentRun === 'boolean') return session.hasActiveSubagentRun;
  return false;
}

/**
 * 从 sessions.list 同步当前明确处于活动运行的子智能体。
 * 会话存在本身不代表仍在运行，必须先通过官方活动字段筛选。
 */
function syncRunningSubAgents() {
  const store = useGatewayDataStore.getState();
  const sessions = store.sessions;
  const prev = store.runningSubAgents;

  // 字段未变时复用对象引用，避免无变化轮询使订阅者重渲染并重启动效。
  const running: RunningSubAgent[] = [];
  const now = Date.now();
  for (const s of sessions) {
    const match = s.key?.match(SUB_AGENT_RE);
    if (!match) continue;
    if (!isRunningSubagentSession(s)) continue;

    const agentId = match[1];
    const existing = prev.find((r) => r.sessionKey === s.key);
    const label = s.label || s.displayName || '';
    // 没有变化时保留原对象引用。
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

  // 仅在列表真实变化时更新 store。
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

function previewGatewayEventPayload(payload: unknown): string {
  try {
    const serialized = JSON.stringify(payload);
    return typeof serialized === 'string' ? serialized.slice(0, 200) : String(serialized);
  } catch {
    return '[不可序列化的事件载荷]';
  }
}

/**
 * 处理非聊天 Gateway 事件并更新数据投影。
 * 仅由 Gateway 事件分发器传入，不在此处创建本地生命周期状态。
 */
export function handleGatewayEvent(event: string, payload: unknown): void {
  const store = useGatewayDataStore.getState();
  const eventPayload = isGatewayRecord(payload) ? payload : null;

  switch (event) {
    // OpenClaw 用该事件通知元数据、生命周期和转录变化。只刷新权威投影，
    // 不根据载荷制造本地影子状态。
    case 'sessions.changed': {
      const reason = typeof eventPayload?.reason === 'string' ? eventPayload.reason : '';
      const phase = typeof eventPayload?.phase === 'string' ? eventPayload.phase : '';
      const sessionKey = typeof eventPayload?.sessionKey === 'string'
        ? eventPayload.sessionKey.trim()
        : typeof eventPayload?.key === 'string'
          ? eventPayload.key.trim()
          : '';
      if (reason === 'delete' || reason === 'deleted') {
        if (sessionKey) {
          const sessionId = typeof eventPayload?.sessionId === 'string'
            ? eventPayload.sessionId
            : store.sessions.find((session) => session.key === sessionKey)?.sessionId;
          markSessionDeleted(sessionKey, sessionId);
          requestFence.invalidate('sessions');
          store.setSessions(store.sessions.filter((session) => session.key !== sessionKey));
        }
      }
      // 该事件本身是 OpenClaw 的失效通知契约。生命周期和转录更新可能传递
      // `phase` 而非 `reason`，因此均刷新权威会话投影。
      scheduleSessionsChangedRefresh({
        reason: reason || phase || 'gateway-event',
        sessionKey: sessionKey || undefined,
      });
      break;
    }

    // 当前 OpenClaw 只公开 cron 事件族，未公开可投影到本地状态的载荷 schema，
    // 因此仅将其作为失效通知。
    case 'cron': {
      void fetchCron();
      debugLog('datastore', '[DataStore] Cron changed; refreshing Gateway projection');
      break;
    }

    // 心跳和健康事件属于预期后台事件，不写入控制台。
    case 'tick':
    case 'health':
      break;

    // 其他事件只记录受限预览，避免日志路径再次因未知载荷失败。
    default:
      debugLog('datastore', '[DataStore] Unhandled event:', event, previewGatewayEventPayload(payload));
      break;
  }
}
