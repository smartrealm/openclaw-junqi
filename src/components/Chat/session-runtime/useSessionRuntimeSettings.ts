import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gateway } from '@/services/gateway';
import { resolveGatewaySessionModelId } from '@/services/gateway/modelIdentity';
import {
  parseGatewaySessionAgentRuntime,
  type GatewaySessionAgentRuntime,
} from '@/services/gateway/sessionAgentRuntime';
import type { GatewayThinkingLevelOption } from '@/services/gateway/sessionThinkingProfile';
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
  normalizeReasoningLevel,
  normalizeResponseUsage,
  normalizeTraceLevel,
  normalizeThinkingLevel,
  normalizeVerboseLevel,
  canWriteThinkingLevel,
  reasoningLevelForGateway,
  responseUsageForGateway,
  traceLevelForGateway,
  verboseLevelForGateway,
  type SessionFastMode,
  type SessionReasoningLevel,
  type SessionResponseUsageLevel,
  type SessionTraceLevel,
  type SessionVerboseLevel,
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
  thinking: string | null;
  thinkingLevels: readonly GatewayThinkingLevelOption[] | null;
  thinkingDefault: string | null;
  fastMode: SessionFastMode;
  verbose: SessionVerboseLevel;
  trace: SessionTraceLevel;
  responseUsage: SessionResponseUsageLevel;
  reasoning: SessionReasoningLevel;
}

type SessionRuntimeDraft = Omit<SessionRuntimeSnapshot, 'thinkingLevels' | 'thinkingDefault'>;

function commitSessionModel(
  sessionKey: string,
  effectiveModel: string | null,
  manualOverride: string | null,
  previousModel: string | null,
  agentRuntime: GatewaySessionAgentRuntime | null,
): void {
  const state = useChatStore.getState();
  state.setSessionModel(sessionKey, effectiveModel);
  if (agentRuntime) state.setSessionAgentRuntime(sessionKey, agentRuntime);
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

export function resolveSessionAgentRuntimePatch(
  result: SessionPatchResult,
): GatewaySessionAgentRuntime | null {
  return parseGatewaySessionAgentRuntime(result.resolved.agentRuntime);
}

function resolvedPatchFastMode(result: SessionPatchResult): boolean | 'auto' | null {
  const value = result.entry.fastMode;
  if (value === undefined || value === null || value === true || value === false || value === 'auto') {
    return value ?? null;
  }
  throw new SessionSettingsResponseError('invalid-payload');
}

export function resolveSessionThinkingPatch(result: SessionPatchResult): string | null {
  const value = result.entry.thinkingLevel;
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new SessionSettingsResponseError('invalid-payload');
}

function resolvedPatchVerboseLevel(result: SessionPatchResult): 'on' | 'full' | 'off' | null {
  const value = result.entry.verboseLevel;
  if (value === undefined || value === null || value === 'on' || value === 'full' || value === 'off') {
    return value ?? null;
  }
  throw new SessionSettingsResponseError('invalid-payload');
}

function resolvedPatchTraceLevel(result: SessionPatchResult): string | null {
  const value = result.entry.traceLevel;
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim()) return value;
  throw new SessionSettingsResponseError('invalid-payload');
}

function resolvedPatchResponseUsage(result: SessionPatchResult): string | null {
  const value = result.entry.responseUsage;
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim()) return value;
  throw new SessionSettingsResponseError('invalid-payload');
}

