import { useEffect, useRef } from "react";

type IntervalHandle = ReturnType<typeof setInterval>;

interface VisibilitySource {
  visibilityState?: string;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}

export function installVisibleInterval({
  run,
  intervalMs,
  visibilitySource = typeof document === "undefined" ? null : document,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: {
  run: () => void;
  intervalMs: number;
  visibilitySource?: VisibilitySource | null;
  setIntervalFn?: (callback: () => void, intervalMs: number) => IntervalHandle;
  clearIntervalFn?: (handle: IntervalHandle) => void;
}): () => void {
  let interval: IntervalHandle | null = null;

  const stop = () => {
    if (interval === null) return;
    clearIntervalFn(interval);
    interval = null;
  };
  const start = () => {
    if (interval !== null || visibilitySource?.visibilityState === "hidden") return;
    run();
    interval = setIntervalFn(run, intervalMs);
  };
  const reconcile = () => {
    if (visibilitySource?.visibilityState === "hidden") stop();
    else start();
  };

  start();
  visibilitySource?.addEventListener("visibilitychange", reconcile);
  return () => {
    stop();
    visibilitySource?.removeEventListener("visibilitychange", reconcile);
  };
}

export function useVisibleInterval(
  run: () => void,
  intervalMs: number,
  enabled = true,
  restartKey?: unknown,
): void {
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return;
    return installVisibleInterval({
      run: () => runRef.current(),
      intervalMs,
    });
  }, [enabled, intervalMs, restartKey]);
}
