import { useCallback, useEffect, useRef, useState } from 'react';
import { openClawTtsPreferencesClient, openClawTtsStatusClient } from '@/services/gateway';
import {
  OpenClawTtsStatusUnavailableError,
  type OpenClawTtsStatus,
} from '@/services/gateway/OpenClawTtsStatusClient';
import {
  OpenClawTtsPreferencesResponseError,
  OpenClawTtsPreferencesUnavailableError,
  type OpenClawTtsPreferenceMutation,
} from '@/services/gateway/OpenClawTtsPreferencesClient';

export type OpenClawTtsStatusFailure = 'unavailable' | 'invalid';
export type OpenClawTtsPreferenceFailure = 'unavailable' | 'invalid' | 'rejected';

interface OpenClawTtsStatusState {
  readonly status: OpenClawTtsStatus | null;
  readonly loading: boolean;
  readonly failure: OpenClawTtsStatusFailure | null;
  readonly mutation: OpenClawTtsPreferenceMutation | null;
  readonly mutationFailure: OpenClawTtsPreferenceFailure | null;
}

const EMPTY_STATE: OpenClawTtsStatusState = {
  status: null,
  loading: false,
  failure: null,
  mutation: null,
  mutationFailure: null,
};

export function useOpenClawTtsStatus(active: boolean) {
  const [state, setState] = useState<OpenClawTtsStatusState>(EMPTY_STATE);
  const requestVersion = useRef(0);
  const mutationInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!active || mutationInFlight.current) return;
    const version = ++requestVersion.current;
    setState((current) => ({ ...current, loading: true, failure: null }));
    try {
      const status = await openClawTtsStatusClient.get();
      if (requestVersion.current === version) {
        setState((current) => ({ ...current, status, loading: false, failure: null }));
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setState((current) => ({
          ...current,
          status: null,
          loading: false,
          failure: error instanceof OpenClawTtsStatusUnavailableError ? 'unavailable' : 'invalid',
        }));
      }
    }
  }, [active]);

  const mutate = useCallback(async (
    mutation: OpenClawTtsPreferenceMutation,
    operation: () => Promise<string>,
  ) => {
    if (!active || mutationInFlight.current) return;
    mutationInFlight.current = true;
    const version = ++requestVersion.current;
    setState((current) => ({
      ...current,
      loading: false,
      failure: null,
      mutation,
      mutationFailure: null,
    }));
    try {
      const connectionId = await operation();
      const status = await openClawTtsStatusClient.getForConnection(connectionId);
      if (requestVersion.current === version) {
        setState((current) => ({
          ...current,
          status,
          loading: false,
          failure: null,
          mutation: null,
          mutationFailure: null,
        }));
      }
    } catch (error) {
      if (requestVersion.current === version) {
        const mutationFailure = error instanceof OpenClawTtsPreferencesUnavailableError
          || error instanceof OpenClawTtsStatusUnavailableError
          ? 'unavailable'
          : error instanceof OpenClawTtsPreferencesResponseError
            ? 'invalid'
            : 'rejected';
        setState((current) => ({
          ...current,
          loading: false,
          mutation: null,
          mutationFailure,
        }));
      }
    } finally {
      mutationInFlight.current = false;
    }
  }, [active]);

  const setEnabled = useCallback((enabled: boolean) => mutate(
    'enabled',
    () => openClawTtsPreferencesClient.setEnabled(enabled),
  ), [mutate]);

  const setProvider = useCallback((provider: string) => mutate(
    'provider',
    () => openClawTtsPreferencesClient.setProvider(provider),
  ), [mutate]);

  const setPersona = useCallback((persona: string | null) => mutate(
    'persona',
    () => openClawTtsPreferencesClient.setPersona(persona),
  ), [mutate]);

  useEffect(() => {
    if (!active) {
      requestVersion.current += 1;
      setState(EMPTY_STATE);
      return;
    }
    void refresh();
  }, [active, refresh]);

  return { ...state, refresh, setEnabled, setProvider, setPersona };
}
