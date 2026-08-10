import {
  parseCollaborationChangedHint,
  type CollaborationChangedHint,
} from '@/types/collaboration';

export type CollaborationChangedHintListener = (hint: CollaborationChangedHint) => void;

const COLLABORATION_CHANGED_EVENT = 'junqi-collab.changed';
const changedHintListeners = new Set<CollaborationChangedHintListener>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractChangedHintCandidate(message: unknown): {
  recognized: boolean;
  candidate?: unknown;
} {
  const envelope = asRecord(message);
  if (!envelope || envelope.type !== 'event') return { recognized: false };
  const payload = asRecord(envelope.payload);

  // OpenClaw 通过 Agent stream 承载插件事件，协作插件也按此契约发送刷新提示。
  if (envelope.event === 'agent' && payload?.stream === COLLABORATION_CHANGED_EVENT) {
    return { recognized: true, candidate: payload.data };
  }

  return { recognized: false };
}

/**
 * 向协作监听器发布一个原始 Gateway 事件。
 *
 * 即使保留 stream 的载荷无效，返回值仍表明该事件属于协作 stream。调用方据此阻止该
 * stream 落入无关的通用 `agent` 处理。
 */
export function publishCollaborationChangedEvent(message: unknown): boolean {
  const extracted = extractChangedHintCandidate(message);
  if (!extracted.recognized) return false;
  const hint = parseCollaborationChangedHint(extracted.candidate);
  if (!hint) return true;

  for (const listener of [...changedHintListeners]) {
    try {
      listener({ ...hint });
    } catch {
      // 单个界面监听器不能阻断其他 Gateway 事件路由。
    }
  }
  return true;
}

export function subscribeCollaborationChangedHints(
  listener: CollaborationChangedHintListener,
): () => void {
  changedHintListeners.add(listener);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    changedHintListeners.delete(listener);
  };
}

/** 在普通 ChatHandler 路径前路由保留的协作事件。 */
export function routeGatewayEvent(
  message: unknown,
  fallback: (message: unknown) => void,
): void {
  if (publishCollaborationChangedEvent(message)) return;
  fallback(message);
}
