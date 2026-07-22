import type { Session } from '@/stores/chatStore';

export type BackgroundActivityKind = 'dreaming' | 'cron' | 'subagent' | 'system';
export type SessionPresentationKind = 'conversation' | BackgroundActivityKind;
export type SessionExecutionState = 'running' | 'done' | 'failed' | 'stopped' | 'unknown';
export type SessionActivityPhase = 'thinking' | 'sending' | 'generating' | 'background';

export interface SessionThinkingSignal {
  readonly runId: string | null;
  readonly text: string;
}

export interface SessionActivitySignals {
  typingBySession?: Readonly<Record<string, boolean>>;
  typingStartedAtBySession?: Readonly<Record<string, number>>;
  thinkingBySession?: Readonly<Record<string, SessionThinkingSignal | undefined>>;
  sendingBySession?: Readonly<Record<string, boolean>>;
}

export interface SessionActivity {
  readonly sessionKey: string;
  readonly session: Session | null;
  readonly kind: SessionPresentationKind;
  readonly state: SessionExecutionState;
  readonly active: boolean;
  readonly localActive: boolean;
  readonly phase: SessionActivityPhase | null;
  readonly startedAt: number | null;
}

export interface SessionActivityProjection {
  readonly bySessionKey: ReadonlyMap<string, SessionActivity>;
  readonly active: readonly SessionActivity[];
  readonly workingDisplayKey: string | null;
}

export interface SessionActivityProjectionInput extends SessionActivitySignals {
  sessions: readonly Session[];
  activeSessionKey?: string | null;
  jobs?: readonly AutomationJobDescriptor[];
}

export interface AutomationJobDescriptor {
  id: string;
  name?: string;
  description?: string;
  payload?: {
    kind?: string;
    text?: string;
    message?: string;
  };
}

export interface SessionPresentationPartition<T extends Session> {
  conversations: T[];
  background: Record<BackgroundActivityKind, T[]>;
}

const BACKGROUND_ORIGINS = new Set([
  'automation',
  'cron',
  'heartbeat',
  'hook',
  'memory',
  'scheduler',
  'system',
]);

const DREAMING_MARKER = /(?:\bdream(?:ing)?\b|梦境|夢境|memory[-_. ]?core.*(?:short[-_. ]?term[-_. ]?promotion|dream)|short[-_. ]?term[-_. ]?promotion)/i;

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function agentSessionRest(sessionKey: string): string | null {
  const match = /^agent:[^:]+:(.+)$/i.exec(normalized(sessionKey));
  return match?.[1] ?? null;
}

export function agentIdFromSessionKey(sessionKey: string): string | null {
  return /^agent:([^:]+):/i.exec(normalized(sessionKey))?.[1] ?? null;
}

/** Parent ownership is authoritative only when OpenClaw returns a session key. */
export function parentSessionKeyForSession(session: Session): string | null {
  for (const candidate of [session.parentSessionKey, session.spawnedBy]) {
    const key = normalized(candidate);
    if (agentIdFromSessionKey(key)) return key;
  }
  return null;
}

export function isCronSessionKey(sessionKey: string): boolean {
  const key = normalized(sessionKey);
  const rest = agentSessionRest(key);
  return rest?.toLowerCase().startsWith('cron:') === true
    || /^cron:[^:]+(?::|$)/i.test(key);
}

export function cronJobIdFromSessionKey(sessionKey: string): string | null {
  const key = normalized(sessionKey);
  const rest = agentSessionRest(key) ?? key;
  return /^cron:([^:]+)(?::|$)/i.exec(rest)?.[1] ?? null;
}

export function isSubagentSessionKey(sessionKey: string): boolean {
  const key = normalized(sessionKey);
  const rest = agentSessionRest(key) ?? key;
  return rest.toLowerCase().startsWith('subagent:');
}

export function isIsolatedExecutionSessionKey(sessionKey: string): boolean {
  return isCronSessionKey(sessionKey) || isSubagentSessionKey(sessionKey);
}

