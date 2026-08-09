import { useCallback, useEffect, type RefObject, type SetStateAction } from 'react';
import { gateway } from '@/services/gateway';
import { voiceRuntime } from '@/runtime/VoiceRuntime';
import { selectSessionRequestActive, useChatStore } from '@/stores/chatStore';
import { debugError } from '@/utils/debugLog';
import type { ComposerMenuId } from '@/components/Chat/message-input/useComposerMenu';

interface UseComposerInterruptionOptions {
  activeSessionKey: string;
  activeSessionId?: string;
  activeMenu: ComposerMenuId;
  closeMenu: () => void;
  voiceOutputActive: boolean;
  textareaRef: RefObject<HTMLTextAreaElement>;
  setText: (next: SetStateAction<string>) => void;
}

export function shouldStopComposerResponse(
  state: Pick<ReturnType<typeof useChatStore.getState>, 'typingBySession' | 'sendingBySession'>,
  sessionKey: string,
  voiceOutputActive: boolean,
): boolean {
  return selectSessionRequestActive(state, sessionKey) || voiceOutputActive;
}

export function useComposerInterruption({
  activeSessionKey,
  activeSessionId,
  activeMenu,
  closeMenu,
  voiceOutputActive,
  textareaRef,
  setText,
}: UseComposerInterruptionOptions) {
  const stopActiveResponse = useCallback(async () => {
    voiceRuntime.interruptGlobally(activeSessionKey);
    const state = useChatStore.getState();
    if (!selectSessionRequestActive(state, activeSessionKey)) return;
    await gateway.abortChat(activeSessionKey, activeSessionId)
      .catch((error) => debugError('gateway', '[ComposerInterruption] Unable to stop response:', error));
  }, [activeSessionId, activeSessionKey]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (activeMenu) {
        event.preventDefault();
        closeMenu();
        textareaRef.current?.focus();
        return;
      }

      const state = useChatStore.getState();
      if (shouldStopComposerResponse(state, activeSessionKey, voiceOutputActive)) {
        event.preventDefault();
        void stopActiveResponse();
        return;
      }
      if (document.activeElement !== textareaRef.current) return;

      const messages = state.messagesPerSession[activeSessionKey] ?? [];
      const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
      if (!lastUserMessage) return;
      event.preventDefault();
      setText(lastUserMessage.content);
      textareaRef.current?.focus();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [
    activeMenu,
    activeSessionKey,
    closeMenu,
    setText,
    stopActiveResponse,
    textareaRef,
    voiceOutputActive,
  ]);

  return stopActiveResponse;
}
