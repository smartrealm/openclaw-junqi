import { chatNotificationDedupeKey } from '@/services/notificationIdentity';

export type ChatNotificationKind = 'message' | 'task_complete';

export interface ChatNotificationEvent {
  sessionKey: string;
  role: string;
  text: string;
  runId: string | null | undefined;
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
 * 仅将带 OpenClaw 原生 runId 的流式终态转换为通知工作。
 */
export function projectChatNotification(
  event: ChatNotificationEvent,
): ChatNotificationProjection | null {
  const body = event.text.trim();
  if (!body) return null;

  const dedupeKey = chatNotificationDedupeKey(event.sessionKey, event.role, event.runId);
  if (!dedupeKey) return null;

  return {
    kind: event.role.trim().toLowerCase() === 'assistant' ? 'task_complete' : 'message',
    body: body.slice(0, 120),
    dedupeKey,
    url: chatNotificationTarget(event.sessionKey),
  };
}
