import { useCallback, useEffect, useMemo, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  getVoiceWakeDetectorStatus,
  setVoiceWakeModelDirectory,
  type VoiceWakeDetectorStatus,
} from '@/api/tauri-commands';
import { voiceWakeGatewayClient } from '@/services/gateway';
import {
  resolveModelWakeKeywordSelection,
  selectedModelWakeKeywords,
} from '@/services/voice/VoiceWakeKeywordSelection';

export interface JarvisVoiceSettingsState {
  detector: VoiceWakeDetectorStatus | null;
  gatewayTriggers: string[];
  selectedKeywords: string[];
  loading: boolean;
  configuring: boolean;
  saving: boolean;
  error: string | null;
  configureModel: (title: string) => Promise<void>;
  saveKeywords: (requestedKeywords: readonly string[], invalidSelection: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/** Reads global Jarvis configuration without owning a conversation or microphone. */
export function useJarvisVoiceSettings(enabled: boolean): JarvisVoiceSettingsState {
  const [detector, setDetector] = useState<VoiceWakeDetectorStatus | null>(null);
  const [gatewayTriggers, setGatewayTriggers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextDetector, triggers] = await Promise.all([
        getVoiceWakeDetectorStatus(),
        voiceWakeGatewayClient.getTriggers(),
      ]);
      setDetector(nextDetector);
      setGatewayTriggers(triggers.triggers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

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
  ): Promise<boolean> => {
    if (saving || !detector?.available) return false;
    const triggers = resolveModelWakeKeywordSelection(detector.keywords, requestedKeywords);
    if (!triggers) {
      setError(invalidSelection);
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await voiceWakeGatewayClient.setTriggers(triggers);
      setGatewayTriggers(updated.triggers);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setSaving(false);
    }
  }, [detector, saving]);

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
    error,
    configureModel,
    saveKeywords,
    refresh,
  };
}
