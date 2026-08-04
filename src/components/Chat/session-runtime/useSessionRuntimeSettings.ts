import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gateway } from '@/services/gateway';
import { resolveGatewaySessionModelId } from '@/services/gateway/modelIdentity';
import {
  SessionSettingsResponseError,
  type SessionPatchResult,
} from '@/services/gateway/SessionSettingsClient';
import { useChatStore } from '@/stores/chatStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { debugError } from '@/utils/debugLog';
import {
  fastModeForGateway,
  normalizeFastMode,
  normalizeThinkingLevel,
  thinkingLevelForGateway,
  type SessionFastMode,
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
  fastMode: SessionFastMode;
}

function commitSessionModel(
  sessionKey: string,
  effectiveModel: string | null,
  manualOverride: string | null,
  previousModel: string | null,
): void {
  const state = useChatStore.getState();
  state.setSessionModel(sessionKey, effectiveModel);
  if (state.activeSessionKey === sessionKey) {
    state.setManualModelOverride(manualOverride);
  }
  if (previousModel && effectiveModel && previousModel !== effectiveModel) {
    state.addMessage({
      id: `model-switch-${Date.now()}`,
      role: 'system',
      kind: 'model-switch',
      content: JSON.stringify({ from: previousModel, to: effectiveModel }),
      timestamp: new Date().toISOString(),
    }, sessionKey);
  }
}

function resolvedPatchModel(result: SessionPatchResult): string {
  const model = resolveGatewaySessionModelId(
    result.resolved.modelProvider,
    result.resolved.model,
  );
  if (!model) throw new SessionSettingsResponseError('missing-resolved-model');
  return model;
}

function resolvedPatchFastMode(result: SessionPatchResult): boolean | 'auto' | null {
  const value = result.entry.fastMode;
  if (value === undefined || value === null || value === true || value === false || value === 'auto') {
    return value ?? null;
  }
  throw new SessionSettingsResponseError('invalid-payload');
}

export function useSessionRuntimeSettings() {
  const { t } = useTranslation();
  const addToast = useNotificationStore((state) => state.addToast);
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const currentModel = useChatStore((state) => state.currentModel);
  const currentThinking = useChatStore((state) => state.currentThinking);
  const manualModelOverride = useChatStore((state) => state.manualModelOverride);
  const currentFastMode = useChatStore((state) => (
    state.sessions.find((session) => session.key === state.activeSessionKey)?.fastMode ?? null
  ));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const committed: SessionRuntimeSnapshot = {
    modelId: manualModelOverride ?? currentModel,
    thinking: normalizeThinkingLevel(currentThinking),
    fastMode: normalizeFastMode(currentFastMode),
  };

  const runUpdate = useCallback(async (operation: () => Promise<void>): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      await operation();
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
      savingRef.current = false;
      setSaving(false);
    }
  }, [addToast, t]);

  const apply = useCallback(async (draft: SessionRuntimeSnapshot): Promise<boolean> => {
    return runUpdate(async () => {
      const stateBefore = useChatStore.getState();
      const sessionKey = stateBefore.activeSessionKey || 'agent:main:main';
      const previousModel = stateBefore.manualModelOverride ?? stateBefore.currentModel;
      const previousThinking = normalizeThinkingLevel(stateBefore.currentThinking);
      const previousFastMode = normalizeFastMode(
        stateBefore.sessions.find((session) => session.key === sessionKey)?.fastMode ?? null,
      );
      if (draft.modelId && draft.modelId !== previousModel) {
        const result = await gateway.setSessionModel(draft.modelId, sessionKey);
        const effectiveModel = resolvedPatchModel(result);
        commitSessionModel(sessionKey, effectiveModel, effectiveModel, previousModel);
      }

      if (draft.thinking !== previousThinking) {
        const nextThinking = thinkingLevelForGateway(draft.thinking);
        await gateway.setSessionThinking(nextThinking, sessionKey);
        useChatStore.getState().setSessionThinking(sessionKey, nextThinking);
      }

      if (draft.fastMode !== previousFastMode) {
        const result = await gateway.setSessionFastMode(fastModeForGateway(draft.fastMode), sessionKey);
        useChatStore.getState().setSessionFastMode(sessionKey, resolvedPatchFastMode(result));
      }
    });
  }, [runUpdate]);

  const restoreDefaultModel = useCallback(async (): Promise<boolean> => {
    return runUpdate(async () => {
      const state = useChatStore.getState();
      const sessionKey = state.activeSessionKey || 'agent:main:main';
      const previousModel = state.manualModelOverride ?? state.currentModel;
      const result = await gateway.setSessionModel(null, sessionKey);
      const effectiveModel = resolvedPatchModel(result);
      commitSessionModel(sessionKey, effectiveModel, null, previousModel);
    });
  }, [runUpdate]);

  return { activeSessionKey, committed, saving, apply, restoreDefaultModel };
}
