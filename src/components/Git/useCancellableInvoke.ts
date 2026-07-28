import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useCancellableInvoke() {
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const safeInvoke = useCallback(
    async <T = unknown>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T | null> => {
      const result = await invoke<T>(command, args);
      return cancelledRef.current ? null : result;
    },
    [],
  );
  const isCancelled = useCallback(() => cancelledRef.current, []);

  return {
    safeInvoke,
    isCancelled,
  };
}
