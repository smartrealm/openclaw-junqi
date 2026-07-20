import type { Session } from '@/stores/chatStore';

export type BackgroundActivityKind = 'dreaming' | 'cron' | 'subagent' | 'system';
export type SessionPresentationKind = 'conversation' | BackgroundActivityKind;

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

export function isSessionExecutionActive(session: Session): boolean {
  return session.running === true
    || session.hasActiveRun === true
    || session.hasActiveSubagentRun === true
    || session.status === 'running'
    || session.subagentRunState === 'active';
}
