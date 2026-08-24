import assert from "node:assert/strict";
import test from "node:test";
import { shouldRegisterDingTalkTools } from "./index.js";

test("在 OpenClaw 工具发现模式注册钉钉工具", () => {
  assert.equal(shouldRegisterDingTalkTools("discovery"), true);
  assert.equal(shouldRegisterDingTalkTools("tool-discovery"), true);
  assert.equal(shouldRegisterDingTalkTools("full"), true);
});

test("不在非工具模式注册钉钉工具", () => {
  assert.equal(shouldRegisterDingTalkTools("setup-only"), false);
  assert.equal(shouldRegisterDingTalkTools("setup-runtime"), false);
  assert.equal(shouldRegisterDingTalkTools("cli-metadata"), false);
});
