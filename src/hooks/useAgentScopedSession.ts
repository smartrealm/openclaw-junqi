/**
 * useAgentScopedSession — read `?agent=<id>&new=1` from the route, materialize
 * a real Gateway session for that agent, then mark the confirmed session
 * active. The intent is consumed only after Gateway confirmation; a failed
 * request remains visible and can be retried explicitly.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import { createNativeSession } from '@/utils/sessionCreate';

export interface AgentScopedSessionCreationState {
  readonly error: string | null;
  readonly retry: () => void;
}

export function useAgentScopedSession(): AgentScopedSessionCreationState {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const agentId = params.get('agent');
  const wantNew = params.get('new') === '1';
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const handledAttemptRef = useRef<string | null>(null);

  const retry = useCallback(() => {
    setRetryAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    if (!agentId || !wantNew) {
      setError(null);
      return;
    }
    const attemptKey = `${location.key}:${retryAttempt}`;
    if (handledAttemptRef.current === attemptKey) return;
    handledAttemptRef.current = attemptKey;
    let cancelled = false;
    setError(null);

    void createNativeSession({ agentId, label: t('chat.newSessionLabel') }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const nextParams = new URLSearchParams(params);
      nextParams.delete('new');
      nextParams.delete('agent');
      setParams(nextParams, { replace: true });
    });

    return () => { cancelled = true; };
  }, [agentId, location.key, params, retryAttempt, setParams, t, wantNew]);

  return { error, retry };
}
