import type { GatewayRuntimeMode } from "@/api/tauri-commands";

export type RuntimeSelectionOutcome =
  | { status: "committed" }
  | { status: "superseded" }
  | {
      status: "rolled-back";
      cause: unknown;
      restoredPreviousGateway: boolean;
      previousGatewayRestoreError?: unknown;
      compensationErrors?: unknown[];
    };

export interface RuntimeSelectionTransactionPorts {
  isActive: () => boolean;
  rollbackPendingLocations: () => Promise<boolean>;
  stageMode: (mode: GatewayRuntimeMode) => Promise<void>;
  prepare: (mode: GatewayRuntimeMode) => Promise<void>;
  setup: (mode: GatewayRuntimeMode) => Promise<boolean>;
  commit: (mode: GatewayRuntimeMode) => Promise<unknown>;
  rollbackMode: (mode: GatewayRuntimeMode) => Promise<void>;
  restoreGateway: (mode: GatewayRuntimeMode) => Promise<void>;
}

/**
 * Owns one explicit runtime selection from staging through compensation.
 *
 * UI state, navigation and translated diagnostics deliberately stay outside
 * this service. The transaction only coordinates persistence and Gateway
 * lifecycle ports, which makes its commit/rollback rules independently
 * testable and keeps the React hook from becoming a second backend.
 */
export async function executeRuntimeSelectionTransaction(
  targetMode: GatewayRuntimeMode,
  previousMode: GatewayRuntimeMode,
  ports: RuntimeSelectionTransactionPorts,
): Promise<RuntimeSelectionOutcome> {
  const switchedMode = targetMode !== previousMode;
  let modeStaged = false;
  let cause: unknown = new Error(`${targetMode} setup did not complete`);

  try {
    if (targetMode === "docker") {
      // Docker cannot consume a pending Native location transaction. Recovery
      // here happens before this mode switch and therefore must never be
      // mistaken for compensation of a later staged Docker mode.
      await ports.rollbackPendingLocations();
      if (!ports.isActive()) return { status: "superseded" };
    }

    await ports.stageMode(targetMode);
    modeStaged = true;
    if (!ports.isActive()) return { status: "superseded" };

    await ports.prepare(targetMode);
    if (!ports.isActive()) return { status: "superseded" };

    const completed = await ports.setup(targetMode);
    if (!ports.isActive()) return { status: "superseded" };
    if (!completed) throw cause;

    await ports.commit(targetMode);
    if (!ports.isActive()) return { status: "superseded" };
    return { status: "committed" };
  } catch (error) {
    cause = error;
  }

  if (!ports.isActive()) return { status: "superseded" };

  // Only recovery performed after the failed stage can compensate that stage.
  // A durable location memento restores the complete previous bootstrap and
  // Gateway. Without one, roll back the independently staged mode and restart
  // the previous runtime explicitly.
  const compensationErrors: unknown[] = [];
  let restoredLocations = false;
  try {
    restoredLocations = await ports.rollbackPendingLocations();
  } catch (error) {
    // Location recovery and mode rollback are independent compensation paths.
    // A failed location probe must not strand the staged mode without trying
    // its own rollback.
    compensationErrors.push(error);
  }
  if (!ports.isActive()) return { status: "superseded" };

  let modeRestored = !modeStaged || !switchedMode || restoredLocations;
  if (modeStaged && switchedMode && !restoredLocations) {
    try {
      await ports.rollbackMode(targetMode);
      modeRestored = true;
    } catch (error) {
      compensationErrors.push(error);
    }
    if (!ports.isActive()) return { status: "superseded" };
  }

  let restoredPreviousGateway = true;
  let previousGatewayRestoreError: unknown;
  if (modeStaged && switchedMode && !restoredLocations) {
    if (!modeRestored) {
      // Starting the previous Gateway while persistence still selects the
      // candidate could relaunch the failed candidate. Fail closed instead.
      restoredPreviousGateway = false;
      previousGatewayRestoreError = new Error("Runtime mode rollback failed; previous Gateway was not restarted");
    } else {
      try {
        await ports.restoreGateway(previousMode);
      } catch (error) {
        restoredPreviousGateway = false;
        previousGatewayRestoreError = error;
        compensationErrors.push(error);
      }
    }
  }

  return {
    status: "rolled-back",
    cause,
    restoredPreviousGateway,
    previousGatewayRestoreError,
    ...(compensationErrors.length > 0 ? { compensationErrors } : {}),
  };
}
