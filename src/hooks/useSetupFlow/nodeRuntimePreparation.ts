import type { NodeStatus } from "@/api/tauri-commands";

export interface NodeRuntimePreparation {
  key: "setup.node.autoRepair" | "setup.node.autoRepairDetected" | "setup.installingNode";
  params: Record<string, string>;
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
