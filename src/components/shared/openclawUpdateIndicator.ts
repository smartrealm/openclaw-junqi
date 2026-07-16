import type { OpenclawUpdateStatus } from "@/api/tauri-commands";
import type { OpenclawUpdatePhase } from "@/hooks/openclawUpdateState";

export type OpenclawUpdateIndicator = "idle" | "busy" | "current" | "available" | "error";

type UpdateStatusSummary = Pick<OpenclawUpdateStatus, "available" | "error">;

export function resolveOpenclawUpdateIndicator(
  phase: OpenclawUpdatePhase,
  status: UpdateStatusSummary | null,
): OpenclawUpdateIndicator {
  if (phase === "checking" || phase === "updating") return "busy";
  if (phase === "error" || status?.error) return "error";
  if ((phase !== "ready" && phase !== "success") || !status) return "idle";
  return status.available ? "available" : "current";
}
