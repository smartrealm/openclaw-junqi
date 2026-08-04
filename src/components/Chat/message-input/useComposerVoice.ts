import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getVoiceWakeDetectorStatus,
  finishTalkPlayback,
  playTalkPcm,
  presentCurrentWindowForVoiceWake,
  stopTalkPlayback,
} from '@/api/tauri-commands';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import { useVoiceWake } from '@/hooks/useVoiceWake';
import { AttachmentValidationError, createPreparedAttachment, toGatewayAttachments } from '@/services/chat/attachments';
import { chatSendCoordinator } from '@/services/chat/sendTransaction';
import { gateway, talkGatewayClient, voiceWakeGatewayClient } from '@/services/gateway';
import { createClientMessageId } from '@/services/gateway/messageIdentity';
import type { VoiceWakeGatewayConfiguration } from '@/services/gateway/VoiceWakeGatewayClient';
import {
  voiceModeCoordinator,
  type VoiceModeContext,
} from '@/services/voice/VoiceModeCoordinator';
import {
  decideVoiceWakeRoute,
  hasCompatibleVoiceWakeTrigger,
  type VoiceWakeRouteContext,
} from '@/services/voice/VoiceWakeRoutePolicy';
import { voiceRuntime } from '@/services/voice/VoiceRuntime';
import { TalkConversationCoordinator, shouldCancelTalkOutput } from '@/services/voice/TalkConversationCoordinator';
import { VOICE_INTERRUPT_EVENT, type VoiceInterruptControl } from '@/services/voice/types';
import { createJarvisSessionCategory } from '@/services/voice/JarvisSessionCategory';
import { shouldAutoArmSession, subscribeAutoArmPreference } from '@/services/voice/VoiceWakePreference';
import { selectSessionRequestActive, useChatStore } from '@/stores/chatStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { debugError } from '@/utils/debugLog';
import { voiceFileRuntime } from '@/services/chat/voiceFileRuntime';

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

interface UseComposerVoiceOptions {
  activeSessionKey: string;
  activeSessionId?: string;
  activeSessionAgentId?: string;
  connected: boolean;
  historyLoading: boolean;
  runtimeTargetFingerprint: string | null;
  textareaRef: RefObject<HTMLTextAreaElement>;
  setIsSending: (sending: boolean, sessionKey?: string) => void;
  closeMenu: () => void;
  reportAttachmentError: (error: unknown) => void;
}

