import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
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
  responseActive: boolean;
  voiceOutputActive: boolean;
  textareaRef: RefObject<HTMLTextAreaElement>;
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
  responseActive,
  voiceOutputActive,
  textareaRef,
}: UseComposerInterruptionOptions) {
  const { t } = useTranslation();
  const [stopError, setStopError] = useState<string | null>(null);

  useEffect(() => setStopError(null), [activeSessionKey]);
  useEffect(() => {
    if (!responseActive) setStopError(null);
  }, [responseActive]);

  const stopActiveResponse = useCallback(async () => {
    setStopError(null);
    voiceRuntime.interruptGlobally(activeSessionKey);
    const state = useChatStore.getState();
    if (!selectSessionRequestActive(state, activeSessionKey)) return;
    try {
      await gateway.abortChat(activeSessionKey, activeSessionId);
    } catch (error) {
      debugError('gateway', '[ComposerInterruption] Unable to stop response:', error);
      setStopError(t('input.stopFailed'));
    }
  }, [activeSessionId, activeSessionKey, t]);

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
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [
    activeMenu,
    activeSessionKey,
    closeMenu,
    stopActiveResponse,
    textareaRef,
    voiceOutputActive,
  ]);

  return { stopActiveResponse, stopError };
}