function isDreamingSession(
  session: Session,
  jobsById: ReadonlyMap<string, AutomationJobDescriptor>,
): boolean {
  const jobId = cronJobIdFromSessionKey(session.key);
  const job = jobId ? jobsById.get(jobId) : undefined;
  const markers = [
    jobId,
    job?.name,
    job?.description,
    job?.payload?.text,
    job?.payload?.message,
    session.label,
    session.topic,
    session.origin?.label,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return markers.some((value) => DREAMING_MARKER.test(value));
}

function hasBackgroundOrigin(session: Session): boolean {
  const originValues = [session.origin?.surface, session.origin?.provider]
    .map((value) => normalized(value).toLowerCase())
    .filter(Boolean);
  return originValues.some((value) => BACKGROUND_ORIGINS.has(value));
}

export function classifySessionPresentation(
  session: Session,
  jobsById: ReadonlyMap<string, AutomationJobDescriptor> = new Map(),
): SessionPresentationKind {
  if (isCronSessionKey(session.key)) {
    return isDreamingSession(session, jobsById) ? 'dreaming' : 'cron';
  }
  if (isSubagentSessionKey(session.key) || session.subagentRunState) {
    return 'subagent';
  }
  if (session.key === 'global' || session.key === 'unknown' || session.kind === 'global') {
    return 'system';
  }
  if (hasBackgroundOrigin(session)) {
    return 'system';
  }
  return 'conversation';
}

export function partitionSessionsForPresentation<T extends Session>(
  sessions: readonly T[],
  jobs: readonly AutomationJobDescriptor[] = [],
): SessionPresentationPartition<T> {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const partition: SessionPresentationPartition<T> = {
    conversations: [],
    background: {
      dreaming: [],
      cron: [],
      subagent: [],
      system: [],
    },
  };

  for (const session of sessions) {
    const kind = classifySessionPresentation(session, jobsById);
    if (kind === 'conversation') partition.conversations.push(session);
    else partition.background[kind].push(session);
  }
  return partition;
}

function declaredSessionExecutionState(session: Session): SessionExecutionState {
  const state = normalized(session.subagentRunState || session.status).toLowerCase();
  if (['active', 'running', 'started', 'working'].includes(state)) return 'running';
  if (['complete', 'completed', 'done', 'finished', 'succeeded', 'success'].includes(state)) return 'done';
  if (['aborted', 'canceled', 'cancelled', 'error', 'failed'].includes(state)) return 'failed';
  if (['idle', 'paused', 'stopped'].includes(state)) return 'stopped';
  return 'unknown';
}

export function sessionExecutionState(session: Session): SessionExecutionState {
  if (session.running === true || session.hasActiveRun === true || session.hasActiveSubagentRun === true) {
    return 'running';
  }
  return declaredSessionExecutionState(session);
}

export function isSessionExecutionActive(session: Session): boolean {
  return sessionExecutionState(session) === 'running';
}

function hasThinkingSignal(signal: SessionThinkingSignal | undefined): boolean {
  return Boolean(signal?.runId || signal?.text.trim());
}

function validStartedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function localPhase(
  sessionKey: string,
  signals: SessionActivitySignals,
): SessionActivityPhase | null {
  if (hasThinkingSignal(signals.thinkingBySession?.[sessionKey])) return 'thinking';
  if (signals.typingBySession?.[sessionKey]) return 'generating';
  if (signals.sendingBySession?.[sessionKey]) return 'sending';
  return null;
}

function projectedState(
  session: Session | null,
  kind: SessionPresentationKind,
  localActive: boolean,
  chatObserved: boolean,
): SessionExecutionState {
  if (localActive) return 'running';
  if (!session) return 'unknown';

  if (kind !== 'conversation') return sessionExecutionState(session);

  // Without a local observation, an official active-run snapshot may describe
  // work started by another client and remains the only available authority.
  if (!chatObserved) return sessionExecutionState(session);

  // Once this renderer has observed the session, an explicit local false can
  // suppress an older sessions.list row that still reports the completed run.
  const declaredState = declaredSessionExecutionState(session);
  return declaredState === 'running' ? 'unknown' : declaredState;
}

const SESSION_ACTIVITY_PHASE_PRIORITY: Readonly<Record<SessionActivityPhase, number>> = {
  thinking: 0,
  generating: 1,
  sending: 2,
  background: 3,
};

function compareActiveSessions(
  left: SessionActivity,
  right: SessionActivity,
  activeSessionKey: string,
): number {
  const leftSelected = left.sessionKey === activeSessionKey ? 1 : 0;
  const rightSelected = right.sessionKey === activeSessionKey ? 1 : 0;
  if (leftSelected !== rightSelected) return rightSelected - leftSelected;

  const phaseDelta = SESSION_ACTIVITY_PHASE_PRIORITY[left.phase ?? 'background']
    - SESSION_ACTIVITY_PHASE_PRIORITY[right.phase ?? 'background'];
  if (phaseDelta !== 0) return phaseDelta;

  const leftStartedAt = left.startedAt ?? Number.POSITIVE_INFINITY;
  const rightStartedAt = right.startedAt ?? Number.POSITIVE_INFINITY;
  if (leftStartedAt !== rightStartedAt) return leftStartedAt - rightStartedAt;
  return left.sessionKey.localeCompare(right.sessionKey);
}

/**
 * Build the single read-only activity view consumed by every session surface.
 * The function has no side effects and never mutates its sessions or signals.
 */
export function projectSessionActivity({
  sessions,
  activeSessionKey = null,
  jobs = [],
  typingBySession = {},
  typingStartedAtBySession = {},
  thinkingBySession = {},
  sendingBySession = {},
}: SessionActivityProjectionInput): SessionActivityProjection {
  const sessionByKey = new Map(sessions.map((session) => [session.key, session]));
  const allKeys = new Set(sessionByKey.keys());
  for (const source of [typingBySession, thinkingBySession, sendingBySession]) {
    for (const sessionKey of Object.keys(source)) allKeys.add(sessionKey);
  }

  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const bySessionKey = new Map<string, SessionActivity>();
  for (const sessionKey of allKeys) {
    const session = sessionByKey.get(sessionKey) ?? null;
    const kind = session
      ? classifySessionPresentation(session, jobsById)
      : isCronSessionKey(sessionKey)
        ? 'cron'
        : isSubagentSessionKey(sessionKey)
          ? 'subagent'
          : 'conversation';
    const phase = localPhase(sessionKey, {
      typingBySession,
      thinkingBySession,
      sendingBySession,
    });
    const localActive = phase !== null;
    const chatObserved = Object.prototype.hasOwnProperty.call(typingBySession, sessionKey);
    const state = projectedState(session, kind, localActive, chatObserved);
    const active = state === 'running';
    bySessionKey.set(sessionKey, {
      sessionKey,
      session,
      kind,
      state,
      active,
      localActive,
      phase: active ? phase ?? 'background' : null,
      startedAt: localActive ? validStartedAt(typingStartedAtBySession[sessionKey]) : null,
    });
  }

  const normalizedActiveSessionKey = normalized(activeSessionKey);
  const active = [...bySessionKey.values()]
    .filter((activity) => activity.active)
    .sort((left, right) => compareActiveSessions(left, right, normalizedActiveSessionKey));

  return {
    bySessionKey,
    active,
    workingDisplayKey: active[0]?.sessionKey ?? null,
  };
}
