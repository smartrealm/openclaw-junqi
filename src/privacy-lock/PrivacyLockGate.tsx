import { ReactNode, useEffect } from 'react';
import { PrivacyLockScreen } from './PrivacyLockScreen';
import { startPrivacyLockListener, usePrivacyLockStore } from './store';
import { PrivacyLockRuntime } from './PrivacyLockRuntime';

export interface PrivacyLockGateProps {
  children: ReactNode;
  compact?: boolean;
}

export function PrivacyLockGate({ children, compact = false }: PrivacyLockGateProps) {
  const snapshot = usePrivacyLockStore((state) => state.snapshot);
  const loading = usePrivacyLockStore((state) => state.loading);
  const error = usePrivacyLockStore((state) => state.error);
  const refresh = usePrivacyLockStore((state) => state.refresh);

  useEffect(() => startPrivacyLockListener(), []);
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  if (loading || !snapshot) {
    return <div className="h-screen w-full bg-aegis-bg" aria-busy="true" />;
  }
  if (error) {
    return <div className="h-screen w-full bg-aegis-bg" aria-busy="true" />;
  }
  if (snapshot.locked) {
    return (
      <>
        <PrivacyLockRuntime />
        <PrivacyLockScreen compact={compact} />
      </>
    );
  }
  return (
    <>
      <PrivacyLockRuntime />
      {children}
    </>
  );
}
