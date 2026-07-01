import { create } from 'zustand';
import { useChatStore } from './chatStore';

// ═══════════════════════════════════════════════════════════
// Gateway Data Store — Central data layer for all pages
//
// DESIGN:
//   All pages READ from this store — nobody calls gateway directly.
//   Smart polling fetches at 3 speeds:
//     Fast  (10s)  → sessions.list         (who's running now?)
//     Mid   (30s)  → agents.list + cron    (rarely change)
//     Slow  (120s) → usage.cost + sessions.usage (heavy, slow-changing)
//
//   Gateway events (session.started, etc.) update the store
//   in real-time without polling.
// ═══════════════════════════════════════════════════════════

// ── Types ────────────────────────────────────────────────

export interface SessionInfo {
  key: string;
  label?: string;
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
  cacheRead?: number;
  cacheWrite?: number;
  requests: number;
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
    requests: number;
    [k: string]: any;
  };
  updatedAt?: number;
}

export interface SessionsUsage {
  sessions?: any[];
  totals?: any;
  aggregates?: {
    byAgent?: any[];
    byModel?: any[];
    [k: string]: any;
  };
  [k: string]: any;
}

export interface CronJob {
  id: string;
  name?: string;
  schedule?: any;
  enabled?: boolean;
  lastRun?: string;
  state?: any;
  // Gateway 2026.2.22+: split run vs delivery status
  lastRunStatus?: string;
  lastDeliveryStatus?: string;
  [k: string]: any;
}

// ── task_id → session_key map (populated by 'task-session' events) ──
const taskToSession = new Map<string, string>();
function taskIdToSessionKey(taskId: string): string | undefined {
  return taskToSession.get(taskId);
}

// ── Pending task-status buffer ────────────────────────────────────────────
// task-status can arrive before task-session (which maps task_id → session_key).
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
  if (!isActive) {
    useChatStore.getState().setIsTyping(false, sessionKey);
  }
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

  // ── Actions ──

  // Setters (called by polling engine or event handler)
  setSessions: (sessions: SessionInfo[]) => void;
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

  // ── Setters ──

  setSessions: (sessions) => {
    // Merge incoming sessions with existing ones, preserving event-driven fields
    // (runningUpdatedAt) that the polling API does not return. Without this,
    // every 10s poll wipes the freshness stamp → isFreshRunning returns false →
    // pet shows idle while an agent is actively working.
    const existing = get().sessions;
    const existingByKey = new Map(existing.map((s) => [s.key, s]));
    const merged = sessions.map((s) => {
      const prev = existingByKey.get(s.key);
      if (!prev) return s;
      // Poll says running=false → drop freshness stamp (task ended).
      // Poll says running=true but prev has no stamp → mint one now.
      const runningUpdatedAt = s.running === false
        ? undefined
        : (prev.runningUpdatedAt ?? (s.running ? Date.now() : undefined));
      return { ...s, runningUpdatedAt };
    });
    set({
      sessions: merged,
      lastFetch: { ...get().lastFetch, sessions: Date.now() },
      loading: { ...get().loading, sessions: false },
      errors: { ...get().errors, sessions: null },
    });
  },

  setAgents: (agents) =>
    set({
      agents,
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

  setPolling: (active) => set({ polling: active }),

  // ── Derived ──

  getMainSession: () =>
    get().sessions.find((s) => s.key === 'agent:main:main'),
}));


// ═══════════════════════════════════════════════════════════
// Polling Engine — starts/stops with gateway connection
// ═══════════════════════════════════════════════════════════

// Polling intervals (ms)
const FAST_INTERVAL  = 10_000;   // 10s — sessions
const MID_INTERVAL   = 30_000;   // 30s — agents + cron
const SLOW_INTERVAL  = 120_000;  // 120s — cost + usage

let fastTimer:  ReturnType<typeof setInterval> | null = null;
let midTimer:   ReturnType<typeof setInterval> | null = null;
let slowTimer:  ReturnType<typeof setInterval> | null = null;

// Reference to gateway connection (set by startPolling)
// Uses request() directly to avoid circular imports with gateway facade
let gw: { request: (method: string, params: any) => Promise<any> } | null = null;

// ── Fetch functions ──────────────────────────────────────

