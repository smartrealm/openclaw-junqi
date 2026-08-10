import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError, serializeRuntimeError } from "./errors.js";

test("unknown runtime failures never expose their original message", () => {
  const serialized = serializeRuntimeError(
    new Error("spawn /private/secret/dws failed with token=secret-value"),
  );
  assert.deepEqual(serialized, {
    code: "DWS_RUNTIME_FAILURE",
    message: "DWS runtime operation failed",
  });
});

test("known runtime failures expose only stable messages and allowlisted details", () => {
  const serialized = serializeRuntimeError(new DingTalkRuntimeError(
    "DWS_COMMAND_FAILED",
    "remote response included token=secret-value",
    {
      exitCode: 2,
      signal: "SIGTERM",
      recoveryEventId: "recovery-1",
      cause: "/private/secret/dws",
      token: "secret-value",
    },
  ));
  assert.deepEqual(serialized, {
    code: "DWS_COMMAND_FAILED",
    message: "DWS command failed",
    details: {
      exitCode: 2,
      signal: "SIGTERM",
      recoveryEventId: "recovery-1",
    },
  });
});

test("unknown DingTalk runtime error codes fail closed", () => {
  const serialized = serializeRuntimeError(
    new DingTalkRuntimeError("DWS_UNREVIEWED_FAILURE", "token=secret-value"),
  );
  assert.deepEqual(serialized, {
    code: "DWS_RUNTIME_FAILURE",
    message: "DWS runtime operation failed",
  });
});
