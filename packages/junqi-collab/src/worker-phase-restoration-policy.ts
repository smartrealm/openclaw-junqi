export type WorkerPhaseSuspensionFence =
  | "PARTIAL_DECISION_PENDING"
  | "MAINTENANCE_GATE_ACTIVE"
  | "OPEN_INTERVENTION";

export interface WorkerPhaseRestorationFacts {
  readonly hasPendingPartialDecision: boolean;
  readonly maintenanceGateActive: boolean;
  readonly hasUnresolvedIntervention: boolean;
}

export type WorkerPhaseRestorationDecision =
  | Readonly<{ kind: "RESTORE" }>
  | Readonly<{
      kind: "DEFER";
      fences: readonly WorkerPhaseSuspensionFence[];
    }>;

const RESTORE = Object.freeze({ kind: "RESTORE" } as const);

/**
 * Run 暂停期间接受终态结果后，用该纯策略判断是否释放 Worker 阶段。结果可以在本地
 * 收敛，但不能清除仍需显式处理的持久操作员或基础设施围栏。
 */
export function decideWorkerPhaseRestoration(
  facts: WorkerPhaseRestorationFacts,
): WorkerPhaseRestorationDecision {
  const fences: WorkerPhaseSuspensionFence[] = [];
  if (facts.hasPendingPartialDecision) fences.push("PARTIAL_DECISION_PENDING");
  if (facts.maintenanceGateActive) fences.push("MAINTENANCE_GATE_ACTIVE");
  if (facts.hasUnresolvedIntervention) fences.push("OPEN_INTERVENTION");
  return fences.length > 0
    ? { kind: "DEFER", fences }
    : RESTORE;
}
