import { gateway, isGatewayChatSendDeliveryUncertain } from '@/services/gateway';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { useChatStore, type ChatMessage } from '@/stores/chatStore';
import type { GatewayAttachment, QueuedChatMessage } from './types';
import { sessionMutationGate } from './sessionMutationGate';
import { taskExecutionCoordinator } from '@/task-execution/TaskExecutionCoordinator';
import type { TaskExecutionSource } from '@/task-execution/types';
import { requireOpenClawSessionTarget } from '@/services/gateway/OpenClawSessionTarget';

interface ChatSendGateway {
  sendMessage: typeof gateway.sendMessage;
}

type TaskExecutionPort = Pick<typeof taskExecutionCoordinator,
  'prepareSend' | 'prepareSteer' | 'isRunStopRequested' | 'settleRun' | 'reportPersistenceFailure'>;

interface ChatSendState {
  addMessage: (message: ChatMessage, sessionKey?: string) => void;
  updateMessage: (sessionKey: string, messageId: string, patch: Partial<ChatMessage>) => void;
  setIsTyping: (typing: boolean, sessionKey?: string) => void;
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
  displayAttachments?: ChatMessage['attachments'];
  clientMessageId?: string;
  optimisticMessage?: Partial<ChatMessage> | false;
  delivery?: 'steer';
  source?: TaskExecutionSource;
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
    private readonly taskExecutionPort: TaskExecutionPort = taskExecutionCoordinator,
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

    const activeGatewayRun = state.typingBySession[sessionKey] === true;
    const sessionMutationBlocked = sessionMutationGate.isBlocked(sessionKey);
    // OpenClaw 是运行中任务队列语义的权威；本地队列只保护破坏性会话变更的交接窗口。
    const queueLocally = request.delivery !== 'steer'
      && sessionMutationBlocked;
    if (queueLocally) {
      try {
        state.enqueueMessage(sessionKey, {
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
    let taskRunId = clientMessageId;
    let taskRunCreated = false;

    try {
      const session = state.sessions?.find((candidate) => candidate.key === sessionKey);
      const observedModel = request.model
        ?? session?.model
        ?? (state.activeSessionKey === sessionKey ? state.currentModel : null)
        ?? null;
      let supersededRunId: string | null = null;
      if (request.delivery === 'steer') {
        const prepared = await this.taskExecutionPort.prepareSteer({
          sessionKey,
          sessionId: request.sessionId,
          runId: clientMessageId,
          source: request.source ?? 'chat',
          model: observedModel,
        });
        supersededRunId = prepared.supersededRunId;
        taskRunCreated = prepared.created;
      } else {
        const prepared = await this.taskExecutionPort.prepareSend({
          sessionKey,
          sessionId: request.sessionId,
          runId: clientMessageId,
          source: request.source ?? 'chat',
          model: observedModel,
          // UI 已观察到 Gateway 运行时，须等待 OpenClaw 确认队列模式，
          // 不能提前创建本地 Run。
          allowCreate: !activeGatewayRun,
        });
        taskRunId = prepared.runId ?? clientMessageId;
        taskRunCreated = prepared.created;
      }
      if (taskRunCreated && await this.taskExecutionPort.isRunStopRequested({
        sessionKey,
        sessionId: request.sessionId,
        runId: taskRunId,
      })) {
        state.updateMessage(sessionKey, clientMessageId, {
          status: 'cancelled',
          deliveryError: undefined,
          retryPayload,
        });
        state.setIsTyping(false, sessionKey);
        return { cancelled: true, clientMessageId };
      }
      const result = await this.gatewayPort.sendMessage(
        request.message,
        request.attachments,
        sessionKey,
        {
          clientMessageId,
          sessionId: request.sessionId,
          ...(request.delivery !== 'steer' && session?.activeLeafEntryId !== undefined
            ? { expectedLeafEntryId: session.activeLeafEntryId }
            : {}),
          ...(request.delivery === 'steer' ? { delivery: 'steer' as const } : {}),
          ...(supersededRunId ? { supersededRunId } : {}),
        },
      ) as { queued?: boolean } | undefined;
      const deliveryUncertain = isGatewayChatSendDeliveryUncertain(result);
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
      if (error instanceof Error && (
        error.name === 'GatewayDisconnectedError'
        || error.name === 'GatewayRpcError'
        || error.message === 'Gateway is not connected'
      ) && taskRunCreated) {
        await this.taskExecutionPort.settleRun({
          sessionKey,
          sessionId: request.sessionId,
          runId: taskRunId,
          terminalReason: 'error',
        }).catch((settleError) => this.taskExecutionPort.reportPersistenceFailure('settle rejected send checkpoint', settleError));
      }
      throw error;
    }
  }
}

export const chatSendCoordinator = new ChatSendCoordinator(
  gateway,
  () => useChatStore.getState(),
);
