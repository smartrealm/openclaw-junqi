import type { OpenClawSetupVerification, OpenClawSetupVerificationFailureStatus } from "@/services/gateway/OpenClawSetupVerificationClient";

export interface SetupCompletionDependencies {
  probeGateway: () => Promise<boolean>;
  requiresOnboarding: () => Promise<boolean>;
  verifyConfiguredInference: () => Promise<SetupInferenceVerification>;
}

export type SetupInferenceVerification =
  | { status: "verified"; modelRef: string; latencyMs: number }
  | { status: "failed"; reason: OpenClawSetupVerificationFailureStatus; error: string }
  | { status: "unavailable"; error: string };

export function toSetupInferenceVerification(
  verification: OpenClawSetupVerification,
): SetupInferenceVerification {
  return verification.ok
    ? { status: "verified", modelRef: verification.modelRef, latencyMs: verification.latencyMs }
    : { status: "failed", reason: verification.status, error: verification.error };
}

export type SetupCompletionResult =
  | { ready: true; verification: SetupInferenceVerification }
  | { ready: false; reason: 'gateway-unavailable' | 'onboarding-required' | 'inference-unverified'; verification?: SetupInferenceVerification };

/** 按 OpenClaw 原生跳过引导条件验证选定运行时。 */
export async function validateSetupCompletion(
  dependencies: SetupCompletionDependencies,
): Promise<SetupCompletionResult> {
  if (!(await dependencies.probeGateway())) {
    return { ready: false, reason: 'gateway-unavailable' };
  }
  if (await dependencies.requiresOnboarding()) {
    return { ready: false, reason: 'onboarding-required' };
  }
  const verification = await dependencies.verifyConfiguredInference();
  if (verification.status === "unavailable") {
    // 当前稳定版 Gateway 可能没有提供实时验证 RPC；这不是配置或凭据失败。
    // 保留未知状态，允许官方配置完成后的桌面流程继续，不把未知伪报为成功。
    return { ready: true, verification };
  }
  if (verification.status !== "verified") {
    return { ready: false, reason: 'inference-unverified', verification };
  }

  return { ready: true, verification };
}
