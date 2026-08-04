import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { JarvisVoiceOverlay } from '@/components/Chat/JarvisVoiceOverlay';
import { useComposerVoice } from '@/components/Chat/message-input/useComposerVoice';
import { useChatStore } from '@/stores/chatStore';
import { debugError } from '@/utils/debugLog';

type JarvisVoiceController = ReturnType<typeof useComposerVoice>;

const JarvisVoiceContext = createContext<JarvisVoiceController | null>(null);

export function useJarvisVoiceRuntime(): JarvisVoiceController {
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
    state.connected && messageCount === 0 && Boolean(state.loadingHistoryBySession[state.activeSessionKey])
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
  const value = useMemo(() => controller, [controller]);

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
