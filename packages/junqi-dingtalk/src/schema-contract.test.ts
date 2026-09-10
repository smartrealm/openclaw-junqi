import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError } from "./errors.js";
import {
  buildSchemaValidatedArguments,
  DwsSchemaRegistry,
  validateLeafContract,
} from "./schema-contract.js";
import { DINGTALK_TOOL_SPECS } from "./tool-specs.js";

const searchUsers = DINGTALK_TOOL_SPECS.find((spec) => spec.name.endsWith("search_users"));
if (!searchUsers) throw new Error("search users tool spec is missing");

test("validates a matching DWS leaf contract", () => {
  const verified = validateLeafContract(searchUsers, {
    availability: "available",
    canonical_path: searchUsers.canonicalPath,
    cli_path: searchUsers.cliPath,
    effect: searchUsers.effect,
    risk: searchUsers.risk,
    confirmation: searchUsers.confirmation,
    idempotency: searchUsers.idempotency,
    parameters: {
      query: { type: "string", required: true },
    },
    result: {
      outcomes: ["success"],
      data_schema: { type: "object", additionalProperties: true },
    },
  });
  assert.equal(verified.digest.length, 64);
  assert.deepEqual(verified.schema.result?.outcomes, ["success"]);
  assert.deepEqual(buildSchemaValidatedArguments(verified.schema, { query: "研发" }), [
    "--query",
    "研发",
  ]);
});

