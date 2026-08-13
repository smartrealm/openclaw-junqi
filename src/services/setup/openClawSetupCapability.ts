import type { GuidedSetupDetection } from "@/services/gateway/OpenClawGuidedSetupClient";

export type OpenClawSetupCapability =
  | { mode: "guided"; detection: GuidedSetupDetection }
  | { mode: "classic" };

export function isGuidedSetupUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; availability?: unknown };
  return candidate.code === "OPENCLAW_GUIDED_SETUP_METHOD_UNAVAILABLE"
    && candidate.availability === "unsupported";
}

/**
 * 通过正式 RPC 响应协商配置流程。只有明确的 unknown-method 才代表 Guided
 * 协议不可用；连接、权限与响应错误必须保留原始失败语义。
 */
export async function resolveOpenClawSetupCapability(
  detect: () => Promise<GuidedSetupDetection>,
): Promise<OpenClawSetupCapability> {
  try {
    return { mode: "guided", detection: await detect() };
  } catch (error) {
    if (isGuidedSetupUnsupported(error)) return { mode: "classic" };
    throw error;
  }
}
