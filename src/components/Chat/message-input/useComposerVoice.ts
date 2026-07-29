import { useCallback, useState, type RefObject, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useVoiceWake } from '@/hooks/useVoiceWake';
import { AttachmentValidationError, createPreparedAttachment, toGatewayAttachments } from '@/services/chat/attachments';
import { chatSendCoordinator } from '@/services/chat/sendTransaction';
import { gateway } from '@/services/gateway';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { useChatStore } from '@/stores/chatStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { debugError } from '@/utils/debugLog';

function estimateWavDuration(base64: string): number {
  try {
    const raw = atob(base64);
    if (raw.length < 44) return 0;
    const view = new DataView(Uint8Array.from(raw, (char) => char.charCodeAt(0)).buffer);
    const channels = view.getUint16(22, true) || 1;
    const sampleRate = view.getUint32(24, true) || 16_000;
    const bits = view.getUint16(34, true) || 16;
    const dataBytes = view.getUint32(40, true) || Math.max(0, raw.length - 44);
    return Math.max(0, Math.round(dataBytes / Math.max(1, sampleRate * channels * (bits / 8))));
  } catch {
    return 0;
  }
}

interface UseComposerVoiceOptions {
  activeSessionKey: string;
  activeSessionId?: string;
  connected: boolean;
  historyLoading: boolean;
  language: string;
  textareaRef: RefObject<HTMLTextAreaElement>;
  setText: (next: SetStateAction<string>) => void;
  setIsSending: (sending: boolean, sessionKey?: string) => void;
  closeMenu: () => void;
  reportAttachmentError: (error: unknown) => void;
}

export function useComposerVoice({
  activeSessionKey,
  activeSessionId,
  connected,
  historyLoading,
  language,
  textareaRef,
  setText,
  setIsSending,
  closeMenu,
  reportAttachmentError,
}: UseComposerVoiceOptions) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const phase = useVoiceStore((state) => state.phase);
  const voiceSessionKey = useVoiceStore((state) => state.sessionKey);
  const remoteOutput = useVoiceStore((state) => state.remoteOutput);
  const outputActive = remoteOutput !== null
    || ((phase === 'queued' || phase === 'speaking')
      && (voiceSessionKey == null || voiceSessionKey === activeSessionKey));

  const sendVoice = useCallback(async (
    base64: string,
    mimeType: string,
    durationSec: number,
    previewUrl: string,
  ) => {
    if (!connected || historyLoading || !base64) return;
    const sessionKey = activeSessionKey;
    setRecording(false);
    voiceRuntime.interruptGlobally(sessionKey);
    setIsSending(true, sessionKey);
    try {
      const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm';
      const fileName = `voice-${Date.now()}.${extension}`;
      await window.aegis?.voice?.save?.(fileName, base64, sessionKey).catch(() => null);
      const attachments = toGatewayAttachments([createPreparedAttachment({
        fileName,
        mimeType,
        base64,
        size: Math.floor(base64.length * 0.75),
      })]);
      await chatSendCoordinator.send({
        sessionKey,
        sessionId: activeSessionId,
        clientMessageId: createClientMessageId(),
        message: t('voice.voiceMessage', { seconds: durationSec }),
        attachments,
        optimisticMessage: { mediaUrl: previewUrl, mediaType: 'audio' },
      });
    } catch (error) {
      debugError('media', '[ComposerVoice] Send failed:', error);
      if (error instanceof AttachmentValidationError) reportAttachmentError(error);
    } finally {
      setIsSending(false, sessionKey);
    }
  }, [
    activeSessionId,
    activeSessionKey,
    connected,
    historyLoading,
    reportAttachmentError,
    setIsSending,
    t,
  ]);

  const stopAssistant = useCallback(async () => {
    voiceRuntime.interruptGlobally(activeSessionKey);
    if (!useChatStore.getState().typingBySession[activeSessionKey]) return;
    useChatStore.getState().clearQueue(activeSessionKey);
    await gateway.abortChat(activeSessionKey)
      .catch((error) => debugError('gateway', '[ComposerVoice] Unable to stop response:', error));
  }, [activeSessionKey]);

  const voiceWake = useVoiceWake({
    onTranscript: (transcript) => {
      voiceRuntime.interruptGlobally(activeSessionKey);
      setText((current) => current ? `${current} ${transcript}` : transcript);
      textareaRef.current?.focus();
    },
    onCaptureFallback: async (wavDataUrl) => {
      const base64 = wavDataUrl.split(',')[1] || '';
      if (base64) await sendVoice(base64, 'audio/wav', estimateWavDuration(base64), wavDataUrl);
    },
    onWakeDetected: () => { void stopAssistant(); },
    lang: language === 'zh-TW' ? 'zh-TW' : language === 'zh' ? 'zh-CN' : 'en-US',
    sessionKey: activeSessionKey,
  });

  const startRecording = useCallback(() => {
    void (async () => {
      closeMenu();
      if (voiceWake.enabled || voiceWake.error) await voiceWake.stop();
      await stopAssistant();
      setRecording(true);
    })();
  }, [closeMenu, stopAssistant, voiceWake.enabled, voiceWake.error, voiceWake.stop]);

  const toggleDictation = useCallback(() => {
    void (async () => {
      closeMenu();
      if (voiceWake.enabled) await voiceWake.stop();
      else {
        await stopAssistant();
        await voiceWake.start();
      }
      textareaRef.current?.focus();
    })();
  }, [closeMenu, stopAssistant, textareaRef, voiceWake.enabled, voiceWake.start, voiceWake.stop]);

  const status = voiceWake.phase === 'transcribing' || voiceWake.phase === 'wake_detected'
    ? t('input.dictationProcessing')
    : t('input.dictationListening');

  return {
    recording,
    setRecording,
    outputActive,
    voiceWake,
    status,
    startRecording,
    toggleDictation,
    sendVoice: (base64: string, mimeType: string, durationSec: number, previewUrl: string) => {
      void sendVoice(base64, mimeType, durationSec, previewUrl);
    },
  };
}
