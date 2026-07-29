import { useCallback, useRef } from "react";
import { cancelSetupOperation } from "@/api/tauri-commands";
import { debugWarn } from "@/utils/debugLog";

export type SetupOperationKind = "node" | "git" | "openclaw" | "docker-image";

interface ActiveSetupTransaction {
  runId: number;
  completion: Promise<void>;
  finish: () => void;
}

/** Owns renderer run fencing and the one native operation cancellable by that run. */
export function useSetupOperationCoordinator() {
  const activeRunRef = useRef(0);
  const scopeRef = useRef(
    `setup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  const activeOperationRef = useRef<string | null>(null);
  const activeTransactionRef = useRef<ActiveSetupTransaction | null>(null);

  const requestCancellation = useCallback((operationId: string) => {
    void cancelSetupOperation(operationId).catch((error) => {
      debugWarn("app", "[setup] native operation cancellation request failed:", error);
    });
  }, []);

  const cancelActiveRun = useCallback((): Promise<void> => {
    const operationId = activeOperationRef.current;
    const completion = activeTransactionRef.current?.completion ?? Promise.resolve();
    activeOperationRef.current = null;
    activeRunRef.current += 1;
    if (operationId) requestCancellation(operationId);
    return completion;
  }, [requestCancellation]);

  const beginRun = useCallback(() => {
    void cancelActiveRun();
    return activeRunRef.current;
  }, [cancelActiveRun]);

  const isRunActive = useCallback(
    (runId: number) => activeRunRef.current === runId,
    [],
  );

  const runSetupOperation = useCallback(async <T,>(
    runId: number,
    kind: SetupOperationKind,
    execute: (operationId: string) => Promise<T>,
  ): Promise<T> => {
    if (!isRunActive(runId)) throw new Error("setup cancelled");
    if (activeOperationRef.current) {
      throw new Error("another native setup operation is still active");
    }
    const operationId = `${scopeRef.current}:${runId}:${kind}`;
    activeOperationRef.current = operationId;
    try {
      return await execute(operationId);
    } finally {
      if (activeOperationRef.current === operationId) {
        activeOperationRef.current = null;
      }
    }
  }, [isRunActive]);

  const beginSetupTransaction = useCallback((runId: number) => {
    const current = activeTransactionRef.current;
    if (current?.runId === runId) return;
    if (current) throw new Error("another setup transaction is still stopping");
    let finish!: () => void;
    const completion = new Promise<void>((resolve) => { finish = resolve; });
    activeTransactionRef.current = { runId, completion, finish };
  }, []);

  const finishSetupTransaction = useCallback((runId: number) => {
    const current = activeTransactionRef.current;
    if (current?.runId !== runId) return;
    activeTransactionRef.current = null;
    current.finish();
  }, []);

  return {
    beginRun,
    isRunActive,
    runSetupOperation,
    beginSetupTransaction,
    finishSetupTransaction,
    cancelActiveRun,
  };
}
