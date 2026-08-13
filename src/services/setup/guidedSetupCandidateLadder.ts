import type {
  GuidedSetupActivation,
  GuidedSetupCandidate,
  GuidedSetupDetection,
} from "@/services/gateway/OpenClawGuidedSetupClient";

export interface GuidedSetupCandidateActivator {
  activateCandidate: (candidate: GuidedSetupCandidate) => Promise<GuidedSetupActivation>;
}

export type GuidedSetupCandidateLadderResult =
  | { activated: true; candidate: GuidedSetupCandidate; result: Extract<GuidedSetupActivation, { ok: true }> }
  | { activated: false; lastResult: Extract<GuidedSetupActivation, { ok: false }> | null };

/** 按 OpenClaw 返回的推荐顺序逐项实测；只有官方激活成功才停止。 */
export async function activateFirstWorkingGuidedCandidate(
  detection: GuidedSetupDetection,
  activator: GuidedSetupCandidateActivator,
): Promise<GuidedSetupCandidateLadderResult> {
  let lastResult: Extract<GuidedSetupActivation, { ok: false }> | null = null;
  for (const candidate of detection.candidates) {
    const result = await activator.activateCandidate(candidate);
    if (result.ok) return { activated: true, candidate, result };
    lastResult = result;
  }
  return { activated: false, lastResult };
}
