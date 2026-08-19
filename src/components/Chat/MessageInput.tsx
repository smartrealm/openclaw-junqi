import { useCallback, type SetStateAction } from 'react';
import { getDirection } from '@/i18n';
import { selectActiveSessionTyping, useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ComposerAttachmentOverlays } from './message-input/ComposerAttachmentOverlays';
import { ComposerAttachmentTray } from './message-input/ComposerAttachmentTray';
import { ComposerInputSurface } from './message-input/ComposerInputSurface';
import { ComposerVoiceRecorder } from './message-input/ComposerVoiceRecorder';
import { useComposerAttachments } from '@/hooks/chat/useComposerAttachments';
import { useComposerInterruption } from '@/hooks/chat/useComposerInterruption';
import { useComposerMenu } from './message-input/useComposerMenu';
import { useComposerSuggestions } from '@/hooks/chat/useComposerSuggestions';
import { useJarvisVoiceRuntime } from '@/runtime/JarvisVoiceRuntime';
import { useMessageSend } from '@/hooks/chat/useMessageSend';
import {
  hasConfirmedEmptyTranscript,
  shouldWarmUpHistoryBeforeFirstSend,
} from '@/utils/confirmedEmptyTranscript';

export function MessageInput() {
  const { language } = useSettingsStore();
  const dir = getDirection(language);
  const {
    setIsSending,
    connected,
    activeSessionKey,
    messages,
    historyLoader,
  } = useChatStore();
  const isTyping = useChatStore(selectActiveSessionTyping);
  const isSending = useChatStore((state) => Boolean(state.sendingBySession[activeSessionKey]));
  const isLoadingHistory = useChatStore((state) => Boolean(state.loadingHistoryBySession[activeSessionKey]));
  const activeSession = useChatStore(
    (state) => state.sessions.find((session) => session.key === activeSessionKey),
  );
  const activeSessionId = activeSession?.sessionId;
  const activeSessionHasConfirmedEmptyTranscript = hasConfirmedEmptyTranscript(activeSession);
  const text = useChatStore((state) => state.drafts[activeSessionKey] || '');
  const historyLoading = connected && isLoadingHistory && shouldWarmUpHistoryBeforeFirstSend({
    messageCount: messages.length,
    confirmedEmptyTranscript: activeSessionHasConfirmedEmptyTranscript,
  });
  const setText = useCallback((next: SetStateAction<string>) => {
    const state = useChatStore.getState();
    const current = state.drafts[activeSessionKey] || '';
    state.setDraft(activeSessionKey, typeof next === 'function' ? next(current) : next);
  }, [activeSessionKey]);

  const suggestions = useComposerSuggestions({
    activeSessionKey,
    connected,
    messages,
    text,
    setText,
  });
  const attachments = useComposerAttachments(activeSessionKey, suggestions.textareaRef);
  const menu = useComposerMenu(activeSessionKey);
  const voice = useJarvisVoiceRuntime();
  const send = useMessageSend({
    activeSessionKey,
    activeSessionId,
    connected,
    historyLoading,
    isConfirmedEmptyTranscript: () => {
      const current = useChatStore.getState().sessions.find((session) => session.key === activeSessionKey);
      return current?.sessionId === activeSessionId
        && current?.agentId === activeSession?.agentId
        && hasConfirmedEmptyTranscript(current);
    },
    historyLoader: historyLoader ?? undefined,
    isSending,
    messageCount: messages.length,
    files: attachments.files,
    text,
    textareaRef: suggestions.textareaRef,
    setIsSending,
  });
  const steer = useMessageSend({
    activeSessionKey,
    activeSessionId,
    connected,
    historyLoading,
    isConfirmedEmptyTranscript: () => {
      const current = useChatStore.getState().sessions.find((session) => session.key === activeSessionKey);
      return current?.sessionId === activeSessionId
        && current?.agentId === activeSession?.agentId
        && hasConfirmedEmptyTranscript(current);
    },
    historyLoader: historyLoader ?? undefined,
    isSending,
    messageCount: messages.length,
    files: attachments.files,
    text,
    textareaRef: suggestions.textareaRef,
    setIsSending,
    deliveryMode: 'steer',
  });
  const stop = useComposerInterruption({
    activeSessionKey,
    activeSessionId,
    activeMenu: menu.active,
    closeMenu: menu.close,
    voiceOutputActive: voice.outputActive,
    textareaRef: suggestions.textareaRef,
    setText,
  });

  return (
    <div className="shrink-0 min-w-0 border-t border-[rgb(var(--aegis-overlay)/0.04)] bg-[var(--aegis-bg-frosted-60)] backdrop-blur-sm">
      <ComposerAttachmentTray
        files={attachments.files}
        onPreview={attachments.setLightbox}
        onRemove={attachments.removeFile}
      />
      {voice.recording ? (
        <ComposerVoiceRecorder
          dir={dir}
          disabled={!connected || historyLoading}
          onSend={voice.sendVoice}
          onCancel={() => voice.setRecording(false)}
        />
      ) : (
        <ComposerInputSurface
          activeSessionKey={activeSessionKey}
          dir={dir}
          connected={connected}
          historyLoading={historyLoading}
          text={text}
          isTyping={isTyping}
          isSending={isSending}
          voiceOutputActive={voice.outputActive}
          attachments={attachments}
          suggestions={suggestions}
          menu={menu}
          talkActive={voice.voiceMode.mode === 'talk'}
          onStartRecording={voice.startRecording}
          onToggleTalk={voice.toggleTalk}
          onSend={send}
          onSteer={steer}
          onStop={stop}
        />
      )}

      <ComposerAttachmentOverlays controller={attachments} />
    </div>
  );
}
