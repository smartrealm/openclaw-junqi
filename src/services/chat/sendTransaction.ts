import { gateway, isGatewayChatSendDeliveryUncertain } from '@/services/gateway';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { useChatStore, type ChatMessage } from '@/stores/chatStore';
import type { GatewayAttachment, QueuedChatMessage } from './types';
import { sessionMutationGate } from './sessionMutationGate';
import { taskExecutionCoordinator } from '@/task-execution/TaskExecutionCoordinator';
import type { TaskExecutionSource } from '@/task-execution/types';

interface ChatSendGateway {
  sendMessage: typeof gateway.sendMessage;
}

interface ChatSendState {
  addMessage: (message: ChatMessage, sessionKey?: string) => void;
  updateMessage: (sessionKey: string, messageId: string, patch: Partial<ChatMessage>) => void;
  setIsTyping: (typing: boolean, sessionKey?: string) => void;
  typingBySession: Record<string, boolean>;
  enqueueMessage: (sessionKey: string, message: QueuedChatMessage) => void;
  sessions?: Array<{ key: string; model?: string | null }>;
  activeSessionKey?: string;
  currentModel?: string | null;
}

export interface ChatSendRequest {
  sessionKey: string;
  sessionId?: string;
  message: string;
  attachments?: GatewayAttachment[];
  displayAttachments?: ChatMessage['attachments'];
  clientMessageId?: string;
  optimisticMessage?: Partial<ChatMessage> | false;
  /**
   * Opt into the JunQi-local visible queue while a Gateway run is active.
   * Normal sends leave this unset so OpenClaw applies the session queue mode.
  */
  queueIfBusy?: boolean;
  delivery?: 'queue' | 'steer';
  source?: TaskExecutionSource;
  model?: string | null;
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

    const activeGatewayRun = state.typingBySession[request.sessionKey] === true;
    const sessionMutationBlocked = sessionMutationGate.isBlocked(request.sessionKey);
    // OpenClaw is the authority for active-run queue semantics. Only a
    // destructive JunQi session mutation, or an explicit local queue choice,
    // may keep a normal message in the renderer-owned queue.
    const localQueueRequested = request.queueIfBusy === true || request.delivery === 'queue';
    const queueLocally = request.delivery !== 'steer'
      && request.queueIfBusy !== false
      && (sessionMutationBlocked || (localQueueRequested && activeGatewayRun));
    if (queueLocally) {
      try {
        state.enqueueMessage(request.sessionKey, {
          id: clientMessageId,
          timestamp,
          ...(request.source && request.source !== 'chat' ? { source: request.source } : {}),
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
      retryPayload,
    });
    state.setIsTyping(true, request.sessionKey);
    let taskRunId = clientMessageId;
    let taskRunCreated = request.delivery === 'steer';

    try {
      const observedModel = request.model
        ?? state.sessions?.find((session) => session.key === request.sessionKey)?.model
        ?? (state.activeSessionKey === request.sessionKey ? state.currentModel : null)
        ?? null;
      let supersededRunId: string | null = null;
      if (request.delivery === 'steer') {
        supersededRunId = await taskExecutionCoordinator.prepareSteer({
          sessionKey: request.sessionKey,
          sessionId: request.sessionId,
          runId: clientMessageId,
          source: request.source ?? 'chat',
          model: observedModel,
        });
      } else {
        const prepared = await taskExecutionCoordinator.prepareSend({
          sessionKey: request.sessionKey,
          sessionId: request.sessionId,
          runId: clientMessageId,
          source: request.source ?? 'chat',
          model: observedModel,
          // If the UI already observes a live Gateway run, do not create a
          // local Run before OpenClaw acknowledges which queue mode applies.
          allowCreate: !activeGatewayRun,
        });
        taskRunId = prepared.runId ?? clientMessageId;
        taskRunCreated = prepared.created;
      }
      const result = await this.gatewayPort.sendMessage(
        request.message,
        request.attachments,
        request.sessionKey,
        {
          clientMessageId,
          sessionId: request.sessionId,
          ...(request.delivery === 'steer' ? { delivery: 'steer' as const } : {}),
          ...(supersededRunId ? { supersededRunId } : {}),
        },
      ) as { queued?: boolean } | undefined;
      const deliveryUncertain = isGatewayChatSendDeliveryUncertain(result);
      if (!deliveryUncertain) {
        state.updateMessage(request.sessionKey, clientMessageId, {
          status: result?.queued ? 'queued' : 'sent',
          deliveryError: undefined,
          retryPayload: result?.queued ? retryPayload : undefined,
        });
      }
      if (result?.queued) state.setIsTyping(false, request.sessionKey);
      return result;
    } catch (error) {
      state.updateMessage(request.sessionKey, clientMessageId, {
        status: 'failed',
        deliveryError: errorMessage(error),
        retryPayload,
      });
      state.setIsTyping(false, request.sessionKey);
      if (error instanceof Error && (
        error.name === 'GatewayDisconnectedError'
        || error.name === 'GatewayRpcError'
        || error.message === 'Gateway is not connected'
      ) && taskRunCreated) {
        await taskExecutionCoordinator.settleRun({
          sessionKey: request.sessionKey,
          sessionId: request.sessionId,
          runId: taskRunId,
          terminalReason: 'error',
        }).catch((settleError) => taskExecutionCoordinator.reportPersistenceFailure('settle rejected send checkpoint', settleError));
      }
      throw error;
    }
  }
}

export const chatSendCoordinator = new ChatSendCoordinator(
  gateway,
  () => useChatStore.getState(),
);