export function useComposerVoice({
  activeSessionKey,
  activeSessionId,
  activeSessionAgentId,
  connected,
  historyLoading,
  runtimeTargetFingerprint,
  textareaRef,
  setIsSending,
  closeMenu,
  reportAttachmentError,
}: UseComposerVoiceOptions) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [autoArmEnabled, setAutoArmEnabledState] = useState(() => (
    shouldAutoArmSession(activeSessionKey, runtimeTargetFingerprint)
  ));
  const [autoArmRevision, setAutoArmRevision] = useState(0);
  const voiceMode = useVoiceMode();
  const activeTurnRef = useRef<string | null>(null);
  const autoArmAttemptRef = useRef<string | null>(null);
  const autoArmRecoveryAttemptsRef = useRef(0);
  const wakeConfigurationRef = useRef<VoiceWakeGatewayConfiguration | null>(null);
  const pendingAudioCapturesRef = useRef(new Map<string, {
    wavDataUrl: string;
    durationSec: number;
  }>());
  const stopVoiceWakeRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const talkConversationRef = useRef<TalkConversationCoordinator | null>(null);
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
  const projectedTalkOutputSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const sessionKey = talkConversation.sessionKey;
    const projected = projectedTalkOutputSessionRef.current;
    if (projected && (projected !== sessionKey || talkConversation.phase !== 'speaking')) {
      voiceRuntime.setNativeTalkOutput(projected, false);
      projectedTalkOutputSessionRef.current = null;
    }
    if (sessionKey && talkConversation.phase === 'speaking') {
      voiceRuntime.setNativeTalkOutput(sessionKey, true);
      projectedTalkOutputSessionRef.current = sessionKey;
    }
  }, [talkConversation.phase, talkConversation.sessionKey]);
  useEffect(() => {
    const cancelTalkOutput = (event: Event) => {
      const detail = (event as CustomEvent<VoiceInterruptControl>).detail;
      if (!detail || !detail.cancelTalk) return;
      const coordinator = talkConversationRef.current;
      const snapshot = coordinator?.getSnapshot();
      if (!coordinator || !snapshot || !shouldCancelTalkOutput(snapshot, detail)) return;
      void coordinator.interrupt();
    };
    window.addEventListener(VOICE_INTERRUPT_EVENT, cancelTalkOutput);
    return () => window.removeEventListener(VOICE_INTERRUPT_EVENT, cancelTalkOutput);
  }, []);
  const currentContextRef = useRef<VoiceModeContext | null>(null);
  const currentRouteContextRef = useRef<VoiceWakeRouteContext | null>(null);
  const connectionId = gateway.captureConnectionId();
  currentContextRef.current = connectionId && activeSessionKey
    ? { sessionKey: activeSessionKey, connectionId }
    : null;
  currentRouteContextRef.current = currentContextRef.current
    ? { sessionKey: activeSessionKey, agentId: activeSessionAgentId }
    : null;
  const phase = useVoiceStore((state) => state.phase);
  const voiceSessionKey = useVoiceStore((state) => state.sessionKey);
  const remoteOutput = useVoiceStore((state) => state.remoteOutput);
  const outputActive = remoteOutput !== null
    || ((phase === 'queued' || phase === 'speaking')
      && (voiceSessionKey == null || voiceSessionKey === activeSessionKey));
  const isCurrentVoiceContext = useCallback(
    (context: VoiceModeContext) => isAttestedVoiceContext(currentContextRef.current, context),
    [],
  );

  const requestAutoArmRetry = useCallback(() => {
    autoArmAttemptRef.current = null;
    setAutoArmRevision((revision) => revision + 1);
  }, []);

  useEffect(() => voiceWakeGatewayClient.subscribe((event) => {
    const current = wakeConfigurationRef.current;
    if (!current) return;
    if (event.type === 'triggers') {
      wakeConfigurationRef.current = { ...current, triggers: event.snapshot };
      return;
    }
    wakeConfigurationRef.current = { ...current, routing: event.config };
  }), []);

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
        source: 'jarvis',
        delivery: 'steer',
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

  const voiceWake = useVoiceWake({
    onCaptureFallback: async (wavDataUrl) => {
      const context = currentContextRef.current;
      if (!context) return;
      const talkConversation = talkConversationRef.current;
      if (talkConversation?.getSnapshot().phase === 'connecting') {
        await talkConversation.waitForOpening();
      }
      if (!isCurrentVoiceContext(context) || !voiceModeCoordinator.ownsTurn(activeTurnRef.current, context)) {
        return;
      }
      if (talkConversation?.getSnapshot().sessionId) {
        voiceModeCoordinator.resumeListening(activeTurnRef.current, context);
        return;
      }
      if (!voiceModeCoordinator.markTranscribing(activeTurnRef.current, context)) return;
      voiceRuntime.interruptGlobally(context.sessionKey);
      const base64 = wavDataUrl.split(',')[1] || '';
      if (!base64) return;
      const draft = voiceModeCoordinator.acceptAudioCapture(
        activeTurnRef.current,
        context,
        estimateWavDuration(base64),
      );
      if (draft?.kind === 'audio') {
        pendingAudioCapturesRef.current.set(draft.captureId, {
          wavDataUrl,
          durationSec: draft.durationSec,
        });
        void stopVoiceWakeRef.current();
      }
    },
    onWakeDetected: (trigger) => {
      const context = currentContextRef.current;
      if (!context || !voiceModeCoordinator.markTriggered(activeTurnRef.current, context)) return false;
      if (trigger) {
        const routeContext = currentRouteContextRef.current;
        const disposition = routeContext?.sessionKey === context.sessionKey
          ? decideVoiceWakeRoute(wakeConfigurationRef.current, trigger, routeContext)
          : 'target_changed';
        if (disposition === 'unknown_trigger') {
          voiceModeCoordinator.resumeListening(activeTurnRef.current, context);
          return false;
        }
        if (disposition === 'target_changed') {
          voiceModeCoordinator.reportUnavailable(activeTurnRef.current, context, 'target_changed');
          void stopVoiceWakeRef.current();
          return false;
        }
      }
      const acceptWake = (): boolean => {
        if (!isCurrentVoiceContext(context) || !voiceModeCoordinator.ownsTurn(activeTurnRef.current, context)) {
          return false;
        }
        void presentCurrentWindowForVoiceWake().catch((error) => {
          debugError('media', '[ComposerVoice] Could not restore the wake window:', error);
        });
        void talkConversationRef.current?.start(context.sessionKey);
        void stopAssistant();
        return true;
      };
      if (!trigger) return acceptWake();
      const category = createJarvisSessionCategory(trigger);
      if (!category) return acceptWake();
      return useChatStore.getState().ensureSessionGroup(category)
        .then(() => useChatStore.getState().setSessionCategory(context.sessionKey, category))
        .then(() => acceptWake())
        .catch((error) => {
          debugError('gateway', '[ComposerVoice] Unable to confirm Jarvis session category:', error);
          voiceModeCoordinator.reportUnavailable(activeTurnRef.current, context, 'session_category_unavailable');
          void stopVoiceWakeRef.current();
          return false;
        });
    },
    onPcmAudio: (frame) => {
      const context = currentContextRef.current;
      if (context) voiceModeCoordinator.markTranscribing(activeTurnRef.current, context);
      talkConversationRef.current?.appendPcm(frame);
    },
    sessionKey: activeSessionKey,
  });
  stopVoiceWakeRef.current = voiceWake.stop;

  const stopVoiceMode = useCallback(async () => {
    activeTurnRef.current = null;
    pendingAudioCapturesRef.current.clear();
    await talkConversationRef.current?.stop();
    await voiceModeCoordinator.stopAndReleaseCapture();
  }, []);

  const startDictation = useCallback(async () => {
    closeMenu();
    const context = currentContextRef.current;
    if (voiceWake.enabled) await voiceWake.stop();
    if (!context) {
      voiceModeCoordinator.start({
        mode: 'dictation',
        context: { sessionKey: activeSessionKey, connectionId: '' },
        wakeDetectorAvailable: false,
      });
      activeTurnRef.current = null;
      return;
    }

    if (!isCurrentVoiceContext(context)) return;

    await stopAssistant();
    if (!isCurrentVoiceContext(context)) return;
    pendingAudioCapturesRef.current.clear();
    const snapshot = voiceModeCoordinator.start({
      mode: 'dictation',
      context,
      wakeDetectorAvailable: false,
    });
    activeTurnRef.current = snapshot.turnId;
    await voiceWake.start();
    if (
      !isCurrentVoiceContext(context)
      || !voiceModeCoordinator.ownsTurn(snapshot.turnId, context)
    ) {
      activeTurnRef.current = null;
      pendingAudioCapturesRef.current.clear();
      await voiceWake.stop();
      await voiceModeCoordinator.stopOwnedTurnAndReleaseCapture(snapshot.turnId, context);
      return;
    }
    textareaRef.current?.focus();
  }, [
    activeSessionKey,
    closeMenu,
    isCurrentVoiceContext,
    stopAssistant,
    textareaRef,
    voiceWake.enabled,
    voiceWake.start,
    voiceWake.stop,
  ]);

  const requestWakeWord = useCallback(() => {
    void (async () => {
      closeMenu();
      if (voiceWake.enabled) await voiceWake.stop();
      pendingAudioCapturesRef.current.clear();
      const context = currentContextRef.current;
      if (!context) {
        voiceModeCoordinator.start({
          mode: 'wake_word',
          context: { sessionKey: activeSessionKey, connectionId: '' },
          wakeDetectorAvailable: false,
        });
        activeTurnRef.current = null;
        return;
      }

      let detectorAvailable = false;
      let detectorKeywords: string[] = [];
      try {
        const detector = await getVoiceWakeDetectorStatus();
        detectorAvailable = detector.available;
        detectorKeywords = detector.keywords;
      } catch (error) {
        const snapshot = voiceModeCoordinator.start({
          mode: 'wake_word',
          context,
          wakeDetectorAvailable: false,
        });
        activeTurnRef.current = snapshot.turnId;
        return;
      }
      if (!detectorAvailable) {
        const snapshot = voiceModeCoordinator.start({
          mode: 'wake_word',
          context,
          wakeDetectorAvailable: false,
        });
        activeTurnRef.current = snapshot.turnId;
        return;
      }
      try {
        const configuration = await voiceWakeGatewayClient.getConfiguration();
        if (!isCurrentVoiceContext(context)) return;
        wakeConfigurationRef.current = configuration;
        if (!hasCompatibleVoiceWakeTrigger(detectorKeywords, configuration)) {
          const snapshot = voiceModeCoordinator.start({
            mode: 'wake_word',
            context,
            wakeDetectorAvailable: true,
          });
          activeTurnRef.current = snapshot.turnId;
          voiceModeCoordinator.reportUnavailable(snapshot.turnId, context, 'wake_trigger_model_mismatch');
          return;
        }
      } catch (error) {
        if (!isCurrentVoiceContext(context)) return;
        const snapshot = voiceModeCoordinator.start({
          mode: 'wake_word',
          context,
          wakeDetectorAvailable: true,
        });
        activeTurnRef.current = snapshot.turnId;
        voiceModeCoordinator.reportUnavailable(snapshot.turnId, context, 'gateway_unavailable');
        return;
      }
      const snapshot = voiceModeCoordinator.start({
        mode: 'wake_word',
        context,
        wakeDetectorAvailable: detectorAvailable,
      });
      activeTurnRef.current = snapshot.turnId;
      await voiceWake.start('wake_word', { streamPcm: true });
      if (
        !isCurrentVoiceContext(context)
        || !voiceModeCoordinator.ownsTurn(snapshot.turnId, context)
      ) {
        activeTurnRef.current = null;
        await voiceWake.stop();
        await voiceModeCoordinator.stopOwnedTurnAndReleaseCapture(snapshot.turnId, context);
      }
    })();
  }, [activeSessionKey, closeMenu, isCurrentVoiceContext, voiceWake.enabled, voiceWake.start, voiceWake.stop]);

  useEffect(() => {
    setAutoArmEnabledState(shouldAutoArmSession(activeSessionKey, runtimeTargetFingerprint));
  }, [activeSessionKey, runtimeTargetFingerprint]);

  useEffect(() => subscribeAutoArmPreference(() => {
    const shouldArm = shouldAutoArmSession(activeSessionKey, runtimeTargetFingerprint);
    setAutoArmEnabledState(shouldArm);
    if (shouldArm) requestAutoArmRetry();
    else void stopVoiceMode();
  }), [activeSessionKey, requestAutoArmRetry, runtimeTargetFingerprint, stopVoiceMode]);

  useEffect(() => {
    if (
      !connected
      || historyLoading
      || !connectionId
      || !autoArmEnabled
      || !shouldAutoArmSession(activeSessionKey, runtimeTargetFingerprint)
      || voiceWake.enabled
      || voiceMode.mode !== 'off'
    ) {
      return;
    }
    const attempt = `${connectionId}:${activeSessionKey}`;
    if (autoArmAttemptRef.current === attempt) return;
    autoArmAttemptRef.current = attempt;
    requestWakeWord();
  }, [
    activeSessionKey,
    autoArmEnabled,
    autoArmRevision,
    connected,
    connectionId,
    historyLoading,
    requestWakeWord,
    runtimeTargetFingerprint,
    voiceMode.mode,
    voiceWake.enabled,
  ]);

  useEffect(() => {
    if (voiceWake.enabled) autoArmRecoveryAttemptsRef.current = 0;
  }, [voiceWake.enabled]);

  useEffect(() => {
    if (
      !voiceWake.error
      || !connected
      || historyLoading
      || !connectionId
      || !autoArmEnabled
      || !shouldAutoArmSession(activeSessionKey, runtimeTargetFingerprint)
    ) {
      return;
    }
    const attempt = autoArmRecoveryAttemptsRef.current;
    autoArmRecoveryAttemptsRef.current += 1;
    const timer = window.setTimeout(() => {
      void voiceModeCoordinator.stopAndReleaseCapture();
      requestAutoArmRetry();
    }, Math.min(30_000, 1_000 * (2 ** attempt)));
    return () => window.clearTimeout(timer);
  }, [
    activeSessionKey,
    autoArmEnabled,
    connected,
    connectionId,
    historyLoading,
    requestAutoArmRetry,
    runtimeTargetFingerprint,
    voiceWake.error,
  ]);

  const confirmVoiceDraft = useCallback(async () => {
    const context = currentContextRef.current;
    if (!context) return;
    const turnId = activeTurnRef.current;
    if (
      !isCurrentVoiceContext(context)
      || !voiceModeCoordinator.ownsTurn(turnId, context)
    ) {
      pendingAudioCapturesRef.current.clear();
      activeTurnRef.current = null;
      voiceModeCoordinator.invalidateOwnedTurn(turnId, context, 'gateway_unavailable');
      void stopVoiceWakeRef.current();
      return;
    }
    const draft = voiceModeCoordinator.getDraft(turnId, context);
    if (!draft) return;

    const capture = pendingAudioCapturesRef.current.get(draft.captureId);
    if (!capture) {
      voiceModeCoordinator.fail(turnId, context, 'capture_failed');
      return;
    }
    const base64 = capture.wavDataUrl.split(',')[1] || '';
    if (!base64) {
      voiceModeCoordinator.fail(turnId, context, 'capture_failed');
      return;
    }
    pendingAudioCapturesRef.current.delete(draft.captureId);
    activeTurnRef.current = null;
    void voiceModeCoordinator.stopAndReleaseCapture();
    await sendVoice(base64, 'audio/wav', capture.durationSec, capture.wavDataUrl);
    requestAutoArmRetry();
  }, [isCurrentVoiceContext, requestAutoArmRetry, sendVoice]);

  const discardVoiceDraft = useCallback(() => {
    const context = currentContextRef.current;
    const draft = voiceModeCoordinator.getSnapshot().draft;
    if (voiceModeCoordinator.discardDraft(activeTurnRef.current, context)) {
      if (draft?.kind === 'audio') pendingAudioCapturesRef.current.delete(draft.captureId);
      activeTurnRef.current = null;
      void voiceModeCoordinator.stopAndReleaseCapture();
      requestAutoArmRetry();
    }
  }, [requestAutoArmRetry]);

  useEffect(() => {
    const snapshot = voiceModeCoordinator.getSnapshot();
    const context = currentContextRef.current;
    if (!snapshot.context) return;
    if (!context) {
      activeTurnRef.current = null;
      pendingAudioCapturesRef.current.clear();
      void talkConversationRef.current?.stop();
      voiceModeCoordinator.invalidate('gateway_unavailable');
      void voiceWake.stop();
      return;
    }
    if (!sameVoiceContext(snapshot.context, context)) {
      activeTurnRef.current = null;
      pendingAudioCapturesRef.current.clear();
      void talkConversationRef.current?.stop();
      voiceModeCoordinator.invalidateContext(context);
      void voiceWake.stop();
    }
  }, [activeSessionKey, connectionId, voiceWake.stop]);

  useEffect(() => {
    if (!voiceWake.error) return;
    const context = currentContextRef.current;
    if (context) voiceModeCoordinator.fail(activeTurnRef.current, context, 'capture_failed');
  }, [voiceWake.error]);

  useEffect(() => () => {
    const turnId = activeTurnRef.current;
    const context = currentContextRef.current;
    activeTurnRef.current = null;
    pendingAudioCapturesRef.current.clear();
    const projectedTalkSession = projectedTalkOutputSessionRef.current;
    if (projectedTalkSession) voiceRuntime.setNativeTalkOutput(projectedTalkSession, false);
    void talkConversationRef.current?.stop();
    void stopVoiceWakeRef.current();
    void voiceModeCoordinator.stopOwnedTurnAndReleaseCapture(turnId, context);
  }, []);

  useEffect(() => voiceModeCoordinator.subscribeCaptureStop(() => voiceWake.stop()), [voiceWake.stop]);

  const startRecording = useCallback(() => {
    void (async () => {
      closeMenu();
      if (voiceWake.enabled || voiceWake.error || voiceMode.mode !== 'off') await stopVoiceMode();
      await stopAssistant();
      setRecording(true);
    })();
  }, [closeMenu, stopAssistant, stopVoiceMode, voiceMode.mode, voiceWake.enabled, voiceWake.error]);

  const toggleDictation = useCallback(() => {
    void (async () => {
      if (voiceWake.enabled || voiceMode.mode !== 'off' || voiceMode.draft !== null) await stopVoiceMode();
      else await startDictation();
    })();
  }, [startDictation, stopVoiceMode, voiceMode.draft, voiceMode.mode, voiceWake.enabled]);

  const status = voiceWake.phase === 'transcribing' || voiceWake.phase === 'wake_detected'
    ? t('input.dictationProcessing')
    : t('input.dictationListening');
  return {
    recording,
    setRecording,
    outputActive,
    voiceWake,
    voiceMode,
    talkConversation,
    status,
    startRecording,
    toggleDictation,
    startDictation: () => { void startDictation(); },
    requestWakeWord,
    stopVoiceMode: () => { void stopVoiceMode(); },
    confirmVoiceDraft: () => { void confirmVoiceDraft(); },
    discardVoiceDraft,
    sendVoice: (base64: string, mimeType: string, durationSec: number, previewUrl: string) => {
      void sendVoice(base64, mimeType, durationSec, previewUrl);
    },
  };
}
