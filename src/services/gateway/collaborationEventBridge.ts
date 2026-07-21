import {
  parseCollaborationChangedHint,
  type CollaborationChangedHint,
} from '@/services/collaboration/types';

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

  // OpenClaw's public agent event API emits plugin streams in this shape.
  if (envelope.event === 'agent' && payload?.stream === COLLABORATION_CHANGED_EVENT) {
    return { recognized: true, candidate: payload.data };
  }

  // Keep the documented direct event name compatible if OpenClaw exposes a
  // first-class plugin event transport in a future/runtime-specific build.
  if (envelope.event === COLLABORATION_CHANGED_EVENT) {
    return { recognized: true, candidate: asRecord(payload?.data) ?? payload };
  }

  return { recognized: false };
}

/**
 * Publish one raw Gateway event to collaboration listeners.
 *
 * The boolean reports whether the event belongs to the reserved collaboration
 * stream, even when malformed. Callers use it to prevent that stream from
 * falling through to unrelated generic `agent` event handling.
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
      // A UI listener must not break Gateway event routing for other listeners.
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

/** Route reserved collaboration events before the normal ChatHandler path. */
export function routeGatewayEvent(
  message: unknown,
  fallback: (message: unknown) => void,
): void {
  if (publishCollaborationChangedEvent(message)) return;
  fallback(message);
}
