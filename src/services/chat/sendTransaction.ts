import { gateway } from '@/services/gateway';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { useChatStore, type ChatMessage } from '@/stores/chatStore';
import type { GatewayAttachment, QueuedChatMessage } from './types';
import { sessionMutationGate } from './sessionMutationGate';

interface ChatSendGateway {
  sendMessage: typeof gateway.sendMessage;
}

interface ChatSendState {
  addMessage: (message: ChatMessage, sessionKey?: string) => void;
  updateMessage: (sessionKey: string, messageId: string, patch: Partial<ChatMessage>) => void;
  setIsTyping: (typing: boolean, sessionKey?: string) => void;
  typingBySession: Record<string, boolean>;
  enqueueMessage: (sessionKey: string, message: QueuedChatMessage) => void;
}

export interface ChatSendRequest {
  sessionKey: string;
  sessionId?: string;
  message: string;
  attachments?: GatewayAttachment[];
  displayAttachments?: ChatMessage['attachments'];
  clientMessageId?: string;
  optimisticMessage?: Partial<ChatMessage> | false;
  queueIfBusy?: boolean;
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
    const optimisticPatch = request.optimisticMessage === false
      ? undefined
      : request.optimisticMessage;
    const timestamp = optimisticPatch
      ? optimisticPatch.timestamp ?? new Date().toISOString()
      : new Date().toISOString();
    const retryPayload = {
      text: request.message,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...(request.attachments?.length ? { attachments: request.attachments } : {}),
      ...(request.displayAttachments?.length
        ? { displayAttachments: request.displayAttachments }
        : {}),
    };

    const sessionCannotSend = state.typingBySession[request.sessionKey]
      || sessionMutationGate.isBlocked(request.sessionKey);
    if (request.queueIfBusy !== false && sessionCannotSend) {
      try {
        state.enqueueMessage(request.sessionKey, {
          id: clientMessageId,
          timestamp,
          ...retryPayload,
        });
      } catch (error) {
        const failure = {
          status: 'failed' as const,
          deliveryError: errorMessage(error),
          retryPayload,
        };
        if (request.optimisticMessage === false) {
          state.updateMessage(request.sessionKey, clientMessageId, failure);
        } else {
          state.addMessage({
            ...optimisticPatch,
            id: clientMessageId,
            clientMessageId,
            role: 'user',
            content: request.message,
            timestamp,
            ...failure,
            ...(request.displayAttachments?.length
              ? { attachments: request.displayAttachments }
              : {}),
            ...(request.attachments?.length
              ? {
                  outboundAttachments: request.attachments.map((attachment) => ({
                    fileName: attachment.fileName,
                    mimeType: attachment.mimeType,
                  })),
                }
              : {}),
          }, request.sessionKey);
        }
        throw error;
      }
      if (request.optimisticMessage === false) {
        state.updateMessage(request.sessionKey, clientMessageId, {
          status: 'queued',
          deliveryError: undefined,
          retryPayload,
        });
      }
      return { queued: true, queue: 'session' as const, clientMessageId };
    }

    if (request.optimisticMessage !== false) {
      state.addMessage({
        ...optimisticPatch,
        id: clientMessageId,
        clientMessageId,
        role: 'user',
        content: request.message,
        timestamp,
        status: 'pending',
        ...(request.displayAttachments?.length ? { attachments: request.displayAttachments } : {}),
        ...(request.attachments?.length
          ? {
              outboundAttachments: request.attachments.map((attachment) => ({
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
              })),
              retryPayload,
            }
          : {}),
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
        retryPayload: result?.queued ? retryPayload : undefined,
      });
      if (result?.queued) state.setIsTyping(false, request.sessionKey);
      return result;
    } catch (error) {
      state.updateMessage(request.sessionKey, clientMessageId, {
        status: 'failed',
        deliveryError: errorMessage(error),
        retryPayload,
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
