import { useEffect, useSyncExternalStore } from 'react';
import { hasAvailableDingTalkRuntimeTool } from '@/business-applications/dingtalkTools';
import {
  getCurrentRuntimeIdentity,
  subscribeRuntimeIdentity,
} from '@/services/gateway/runtimeIdentity';
import { useChatStore } from '@/stores/chatStore';
import {
  ensureToolsEffectiveFresh,
  useGatewayDataStore,
} from '@/stores/gatewayDataStore';
import {
  invalidateDingTalkRuntimeIdentityContext,
  invalidateDingTalkRuntimeIdentitySnapshot,
  refreshDingTalkRuntimeIdentitySnapshot,
} from '@/stores/dingTalkRuntimeIdentityStore';

function useRuntimeIdentitySnapshot() {
  return useSyncExternalStore(
    (onStoreChange) => subscribeRuntimeIdentity(() => onStoreChange()),
    getCurrentRuntimeIdentity,
    () => null,
  );
}

export function useDingTalkBusinessPrewarm({
  setupComplete,
  connected,
}: {
  setupComplete: boolean;
  connected: boolean;
}): void {
  const identity = useRuntimeIdentitySnapshot();
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const session = useGatewayDataStore((state) => (
    state.sessions.find((entry) => entry.key === activeSessionKey) ?? null
  ));
  const effective = useGatewayDataStore((state) => state.toolsEffective[activeSessionKey]);
  const effectiveRevision = useGatewayDataStore(
    (state) => state.toolsEffectiveUpdatedAt[activeSessionKey] ?? 0,
  );
  const effectiveLoadingSessionKey = useGatewayDataStore(
    (state) => state.toolsEffectiveLoadingSessionKey,
  );

  const contextReady = setupComplete
    && connected
    && identity?.verified === true
    && Boolean(session)
    && Boolean(activeSessionKey);

  useEffect(() => {
    if (!contextReady) {
      invalidateDingTalkRuntimeIdentitySnapshot();
      return;
    }
    if (effectiveLoadingSessionKey !== activeSessionKey) {
      void ensureToolsEffectiveFresh(activeSessionKey, undefined, session?.agentId);
    }
  }, [activeSessionKey, contextReady, effective, effectiveLoadingSessionKey, session?.agentId]);

  useEffect(() => {
    if (!contextReady || !identity || effectiveRevision <= 0) return;
    if (!hasAvailableDingTalkRuntimeTool(effective?.groups)) {
      invalidateDingTalkRuntimeIdentityContext(identity.connectionId, activeSessionKey);
      return;
    }
    void refreshDingTalkRuntimeIdentitySnapshot(identity.connectionId, activeSessionKey);
  }, [activeSessionKey, contextReady, effective, effectiveRevision, identity]);
}