async function fetchSessions() {
  if (!gw) return;
  const store = useGatewayDataStore.getState();
  store.setLoading('sessions', true);
  try {
    const res = await gw.request('sessions.list', {});
    const rawList: SessionInfo[] = Array.isArray(res?.sessions) ? res.sessions : [];

    // Merge: preserve event-enriched runningUpdatedAt that the server does not return.
    // IMPORTANT: polling must NEVER generate a new runningUpdatedAt timestamp by itself.
    // runningUpdatedAt is exclusively set by real-time events (session.started/ended,
    // task-status). A server poll saying running=true is not a fresh live signal —
    // it may reflect a session that was active before app launch.
    // Rule: always carry forward the existing runningUpdatedAt; never mint a new one here.
    const prev = store.sessions;
    const prevByKey = new Map(prev.map((s) => [s.key, s]));
    const list = rawList.map((s) => {
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

    // Skip store update if nothing meaningful changed (avoids unnecessary React re-renders)
    const same = prev.length === list.length
      && prev.every((s, i) => s.key === list[i]?.key
        && s.running === list[i]?.running
        && s.totalTokens === list[i]?.totalTokens
        && s.runningUpdatedAt === list[i]?.runningUpdatedAt);
    if (!same) {
      store.setSessions(list);
    } else {
      store.setLoading('sessions', false);
    }
  } catch (e: any) {
    store.setError('sessions', e?.message || String(e));
    store.setLoading('sessions', false);
  }
}

async function fetchAgents() {
  if (!gw) return;
  const store = useGatewayDataStore.getState();
  store.setLoading('agents', true);
  try {
    const res = await gw.request('agents.list', {});
    const list = Array.isArray(res?.agents) ? res.agents
               : Array.isArray(res) ? res : [];
    store.setAgents(list);
  } catch (e: any) {
    store.setError('agents', e?.message || String(e));
    store.setLoading('agents', false);
  }
}

async function fetchCost() {
  if (!gw) return;
  const store = useGatewayDataStore.getState();
  store.setLoading('cost', true);
  try {
    const res = await gw.request('usage.cost', { days: 30 });
    if (res) store.setCostSummary(res);
  } catch (e: any) {
    store.setError('cost', e?.message || String(e));
    store.setLoading('cost', false);
  }
}

async function fetchUsage() {
  if (!gw) return;
  const store = useGatewayDataStore.getState();
  store.setLoading('usage', true);
  try {
    const res = await gw.request('sessions.usage', { limit: 100 });
    if (res) store.setSessionsUsage(res);
  } catch (e: any) {
    store.setError('usage', e?.message || String(e));
    store.setLoading('usage', false);
  }
}

async function fetchCron() {
  if (!gw) return;
  const store = useGatewayDataStore.getState();
  store.setLoading('cron', true);
  try {
    const res = await gw.request('cron.list', { includeDisabled: true });
    const list = Array.isArray(res?.jobs) ? res.jobs
               : Array.isArray(res) ? res : [];
    store.setCronJobs(list);
  } catch (e: any) {
    store.setError('cron', e?.message || String(e));
    store.setLoading('cron', false);
  }
}

// ── Grouped fetchers (called by timers) ─────────────────

async function tickFast() {
  await fetchSessions();
  // Detect running sub-agents from sessions data
  syncRunningSubAgents();
}

async function tickMid() {
  await Promise.allSettled([fetchAgents(), fetchCron()]);
}

async function tickSlow() {
  await Promise.allSettled([fetchCost(), fetchUsage()]);
}

// ── Public API ──────────────────────────────────────────

/**
 * Start smart polling. Call once when gateway connects.
 * @param gateway  The GatewayService instance
 */
export function startPolling(gateway: { request: (method: string, params: any) => Promise<any> }) {
  // Prevent double-start
  if (gw && useGatewayDataStore.getState().polling) return;

  gw = gateway;
  useGatewayDataStore.getState().setPolling(true);
  console.log('[DataStore] ▶ Polling started (fast=10s, mid=30s, slow=120s)');

  // Immediate initial fetch — all groups
  tickFast();
  tickMid();
  tickSlow();

  // Set up intervals
  fastTimer = setInterval(tickFast, FAST_INTERVAL);
  midTimer  = setInterval(tickMid,  MID_INTERVAL);
  slowTimer = setInterval(tickSlow, SLOW_INTERVAL);
}

/**
 * Stop polling. Call when gateway disconnects.
 */
export function stopPolling() {
  if (fastTimer)  { clearInterval(fastTimer);  fastTimer  = null; }
  if (midTimer)   { clearInterval(midTimer);   midTimer   = null; }
  if (slowTimer)  { clearInterval(slowTimer);  slowTimer  = null; }
  gw = null;
  const store = useGatewayDataStore.getState();
  store.setPolling(false);
  // Clear running sub-agents on disconnect — presence-based detection is meaningless
  // without a live sessions.list feed. Without this, stale sub-agents keep the pet
  // in "working" state indefinitely after a gateway disconnect/reconnect cycle.
  if (store.runningSubAgents.length > 0) {
    store.setRunningSubAgents([]);
    console.log('[DataStore] 🧹 Cleared runningSubAgents on disconnect');
  }
  console.log('[DataStore] ⏹ Polling stopped');
}

/**
 * Force refresh all data now (e.g. user clicks Refresh button).
 */
export async function refreshAll() {
  if (!gw) return;
  console.log('[DataStore] 🔄 Manual refresh — all groups');
  await Promise.allSettled([tickFast(), tickMid(), tickSlow()]);
}

/**
 * Force refresh a specific group.
 */
export async function refreshGroup(group: 'sessions' | 'agents' | 'cost' | 'usage' | 'cron') {
  if (!gw) return;
  switch (group) {
    case 'sessions': return fetchSessions();
    case 'agents':   return fetchAgents();
    case 'cost':     return fetchCost();
    case 'usage':    return fetchUsage();
    case 'cron':     return fetchCron();
  }
}

/**
 * Fetch full-year cost data (for FullAnalytics).
 * NOT part of regular polling — only called on-demand.
 */
export async function fetchFullCost(days = 365): Promise<CostSummary | null> {
  if (!gw) return null;
  try {
    return await gw.request('usage.cost', { days });
  } catch {
    return null;
  }
}

/**
 * Fetch heavy usage data on-demand (for FullAnalytics).
 */
export async function fetchFullUsage(limit = 2000): Promise<SessionsUsage | null> {
  if (!gw) return null;
  try {
    return await gw.request('sessions.usage', { limit });
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

  // Any sub-agent session in sessions.list is active (completed ones get removed).
  // IMPORTANT: reuse the existing RunningSubAgent object when its fields are
  // unchanged so that the resulting array elements share references with `prev`.
  // This lets `changed` (below) stay false on a no-op poll and prevents
  // subscribers (AgentHub TreeView) from re-rendering and restarting SVG
  // <animateMotion> animations, which caused the visible flicker.
  const running: RunningSubAgent[] = [];
  for (const s of sessions) {
    const match = s.key?.match(SUB_AGENT_RE);
    if (!match) continue;

    // Skip ended sub-agents. The gateway keeps done sessions in sessions.list,
    // but they are NOT running. Without this filter they'd show as perpetually
    // active (and mislead users into thinking tokens are still being burned).
    if ((s as any).status === 'done' || (s as any).endedAt) continue;

    const agentId = match[1];
    const existing = prev.find((r) => r.sessionKey === s.key);
    const label = s.label || s.displayName || '';
    // Reuse the exact same object reference if nothing changed.
    if (existing && existing.agentId === agentId && existing.label === label) {
      running.push(existing);
    } else {
      running.push({
        agentId,
        startTime: existing?.startTime || Date.now(),
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
      console.log('[DataStore] 🚀 Sub-agent detected:', r.agentId, r.label);
    }
  }
  for (const old of prev) {
    if (!newKeys.has(old.sessionKey)) {
      console.log('[DataStore] ✅ Sub-agent done:', old.agentId);
    }
  }

  store.setRunningSubAgents(running);
}

// ═══════════════════════════════════════════════════════════
// Event Handler — real-time updates from Gateway events
// ═══════════════════════════════════════════════════════════

/**
 * Handle a non-chat gateway event and update the store.
 * Call this from gateway.ts handleEvent for non-chat events.
 */
export function handleGatewayEvent(event: string, payload: any) {
  const store = useGatewayDataStore.getState();

  switch (event) {
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
      console.log('[DataStore] 📡 Session started:', key);
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
          console.log('[DataStore] 🧹 Sub-agent removed on session.ended:', key);
        }
      }
      console.log('[DataStore] 📡 Session ended:', key);
      break;
    }

    // ── Task status (from backend hook events: PostToolUse/Stop/Notification etc.) ──
    // Backend emits { task_id, status: 'running' | 'input_required' | ... }.
    // We need to map task_id → session key. The map is populated by 'task-session'
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
        console.log('[DataStore] 📡 task-status buffered (awaiting task-session):', taskId, '→', status);
        break;
      }
      applyTaskStatus(store, sessionKey, isActive);
      console.log('[DataStore] 📡 task-status:', taskId, '→', status, '(session:', sessionKey, ')');
      break;
    }

    // ── task-session: build the task_id → session_key map ──
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
            console.log('[DataStore] 📡 task-status replayed:', taskId, '→', pending.status,
              '(session:', sessionId, ', lag:', age, 'ms)');
          } else {
            console.log('[DataStore] 📡 task-status pending expired, discarding:', taskId);
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
      console.log('[DataStore] 📡 Cron started:', jobId);
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
      console.log('[DataStore] 📡 Cron completed:', jobId);
      break;
    }

    // ── Agent events ──
    case 'agent.spawned':
    case 'agent.created': {
      // Trigger a full agents refresh to get accurate data
      fetchAgents();
      console.log('[DataStore] 📡 Agent event — refreshing agents');
      break;
    }

    // ── Heartbeat / health events ──
    case 'tick':
    case 'health':
      // Expected background events from gateway; keep console clean.
      break;

    // ── Catch-all logging ──
    default:
      console.log('[DataStore] 📡 Unhandled event:', event, JSON.stringify(payload).substring(0, 200));
      break;
  }
}
