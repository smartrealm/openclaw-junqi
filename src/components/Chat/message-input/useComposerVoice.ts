import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  finishTalkPlayback,
  playTalkPcm,
  stopTalkPlayback,
} from '@/api/tauri-commands';
import { useVoiceCapture } from '@/hooks/useVoiceCapture';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { AttachmentValidationError, createPreparedAttachment, toGatewayAttachments } from '@/services/chat/attachments';
import { chatSendCoordinator } from '@/services/chat/sendTransaction';
import { voiceFileRuntime } from '@/services/chat/voiceFileRuntime';
import { gateway, talkGatewayClient } from '@/services/gateway';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import type { TalkConversationErrorCode } from '@/services/voice/TalkConversationCoordinator';
import { TalkConversationCoordinator, shouldCancelTalkOutput } from '@/services/voice/TalkConversationCoordinator';
import {
  voiceModeCoordinator,
  type VoiceModeContext,
  type VoiceModeErrorCode,
} from '@/services/voice/VoiceModeCoordinator';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { VOICE_INTERRUPT_EVENT, type VoiceInterruptControl } from '@/services/voice/types';
import { selectSessionRequestActive, useChatStore } from '@/stores/chatStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { debugError } from '@/utils/debugLog';

function sameVoiceContext(left: VoiceModeContext, right: VoiceModeContext): boolean {
  return left.sessionKey === right.sessionKey && left.connectionId === right.connectionId;
}

function isAttestedVoiceContext(
  current: VoiceModeContext | null,
  expected: VoiceModeContext,
): boolean {
  return current !== null
    && sameVoiceContext(current, expected)
    && gateway.isConnectionCurrent(expected.connectionId);
}

function voiceModeError(code: TalkConversationErrorCode): VoiceModeErrorCode {
  if (code === 'talk_session_replaced') return 'talk_session_replaced';
  if (code === 'talk_session_closed') return 'talk_session_closed';
  if (code === 'gateway_unavailable' || code === 'connection_changed') return 'gateway_unavailable';
  return 'talk_unavailable';
}

interface UseComposerVoiceOptions {
  activeSessionKey: string;
  activeSessionId?: string;
  connected: boolean;
  historyLoading: boolean;
  setIsSending: (sending: boolean, sessionKey?: string) => void;
  reportAttachmentError: (error: unknown) => void;
}

