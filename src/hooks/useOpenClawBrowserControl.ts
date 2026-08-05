import { useCallback, useEffect, useRef, useState } from 'react';
import { gateway } from '@/services/gateway';
import type {
  OpenClawBrowserProfile,
  OpenClawBrowserStatus,
  OpenClawBrowserTab,
} from '@/services/gateway/OpenClawBrowserClient';

interface BrowserControlState {
  readonly profiles: readonly OpenClawBrowserProfile[];
  readonly status: OpenClawBrowserStatus | null;
  readonly tabs: readonly OpenClawBrowserTab[];
  readonly snapshot: unknown | null;
  readonly loading: boolean;
  readonly operation: 'start' | 'stop' | 'open' | 'focus' | 'close' | 'snapshot' | null;
  readonly error: string | null;
}

const INITIAL_STATE: BrowserControlState = {
  profiles: [],
  status: null,
  tabs: [],
  snapshot: null,
  loading: false,
  operation: null,
  error: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectProfile(
  profiles: readonly OpenClawBrowserProfile[],
  current: string,
): string {
  if (current && profiles.some((profile) => profile.name === current)) return current;
  return profiles.find((profile) => profile.isDefault)?.name ?? profiles[0]?.name ?? '';
}

export function browserProfileNeedsLoginConfirmation(profile: OpenClawBrowserProfile | undefined): boolean {
  return profile?.driver === 'existing-session' || profile?.driver === 'extension';
}

export function useOpenClawBrowserControl(enabled: boolean) {
  const [profileName, setProfileName] = useState('');
  const [state, setState] = useState<BrowserControlState>(INITIAL_STATE);
  const requestId = useRef(0);
  const operationRef = useRef<BrowserControlState['operation']>(null);
  const profileNameRef = useRef(profileName);

  const refresh = useCallback(async (requestedProfile = profileNameRef.current) => {
    const request = requestId.current + 1;
    requestId.current = request;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const profiles = await gateway.getBrowserProfiles();
      if (request !== requestId.current) return;
      const nextProfile = selectProfile(profiles, requestedProfile);
      if (nextProfile !== profileNameRef.current) {
        profileNameRef.current = nextProfile;
        setProfileName(nextProfile);
      }
      if (!nextProfile) {
        setState({ ...INITIAL_STATE, profiles, loading: false });
        return;
      }
      const status = await gateway.getBrowserStatus(nextProfile);
      if (request !== requestId.current) return;
      if (!status.running) {
        setState((current) => ({ ...current, profiles, status, tabs: [], loading: false, error: null }));
        return;
      }

      setState((current) => ({ ...current, profiles, status, tabs: [], loading: true, error: null }));
      const tabs = await gateway.getBrowserTabs(nextProfile);
      if (request !== requestId.current) return;
      setState((current) => ({ ...current, profiles, status, tabs, loading: false, error: null }));
    } catch (error) {
      if (request !== requestId.current) return;
      setState((current) => ({ ...current, loading: false, error: errorMessage(error) }));
    }
  }, []);

  useEffect(() => {
    requestId.current += 1;
    if (!enabled) {
      setState(INITIAL_STATE);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const run = useCallback(async <T,>(
    operation: NonNullable<BrowserControlState['operation']>,
    action: () => Promise<T>,
  ): Promise<T | null> => {
    if (!profileName || operationRef.current !== null) return null;
    operationRef.current = operation;
    setState((current) => ({ ...current, operation, error: null }));
    try {
      const value = await action();
      await refresh();
      return value;
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error) }));
      return null;
    } finally {
      operationRef.current = null;
      setState((current) => ({ ...current, operation: null }));
    }
  }, [profileName, refresh]);

  const start = useCallback(() => run('start', () => gateway.startBrowser(profileName)), [profileName, run]);
  const stop = useCallback(() => run('stop', () => gateway.stopBrowser(profileName)), [profileName, run]);
  const open = useCallback((url: string, label?: string) => (
    run('open', () => gateway.openBrowserTab(url, profileName, label))
  ), [profileName, run]);
  const focus = useCallback((targetId: string) => (
    run('focus', () => gateway.focusBrowserTab(targetId, profileName))
  ), [profileName, run]);
  const close = useCallback((targetId: string) => (
    run('close', () => gateway.closeBrowserTab(targetId, profileName))
  ), [profileName, run]);
  const snapshot = useCallback(async () => {
    const value = await run('snapshot', () => gateway.captureBrowserSnapshot(profileName));
    if (value !== null) setState((current) => ({ ...current, snapshot: value }));
    return value;
  }, [profileName, run]);

  const selectBrowserProfile = useCallback((nextProfile: string) => {
    profileNameRef.current = nextProfile;
    setProfileName(nextProfile);
    setState((current) => ({
      ...current,
      status: null,
      tabs: [],
      snapshot: null,
      error: null,
    }));
    void refresh(nextProfile);
  }, [refresh]);

  return {
    ...state,
    profileName,
    setProfileName: selectBrowserProfile,
    selectedProfile: state.profiles.find((profile) => profile.name === profileName),
    refresh,
    start,
    stop,
    open,
    focus,
    close,
    snapshot,
  };
}
