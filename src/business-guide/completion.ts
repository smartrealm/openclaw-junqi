import type { ChatMessage } from '@/stores/chatStore';

export function findNewUserMessage(
  messages: readonly ChatMessage[],
  baselineIds: ReadonlySet<string>,
): ChatMessage | null {
  return messages.find((message) => (
    message.role === 'user'
    && !baselineIds.has(message.id)
    && message.status !== 'failed'
    && message.status !== 'cancelled'
  )) ?? null;
}

export function hasAssistantResponseAfter(
  messages: readonly ChatMessage[],
  userMessageId: string,
): boolean {
  const userIndex = messages.findIndex((message) => message.id === userMessageId);
  if (userIndex < 0) return false;
  return messages.slice(userIndex + 1).some((message) => (
    message.role === 'assistant'
    && message.content.trim().length > 0
    && message.responseState !== 'error'
    && message.responseState !== 'aborted'
  ));
}
