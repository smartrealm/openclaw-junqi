import { gateway } from '@/services/gateway';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { useChatStore, type ChatMessage } from '@/stores/chatStore';
import type { GatewayAttachment } from './types';

interface ChatSendGateway {
  sendMessage: typeof gateway.sendMessage;
}

interface ChatSendState {
  addMessage: (message: ChatMessage, sessionKey?: string) => void;
  updateMessage: (sessionKey: string, messageId: string, patch: Partial<ChatMessage>) => void;
  setIsTyping: (typing: boolean, sessionKey?: string) => void;
}

export interface ChatSendRequest {
  sessionKey: string;
  sessionId?: string;
  message: string;
  attachments?: GatewayAttachment[];
  displayAttachments?: ChatMessage['attachments'];
  clientMessageId?: string;
  optimisticMessage?: Partial<ChatMessage> | false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error || 'Message delivery failed');
}

export class ChatSendCoordinator {
  constructor(
    private readonly gatewayPort: ChatSendGateway,
    private readonly state: () => ChatSendState,
  ) {}

  async send(request: ChatSendRequest): Promise<unknown> {
    const clientMessageId = request.clientMessageId ?? createClientMessageId();
    const state = this.state();
    if (request.optimisticMessage !== false) {
      state.addMessage({
        id: clientMessageId,
        clientMessageId,
        role: 'user',
        content: request.message,
        timestamp: new Date().toISOString(),
        status: 'pending',
        ...(request.displayAttachments?.length ? { attachments: request.displayAttachments } : {}),
        ...request.optimisticMessage,
      }, request.sessionKey);
    }
    state.updateMessage(request.sessionKey, clientMessageId, {
      status: 'pending',
      deliveryError: undefined,
    });
    state.setIsTyping(true, request.sessionKey);

    try {
      const result = await this.gatewayPort.sendMessage(
        request.message,
        request.attachments,
        request.sessionKey,
        { clientMessageId, sessionId: request.sessionId },
      ) as { queued?: boolean } | undefined;
      state.updateMessage(request.sessionKey, clientMessageId, {
        status: result?.queued ? 'queued' : 'sent',
        deliveryError: undefined,
      });
      if (result?.queued) state.setIsTyping(false, request.sessionKey);
      return result;
    } catch (error) {
      state.updateMessage(request.sessionKey, clientMessageId, {
        status: 'failed',
        deliveryError: errorMessage(error),
      });
      state.setIsTyping(false, request.sessionKey);
      throw error;
    }
  }
}

export const chatSendCoordinator = new ChatSendCoordinator(
  gateway,
  () => useChatStore.getState(),
);
