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
 * 桌面级语音所有者统一管理原生麦克风、Talk 中继和全窗口 Jarvis 表面；聊天控件仅消费控制器，不能接管采集。
 */
export function JarvisVoiceRuntime({ children }: { children: ReactNode }) {
  const { language } = useSettingsStore();
  const { t } = useTranslation();
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const activeSessionId = useChatStore(
    (state) => state.sessions.find((session) => session.key === state.activeSessionKey)?.sessionId,
  );
  const activeSessionAgentId = useChatStore(
    (state) => state.sessions.find((session) => session.key === state.activeSessionKey)?.agentId,
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
    activeSessionAgentId,
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
        talkError={controller.talkConversation.error}
        onStop={controller.stopVoiceMode}
        onConfirmDraft={controller.confirmVoiceDraft}
        onDiscardDraft={controller.discardVoiceDraft}
        onOpenSettings={() => { window.location.hash = '#/settings?tab=jarvis'; }}
        settingsLabel={t('settings.tab.jarvis')}
      />
    </JarvisVoiceContext.Provider>
  );
}
