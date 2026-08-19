export interface OpenClawProgressCardChangedEvent {
  readonly sessionKey: string;
  readonly revision: number | null;
}

export type OpenClawProgressCardEventListener = (
  event: OpenClawProgressCardChangedEvent,
) => void;

const listeners = new Set<OpenClawProgressCardEventListener>();

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseOpenClawProgressCardChangedEvent(
  value: unknown,
): OpenClawProgressCardChangedEvent | null {
  const source = record(value);
  const sessionKey = typeof source?.sessionKey === 'string' ? source.sessionKey.trim() : '';
  const revision = source?.revision;
  if (
    !sessionKey
    || (revision !== null && (typeof revision !== 'number' || !Number.isFinite(revision)))
  ) return null;
  return { sessionKey, revision };
}

export function publishOpenClawProgressCardEvent(message: unknown): boolean {
  const envelope = record(message);
  if (!envelope || envelope.type !== 'event' || envelope.event !== 'progressCard.changed') {
    return false;
  }
  const event = parseOpenClawProgressCardChangedEvent(envelope.payload);
  if (!event) return true;
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // 单个界面监听器失败不能阻断 Gateway 事件分发。
    }
  }
  return true;
}

export function subscribeOpenClawProgressCardEvents(
  listener: OpenClawProgressCardEventListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function routeOpenClawProgressCardEvent(
  message: unknown,
  fallback: (message: unknown) => void,
): void {
  if (publishOpenClawProgressCardEvent(message)) return;
  fallback(message);
}
