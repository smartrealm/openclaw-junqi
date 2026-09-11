import type { NodeStatus, SetupNodeStatus } from "@/api/tauri-commands";

export interface NodeRuntimePreparation {
  key: "setup.node.autoRepair" | "setup.node.autoRepairDetected" | "setup.installingNode";
  params: Record<string, string>;
}

export type SetupNodeRepairAction = "install" | "repair-npm" | "ready";

export function nextSetupNodeRepairAction(status: SetupNodeStatus): SetupNodeRepairAction {
  if (!status.node.available) return "install";
  return status.npm.available ? "ready" : "repair-npm";
}

export function describeNodeRuntimePreparation(
  node: NodeStatus,
  requirement: string | null,
): NodeRuntimePreparation {
  const version = node.version?.trim();
  const targetRequirement = requirement?.trim();
  if (version && targetRequirement) {
    return {
      key: "setup.node.autoRepairDetected",
      params: { version, requirement: targetRequirement },
    };
  }
  if (targetRequirement) {
    return {
      key: "setup.node.autoRepair",
      params: { requirement: targetRequirement },
    };
  }
  return { key: "setup.installingNode", params: {} };
}
