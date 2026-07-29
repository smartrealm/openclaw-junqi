import type { ChatMessage } from '@/stores/chatStore';

export interface LocalUserMessageCapabilities {
  canDelete: boolean;
  canEditAndRetry: boolean;
}

export function localUserMessageCapabilities(
  message: ChatMessage | undefined,
): LocalUserMessageCapabilities {
  const isLocalUserMessage = message?.role === 'user' && !message.nativeMessageId;
  return {
    canDelete: Boolean(
      isLocalUserMessage
      && (message?.status === 'failed' || message?.status === 'cancelled'),
    ),
    canEditAndRetry: Boolean(
      isLocalUserMessage
      && message?.status === 'failed'
      && message.retryPayload,
    ),
  };
}

export function editFailedUserMessage(
  message: ChatMessage,
  content: string,
): ChatMessage {
  if (!localUserMessageCapabilities(message).canEditAndRetry) {
    throw new Error('Only failed local user messages can be edited');
  }
  const nextContent = content.trim();
  if (!nextContent) throw new Error('Edited message cannot be empty');

  return {
    ...message,
    content: nextContent,
    retryPayload: {
      ...message.retryPayload!,
      text: nextContent,
    },
  };
}

export function removeLocalUserMessage(
  messages: readonly ChatMessage[],
  messageId: string,
): ChatMessage[] {
  const target = messages.find((message) => message.id === messageId);
  if (!localUserMessageCapabilities(target).canDelete) return [...messages];
  return messages.filter((message) => message.id !== messageId);
}