export function useComposerVoice({
  activeSessionKey,
  activeSessionId,
  connected,
  historyLoading,
  setIsSending,
  reportAttachmentError,
}: UseComposerVoiceOptions) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const voiceMode = useVoiceMode();
  const activeTurnRef = useRef<string | null>(null);
  const currentContextRef = useRef<VoiceModeContext | null>(null);
  const stopVoiceCaptureRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const talkConversationRef = useRef<TalkConversationCoordinator | null>(null);
  const projectedTalkOutputSessionRef = useRef<string | null>(null);

  if (!talkConversationRef.current) {
    talkConversationRef.current = new TalkConversationCoordinator({
      client: talkGatewayClient,
      captureConnectionId: () => gateway.captureConnectionId(),
      isConnectionCurrent: (candidate) => gateway.isConnectionCurrent(candidate),
      interruptLocalOutput: (sessionKey) => voiceRuntime.interruptGlobally(sessionKey, { cancelTalk: false }),
      playOutput: playTalkPcm,
      finishOutput: finishTalkPlayback,
      stopOutput: stopTalkPlayback,
    });
  }

  const talkConversation = useSyncExternalStore(
    talkConversationRef.current.subscribe,
    talkConversationRef.current.getSnapshot,
    talkConversationRef.current.getSnapshot,
  );
  const connectionId = gateway.captureConnectionId();
  currentContextRef.current = connectionId && activeSessionKey
    ? { sessionKey: activeSessionKey, connectionId }
    : null;

  const phase = useVoiceStore((state) => state.phase);
  const voiceSessionKey = useVoiceStore((state) => state.sessionKey);
  const remoteOutput = useVoiceStore((state) => state.remoteOutput);
  const outputActive = talkConversation.phase === 'speaking'
    || remoteOutput !== null
    || ((phase === 'queued' || phase === 'speaking')
      && (voiceSessionKey == null || voiceSessionKey === activeSessionKey));

  const isCurrentVoiceContext = useCallback(
    (context: VoiceModeContext) => isAttestedVoiceContext(currentContextRef.current, context),
    [],
  );

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
      await voiceFileRuntime.save(sessionKey, fileName, base64);
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
    if (!selectSessionRequestActive(useChatStore.getState(), activeSessionKey)) return;
    await gateway.abortChat(activeSessionKey, activeSessionId)
      .catch((error) => debugError('gateway', '[ComposerVoice] Unable to stop response:', error));
  }, [activeSessionId, activeSessionKey]);

  const voiceCapture = useVoiceCapture({
    onSpeechStart: () => {
      const context = currentContextRef.current;
      const turnId = activeTurnRef.current;
      if (!context || !voiceModeCoordinator.transition(turnId, context, 'hearing')) return;
      if (talkConversationRef.current?.getSnapshot().phase === 'speaking') {
        void talkConversationRef.current.interrupt();
      }
    },
    onSpeechEnd: () => {
      const context = currentContextRef.current;
      if (context) voiceModeCoordinator.transition(activeTurnRef.current, context, 'thinking');
    },
    onPcmAudio: (frame) => {
      const context = currentContextRef.current;
      if (!context || !voiceModeCoordinator.ownsTurn(activeTurnRef.current, context)) return;
      talkConversationRef.current?.appendPcm(frame);
    },
    sessionKey: activeSessionKey,
  });
  stopVoiceCaptureRef.current = voiceCapture.stop;

  const stopVoiceMode = useCallback(async () => {
    activeTurnRef.current = null;
    await voiceModeCoordinator.stopAndReleaseResources();
  }, []);

  const startTalk = useCallback(async () => {
    if (recording) setRecording(false);
    if (voiceModeCoordinator.getSnapshot().mode !== 'off') await stopVoiceMode();
    const context = currentContextRef.current;
    if (!context || !isCurrentVoiceContext(context)) {
      activeTurnRef.current = voiceModeCoordinator.start({ context: null }).turnId;
      return;
    }

    const started = voiceModeCoordinator.start({ context });
    activeTurnRef.current = started.turnId;
    await stopAssistant();
    if (!isCurrentVoiceContext(context) || !voiceModeCoordinator.ownsTurn(started.turnId, context)) {
      await voiceModeCoordinator.stopOwnedTurnAndReleaseResources(started.turnId, context);
      return;
    }

    const coordinator = talkConversationRef.current;
    const acceptance = await coordinator?.acceptInput(context.sessionKey);
    if (
      !coordinator
      || !acceptance
      || !coordinator.ownsLease(acceptance.lease)
      || !voiceModeCoordinator.ownsTurn(started.turnId, context)
    ) {
      if (coordinator && acceptance?.lease) {
        await coordinator.stopOwnedLease(acceptance.lease);
      }
      return;
    }
    const talk = acceptance.snapshot;
    if (talk.phase === 'error' || !talk.inputAudioFormat) {
      voiceModeCoordinator.fail(
        started.turnId,
        context,
        talk.error ? voiceModeError(talk.error) : 'talk_unavailable',
        talk.errorDetail,
      );
      return;
    }

    const captureResult = await voiceCapture.start(talk.inputAudioFormat);
    if (
      !captureResult.ok
      || !isCurrentVoiceContext(context)
      || !voiceModeCoordinator.ownsTurn(started.turnId, context)
    ) {
      await coordinator.stopOwnedLease(acceptance.lease);
      if (voiceModeCoordinator.ownsTurn(started.turnId, context)) {
        voiceModeCoordinator.fail(started.turnId, context, 'capture_failed', captureResult.ok ? null : captureResult.error);
      }
      return;
    }
    voiceModeCoordinator.transition(started.turnId, context, 'listening');
  }, [
    isCurrentVoiceContext,
    recording,
    stopAssistant,
    stopVoiceMode,
    voiceCapture.start,
  ]);

  useEffect(() => {
    const previousSessionKey = projectedTalkOutputSessionRef.current;
    const sessionKey = talkConversation.sessionKey;
    if (previousSessionKey && previousSessionKey !== sessionKey) {
      voiceRuntime.setNativeTalkOutput(previousSessionKey, false);
    }
    if (sessionKey && talkConversation.phase === 'speaking') {
      voiceRuntime.setNativeTalkOutput(sessionKey, true);
    } else if (sessionKey) {
      voiceRuntime.setNativeTalkOutput(sessionKey, false);
    }
    projectedTalkOutputSessionRef.current = sessionKey;

    const context = currentContextRef.current;
    const turnId = activeTurnRef.current;
    if (!context || !voiceModeCoordinator.ownsTurn(turnId, context)) return;
    if (talkConversation.phase === 'connecting') {
      voiceModeCoordinator.transition(turnId, context, 'preparing');
    } else if (talkConversation.phase === 'thinking') {
      voiceModeCoordinator.transition(turnId, context, 'thinking');
    } else if (talkConversation.phase === 'speaking') {
      voiceModeCoordinator.transition(turnId, context, 'speaking');
    } else if (talkConversation.phase === 'listening' && voiceModeCoordinator.getSnapshot().phase === 'speaking') {
      voiceModeCoordinator.transition(turnId, context, 'listening');
    } else if (talkConversation.phase === 'error' && talkConversation.error) {
      voiceModeCoordinator.fail(
        turnId,
        context,
        voiceModeError(talkConversation.error),
        talkConversation.errorDetail,
      );
      void voiceCapture.stop();
    }
  }, [
    talkConversation.error,
    talkConversation.errorDetail,
    talkConversation.phase,
    talkConversation.sessionKey,
    voiceCapture.stop,
  ]);

  useEffect(() => {
    const cancelTalkOutput = (event: Event) => {
      const detail = (event as CustomEvent<VoiceInterruptControl>).detail;
      const coordinator = talkConversationRef.current;
      const snapshot = coordinator?.getSnapshot();
      if (!coordinator || !snapshot || !shouldCancelTalkOutput(snapshot, detail)) return;
      void coordinator.interrupt();
    };
    window.addEventListener(VOICE_INTERRUPT_EVENT, cancelTalkOutput);
    return () => window.removeEventListener(VOICE_INTERRUPT_EVENT, cancelTalkOutput);
  }, []);

  useEffect(() => voiceModeCoordinator.subscribeResourceRelease(async () => {
    await Promise.allSettled([
      voiceCapture.stop(),
      talkConversationRef.current?.stop() ?? Promise.resolve(),
    ]);
  }), [voiceCapture.stop]);

  useEffect(() => {
    const snapshot = voiceModeCoordinator.getSnapshot();
    const context = currentContextRef.current;
    if (!snapshot.context) return;
    if (!context) {
      activeTurnRef.current = null;
      voiceModeCoordinator.invalidate('gateway_unavailable');
      void voiceCapture.stop();
      void talkConversationRef.current?.stop();
      return;
    }
    if (!sameVoiceContext(snapshot.context, context)) {
      activeTurnRef.current = null;
      voiceModeCoordinator.invalidateContext(context);
      void voiceCapture.stop();
      void talkConversationRef.current?.stop();
    }
  }, [activeSessionKey, connectionId, voiceCapture.stop]);

  useEffect(() => {
    if (!voiceCapture.error) return;
    const context = currentContextRef.current;
    if (context) {
      voiceModeCoordinator.fail(activeTurnRef.current, context, 'capture_failed', voiceCapture.error);
      void talkConversationRef.current?.stop();
    }
  }, [voiceCapture.error]);

  useEffect(() => () => {
    const turnId = activeTurnRef.current;
    const context = currentContextRef.current;
    const projectedSessionKey = projectedTalkOutputSessionRef.current;
    activeTurnRef.current = null;
    projectedTalkOutputSessionRef.current = null;
    if (projectedSessionKey) voiceRuntime.setNativeTalkOutput(projectedSessionKey, false);
    void talkConversationRef.current?.stop();
    void stopVoiceCaptureRef.current();
    void voiceModeCoordinator.stopOwnedTurnAndReleaseResources(turnId, context);
  }, []);

  const startRecording = useCallback(() => {
    void (async () => {
      if (voiceModeCoordinator.getSnapshot().mode !== 'off') await stopVoiceMode();
      await stopAssistant();
      setRecording(true);
    })();
  }, [stopAssistant, stopVoiceMode]);

  const toggleTalk = useCallback(() => {
    void (async () => {
      if (voiceModeCoordinator.getSnapshot().mode !== 'off') await stopVoiceMode();
      else await startTalk();
    })();
  }, [startTalk, stopVoiceMode]);

  const startTalkAction = useCallback(() => { void startTalk(); }, [startTalk]);
  const stopVoiceModeAction = useCallback(() => { void stopVoiceMode(); }, [stopVoiceMode]);

  return {
    recording,
    setRecording,
    outputActive,
    voiceCapture,
    voiceMode,
    talkConversation,
    startRecording,
    startTalk: startTalkAction,
    toggleTalk,
    stopVoiceMode: stopVoiceModeAction,
    sendVoice: (base64: string, mimeType: string, durationSec: number, previewUrl: string) => {
      void sendVoice(base64, mimeType, durationSec, previewUrl);
    },
  };
}
