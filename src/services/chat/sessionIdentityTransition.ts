import { hasSessionIdentityChanged } from '@/utils/sessionLifecycle';

export interface SessionIdentityTransition {
  sessionKey: string;
  previousSessionId: string;
  nextSessionId: string;
}

type SessionIdentityTransitionListener = (transition: SessionIdentityTransition) => void;
const transitionListeners = new Set<SessionIdentityTransitionListener>();

export function subscribeSessionIdentityTransitions(
  listener: SessionIdentityTransitionListener,
): () => void {
  transitionListeners.add(listener);
  return () => transitionListeners.delete(listener);
}

export function publishSessionIdentityTransitions(
  transitions: readonly SessionIdentityTransition[],
): void {
  for (const transition of transitions) {
    for (const listener of transitionListeners) listener(transition);
  }
}

/**
 * Pure identity diff shared by the store reducer and the application runtime.
 * Keeping it free of stores and Gateway imports prevents the chat/gateway
 * module cycle from becoming part of application startup.
 */
export function collectSessionIdentityTransitions(
  previous: readonly { key: string; sessionId?: string }[],
  next: readonly { key: string; sessionId?: string }[],
): SessionIdentityTransition[] {
  const previousByKey = new Map(previous.map((session) => [session.key, session.sessionId]));
  return next.flatMap((session) => {
    const previousSessionId = previousByKey.get(session.key);
    if (!hasSessionIdentityChanged(previousSessionId, session.sessionId)) return [];
    return [{
      sessionKey: session.key,
      previousSessionId: previousSessionId!.trim(),
      nextSessionId: session.sessionId!.trim(),
    }];
  });
}
