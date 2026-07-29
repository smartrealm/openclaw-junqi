import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { debugError } from '@/utils/debugLog';
import { setSessionModelPref } from '@/utils/sessionModelPrefs';
import {
  normalizeThinkingLevel,
  thinkingLevelForGateway,
  type SessionThinkingLevel,
} from './sessionRuntimeDomain';

function settingErrorMessage(error: unknown, fallback: string, invalidResponse: string): string {
  if (
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'SESSION_SETTINGS_RESPONSE_INVALID'
  ) {
    return invalidResponse;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface SessionRuntimeSnapshot {
  modelId: string | null;
  thinking: SessionThinkingLevel;
}

export function useSessionRuntimeSettings() {
  const { t } = useTranslation();
  const addToast = useNotificationStore((state) => state.addToast);
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const currentModel = useChatStore((state) => state.currentModel);
  const currentThinking = useChatStore((state) => state.currentThinking);
  const manualModelOverride = useChatStore((state) => state.manualModelOverride);
  const [saving, setSaving] = useState(false);

  const committed: SessionRuntimeSnapshot = {
    modelId: manualModelOverride ?? currentModel,
    thinking: normalizeThinkingLevel(currentThinking),
  };

  const apply = useCallback(async (draft: SessionRuntimeSnapshot): Promise<boolean> => {
    if (saving) return false;
    const stateBefore = useChatStore.getState();
    const sessionKey = stateBefore.activeSessionKey || 'agent:main:main';
    const previousModel = stateBefore.manualModelOverride ?? stateBefore.currentModel;
    const previousThinking = normalizeThinkingLevel(stateBefore.currentThinking);
    setSaving(true);

    try {
      if (draft.modelId && draft.modelId !== previousModel) {
        await gateway.setSessionModel(draft.modelId, sessionKey);
        const state = useChatStore.getState();
        state.setSessionModel(sessionKey, draft.modelId);
        if (useChatStore.getState().activeSessionKey === sessionKey) {
          useChatStore.getState().setManualModelOverride(draft.modelId);
        }
        setSessionModelPref(sessionKey, draft.modelId);
        if (previousModel) {
          state.addMessage({
            id: `model-switch-${Date.now()}`,
            role: 'system',
            kind: 'model-switch',
            content: JSON.stringify({ from: previousModel, to: draft.modelId }),
            timestamp: new Date().toISOString(),
          }, sessionKey);
        }
        window.dispatchEvent(new Event('aegis:model-changed'));
      }

      if (draft.thinking !== previousThinking) {
        const nextThinking = thinkingLevelForGateway(draft.thinking);
        await gateway.setSessionThinking(nextThinking, sessionKey);
        useChatStore.getState().setSessionThinking(sessionKey, nextThinking);
      }
      return true;
    } catch (error) {
      debugError('models', '[SessionRuntimeControl] Unable to update session settings:', error);
      addToast(
        'error',
        t('chat.sessionSettingsUpdateFailed'),
        settingErrorMessage(
          error,
          t('errors.occurred'),
          t('chat.sessionSettingsResponseInvalid'),
        ),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [addToast, saving, t]);

  return { activeSessionKey, committed, saving, apply };
}
