import { useEffect, useSyncExternalStore } from 'react';
import { openClawSessionObserverClient } from '@/services/gateway';
import {
  openClawSessionObserverStream,
  type OpenClawSessionObserverDigest,
} from '@/services/gateway/sessionObserverEventBridge';

/** Exposes only live, Gateway-owned observer digests for the visible desktop surface. */
export function useOpenClawSessionObserver(visible: boolean): readonly OpenClawSessionObserverDigest[] {
  const digests = useSyncExternalStore(
    (listener) => openClawSessionObserverStream.subscribe(listener),
    openClawSessionObserverStream.getSnapshot,
    openClawSessionObserverStream.getSnapshot,
  );

  useEffect(() => {
    if (!visible) {
      openClawSessionObserverStream.clear();
      void openClawSessionObserverClient.setVisible(false);
      return;
    }
    void openClawSessionObserverClient.setVisible(true);
    return () => {
      openClawSessionObserverStream.clear();
      void openClawSessionObserverClient.setVisible(false);
    };
  }, [visible]);

  return visible ? digests : [];
}
