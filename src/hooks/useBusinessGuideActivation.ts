import { useSyncExternalStore } from 'react';
import { isBusinessGuideActive } from '@/business-guide/activation';
import { getCurrentRuntimeIdentity, subscribeRuntimeIdentity } from '@/services/gateway/runtimeIdentity';
import { useAppStore } from '@/stores/app-store';
import { useChatStore } from '@/stores/chatStore';

/**
 * 业务引导只消费客户端已经持有的真实事实，不承担 OpenClaw 配置或模型终态核验。
 */
export function useBusinessGuideActivation(): boolean {
  const setupComplete = useAppStore((state) => state.setupComplete === true);
  const connected = useChatStore((state) => state.connected);
  const identity = useSyncExternalStore(
    subscribeRuntimeIdentity,
    getCurrentRuntimeIdentity,
    getCurrentRuntimeIdentity,
  );
  const identityVerified = identity?.verified === true;

  return isBusinessGuideActive({
    setupComplete,
    connected,
    identityVerified,
  });
}
