const HEALTH_VALUES = [
  'on-track',
  'grinding',
  'stuck',
  'waiting-on-user',
  'wrapping-up',
  'done',
  'failed',
] as const;

export type OpenClawSessionObserverHealth = typeof HEALTH_VALUES[number];

export interface OpenClawSessionObserverDigest {
  readonly sessionKey: string;
  readonly agentId?: string;
  readonly runId?: string;
  readonly revision: number;
  readonly updatedAt: number;
  readonly headline: string;
  readonly health: OpenClawSessionObserverHealth;
}

type Listener = () => void;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

function optionalString(value: unknown, maximum: number): string | undefined | null {
  if (value === undefined) return undefined;
  return nonEmptyString(value, maximum);
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isHealth(value: string): value is OpenClawSessionObserverHealth {
  return HEALTH_VALUES.some((health) => health === value);
}

function keyFor(digest: OpenClawSessionObserverDigest): string {
  return `${digest.sessionKey}\u0000${digest.agentId ?? ''}`;
}

export function parseOpenClawSessionObserverDigest(value: unknown): OpenClawSessionObserverDigest | null {
  const source = record(value);
  const sessionKey = nonEmptyString(source?.sessionKey, 4096);
  const agentId = optionalString(source?.agentId, 4096);
  const runId = optionalString(source?.runId, 4096);
  const revision = nonNegativeSafeInteger(source?.revision);
  const updatedAt = nonNegativeSafeInteger(source?.updatedAt);
  const headline = nonEmptyString(source?.headline, 120);
  const assessment = source?.assessment;
  const health = typeof source?.health === 'string' && isHealth(source.health)
    ? source.health
    : null;
  const planProgress = source?.planProgress;
  const planProgressRecord = record(planProgress);
  const validPlanProgress = planProgress === undefined || (
    planProgressRecord !== null
    && nonNegativeSafeInteger(planProgressRecord.completed) !== null
    && nonNegativeSafeInteger(planProgressRecord.total) !== null
  );
  if (!source || !sessionKey || agentId === null || runId === null || revision === null || revision < 1
    || updatedAt === null || !headline || !health || (assessment !== undefined && nonEmptyString(assessment, 320) === null)
    || !validPlanProgress) return null;
  let target;
  try {
    target = resolveOpenClawSessionTarget(sessionKey, agentId);
  } catch {
    return null;
  }
  return {
    sessionKey: target.localKey,
    ...(target.agentId ? { agentId: target.agentId } : {}),
    ...(runId ? { runId } : {}),
    revision,
    updatedAt,
    headline,
    health,
  };
}

class OpenClawSessionObserverStream {
  private readonly digests = new Map<string, OpenClawSessionObserverDigest>();
  private readonly listeners = new Set<Listener>();
  private snapshot: readonly OpenClawSessionObserverDigest[] = [];

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot = (): readonly OpenClawSessionObserverDigest[] => this.snapshot;

  publish(digest: OpenClawSessionObserverDigest): void {
    const key = keyFor(digest);
    const previous = this.digests.get(key);
    if (previous && digest.updatedAt < previous.updatedAt) return;
    if (previous && digest.runId === previous.runId && digest.revision <= previous.revision) return;
    this.digests.set(key, digest);
    this.snapshot = [...this.digests.values()].sort((left, right) => (
      right.updatedAt - left.updatedAt || keyFor(left).localeCompare(keyFor(right))
    ));
    this.notify();
  }

  clear(): void {
    if (this.digests.size === 0) return;
    this.digests.clear();
    this.snapshot = [];
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A presentation listener cannot block the Gateway event dispatcher.
      }
    }
  }
}

export const openClawSessionObserverStream = new OpenClawSessionObserverStream();

export function publishOpenClawSessionObserverEvent(message: unknown): boolean {
  const envelope = record(message);
  if (!envelope || envelope.type !== 'event' || envelope.event !== 'session.observer') return false;
  const digest = parseOpenClawSessionObserverDigest(envelope.payload);
  if (digest) openClawSessionObserverStream.publish(digest);
  return true;
}

export function routeOpenClawSessionObserverEvent(message: unknown, fallback: (message: unknown) => void): void {
  if (publishOpenClawSessionObserverEvent(message)) return;
  fallback(message);
}
import { resolveOpenClawSessionTarget } from './OpenClawSessionTarget';
