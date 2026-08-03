import { useCallback, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { showAlert } from '@/components/shared/AlertDialog';
import { displayAttachments, toGatewayAttachments } from '@/services/chat/attachments';
import { chatSendCoordinator } from '@/services/chat/sendTransaction';
import type { PreparedAttachment } from '@/services/chat/types';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { useChatStore } from '@/stores/chatStore';
import { ensureGroupFresh, useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { debugError } from '@/utils/debugLog';

interface UseMessageSendOptions {
  activeSessionKey: string;
  activeSessionId?: string;
  connected: boolean;
  historyLoading: boolean;
  historyLoader?: (sessionKey: string) => Promise<unknown>;
  isSending: boolean;
  messageCount: number;
  files: PreparedAttachment[];
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement>;
  setIsSending: (sending: boolean, sessionKey?: string) => void;
  deliveryMode?: 'normal' | 'steer';
}

export function useMessageSend({
  activeSessionKey,
  activeSessionId,
  connected,
  historyLoading,
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

  return useCallback(async () => {
    const sessionKey = activeSessionKey;
    const sendFiles = [...files];
    const rawText = textareaRef.current?.value ?? text;
    const trimmed = rawText.trim();
    if ((!trimmed && sendFiles.length === 0) || isSending || !connected || historyLoading) return;

    if (messageCount === 0 && historyLoader) {
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
      attachments = toGatewayAttachments(sendFiles);
    } catch (error) {
      showAlert(t('input.attachmentErrorTitle'), error instanceof Error ? error.message : String(error), 'error');
      return;
    }

    const fullMessage = trimmed || t('input.attachmentsOnlyMessage', {
      files: sendFiles.map((file) => file.fileName).join(', '),
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
      const delivery = chatSendCoordinator.send({
        sessionKey,
        sessionId: activeSessionId,
        message: fullMessage,
        clientMessageId: createClientMessageId(),
        attachments: attachments.length ? attachments : undefined,
        displayAttachments: displayAttachments(sendFiles),
        optimisticMessage: { timestamp: new Date().toISOString() },
        queueIfBusy: deliveryMode !== 'steer',
        steer: deliveryMode === 'steer',
      });
      const state = useChatStore.getState();
      state.consumeComposerSnapshot(sessionKey, {
        text: rawText,
        attachmentIds: sendFiles.map((file) => file.id),
      });
      state.setQuickReplies([], sessionKey);
      await delivery;
    } catch (error) {
      debugError('app', '[MessageSend] Delivery failed:', error);
    } finally {
      setIsSending(false, sessionKey);
    }
  }, [
    activeSessionId,
    activeSessionKey,
    connected,
    files,
    historyLoader,
    historyLoading,
    isSending,
    messageCount,
    setIsSending,
    t,
    text,
    textareaRef,
    deliveryMode,
  ]);
}
