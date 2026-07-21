import type { RunStatus } from "./types.js";

export interface ProvisionExecutionContext {
  readonly runStatus: RunStatus;
  readonly infrastructureFenced: boolean;
}

export type ProvisionExecutionDecision =
  | Readonly<{ kind: "CREATE_OR_RECOVER" }>
  | Readonly<{ kind: "OBSERVE_ONLY" }>
  | Readonly<{ kind: "DEFER" }>
  | Readonly<{ kind: "INVALID_STATE" }>;

const CREATE_OR_RECOVER = Object.freeze({ kind: "CREATE_OR_RECOVER" } as const);
const OBSERVE_ONLY = Object.freeze({ kind: "OBSERVE_ONLY" } as const);
const DEFER = Object.freeze({ kind: "DEFER" } as const);
const INVALID_STATE = Object.freeze({ kind: "INVALID_STATE" } as const);

/**
 * Pure policy for the PROVISION outbox effect gate. A lease generation never
 * proves whether an external effect started. Closing Runs are therefore
 * restricted to authoritative observation and can never create a new Flow.
 */
export function decideProvisionExecution(
  context: ProvisionExecutionContext,
): ProvisionExecutionDecision {
  if (context.runStatus === "PROVISIONING") {
    if (context.infrastructureFenced) return DEFER;
    return CREATE_OR_RECOVER;
  }

  if (
    context.runStatus === "CANCELLING"
    || context.runStatus === "COMPLETED"
    || context.runStatus === "CANCELLED"
    || context.runStatus === "FAILED"
  ) {
    // Termination convergence is a maintenance/session-fence exception. It is
    // observe-only and cannot introduce a new external Flow, so deferring it
    // would deadlock the "cancel, then wait for settled effects" protocol.
    return OBSERVE_ONLY;
  }

  return INVALID_STATE;
}
