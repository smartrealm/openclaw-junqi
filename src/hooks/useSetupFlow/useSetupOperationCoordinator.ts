import { useCallback, useRef } from "react";
import { cancelSetupOperation } from "@/api/tauri-commands";
import {
  SetupOperationCoordinator,
  type SetupOperationKind,
} from "@/services/setup/setupOperationCoordinator";
import { debugWarn } from "@/utils/debugLog";

/** React adapter for the setup operation ownership service. */
export function useSetupOperationCoordinator() {
  const coordinatorRef = useRef<SetupOperationCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new SetupOperationCoordinator({
      cancelOperation: cancelSetupOperation,
      onBestEffortCancellationError: (error) => {
        debugWarn("app", "[setup] native operation cancellation request failed:", error);
      },
    });
  }
  const coordinator = coordinatorRef.current;

  const beginRun = useCallback(() => coordinator.beginRun(), [coordinator]);
  const isRunActive = useCallback((runId: number) => coordinator.isRunActive(runId), [coordinator]);
  const isCurrentOperationId = useCallback(
    (operationId: string) => coordinator.isCurrentOperationId(operationId),
    [coordinator],
  );
  const runSetupOperation = useCallback(<T,>(
    runId: number,
    kind: SetupOperationKind,
    execute: (operationId: string) => Promise<T>,
  ) => coordinator.runOperation(runId, kind, execute), [coordinator]);
  const beginSetupTransaction = useCallback(
    (runId: number) => coordinator.beginTransaction(runId),
    [coordinator],
  );
  const finishSetupTransaction = useCallback(
    (runId: number) => coordinator.finishTransaction(runId),
    [coordinator],
  );
  const invalidateActiveRun = useCallback(() => coordinator.invalidateActiveRun(), [coordinator]);
  const cancelActiveRun = useCallback(() => coordinator.cancelActiveRun(), [coordinator]);

  return {
    beginRun,
    isRunActive,
    isCurrentOperationId,
    runSetupOperation,
    beginSetupTransaction,
    finishSetupTransaction,
    invalidateActiveRun,
    cancelActiveRun,
  };
}
