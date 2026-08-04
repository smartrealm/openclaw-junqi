import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  appAutostartStatus,
  disableAppAutostart,
  enableAppAutostart,
  getVoiceWakeDetectorStatus,
  setVoiceWakeModelDirectory,
  type VoiceWakeDetectorStatus,
} from '@/api/tauri-commands';
import { voiceWakeGatewayClient } from '@/services/gateway';
import { getCurrentRuntimeIdentity, subscribeRuntimeIdentity } from '@/services/gateway/runtimeIdentity';
import {
  mergeGatewayTriggersForModelSelection,
  resolveModelWakeKeywordSelection,
  selectedModelWakeKeywords,
} from '@/services/voice/VoiceWakeKeywordSelection';
import {
  autoArmBinding,
  disableVoiceWakeStandby,
  enableVoiceWakeStandby,
} from '@/services/voice/VoiceWakePreference';
import { subscribeVoiceWakeSettingsTriggerProjection } from '@/services/voice/VoiceWakeSettingsProjection';
import { useChatStore } from '@/stores/chatStore';

export interface JarvisVoiceSettingsState {
  detector: VoiceWakeDetectorStatus | null;
  gatewayTriggers: string[];
  selectedKeywords: string[];
  loading: boolean;
  configuring: boolean;
  saving: boolean;
  standbyEnabled: boolean;
  standbyReady: boolean;
  standbySessionKey: string | null;
  error: string | null;
  configureModel: (title: string) => Promise<void>;
  saveKeywords: (
    requestedKeywords: readonly string[],
    invalidSelection: string,
    triggerCapacityExceeded: string,
  ) => Promise<boolean>;
  refresh: () => Promise<void>;
  toggleStandby: () => Promise<void>;
}

/** 读取全局 Jarvis 配置，不持有会话或麦克风。 */
export function useJarvisVoiceSettings(enabled: boolean): JarvisVoiceSettingsState {
  const [detector, setDetector] = useState<VoiceWakeDetectorStatus | null>(null);
  const [gatewayTriggers, setGatewayTriggers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [standbyEnabled, setStandbyEnabled] = useState(false);
  const [standbyReady, setStandbyReady] = useState(false);
  const [standbySessionKey, setStandbySessionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triggerRevisionRef = useRef(0);
  const runtimeIdentity = useSyncExternalStore(
    subscribeRuntimeIdentity,
    getCurrentRuntimeIdentity,
    getCurrentRuntimeIdentity,
  );

  const replaceGatewayTriggers = useCallback((triggers: readonly string[]) => {
    triggerRevisionRef.current += 1;
    setGatewayTriggers([...triggers]);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const triggerRevision = triggerRevisionRef.current;
    try {
      const [nextDetector, triggers, autostartEnabled] = await Promise.all([
        getVoiceWakeDetectorStatus(),
        voiceWakeGatewayClient.getTriggers(),
        appAutostartStatus(),
      ]);
      setDetector(nextDetector);
      if (triggerRevisionRef.current === triggerRevision) {
        replaceGatewayTriggers(triggers.triggers);
      }
      const binding = autoArmBinding();
      const identity = getCurrentRuntimeIdentity();
      const bindingCurrent = Boolean(
        binding
        && identity?.verified
        && binding.targetFingerprint === identity.targetFingerprint,
      );
      setStandbySessionKey(binding?.sessionKey ?? null);
      setStandbyEnabled(autostartEnabled.enabled);
      setStandbyReady(autostartEnabled.enabled && bindingCurrent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [replaceGatewayTriggers]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh, runtimeIdentity]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeVoiceWakeSettingsTriggerProjection(
      (listener) => voiceWakeGatewayClient.subscribe(listener),
      replaceGatewayTriggers,
    );
  }, [enabled, replaceGatewayTriggers]);

  const configureModel = useCallback(async (title: string) => {
    if (configuring) return;
    const directory = await open({ directory: true, multiple: false, title });
    if (typeof directory !== 'string') return;
    setConfiguring(true);
    setError(null);
    try {
      setDetector(await setVoiceWakeModelDirectory(directory));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConfiguring(false);
    }
  }, [configuring]);

  const saveKeywords = useCallback(async (
    requestedKeywords: readonly string[],
    invalidSelection: string,
    triggerCapacityExceeded: string,
  ): Promise<boolean> => {
    if (saving || !detector?.available) return false;
    const selectedModelKeywords = resolveModelWakeKeywordSelection(detector.keywords, requestedKeywords);
    if (!selectedModelKeywords) {
      setError(invalidSelection);
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const current = await voiceWakeGatewayClient.getTriggers();
      const triggers = mergeGatewayTriggersForModelSelection(
        detector.keywords,
        current.triggers,
        selectedModelKeywords,
      );
      if (!triggers) {
        setError(triggerCapacityExceeded);
        return false;
      }
      const updated = await voiceWakeGatewayClient.setTriggers(triggers);
      replaceGatewayTriggers(updated.triggers);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setSaving(false);
    }
  }, [detector, replaceGatewayTriggers, saving]);

  const toggleStandby = useCallback(async () => {
    setError(null);
    try {
      if (standbyEnabled) {
        await disableVoiceWakeStandby({
          enable: enableAppAutostart,
          disable: disableAppAutostart,
        });
        setStandbyEnabled(false);
        setStandbyReady(false);
        setStandbySessionKey(null);
        return;
      }
      const sessionKey = useChatStore.getState().activeSessionKey.trim();
      if (!sessionKey) throw new Error('No active OpenClaw session is available for Jarvis standby');
      const identity = getCurrentRuntimeIdentity();
      const targetFingerprint = identity?.verified ? identity.targetFingerprint.trim() : '';
      if (!targetFingerprint) throw new Error('voice_wake_standby_runtime_unavailable');
      await enableVoiceWakeStandby(
        { sessionKey, targetFingerprint },
        { enable: enableAppAutostart, disable: disableAppAutostart },
        () => {
          const current = getCurrentRuntimeIdentity();
          return current?.verified === true && current.targetFingerprint === targetFingerprint;
        },
      );
      setStandbyEnabled(true);
      setStandbyReady(true);
      setStandbySessionKey(sessionKey);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [standbyEnabled]);

  const selectedKeywords = useMemo(() => (
    selectedModelWakeKeywords(detector?.keywords ?? [], gatewayTriggers)
  ), [detector?.keywords, gatewayTriggers]);

  return {
    detector,
    gatewayTriggers,
    selectedKeywords,
    loading,
    configuring,
    saving,
    standbyEnabled,
    standbyReady,
    standbySessionKey,
    error,
    configureModel,
    saveKeywords,
    refresh,
    toggleStandby,
  };
}
