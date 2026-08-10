/**
 * 读取路由中的 `?agent=<id>&new=1`，为目标智能体创建真实 Gateway 会话，
 * 并在 Gateway 确认后切换为当前会话。每次路由导航只发起一次创建，避免重渲染重复建会话。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import { createNativeSession } from '@/utils/sessionCreate';
import { useNotificationStore } from '@/stores/notificationStore';

export interface AgentScopedSessionState {
  readonly pending: boolean;
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

      // 只有 Gateway 确认新会话后才消费一次性路由意图；失败意图保留，供用户显式重试。
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

  return { pending: Boolean(agentId && wantNew), error, retrying, retry: createForRoute };
}