function resolvedPatchReasoningLevel(result: SessionPatchResult): 'on' | 'off' | 'stream' | null {
  const value = result.entry.reasoningLevel;
  if (value === undefined || value === null || value === 'on' || value === 'off' || value === 'stream') {
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
  const currentThinkingLevels = useChatStore((state) => (
    state.sessions.find((entry) => entry.key === state.activeSessionKey)?.thinkingLevels ?? null
  ));
  const currentThinkingDefault = useChatStore((state) => (
    state.sessions.find((entry) => entry.key === state.activeSessionKey)?.thinkingDefault ?? null
  ));
  const manualModelOverride = useChatStore((state) => state.manualModelOverride);
  const currentFastMode = useChatStore((state) => (
    state.sessions.find((session) => session.key === state.activeSessionKey)?.fastMode ?? null
  ));
  const currentVerbose = useChatStore((state) => (
    state.sessions.find((session) => session.key === state.activeSessionKey)?.verboseLevel ?? null
  ));
  const currentTrace = useChatStore((state) => (
    state.sessions.find((session) => session.key === state.activeSessionKey)?.traceLevel ?? null
  ));
  const currentResponseUsage = useChatStore((state) => (
    state.sessions.find((session) => session.key === state.activeSessionKey)?.responseUsage ?? null
  ));
  const currentReasoning = useChatStore((state) => (
    state.sessions.find((session) => session.key === state.activeSessionKey)?.reasoningLevel ?? null
  ));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const committed: SessionRuntimeSnapshot = {
    modelId: manualModelOverride ?? currentModel,
    thinking: normalizeThinkingLevel(currentThinking),
    thinkingLevels: currentThinkingLevels,
    thinkingDefault: normalizeThinkingLevel(currentThinkingDefault),
    fastMode: normalizeFastMode(currentFastMode),
    verbose: normalizeVerboseLevel(currentVerbose),
    trace: normalizeTraceLevel(currentTrace),
    responseUsage: normalizeResponseUsage(currentResponseUsage),
    reasoning: normalizeReasoningLevel(currentReasoning),
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

  const apply = useCallback(async (draft: SessionRuntimeDraft): Promise<boolean> => {
    return runUpdate(async () => {
      const stateBefore = useChatStore.getState();
      const sessionKey = stateBefore.activeSessionKey || 'agent:main:main';
      const previousModel = stateBefore.manualModelOverride ?? stateBefore.currentModel;
      const previousThinking = normalizeThinkingLevel(stateBefore.currentThinking);
      const previousFastMode = normalizeFastMode(
        stateBefore.sessions.find((session) => session.key === sessionKey)?.fastMode ?? null,
      );
      const previousVerbose = normalizeVerboseLevel(
        stateBefore.sessions.find((session) => session.key === sessionKey)?.verboseLevel ?? null,
      );
      const previousTrace = normalizeTraceLevel(
        stateBefore.sessions.find((session) => session.key === sessionKey)?.traceLevel ?? null,
      );
      const previousResponseUsage = normalizeResponseUsage(
        stateBefore.sessions.find((session) => session.key === sessionKey)?.responseUsage ?? null,
      );
      const previousReasoning = normalizeReasoningLevel(
        stateBefore.sessions.find((session) => session.key === sessionKey)?.reasoningLevel ?? null,
      );
      const modelWillChange = Boolean(draft.modelId && draft.modelId !== previousModel);
      const thinkingWillChange = draft.thinking !== previousThinking;
      const currentThinkingLevels = stateBefore.sessions.find(
        (session) => session.key === sessionKey,
      )?.thinkingLevels;
      // 新模型的 profile 只能由随后的权威会话刷新确认，不能拿旧模型的能力集写入。
      if (
        thinkingWillChange
        && (modelWillChange || !canWriteThinkingLevel(currentThinkingLevels, draft.thinking))
      ) {
        throw new SessionSettingsResponseError('invalid-payload');
      }

      if (modelWillChange) {
        const result = await gateway.setSessionModel(draft.modelId, sessionKey);
        const effectiveModel = resolvedPatchModel(result);
        commitSessionModel(
          sessionKey,
          effectiveModel,
          effectiveModel,
          previousModel,
          resolveSessionAgentRuntimePatch(result),
        );
      }

      if (thinkingWillChange) {
        const result = await gateway.setSessionThinking(draft.thinking, sessionKey);
        useChatStore.getState().setSessionThinking(sessionKey, resolveSessionThinkingPatch(result));
      }

      if (draft.fastMode !== previousFastMode) {
        const result = await gateway.setSessionFastMode(fastModeForGateway(draft.fastMode), sessionKey);
        useChatStore.getState().setSessionFastMode(sessionKey, resolvedPatchFastMode(result));
      }

      if (draft.verbose !== previousVerbose) {
        const result = await gateway.setSessionVerbose(verboseLevelForGateway(draft.verbose), sessionKey);
        useChatStore.getState().setSessionVerbose(sessionKey, resolvedPatchVerboseLevel(result));
      }

      if (draft.trace !== previousTrace) {
        if (draft.trace === 'unsupported') throw new SessionSettingsResponseError('invalid-payload');
        const result = await gateway.setSessionTrace(
          traceLevelForGateway(draft.trace),
          sessionKey,
        );
        useChatStore.getState().setSessionTrace(sessionKey, resolvedPatchTraceLevel(result));
      }

      if (draft.responseUsage !== previousResponseUsage) {
        if (draft.responseUsage === 'unsupported') throw new SessionSettingsResponseError('invalid-payload');
        const result = await gateway.setSessionResponseUsage(
          responseUsageForGateway(draft.responseUsage),
          sessionKey,
        );
        useChatStore.getState().setSessionResponseUsage(sessionKey, resolvedPatchResponseUsage(result));
      }

      if (draft.reasoning !== previousReasoning) {
        const result = await gateway.setSessionReasoning(reasoningLevelForGateway(draft.reasoning), sessionKey);
        useChatStore.getState().setSessionReasoning(sessionKey, resolvedPatchReasoningLevel(result));
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
      commitSessionModel(
        sessionKey,
        effectiveModel,
        null,
        previousModel,
        resolveSessionAgentRuntimePatch(result),
      );
    });
  }, [runUpdate]);

  return { activeSessionKey, committed, saving, apply, restoreDefaultModel };
}
