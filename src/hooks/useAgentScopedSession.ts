/**
 * useAgentScopedSession — read `?agent=<id>&new=1` from the route, materialize
 * a real Gateway session for that agent, then mark the confirmed session
 * active. Fires only once per `?new=1` navigation so subsequent renders leave
 * the user alone.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import { createNativeSession } from '@/utils/sessionCreate';
import { useNotificationStore } from '@/stores/notificationStore';

export interface AgentScopedSessionState {
  readonly error: string | null;
  readonly retrying: boolean;
  readonly retry: () => void;
}

export function useAgentScopedSession(): AgentScopedSessionState {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const agentId = params.get('agent');
  const wantNew = params.get('new') === '1';
  const handledLocationKeyRef = useRef<string | null>(null);
  const operationRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const createForRoute = useCallback(() => {
    if (!agentId || !wantNew) return;
    const operation = ++operationRef.current;
    setError(null);
    setRetrying(true);
    void createNativeSession({ agentId }).then((result) => {
      if (operation !== operationRef.current) return;
      setRetrying(false);
      if (!result.ok) {
        setError(result.error);
        useNotificationStore.getState().addToast('error', t('chat.newSession'), result.error);
        return;
      }

      // Consume the one-shot route intent only after Gateway confirms the new
      // session. Failed intents remain visible and can be retried explicitly.
      const nextParams = new URLSearchParams(params);
      nextParams.delete('new');
      nextParams.delete('agent');
      setParams(nextParams, { replace: true });
    });
  }, [agentId, params, setParams, t, wantNew]);

  useEffect(() => {
    if (!agentId || !wantNew) return;
    if (handledLocationKeyRef.current === location.key) return;
    handledLocationKeyRef.current = location.key;
    setError(null);
    createForRoute();
  }, [agentId, createForRoute, location.key, wantNew]);

  return { error, retrying, retry: createForRoute };
}
