export type WorkerPhaseSuspensionFence =
  | "PARTIAL_DECISION_PENDING"
  | "MAINTENANCE_GATE_ACTIVE"
  | "OPEN_INTERVENTION"
  | "SESSION_MUTATION_ACTIVE";

export interface WorkerPhaseRestorationFacts {
  readonly hasPendingPartialDecision: boolean;
  readonly maintenanceGateActive: boolean;
  readonly hasUnresolvedIntervention: boolean;
  readonly hasActiveSessionMutation: boolean;
}

export type WorkerPhaseRestorationDecision =
  | Readonly<{ kind: "RESTORE" }>
  | Readonly<{
      kind: "DEFER";
      fences: readonly WorkerPhaseSuspensionFence[];
    }>;

const RESTORE = Object.freeze({ kind: "RESTORE" } as const);

/**
 * Policy for releasing a Worker phase after accepting a terminal result while
 * the Run is suspended. The result may settle locally, but it must not erase a
 * durable operator or infrastructure fence that still requires explicit
 * resolution.
 */
export function decideWorkerPhaseRestoration(
  facts: WorkerPhaseRestorationFacts,
): WorkerPhaseRestorationDecision {
  const fences: WorkerPhaseSuspensionFence[] = [];
  if (facts.hasPendingPartialDecision) fences.push("PARTIAL_DECISION_PENDING");
  if (facts.maintenanceGateActive) fences.push("MAINTENANCE_GATE_ACTIVE");
  if (facts.hasUnresolvedIntervention) fences.push("OPEN_INTERVENTION");
  if (facts.hasActiveSessionMutation) fences.push("SESSION_MUTATION_ACTIVE");
  return fences.length > 0
    ? { kind: "DEFER", fences }
    : RESTORE;
}
