import assert from "node:assert/strict";
import test from "node:test";
import { auditDingTalkContracts } from "./contract-audit.js";
import { DingTalkRuntimeError } from "./errors.js";
import type { DwsSchemaRegistry } from "./schema-contract.js";
import type { DingTalkToolSpec } from "./types.js";

const specs = [
  { name: "tool_b", canonicalPath: "b.read" },
  { name: "tool_a", canonicalPath: "a.read" },
] as DingTalkToolSpec[];

test("全量契约审计返回稳定的通过和失败计数", async () => {
  const schemas = {
    async verify(spec: DingTalkToolSpec) {
      if (spec.name === "tool_a") {
        throw new DingTalkRuntimeError("DWS_SCHEMA_DRIFT", "drift", { fields: ["risk"] });
      }
      return { schema: {}, digest: "digest" };
    },
  } as unknown as DwsSchemaRegistry;

  const result = await auditDingTalkContracts(schemas, specs, 2);
  assert.equal(result.checkedCount, 2);
  assert.equal(result.passedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.failures, [{
    toolName: "tool_a",
    canonicalPath: "a.read",
    error: {
      code: "DWS_SCHEMA_DRIFT",
      message: "DWS schema differs from the reviewed contract",
      details: { fields: ["risk"] },
    },
  }]);
});
