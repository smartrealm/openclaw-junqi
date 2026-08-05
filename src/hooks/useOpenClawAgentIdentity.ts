import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { gateway, openClawAgentIdentityClient } from '@/services/gateway';
import {
  OpenClawAgentIdentityUnavailableError,
  type OpenClawAgentIdentity,
} from '@/services/gateway/OpenClawAgentIdentityClient';
import { getCurrentRuntimeIdentity, subscribeRuntimeIdentity } from '@/services/gateway/runtimeIdentity';

export type OpenClawAgentIdentityFailure = 'unavailable' | 'invalid';

interface OpenClawAgentIdentityState {
  readonly identity: OpenClawAgentIdentity | null;
  readonly loading: boolean;
  readonly failure: OpenClawAgentIdentityFailure | null;
}

const EMPTY_STATE: OpenClawAgentIdentityState = {
  identity: null,
  loading: false,
  failure: null,
};

let cacheConnectionId: string | null = null;
const identityCache = new Map<string, OpenClawAgentIdentity>();
const identityRequests = new Map<string, Promise<OpenClawAgentIdentity>>();

function cacheKey(connectionId: string, sessionKey: string): string {
  return `${connectionId}\u0000${sessionKey}`;
}

function resetCacheForConnection(connectionId: string): void {
  if (cacheConnectionId === connectionId) return;
  cacheConnectionId = connectionId;
  identityCache.clear();
  identityRequests.clear();
}

function loadIdentity(connectionId: string, sessionKey: string): Promise<OpenClawAgentIdentity> {
  resetCacheForConnection(connectionId);
  const key = cacheKey(connectionId, sessionKey);
  const cached = identityCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = identityRequests.get(key);
  if (pending) return pending;

  const request = openClawAgentIdentityClient.getForConnection({ sessionKey }, connectionId)
    .then((identity) => {
      if (cacheConnectionId === connectionId) identityCache.set(key, identity);
      return identity;
    })
    .finally(() => {
      identityRequests.delete(key);
    });
  identityRequests.set(key, request);
  return request;
}

/**
 * Projects the Gateway-resolved identity for one session. Cache entries are
 * scoped to the currently attested connection, so an identity from an old
 * Gateway cannot survive a reconnect into the next session view.
 */
export function useOpenClawAgentIdentity(sessionKey: string | null | undefined, active: boolean) {
  const runtimeIdentity = useSyncExternalStore(
    subscribeRuntimeIdentity,
    getCurrentRuntimeIdentity,
    getCurrentRuntimeIdentity,
  );
  const [state, setState] = useState<OpenClawAgentIdentityState>(EMPTY_STATE);
  const requestVersion = useRef(0);
  const normalizedSessionKey = sessionKey?.trim() ?? '';
  const connectionId = runtimeIdentity?.connectionId ?? gateway.captureConnectionId();

  useEffect(() => {
    const version = ++requestVersion.current;
    if (!active || !normalizedSessionKey || !connectionId) {
      setState(EMPTY_STATE);
      return undefined;
    }

    const key = cacheKey(connectionId, normalizedSessionKey);
    const cached = cacheConnectionId === connectionId ? identityCache.get(key) : undefined;
    if (cached) {
      setState({ identity: cached, loading: false, failure: null });
      return undefined;
    }

    setState({ identity: null, loading: true, failure: null });
    void loadIdentity(connectionId, normalizedSessionKey).then(
      (identity) => {
        if (requestVersion.current === version) {
          setState({ identity, loading: false, failure: null });
        }
      },
      (error: unknown) => {
        if (requestVersion.current === version) {
          setState({
            identity: null,
            loading: false,
            failure: error instanceof OpenClawAgentIdentityUnavailableError ? 'unavailable' : 'invalid',
          });
        }
      },
    );

    return () => { requestVersion.current += 1; };
  }, [active, connectionId, normalizedSessionKey]);

  return state;
}
