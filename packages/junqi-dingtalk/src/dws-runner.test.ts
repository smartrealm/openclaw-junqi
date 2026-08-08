import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDwsCommandArguments,
  buildDwsEnvironment,
  normalizeRunnerConfig,
  validateProfileReference,
} from "./dws-runner.js";
import { DingTalkRuntimeError } from "./errors.js";

test("normalizes bounded runner configuration", () => {
  assert.deepEqual(normalizeRunnerConfig(undefined), {
    timeoutMs: 30_000,
    maxOutputBytes: 2_097_152,
  });
  assert.deepEqual(normalizeRunnerConfig({ timeoutMs: 2_000, maxOutputBytes: 65_536 }), {
    timeoutMs: 2_000,
    maxOutputBytes: 65_536,
  });
});

test("requires an exact explicit profile reference", () => {
  assert.equal(validateProfileReference("corp-a:user-b"), "corp-a:user-b");
  assert.throws(
    () => validateProfileReference("corp-a"),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_PROFILE_INVALID",
  );
});

test("forces JSON and appends confirmation after approval", () => {
  assert.deepEqual(
    buildDwsCommandArguments(["oa", "approval", "revoke", "--instance-id", "instance-a"], {
      profile: "corp-a:user-b",
      confirmed: true,
    }),
    [
      "--profile",
      "corp-a:user-b",
      "oa",
      "approval",
      "revoke",
      "--instance-id",
      "instance-a",
      "--format",
      "json",
      "--yes",
    ],
  );
});

test("only passes DWS runtime environment variables to the child process", () => {
  assert.deepEqual(
    buildDwsEnvironment({
      PATH: "/usr/bin",
      DWS_CONFIG_DIR: "/tmp/dws-config",
      LANG: "zh_CN.UTF-8",
      OPENCLAW_GATEWAY_TOKEN: "must-not-reach-dws",
      DWS_ACCESS_TOKEN: "must-not-reach-dws",
      AWS_SECRET_ACCESS_KEY: "must-not-reach-dws",
    }),
    {
      PATH: "/usr/bin",
      DWS_CONFIG_DIR: "/tmp/dws-config",
      LANG: "zh_CN.UTF-8",
    },
  );
});
