import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { VoiceWakeOverlay } from '@/components/Chat/message-input/VoiceWakeOverlay';
import { useComposerVoice } from '@/components/Chat/message-input/useComposerVoice';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { debugError } from '@/utils/debugLog';

type JarvisVoiceController = ReturnType<typeof useComposerVoice>;

const JarvisVoiceContext = createContext<JarvisVoiceController | null>(null);

export function useJarvisVoiceRuntime(): JarvisVoiceController {
  const controller = useContext(JarvisVoiceContext);
  if (!controller) throw new Error('Jarvis voice runtime is unavailable before workspace initialization');
  return controller;
}

/**
 * The desktop-level owner for the native microphone, Talk relay and full-window
 * Jarvis surface. Chat controls consume this controller but never own capture.
 */
export function JarvisVoiceRuntime({ children }: { children: ReactNode }) {
  const { language } = useSettingsStore();
  const { t } = useTranslation();
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const activeSessionId = useChatStore(
    (state) => state.sessions.find((session) => session.key === state.activeSessionKey)?.sessionId,
  );
  const connected = useChatStore((state) => state.connected);
  const messageCount = useChatStore((state) => state.messages.length);
  const historyLoading = useChatStore((state) => (
    state.connected && messageCount === 0 && Boolean(state.loadingHistoryBySession[state.activeSessionKey])
  ));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const setText = useCallback((next: string | ((current: string) => string)) => {
    const chat = useChatStore.getState();
    const current = chat.drafts[activeSessionKey] || '';
    chat.setDraft(activeSessionKey, typeof next === 'function' ? next(current) : next);
  }, [activeSessionKey]);
  const reportAttachmentError = useCallback((error: unknown) => {
    debugError('media', '[JarvisVoiceRuntime] Unable to preserve captured audio:', error);
  }, []);
  const controller = useComposerVoice({
    activeSessionKey,
    activeSessionId,
    connected,
    historyLoading,
    language: String(language),
    textareaRef,
    setText,
    setIsSending: useChatStore.getState().setIsSending,
    closeMenu: () => undefined,
    reportAttachmentError,
  });
  const value = useMemo(() => controller, [controller]);

  return (
    <JarvisVoiceContext.Provider value={value}>
      {children}
      <VoiceWakeOverlay
        snapshot={controller.voiceMode}
        talkPhase={controller.talkConversation.phase}
        onStop={controller.stopVoiceMode}
        onConfirmDraft={controller.confirmVoiceDraft}
        onDiscardDraft={controller.discardVoiceDraft}
        onOpenSettings={() => { window.location.hash = '#/settings?tab=jarvis'; }}
        settingsLabel={t('settings.tab.jarvis')}
      />
    </JarvisVoiceContext.Provider>
  );
}
