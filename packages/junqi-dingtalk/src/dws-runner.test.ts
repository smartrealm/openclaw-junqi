import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDwsCommandArguments,
  buildDwsEnvironment,
  DwsRunner,
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

test("retries executable resolution after an earlier lookup failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-dws-runner-"));
  const executable = path.join(directory, process.platform === "win32" ? "dws.exe" : "dws");
  const runner = new DwsRunner({
    dwsPath: executable,
    timeoutMs: 30_000,
    maxOutputBytes: 2_097_152,
  });
  try {
    await assert.rejects(runner.resolveExecutable(), (error) => (
      error instanceof DingTalkRuntimeError
      && error.code === "DWS_RUNTIME_NOT_EXECUTABLE"
    ));
    await writeFile(executable, "");
    await chmod(executable, 0o700);
    assert.equal(await runner.resolveExecutable(), await realpath(executable));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runs a configured npm JavaScript entry through the current Node runtime", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "junqi-dws-script-"));
  const entry = path.join(directory, "dws.js");
  await writeFile(entry, "process.stdout.write(JSON.stringify({success:true,body:{args:process.argv.slice(2)}}));");
  const runner = new DwsRunner({
    dwsPath: entry,
    timeoutMs: 30_000,
    maxOutputBytes: 2_097_152,
  });
  try {
    const result = await runner.run(["version"]);
    assert.deepEqual(result.data, {
      success: true,
      body: { args: ["version", "--format", "json"] },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
