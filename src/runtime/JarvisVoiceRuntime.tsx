import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import { JarvisVoiceOverlay } from '@/components/Chat/JarvisVoiceOverlay';
import { useComposerVoice } from '@/hooks/chat/useComposerVoice';
import { useNativeVoiceWake, type NativeVoiceWakeState } from '@/hooks/useNativeVoiceWake';
import { useChatStore } from '@/stores/chatStore';
import { debugError } from '@/utils/debugLog';
import { resolveNativeVoiceWakeSessionKey } from '@/services/voice/NativeVoiceWakeRouting';
import type { VoiceWakeRouteTarget } from '@/types/voiceWake';
import {
  hasConfirmedEmptyTranscript,
  shouldWarmUpHistoryBeforeFirstSend,
} from '@/utils/confirmedEmptyTranscript';

type JarvisVoiceController = ReturnType<typeof useComposerVoice>;
type JarvisVoiceRuntimeValue = JarvisVoiceController & {
  voiceWake: NativeVoiceWakeState;
};

const JarvisVoiceContext = createContext<JarvisVoiceRuntimeValue | null>(null);

export function useJarvisVoiceRuntime(): JarvisVoiceRuntimeValue {
  const controller = useContext(JarvisVoiceContext);
  if (!controller) throw new Error('Jarvis voice runtime is unavailable before workspace initialization');
  return controller;
}

/** 桌面级语音所有者统一管理麦克风、Talk 中继和全窗口界面。 */
export function JarvisVoiceRuntime({ children }: { children: ReactNode }) {
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const activeSession = useChatStore(
    (state) => state.sessions.find((session) => session.key === state.activeSessionKey),
  );
  const connected = useChatStore((state) => state.connected);
  const messageCount = useChatStore((state) => state.messages.length);
  const historyLoading = useChatStore((state) => (
    state.connected
      && Boolean(state.loadingHistoryBySession[state.activeSessionKey])
      && shouldWarmUpHistoryBeforeFirstSend({
        messageCount,
        confirmedEmptyTranscript: hasConfirmedEmptyTranscript(
          state.sessions.find((session) => session.key === state.activeSessionKey),
        ),
      })
  ));
  const reportAttachmentError = useCallback((error: unknown) => {
    debugError('media', '[JarvisVoiceRuntime] Unable to preserve captured audio:', error);
  }, []);
  const controller = useComposerVoice({
    activeSessionKey,
    activeSessionId: activeSession?.sessionId,
    connected,
    historyLoading,
    setIsSending: useChatStore.getState().setIsSending,
    reportAttachmentError,
  });
  const pendingWakeSessionRef = useRef<string | null>(null);
  const activateWakeTarget = useCallback((
    _trigger: string,
    target: VoiceWakeRouteTarget,
    resolvedAgentSessionKey: string | null,
  ) => {
    const state = useChatStore.getState();
    const sessionKey = resolveNativeVoiceWakeSessionKey(target, {
      activeSessionKey: state.activeSessionKey,
      sessions: state.sessions,
    }, resolvedAgentSessionKey);
    if (!sessionKey) throw new Error('Gateway 语音唤醒路由目标在当前会话投影中不可用');
    if (sessionKey === state.activeSessionKey) {
      controller.startTalk();
      return;
    }
    pendingWakeSessionRef.current = sessionKey;
    state.setActiveSession(sessionKey);
  }, [controller]);
  const voiceWake = useNativeVoiceWake({
    connected,
    voiceBusy: controller.recording
      || controller.voiceMode.mode !== 'off'
      || controller.talkConversation.phase !== 'idle',
    onDetected: activateWakeTarget,
  });
  useEffect(() => {
    if (pendingWakeSessionRef.current !== activeSessionKey) return;
    pendingWakeSessionRef.current = null;
    controller.startTalk();
  }, [activeSessionKey, controller]);
  const value = useMemo(() => ({ ...controller, voiceWake }), [controller, voiceWake]);

  return (
    <JarvisVoiceContext.Provider value={value}>
      {children}
      <JarvisVoiceOverlay
        snapshot={controller.voiceMode}
        talk={controller.talkConversation}
        inputLevel={controller.voiceCapture.inputLevel}
        sessionLabel={activeSession?.label || activeSessionKey}
        onStop={controller.stopVoiceMode}
        onRetry={controller.startTalk}
      />
    </JarvisVoiceContext.Provider>
  );
}
