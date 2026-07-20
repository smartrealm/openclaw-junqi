import { useCallback, useEffect, useRef, useState } from 'react';

export type SceneRecoveryReason = 'reconnect' | 'foreground';

export class SceneRecoveryTracker {
  private connected: boolean;
  private backgroundAt: number | null = null;
  private lastRecoveryAt = Number.NEGATIVE_INFINITY;

  constructor(connected: boolean) {
    this.connected = connected;
  }

  connectionChanged(connected: boolean, now: number): SceneRecoveryReason | null {
    const reconnected = !this.connected && connected;
    this.connected = connected;
    return reconnected ? this.emit('reconnect', now) : null;
  }

  enterBackground(now: number): void {
    if (this.backgroundAt === null) this.backgroundAt = now;
  }

  enterForeground(now: number, thresholdMs: number): SceneRecoveryReason | null {
    const backgroundAt = this.backgroundAt;
    this.backgroundAt = null;
    if (!this.connected || backgroundAt === null || now - backgroundAt < thresholdMs) return null;
    return this.emit('foreground', now);
  }

  private emit(reason: SceneRecoveryReason, now: number): SceneRecoveryReason | null {
    if (now - this.lastRecoveryAt < 750) return null;
    this.lastRecoveryAt = now;
    return reason;
  }
}

interface SceneRecoveryState {
  revision: number;
  reason: SceneRecoveryReason | null;
}

export function useSceneRecovery(
  connected: boolean,
  onRecover: (reason: SceneRecoveryReason) => void,
  backgroundThresholdMs = 8_000,
): SceneRecoveryState {
  const trackerRef = useRef<SceneRecoveryTracker | null>(null);
  if (!trackerRef.current) trackerRef.current = new SceneRecoveryTracker(connected);
  const onRecoverRef = useRef(onRecover);
  onRecoverRef.current = onRecover;
  const [state, setState] = useState<SceneRecoveryState>({ revision: 0, reason: null });

  const recover = useCallback((reason: SceneRecoveryReason | null) => {
    if (!reason) return;
    setState((current) => ({ revision: current.revision + 1, reason }));
    onRecoverRef.current(reason);
  }, []);

  useEffect(() => {
    recover(trackerRef.current!.connectionChanged(connected, Date.now()));
  }, [connected, recover]);

  useEffect(() => {
    const tracker = trackerRef.current!;
    const enterBackground = () => tracker.enterBackground(Date.now());
    const enterForeground = () => recover(tracker.enterForeground(Date.now(), backgroundThresholdMs));
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') enterBackground();
      else enterForeground();
    };

    window.addEventListener('blur', enterBackground);
    window.addEventListener('focus', enterForeground);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', enterBackground);
      window.removeEventListener('focus', enterForeground);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [backgroundThresholdMs, recover]);

  return state;
}
