import { useCallback, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { showAlert } from '@/components/shared/AlertDialog';
import { displayAttachments, toGatewayAttachments } from '@/services/chat/attachments';
import {
  isChatSendDispatchCancelled,
  type ChatSendRequest,
} from '@/services/chat/sendTransaction';
import { chatSendCoordinator } from '@/runtime/chatSendCoordinator';
import type { PreparedAttachment } from '@/services/chat/types';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { gateway } from '@/services/gateway';
import { voiceRuntime } from '@/runtime/VoiceRuntime';
import { useChatStore, type HistoryLoaderOptions } from '@/stores/chatStore';
import { ensureGroupFresh, useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { debugError } from '@/utils/debugLog';
import { isOpenClawActiveLeafChangedError } from '@/services/gateway/activeLeafEntryId';
import { shouldWarmUpHistoryBeforeFirstSend } from '@/utils/confirmedEmptyTranscript';
import { useAttachmentErrorMessage } from './useAttachmentErrorMessage';

interface UseMessageSendOptions {
  activeSessionKey: string;
  activeSessionId?: string;
  connected: boolean;
  historyLoading: boolean;
  isConfirmedEmptyTranscript: () => boolean;
  historyLoader?: (sessionKey?: string, options?: HistoryLoaderOptions) => Promise<void>;
  isSending: boolean;
  messageCount: number;
  files: PreparedAttachment[];
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement>;
  setIsSending: (sending: boolean, sessionKey?: string) => void;
  deliveryMode?: 'normal' | 'steer';
}

/** Normal Composer sends let the Gateway apply its current session queue mode. */
export function composerDeliveryOptions(
  deliveryMode: NonNullable<UseMessageSendOptions['deliveryMode']>,
): Pick<ChatSendRequest, 'delivery'> {
  return deliveryMode === 'steer' ? { delivery: 'steer' } : {};
}

/** 失败后只在官方并发冲突或已确认空会话首发时读取历史，不推断远端终态。 */
export function shouldRefreshHistoryAfterMessageSendFailure(
  error: unknown,
  confirmedEmptyTranscript: boolean,
): boolean {
  return confirmedEmptyTranscript || isOpenClawActiveLeafChangedError(error);
}

export function useMessageSend({
  activeSessionKey,
  activeSessionId,
  connected,
  historyLoading,
  isConfirmedEmptyTranscript,
  historyLoader,
  isSending,
  messageCount,
  files,
  text,
  textareaRef,
  setIsSending,
  deliveryMode = 'normal',
}: UseMessageSendOptions) {
  const { t } = useTranslation();
  const attachmentErrorMessage = useAttachmentErrorMessage();

  return useCallback(async () => {
    const sessionKey = activeSessionKey;
    const sendFiles = [...files];
    const rawText = textareaRef.current?.value ?? text;
    const trimmed = rawText.trim();
    if ((!trimmed && sendFiles.length === 0) || isSending || !connected || historyLoading) return;

    const confirmedEmptyTranscript = isConfirmedEmptyTranscript();
    if (historyLoader && shouldWarmUpHistoryBeforeFirstSend({
      messageCount,
      confirmedEmptyTranscript,
    })) {
      try {
        await historyLoader(sessionKey);
      } catch (error) {
        debugError('app', '[MessageSend] History warmup failed:', error);
        showAlert(t('chat.historyLoadFailed'), error instanceof Error ? error.message : String(error), 'error');
        return;
      }
    }

    let attachments;
    try {
      attachments = toGatewayAttachments(sendFiles, gateway.getAttachmentPolicy());
    } catch (error) {
      showAlert(t('input.attachmentErrorTitle'), attachmentErrorMessage(error), 'error');
      return;
    }

    const fullMessage = trimmed || t('input.attachmentsOnlyMessage', {
      files: sendFiles.map((file) => file.fileName ?? file.mimeType).join(', '),
    });
    setIsSending(true, sessionKey);

    try {
      const { budgetLimit } = useSettingsStore.getState();
      if (budgetLimit > 0) {
        await ensureGroupFresh('cost');
        const used = useGatewayDataStore.getState().costSummary?.totals?.totalCost ?? 0;
        if (used >= budgetLimit) {
          showAlert(
            t('chat.budgetExceededTitle'),
            t('chat.budgetExceededDesc', { used: used.toFixed(2), limit: budgetLimit.toFixed(2) }),
            'warning',
          );
          return;
        }
      }

      voiceRuntime.interruptGlobally(sessionKey);
      const delivery = await chatSendCoordinator.send({
        sessionKey,
        sessionId: activeSessionId,
        message: fullMessage,
        clientMessageId: createClientMessageId(),
        attachments: attachments.length ? attachments : undefined,
        displayAttachments: displayAttachments(sendFiles),
        optimisticMessage: { timestamp: new Date().toISOString() },
        ...composerDeliveryOptions(deliveryMode),
      });
      if (!isChatSendDispatchCancelled(delivery)) {
        const state = useChatStore.getState();
        state.consumeComposerSnapshot(sessionKey, {
          text: rawText,
          attachmentIds: sendFiles.map((file) => file.id),
        });
        state.setQuickReplies([], sessionKey);
      }
    } catch (error) {
      if (shouldRefreshHistoryAfterMessageSendFailure(error, confirmedEmptyTranscript)) {
        void historyLoader?.(sessionKey, { force: true, background: true })
          .catch((refreshError) => debugError('app', '[MessageSend] Active leaf refresh failed:', refreshError));
      }
      debugError('app', '[MessageSend] Delivery failed:', error);
    } finally {
      setIsSending(false, sessionKey);
    }
  }, [
    attachmentErrorMessage,
    activeSessionId,
    activeSessionKey,
    connected,
    files,
    historyLoader,
    historyLoading,
    isConfirmedEmptyTranscript,
    isSending,
    messageCount,
    setIsSending,
    t,
    text,
    textareaRef,
    deliveryMode,
  ]);
}
