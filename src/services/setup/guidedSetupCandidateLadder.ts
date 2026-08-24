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
  | {
    activated: false;
    lastResult: Extract<GuidedSetupActivation, { ok: false }> | null;
    interruptedCause?: unknown;
  };

/** 按 OpenClaw 官方自动候选规则尝试，避免替换已有但暂时无法核验的默认模型。 */
export async function activateFirstWorkingGuidedCandidate(
  detection: GuidedSetupDetection,
  activator: GuidedSetupCandidateActivator,
): Promise<GuidedSetupCandidateLadderResult> {
  let lastResult: Extract<GuidedSetupActivation, { ok: false }> | null = null;
  for (const candidate of detection.candidates) {
    if (candidate.credentials === false) continue;
    let result: GuidedSetupActivation;
    try {
      result = await activator.activateCandidate(candidate);
    } catch (cause) {
      // 请求异常时无法证明本次激活没有副作用，不能继续自动尝试下一个候选。
      return { activated: false, lastResult, interruptedCause: cause };
    }
    if (result.ok) return { activated: true, candidate, result };
    lastResult = result;
    if (candidate.kind === "existing-model") break;
  }
  return { activated: false, lastResult };
}
