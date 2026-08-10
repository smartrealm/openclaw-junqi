import { useEffect, useState, useSyncExternalStore } from 'react';
import { isBusinessGuideActive } from '@/business-guide/activation';
import {
  openClawSetupClient,
} from '@/services/gateway';
import { getCurrentRuntimeIdentity, subscribeRuntimeIdentity } from '@/services/gateway/runtimeIdentity';
import { useAppStore } from '@/stores/app-store';
import { useChatStore } from '@/stores/chatStore';

interface RuntimeVerification {
  configurationVerified: boolean;
  modelVerified: boolean;
}

const unverifiedRuntime: RuntimeVerification = {
  configurationVerified: false,
  modelVerified: false,
};

async function verifySelectedRuntime(): Promise<RuntimeVerification> {
  try {
    const [detection, verification] = await Promise.all([
      openClawSetupClient.detect(),
      openClawSetupClient.verify(),
    ]);
    return {
      configurationVerified: detection.setupComplete,
      modelVerified: verification.ok,
    };
  } catch {
    return unverifiedRuntime;
  }
}

/**
 * Revalidates the selected runtime after its attested identity is available.
 * It deliberately fails closed while any fact is unavailable or changing.
 */
export function useBusinessGuideActivation(): boolean {
  const setupComplete = useAppStore((state) => state.setupComplete === true);
  const connected = useChatStore((state) => state.connected);
  const identity = useSyncExternalStore(
    subscribeRuntimeIdentity,
    getCurrentRuntimeIdentity,
    getCurrentRuntimeIdentity,
  );
  const [runtime, setRuntime] = useState<RuntimeVerification>(unverifiedRuntime);
  const identityVerified = identity?.verified === true;
  const identityKey = identityVerified ? `${identity?.connectionId}:${identity?.targetFingerprint}` : '';

  useEffect(() => {
    let cancelled = false;
    if (!setupComplete || !connected || !identityVerified || !identityKey) {
      setRuntime(unverifiedRuntime);
      return undefined;
    }

    setRuntime(unverifiedRuntime);
    void verifySelectedRuntime().then((next) => {
      if (!cancelled) setRuntime(next);
    });
    return () => { cancelled = true; };
  }, [connected, identityKey, identityVerified, setupComplete]);

  return isBusinessGuideActive({
    setupComplete,
    connected,
    identityVerified,
    configurationVerified: runtime.configurationVerified,
    modelVerified: runtime.modelVerified,
  });
}
