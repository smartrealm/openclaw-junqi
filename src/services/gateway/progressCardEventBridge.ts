import {
  parseOpenClawLegacyProgressPlanUpdate,
  type OpenClawLegacyProgressPlanUpdate,
} from '@/progress-card/domain';
import type { OpenClawLiveAgentEventPayload } from '@/processing/openClawChatEvent';

export interface OpenClawProgressCardChangedEvent {
  readonly sessionKey: string;
  readonly revision: number | null;
}

export type OpenClawProgressCardEventListener = (
  event: OpenClawProgressCardChangedEvent,
) => void;

const listeners = new Set<OpenClawProgressCardEventListener>();
const legacyPlanListeners = new Set<(event: OpenClawLegacyProgressPlanUpdate) => void>();

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
    || (revision !== null && (
      typeof revision !== 'number'
      || !Number.isSafeInteger(revision)
      || revision < 1
    ))
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

export function publishOpenClawLegacyProgressPlanEvent(
  payload: OpenClawLiveAgentEventPayload,
  sessionKey: string,
): boolean {
  if (payload.stream !== 'plan') return false;
  const event = parseOpenClawLegacyProgressPlanUpdate({
    sessionKey,
    ts: payload.ts,
    data: payload.data,
  });
  if (!event) return false;
  for (const listener of [...legacyPlanListeners]) {
    try {
      listener(event);
    } catch {
      // 单个界面监听器失败不能阻断 Agent 事件的后续投影。
    }
  }
  return true;
}

export function subscribeOpenClawLegacyProgressPlanEvents(
  listener: (event: OpenClawLegacyProgressPlanUpdate) => void,
): () => void {
  legacyPlanListeners.add(listener);
  return () => legacyPlanListeners.delete(listener);
}

export function routeOpenClawProgressCardEvent(
  message: unknown,
  fallback: (message: unknown) => void,
): void {
  if (publishOpenClawProgressCardEvent(message)) return;
  fallback(message);
}
