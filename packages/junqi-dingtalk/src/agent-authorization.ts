import { DingTalkRuntimeError } from "./errors.js";

const MAX_AGENT_ID_LENGTH = 128;

export function normalizeAllowedAgentIds(input: Record<string, unknown> | undefined): readonly string[] {
  const value = input?.allowedAgentIds;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new DingTalkRuntimeError("DWS_AGENT_CONFIGURATION_INVALID", "allowedAgentIds must be an array");
  }
  const ids = value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new DingTalkRuntimeError("DWS_AGENT_CONFIGURATION_INVALID", `allowedAgentIds[${index}] must be a string`);
    }
    const normalized = entry.trim();
    if (!normalized || normalized.length > MAX_AGENT_ID_LENGTH) {
      throw new DingTalkRuntimeError("DWS_AGENT_CONFIGURATION_INVALID", `allowedAgentIds[${index}] is invalid`);
    }
    return normalized;
  });
  if (new Set(ids).size !== ids.length) {
    throw new DingTalkRuntimeError("DWS_AGENT_CONFIGURATION_INVALID", "allowedAgentIds must not repeat an agent id");
  }
  return ids;
}

export function agentAuthorizationFailure(allowedAgentIds: readonly string[], agentId: string | undefined): string | null {
  if (!agentId) return "钉钉 DWS 工具缺少 OpenClaw Agent 身份，已拒绝执行。";
  if (allowedAgentIds.length === 0) return "钉钉 DWS 工具尚未配置获授权的 OpenClaw Agent，已拒绝执行。";
  return allowedAgentIds.includes(agentId) ? null : "当前 OpenClaw Agent 未获授权使用钉钉 DWS 工具。";
}
