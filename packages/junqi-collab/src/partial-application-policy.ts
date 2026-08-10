export type PartialApplicationFence =
  | "MAINTENANCE_GATE_ACTIVE"
  | "OPEN_INTERVENTION_OUTSIDE_CLOSURE";

export interface PartialApplicationFacts {
  readonly maintenanceGateActive: boolean;
  readonly hasUnresolvedInterventionOutsideClosure: boolean;
}

export type PartialApplicationDecision =
  | Readonly<{ kind: "PROCEED" }>
  | Readonly<{
      kind: "DEFER";
      fences: readonly PartialApplicationFence[];
    }>;

const PROCEED = Object.freeze({ kind: "PROCEED" } as const);

/**
 * 不可逆部分接受边界的纯策略。已接受的决定可以持久等待，但不能为了进入汇总阶段
 * 而清除无关的恢复或维护围栏。
 */
export function decidePartialApplication(
  facts: PartialApplicationFacts,
): PartialApplicationDecision {
  const fences: PartialApplicationFence[] = [];
  if (facts.maintenanceGateActive) fences.push("MAINTENANCE_GATE_ACTIVE");
  if (facts.hasUnresolvedInterventionOutsideClosure) {
    fences.push("OPEN_INTERVENTION_OUTSIDE_CLOSURE");
  }
  return fences.length > 0
    ? Object.freeze({ kind: "DEFER", fences: Object.freeze(fences) })
    : PROCEED;
}