test("fails closed for an invalid DWS result contract", () => {
  assert.throws(
    () => validateLeafContract(searchUsers, {
      availability: "available",
      canonical_path: searchUsers.canonicalPath,
      cli_path: searchUsers.cliPath,
      effect: searchUsers.effect,
      risk: searchUsers.risk,
      confirmation: searchUsers.confirmation,
      idempotency: searchUsers.idempotency,
      parameters: {},
      result: { outcomes: ["success"], data_schema: "object" },
    }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_SCHEMA_INVALID",
  );
});

test("fails closed when DWS effect drifts", () => {
  assert.throws(
    () => validateLeafContract(searchUsers, {
      availability: "available",
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

test("fails closed when DWS marks a reviewed tool unavailable", () => {
  assert.throws(
    () => validateLeafContract(searchUsers, {
      availability: "unavailable",
      canonical_path: searchUsers.canonicalPath,
      cli_path: searchUsers.cliPath,
      effect: searchUsers.effect,
      risk: searchUsers.risk,
      confirmation: searchUsers.confirmation,
      idempotency: searchUsers.idempotency,
      parameters: {},
    }),
    (error) => error instanceof DingTalkRuntimeError
      && error.code === "DWS_SCHEMA_DRIFT"
      && error.details?.fields?.includes("availability"),
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
  assert.throws(
    () => buildSchemaValidatedArguments(schema, { query: { text: "研发" } }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_TYPE",
  );
});

test("将 DWS 字符串列表按 CLI CSV 契约传递", () => {
  const schema = {
    canonical_path: "chat.shortcut_messages_mget",
    cli_path: "chat +messages-mget",
    effect: "read",
    risk: "low",
    confirmation: "not_required",
    idempotency: "idempotent",
    parameters: {
      "msg-ids": { type: "array", required: true },
      "no-reactions": { type: "boolean" },
    },
  } as const;

  assert.deepEqual(buildSchemaValidatedArguments(schema, {
    "msg-ids": ["msg-1", "msg,2", 'msg"3'],
    "no-reactions": true,
  }), [
    "--msg-ids",
    'msg-1,"msg,2","msg""3"',
    "--no-reactions",
  ]);
  assert.throws(
    () => buildSchemaValidatedArguments(schema, { "msg-ids": [] }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_REQUIRED",
  );
  assert.throws(
    () => buildSchemaValidatedArguments(schema, { "msg-ids": ["msg-1", 2] }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_TYPE",
  );
});

test("执行前验证 DWS 枚举、格式和扩展参数类型", () => {
  const schema = {
    canonical_path: "test.semantic_parameters",
    cli_path: "test semantic-parameters",
    effect: "read",
    risk: "low",
    confirmation: "not_required",
    idempotency: "idempotent",
    parameters: {
      mode: { type: "string", property: "rpc.mode", enum: ["brief", "full"] },
      artifacts: { type: "array", enum: ["summary", "todos"] },
      statuses: { type: "string", interface_type: "array", enum: ["open", "closed"] },
      date: { type: "string", format: "date" },
      timestamp: { type: "string", format: "date-time" },
      payload: { type: "string", format: "json" },
      ratio: { type: "number" },
      options: { type: "object" },
    },
  } as const;

  assert.deepEqual(buildSchemaValidatedArguments(schema, {
    mode: "brief",
    artifacts: ["summary", "todos"],
    statuses: "open, closed",
    date: "2028-02-29",
    timestamp: "2026-09-09T15:30:00+08:00",
    payload: "{\"safe\":true}",
    ratio: 0.5,
    options: { limit: 1 },
  }), [
    "--mode", "brief",
    "--artifacts", "summary,todos",
    "--statuses", "open, closed",
    "--date", "2028-02-29",
    "--timestamp", "2026-09-09T15:30:00+08:00",
    "--payload", "{\"safe\":true}",
    "--ratio", "0.5",
    "--options", "{\"limit\":1}",
  ]);
  assert.throws(
    () => buildSchemaValidatedArguments(schema, { "rpc.mode": "brief" }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_UNKNOWN",
  );

  for (const [argumentsValue, code] of [
    [{ mode: "unknown" }, "DWS_ARGUMENT_ENUM"],
    [{ artifacts: ["summary", "raw"] }, "DWS_ARGUMENT_ENUM"],
    [{ statuses: "open, draft" }, "DWS_ARGUMENT_ENUM"],
    [{ date: "2026-02-29" }, "DWS_ARGUMENT_FORMAT"],
    [{ timestamp: "2026-09-09 15:30:00" }, "DWS_ARGUMENT_FORMAT"],
    [{ payload: "not-json" }, "DWS_ARGUMENT_FORMAT"],
    [{ ratio: Number.POSITIVE_INFINITY }, "DWS_ARGUMENT_TYPE"],
    [{ options: [] }, "DWS_ARGUMENT_TYPE"],
  ] as const) {
    assert.throws(
      () => buildSchemaValidatedArguments(schema, argumentsValue),
      (error) => error instanceof DingTalkRuntimeError && error.code === code,
    );
  }
});

test("执行前验证 DWS 三类跨参数约束", () => {
  const schema = {
    canonical_path: "test.constraints",
    cli_path: "test constraints",
    effect: "write",
    risk: "high",
    confirmation: "user_required",
    idempotency: "unknown",
    parameters: {
      request: { type: "string" },
      code: { type: "string" },
      department: { type: "string" },
      values: { type: "string" },
    },
    constraints: {
      mutually_exclusive: [["request", "code"]],
      require_one_of: [["request", "code"]],
      require_together: [["code", "department", "values"]],
    },
  } as const;

  assert.deepEqual(buildSchemaValidatedArguments(schema, { request: "request-json" }), [
    "--request", "request-json",
  ]);
  assert.deepEqual(buildSchemaValidatedArguments(schema, {
    code: "process-code",
    department: "dept-1",
    values: "{}",
  }), [
    "--code", "process-code",
    "--department", "dept-1",
    "--values", "{}",
  ]);

  for (const argumentsValue of [
    {},
    { request: "request-json", code: "process-code" },
    { code: "process-code", department: "dept-1" },
  ]) {
    assert.throws(
      () => buildSchemaValidatedArguments(schema, argumentsValue),
      (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_CONSTRAINT",
    );
  }
});

test("将 cli_required 和格式分支纳入动态契约", () => {
  const base = {
    availability: "available",
    canonical_path: searchUsers.canonicalPath,
    cli_path: searchUsers.cliPath,
    effect: searchUsers.effect,
    risk: searchUsers.risk,
    confirmation: searchUsers.confirmation,
    idempotency: searchUsers.idempotency,
    parameters: {
      query: {
        type: "string",
        required: false,
        cli_required: true,
        anyOf: [{ format: "date" }, { format: "date-time" }],
      },
    },
  } as const;
  const first = validateLeafContract(searchUsers, base);
  const second = validateLeafContract(searchUsers, {
    ...base,
    constraints: { require_one_of: [["query"]] },
  });

  assert.notEqual(first.digest, second.digest);
  assert.throws(
    () => buildSchemaValidatedArguments(first.schema, {}),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_REQUIRED",
  );
  assert.deepEqual(buildSchemaValidatedArguments(first.schema, { query: "2026-09-09" }), [
    "--query", "2026-09-09",
  ]);
  assert.deepEqual(buildSchemaValidatedArguments(first.schema, {
    query: "2026-09-09T15:30:00Z",
  }), ["--query", "2026-09-09T15:30:00Z"]);
  assert.throws(
    () => buildSchemaValidatedArguments(first.schema, { query: "09/09/2026" }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_FORMAT",
  );
});

test("拒绝畸形格式分支和跨参数约束", () => {
  const leaf = {
    availability: "available",
    canonical_path: searchUsers.canonicalPath,
    cli_path: searchUsers.cliPath,
    effect: searchUsers.effect,
    risk: searchUsers.risk,
    confirmation: searchUsers.confirmation,
    idempotency: searchUsers.idempotency,
  };
  assert.throws(
    () => validateLeafContract(searchUsers, {
      ...leaf,
      parameters: {
        query: {
          type: "string",
          format: "date",
          anyOf: [{ format: "date" }, { format: "date-time" }],
        },
      },
    }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_SCHEMA_INVALID",
  );
  assert.throws(
    () => validateLeafContract(searchUsers, {
      ...leaf,
      parameters: { query: { type: "string" } },
      constraints: { require_one_of: [["missing"]] },
    }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_SCHEMA_INVALID",
  );
});

test("将 DWS 隐藏兼容参数约束投影到可调用参数面", () => {
  const verified = validateLeafContract(searchUsers, {
    availability: "available",
    canonical_path: searchUsers.canonicalPath,
    cli_path: searchUsers.cliPath,
    effect: searchUsers.effect,
    risk: searchUsers.risk,
    confirmation: searchUsers.confirmation,
    idempotency: searchUsers.idempotency,
    parameters: { query: { type: "string" } },
    constraints: {
      mutually_exclusive: [["query", "legacy-query"]],
      require_one_of: [["query", "legacy-query"]],
    },
  });

  assert.deepEqual(verified.schema.constraints, {
    mutually_exclusive: [],
    require_one_of: [["query"]],
  });
  assert.throws(
    () => buildSchemaValidatedArguments(verified.schema, {}),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_CONSTRAINT",
  );
  assert.deepEqual(buildSchemaValidatedArguments(verified.schema, { query: "研发" }), [
    "--query", "研发",
  ]);
});

test("Schema registry 读取完整叶子契约以保留接口类型和格式分支", async () => {
  const commands: string[][] = [];
  const registry = new DwsSchemaRegistry({
    async run(command: readonly string[]) {
      commands.push([...command]);
      return {
        data: {
          availability: "available",
          canonical_path: searchUsers.canonicalPath,
          cli_path: searchUsers.cliPath,
          effect: searchUsers.effect,
          risk: searchUsers.risk,
          confirmation: searchUsers.confirmation,
          idempotency: searchUsers.idempotency,
          parameters: {
            query: {
              type: "string",
              required: true,
              interface_type: "array",
              anyOf: [{ format: "date" }, { format: "date-time" }],
            },
          },
        },
      };
    },
  } as never);

  const verified = await registry.verify(searchUsers);
  assert.deepEqual(commands, [["schema", searchUsers.canonicalPath]]);
  assert.equal(verified.schema.parameters?.query?.interface_type, "array");
  assert.deepEqual(verified.schema.parameters?.query?.anyOf, [
    { format: "date" },
    { format: "date-time" },
  ]);
});
