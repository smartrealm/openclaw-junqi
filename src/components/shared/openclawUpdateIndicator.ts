import type { OpenclawUpdateStatus } from "@/api/tauri-commands";
import type { OpenclawUpdatePhase } from "@/hooks/openclawUpdateState";

export type OpenclawUpdateIndicator = "idle" | "busy" | "current" | "available" | "error";

type UpdateStatusSummary = Pick<OpenclawUpdateStatus, "available" | "error" | "managedChannelPolicy">;

export function resolveOpenclawUpdateIndicator(
  phase: OpenclawUpdatePhase,
  status: UpdateStatusSummary | null,
): OpenclawUpdateIndicator {
  if (phase === "checking" || phase === "updating") return "busy";
  if (phase === "error" || status?.error) return "error";
  if ((phase !== "ready" && phase !== "success") || !status) return "idle";
  if (status.managedChannelPolicy !== "eligible") return "error";
  return status.available ? "available" : "current";
}
