import assert from "node:assert/strict";
import test from "node:test";
import { agentAuthorizationFailure, normalizeAllowedAgentIds } from "./agent-authorization.js";

test("fails closed unless a specific OpenClaw agent is configured", () => {
  assert.equal(agentAuthorizationFailure(normalizeAllowedAgentIds(undefined), "dingtalk-business"), "钉钉 DWS 工具尚未配置获授权的 OpenClaw Agent，已拒绝执行。");
});

test("authorizes only configured OpenClaw agents", () => {
  const allowed = normalizeAllowedAgentIds({ allowedAgentIds: ["dingtalk-business"] });
  assert.equal(agentAuthorizationFailure(allowed, "dingtalk-business"), null);
  assert.equal(agentAuthorizationFailure(allowed, "main"), "当前 OpenClaw Agent 未获授权使用钉钉 DWS 工具。");
});
