import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { isOpenClawChatSendDeliveryUncertain } from '@/processing/openClawChatEvent';
import type { GatewayAttachment, QueuedChatMessage } from './types';
import { sessionMutationGate } from './sessionMutationGate';
import { requireOpenClawSessionTarget } from '@/services/gateway/OpenClawSessionTarget';

export interface ChatSendGateway {
  sendMessage(
    message: string,
    attachments: GatewayAttachment[] | undefined,
    sessionKey: string,
    identity?: {
      clientMessageId?: string;
      sessionId?: string;
      expectedLeafEntryId?: string | null;
      delivery?: 'send' | 'steer';
      supersededRunId?: string;
    },
  ): Promise<unknown>;
}

export interface ChatSendMessage {
  id: string;
  clientMessageId?: string;
  role: 'user';
  content: string;
  timestamp: string;
  status?: 'pending' | 'sent' | 'queued' | 'failed' | 'cancelled';
  deliveryError?: string;
  mediaUrl?: string;
  mediaType?: string;
  attachments?: Array<{
    mimeType: string;
    content: string;
    fileName?: string;
  }>;
  outboundAttachments?: Array<{ fileName?: string; mimeType: string }>;
  retryPayload?: {
    text: string;
    sessionId?: string;
    attachments?: GatewayAttachment[];
    displayAttachments?: ChatSendMessage['attachments'];
  };
}

interface ChatSendState {
  addMessage: (message: ChatSendMessage, sessionKey?: string) => void;
  updateMessage: (sessionKey: string, messageId: string, patch: Partial<ChatSendMessage>) => void;
  setIsTyping: (typing: boolean, sessionKey?: string) => void;
  setSessionActiveLeafEntryId?: (
    sessionKey: string,
    activeLeafEntryId: string | null | undefined,
  ) => void;
  typingBySession: Record<string, boolean>;
  enqueueMessage: (sessionKey: string, message: QueuedChatMessage) => void;
  sessions?: Array<{
    key: string;
    model?: string | null;
    activeLeafEntryId?: string | null;
  }>;
  activeSessionKey?: string;
  currentModel?: string | null;
}

export interface ChatSendRequest {
  sessionKey: string;
  sessionId?: string;
  message: string;
  attachments?: GatewayAttachment[];
  displayAttachments?: ChatSendMessage['attachments'];
  clientMessageId?: string;
  optimisticMessage?: Partial<ChatSendMessage> | false;
  delivery?: 'steer';
  model?: string | null;
}

export interface ChatSendDispatchCancelled {
  cancelled: true;
  clientMessageId: string;
}

export function isChatSendDispatchCancelled(value: unknown): value is ChatSendDispatchCancelled {
  return typeof value === 'object'
    && value !== null
    && (value as { cancelled?: unknown }).cancelled === true
    && typeof (value as { clientMessageId?: unknown }).clientMessageId === 'string';
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
    const sessionKey = requireOpenClawSessionTarget(request.sessionKey);
    const clientMessageId = request.clientMessageId ?? createClientMessageId();
    const state = this.state();
    const optimisticPatch = request.optimisticMessage === false ? undefined : request.optimisticMessage;
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

    const sessionMutationBlocked = sessionMutationGate.isBlocked(sessionKey);
    // OpenClaw 是运行中任务队列语义的权威；本地队列只保护破坏性会话变更的交接窗口。
    const queueLocally = request.delivery !== 'steer'
      && sessionMutationBlocked;
    if (queueLocally) {
      try {
        state.enqueueMessage(sessionKey, {
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
          state.updateMessage(sessionKey, clientMessageId, failure);
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
          }, sessionKey);
        }
        throw error;
      }
      if (request.optimisticMessage === false) {
        state.updateMessage(sessionKey, clientMessageId, {
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
      }, sessionKey);
    }
    state.updateMessage(sessionKey, clientMessageId, {
      status: 'pending',
      deliveryError: undefined,
      retryPayload,
    });
    state.setIsTyping(true, sessionKey);
    try {
      const session = state.sessions?.find((candidate) => candidate.key === sessionKey);
      const expectedLeafEntryId = request.delivery === 'steer'
        ? undefined
        : session?.activeLeafEntryId;
      const result = await this.gatewayPort.sendMessage(
        request.message,
        request.attachments,
        sessionKey,
        {
          clientMessageId,
          sessionId: request.sessionId,
          ...(expectedLeafEntryId !== undefined
            ? { expectedLeafEntryId }
            : {}),
          ...(request.delivery === 'steer' ? { delivery: 'steer' as const } : {}),
        },
      ) as { queued?: boolean } | undefined;
      if (expectedLeafEntryId === null) {
        state.setSessionActiveLeafEntryId?.(sessionKey, undefined);
      }
      const deliveryUncertain = isOpenClawChatSendDeliveryUncertain(result);
      if (!deliveryUncertain) {
        state.updateMessage(sessionKey, clientMessageId, {
          status: result?.queued ? 'queued' : 'sent',
          deliveryError: undefined,
          retryPayload: result?.queued ? retryPayload : undefined,
        });
      }
      if (result?.queued) state.setIsTyping(false, sessionKey);
      return result;
    } catch (error) {
      state.updateMessage(sessionKey, clientMessageId, {
        status: 'failed',
        deliveryError: errorMessage(error),
        retryPayload,
      });
      state.setIsTyping(false, sessionKey);
      throw error;
    }
  }
}
