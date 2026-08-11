import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gatewayLifecycle } from '@/runtime/gatewayLifecycle';
import { openClawRuntimeConfigClient } from '@/services/gateway';
import {
  readOpenClawRuntimeLocaleState,
  saveOpenClawRuntimeLocale,
} from '@/services/gateway/OpenClawRuntimeLocale';
import {
  getCurrentRuntimeIdentity,
  subscribeRuntimeIdentity,
} from '@/services/gateway/runtimeIdentity';
import type {
  OpenClawRuntimeLanguageMessage,
  OpenClawRuntimeLocale,
} from '@/types/openclawRuntimeLocale';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';

export interface OpenClawRuntimeLanguageSetting {
  currentLocale: OpenClawRuntimeLocale | null;
  selectedLocale: OpenClawRuntimeLocale | null;
  rawLocale: string | null;
  loading: boolean;
  saving: boolean;
  message: OpenClawRuntimeLanguageMessage | null;
  selectLocale(locale: OpenClawRuntimeLocale): void;
  refresh(): Promise<void>;
  save(): Promise<void>;
}

export function useOpenClawRuntimeLanguageSetting(
  connected: boolean,
): OpenClawRuntimeLanguageSetting {
  const { t } = useTranslation();
  const [identity, setIdentity] = useState<RuntimeIdentity | null>(() => getCurrentRuntimeIdentity());
  const [currentLocale, setCurrentLocale] = useState<OpenClawRuntimeLocale | null>(null);
  const [selectedLocale, setSelectedLocale] = useState<OpenClawRuntimeLocale | null>(null);
  const [rawLocale, setRawLocale] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<OpenClawRuntimeLanguageMessage | null>(null);

  useEffect(() => subscribeRuntimeIdentity(setIdentity), []);

  const refresh = useCallback(async () => {
    if (!connected) {
      setCurrentLocale(null);
      setSelectedLocale(null);
      setRawLocale(null);
      setMessage(null);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const state = readOpenClawRuntimeLocaleState(await openClawRuntimeConfigClient.read());
      setCurrentLocale(state.locale);
      setSelectedLocale(state.locale);
      setRawLocale(state.rawLocale);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    if (!selectedLocale || selectedLocale === currentLocale || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await saveOpenClawRuntimeLocale(openClawRuntimeConfigClient, selectedLocale);
      setCurrentLocale(selectedLocale);
      setRawLocale(selectedLocale);

      if (identity?.ownership === 'junqi_managed' && identity.desktopMutationAllowed) {
        const result = await gatewayLifecycle.restart('runtime-language-settings');
        if (!result.success) {
          setMessage({
            kind: 'error',
            text: t('settings.runtimeLanguageSavedRestartFailed', { error: result.error ?? '' }),
          });
          return;
        }
        setMessage({ kind: 'success', text: t('settings.runtimeLanguageApplied') });
        return;
      }

      setMessage({ kind: 'notice', text: t('settings.runtimeLanguageExternalRestart') });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  return {
    currentLocale,
    selectedLocale,
    rawLocale,
    loading,
    saving,
    message,
    selectLocale: setSelectedLocale,
    refresh,
    save,
  };
}
