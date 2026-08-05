import { gatewayChatNotificationDedupeKey } from '@/services/notificationIdentity';

export type ChatNotificationKind = 'message' | 'task_complete';
export type ChatNotificationSource = 'stream-final' | 'transcript' | 'legacy-message';

export interface ChatNotificationEvent {
  source: ChatNotificationSource;
  sessionKey: string;
  role: string;
  text: string;
  runId?: string | null;
  clientMessageId?: string | null;
  nativeMessageId?: string | null;
  messageSeq?: number | null;
  liveProjected?: boolean;
}

export interface ChatNotificationProjection {
  kind: ChatNotificationKind;
  body: string;
  dedupeKey: string;
  url: string;
}

export function chatNotificationTarget(sessionKey: string): string {
  return `/chat?session=${encodeURIComponent(sessionKey)}`;
}

/**
 * Converts authoritative OpenClaw chat events into notification work.
 *
 * The generic message callback intentionally has no notification projection:
 * it lacks run identity and may mirror a live stream or durable transcript.
 * Notification delivery therefore has exactly two identity-bearing producers.
 */
export function projectChatNotification(
  event: ChatNotificationEvent,
): ChatNotificationProjection | null {
  if (event.source === 'legacy-message') return null;
  if (event.source === 'transcript' && event.liveProjected) return null;
  const body = event.text.trim();
  if (!body) return null;

  const dedupeKey = gatewayChatNotificationDedupeKey(event);
  if (!dedupeKey) return null;

  return {
    kind: event.role.trim().toLowerCase() === 'assistant' ? 'task_complete' : 'message',
    body: body.slice(0, 120),
    dedupeKey,
    url: chatNotificationTarget(event.sessionKey),
  };
}
