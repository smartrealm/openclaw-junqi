/**
 * useAgentScopedSession — read `?agent=<id>&new=1` from the route, materialize
 * a real Gateway session for that agent, then mark the confirmed session
 * active. Fires only once per `?new=1` navigation so subsequent renders leave
 * the user alone.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import { createNativeSession } from '@/utils/sessionCreate';
import { useNotificationStore } from '@/stores/notificationStore';

export function useAgentScopedSession(): void {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const agentId = params.get('agent');
  const wantNew = params.get('new') === '1';
  const handledLocationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!agentId || !wantNew) return;
    if (handledLocationKeyRef.current === location.key) return;
    handledLocationKeyRef.current = location.key;

    // Keep React Router's location state in sync with the visible URL. A later
    // navigation to the same ?agent=...&new=1 URL receives a fresh location
    // key and creates another session instead of being blocked forever.
    const nextParams = new URLSearchParams(params);
    nextParams.delete('new');
    nextParams.delete('agent');
    setParams(nextParams, { replace: true });
    void createNativeSession({ agentId, label: t('chat.newSessionLabel') }).then((result) => {
      if (!result.ok) {
        useNotificationStore.getState().addToast('error', t('chat.newSession'), result.error);
      }
    });
  }, [agentId, location.key, params, setParams, wantNew]);
}
