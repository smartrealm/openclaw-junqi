export const DINGTALK_EVENTS_CHANGED_GATEWAY_EVENT = 'plugin.junqi-dingtalk.events_changed' as const;

export interface DingTalkEventInvalidation {
  readonly connectionId: string;
  readonly runtimeGeneration: string;
  readonly configurationDigest: string;
  readonly revision: number;
  readonly eventType: string;
}

type DingTalkEventInvalidationListener = () => void;

const listeners = new Set<DingTalkEventInvalidationListener>();
let latestInvalidation: DingTalkEventInvalidation | null = null;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractInvalidation(message: unknown): {
  readonly recognized: boolean;
  readonly revision?: number;
  readonly eventType?: string;
  readonly runtimeGeneration?: string;
  readonly configurationDigest?: string;
} {
  const envelope = record(message);
  if (
    !envelope
    || envelope.type !== 'event'
    || envelope.event !== DINGTALK_EVENTS_CHANGED_GATEWAY_EVENT
  ) {
    return { recognized: false };
  }
  const payload = record(envelope.payload);
  if (!payload || Object.keys(payload).some((key) => ![
    'revision',
    'eventType',
    'runtimeGeneration',
    'configurationDigest',
  ].includes(key))) {
    return { recognized: true };
  }
  const revision = payload.revision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    return { recognized: true };
  }
  const eventType = payload.eventType;
  if (typeof eventType !== 'string') return { recognized: true };
  const normalized = eventType.trim();
  if (!normalized || normalized !== eventType || normalized.length > 256) return { recognized: true };
  const runtimeGeneration = payload.runtimeGeneration;
  if (
    typeof runtimeGeneration !== 'string'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(runtimeGeneration)
  ) return { recognized: true };
  const configurationDigest = payload.configurationDigest;
  if (
    typeof configurationDigest !== 'string'
    || !/^[a-f0-9]{64}$/u.test(configurationDigest)
  ) return { recognized: true };
  return {
    recognized: true,
    revision: revision as number,
    eventType: normalized,
    runtimeGeneration,
    configurationDigest,
  };
}

export function getLatestDingTalkEventInvalidation(): DingTalkEventInvalidation | null {
  return latestInvalidation;
}

export function subscribeDingTalkEventInvalidations(
  listener: DingTalkEventInvalidationListener,
): () => void {
  listeners.add(listener);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    listeners.delete(listener);
  };
}

/**
 * 钉钉插件事件只作为有新事件可读的失效通知。保留事件即使载荷无效也会被消费，
 * 防止其进入通用聊天事件处理器并被误解为业务消息。
 */
export function routeDingTalkGatewayEvent(
  message: unknown,
  connectionId: string | null,
  fallback: (message: unknown) => void,
): void {
  const extracted = extractInvalidation(message);
  if (!extracted.recognized) {
    fallback(message);
    return;
  }
  if (
    !connectionId
    || extracted.revision === undefined
    || extracted.eventType === undefined
    || extracted.runtimeGeneration === undefined
    || extracted.configurationDigest === undefined
  ) return;
  if (
    latestInvalidation?.connectionId === connectionId
    && latestInvalidation.runtimeGeneration === extracted.runtimeGeneration
    && (
      latestInvalidation.configurationDigest !== extracted.configurationDigest
      || extracted.revision <= latestInvalidation.revision
    )
  ) return;
  latestInvalidation = {
    connectionId,
    runtimeGeneration: extracted.runtimeGeneration,
    configurationDigest: extracted.configurationDigest,
    revision: extracted.revision,
    eventType: extracted.eventType,
  };
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 单个界面监听器不能阻断同一 Gateway 连接上的后续事件。
    }
  }
}
