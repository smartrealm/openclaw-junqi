export type PartialApplicationFence =
  | "MAINTENANCE_GATE_ACTIVE"
  | "OPEN_INTERVENTION_OUTSIDE_CLOSURE"
  | "SESSION_MUTATION_ACTIVE";

export interface PartialApplicationFacts {
  readonly maintenanceGateActive: boolean;
  readonly hasUnresolvedInterventionOutsideClosure: boolean;
  readonly hasActiveSessionMutation: boolean;
}

export type PartialApplicationDecision =
  | Readonly<{ kind: "PROCEED" }>
  | Readonly<{
      kind: "DEFER";
      fences: readonly PartialApplicationFence[];
    }>;

const PROCEED = Object.freeze({ kind: "PROCEED" } as const);

/**
 * Policy for the irreversible partial-waiver boundary. An accepted decision
 * may wait durably, but it cannot erase an unrelated recovery or maintenance
 * fence in order to enter synthesis.
 */
export function decidePartialApplication(
  facts: PartialApplicationFacts,
): PartialApplicationDecision {
  const fences: PartialApplicationFence[] = [];
  if (facts.maintenanceGateActive) fences.push("MAINTENANCE_GATE_ACTIVE");
  if (facts.hasUnresolvedInterventionOutsideClosure) {
    fences.push("OPEN_INTERVENTION_OUTSIDE_CLOSURE");
  }
  if (facts.hasActiveSessionMutation) fences.push("SESSION_MUTATION_ACTIVE");
  return fences.length > 0
    ? Object.freeze({ kind: "DEFER", fences: Object.freeze(fences) })
    : PROCEED;
}
