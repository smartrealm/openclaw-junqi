import { useCallback, type SetStateAction } from 'react';
import { getDirection } from '@/i18n';
import { selectActiveSessionTyping, useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ComposerAttachmentOverlays } from './message-input/ComposerAttachmentOverlays';
import { ComposerAttachmentTray } from './message-input/ComposerAttachmentTray';
import { ComposerInputSurface } from './message-input/ComposerInputSurface';
import { ComposerVoiceRecorder } from './message-input/ComposerVoiceRecorder';
import { MessageQueuePanel } from './message-input/MessageQueuePanel';
import { VoiceStatusBanner } from './message-input/VoiceStatusBanner';
import { VoiceWorkspace } from './message-input/VoiceWorkspace';
import { useComposerAttachments } from './message-input/useComposerAttachments';
import { useComposerInterruption } from './message-input/useComposerInterruption';
import { useComposerMenu } from './message-input/useComposerMenu';
import { useComposerSuggestions } from './message-input/useComposerSuggestions';
import { useComposerVoice } from './message-input/useComposerVoice';
import { useMessageSend } from './message-input/useMessageSend';

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
  const pendingCount = useChatStore((state) => state.messageQueue[activeSessionKey]?.length ?? 0);
  const activeSessionId = useChatStore(
    (state) => state.sessions.find((session) => session.key === activeSessionKey)?.sessionId,
  );
  const text = useChatStore((state) => state.drafts[activeSessionKey] || '');
  const historyLoading = connected && messages.length === 0 && isLoadingHistory;
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
  const voice = useComposerVoice({
    activeSessionKey,
    activeSessionId,
    connected,
    historyLoading,
    language: String(language),
    textareaRef: suggestions.textareaRef,
    setText,
    setIsSending,
    closeMenu: menu.close,
    reportAttachmentError: attachments.reportError,
  });
  const send = useMessageSend({
    activeSessionKey,
    activeSessionId,
    connected,
    historyLoading,
    historyLoader: historyLoader ?? undefined,
    isSending,
    messageCount: messages.length,
    files: attachments.files,
    text,
    textareaRef: suggestions.textareaRef,
    setIsSending,
  });
  const stop = useComposerInterruption({
    activeSessionKey,
    activeMenu: menu.active,
    closeMenu: menu.close,
    voiceOutputActive: voice.outputActive,
    textareaRef: suggestions.textareaRef,
    setText,
  });

  return (
    <div className="shrink-0 min-w-0 border-t border-[rgb(var(--aegis-overlay)/0.04)] bg-[var(--aegis-bg-frosted-60)] backdrop-blur-xl">
      <ComposerAttachmentTray
        files={attachments.files}
        onPreview={attachments.setLightbox}
        onRemove={attachments.removeFile}
      />
      <MessageQueuePanel sessionKey={activeSessionKey} dir={dir} />
      {!voice.recording && (
        <VoiceWorkspace
          snapshot={voice.voiceMode}
          connected={connected && !historyLoading}
          onStartDictation={voice.startDictation}
          onRequestWakeWord={voice.requestWakeWord}
          onStop={voice.stopVoiceMode}
          onConfirmDraft={voice.confirmVoiceDraft}
          onDiscardDraft={voice.discardVoiceDraft}
        />
      )}
      {!voice.recording && voice.voiceMode.mode === 'off' && voice.voiceMode.phase === 'off' && voice.voiceMode.draft === null && (
        <VoiceStatusBanner
          enabled={voice.voiceWake.enabled}
          error={voice.voiceWake.error}
          status={voice.status}
          onStop={voice.toggleDictation}
          onRetry={voice.toggleDictation}
          onDismissError={() => { void voice.voiceWake.stop(); }}
        />
      )}

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
          pendingCount={pendingCount}
          isTyping={isTyping}
          isSending={isSending}
          voiceOutputActive={voice.outputActive}
          attachments={attachments}
          suggestions={suggestions}
          menu={menu}
          dictationEnabled={voice.voiceWake.enabled || voice.voiceMode.mode !== 'off' || voice.voiceMode.draft !== null}
          onStartRecording={voice.startRecording}
          onToggleDictation={voice.toggleDictation}
          onRequestWakeWord={voice.requestWakeWord}
          onSend={send}
          onStop={stop}
        />
      )}

      <ComposerAttachmentOverlays controller={attachments} />
    </div>
  );
}
