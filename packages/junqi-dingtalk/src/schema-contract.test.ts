import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError } from "./errors.js";
import { buildSchemaValidatedArguments, validateLeafContract } from "./schema-contract.js";
import { DINGTALK_TOOL_SPECS } from "./tool-specs.js";

const searchUsers = DINGTALK_TOOL_SPECS.find((spec) => spec.name.endsWith("search_users"));
if (!searchUsers) throw new Error("search users tool spec is missing");

test("validates a matching DWS leaf contract", () => {
  const verified = validateLeafContract(searchUsers, {
    canonical_path: searchUsers.canonicalPath,
    cli_path: searchUsers.cliPath,
    effect: searchUsers.effect,
    risk: searchUsers.risk,
    confirmation: searchUsers.confirmation,
    idempotency: searchUsers.idempotency,
    parameters: {
      query: { type: "string", required: true },
    },
  });
  assert.equal(verified.digest.length, 64);
  assert.deepEqual(buildSchemaValidatedArguments(verified.schema, { query: "研发" }), [
    "--query",
    "研发",
  ]);
});

test("fails closed when DWS effect drifts", () => {
  assert.throws(
    () => validateLeafContract(searchUsers, {
      canonical_path: searchUsers.canonicalPath,
      cli_path: searchUsers.cliPath,
      effect: "write",
      risk: searchUsers.risk,
      confirmation: searchUsers.confirmation,
      idempotency: searchUsers.idempotency,
      parameters: {},
    }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_SCHEMA_DRIFT",
  );
});

test("rejects unknown and missing DWS arguments", () => {
  const schema = {
    canonical_path: searchUsers.canonicalPath,
    cli_path: searchUsers.cliPath,
    effect: searchUsers.effect,
    risk: searchUsers.risk,
    confirmation: searchUsers.confirmation,
    idempotency: searchUsers.idempotency,
    parameters: {
      query: { type: "string", required: true },
    },
  } as const;
  assert.throws(
    () => buildSchemaValidatedArguments(schema, {}),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_REQUIRED",
  );
  assert.throws(
    () => buildSchemaValidatedArguments(schema, { query: "研发", extra: true }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_UNKNOWN",
  );
});
