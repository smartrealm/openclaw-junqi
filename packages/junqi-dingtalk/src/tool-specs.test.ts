import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DINGTALK_TOOL_SPECS,
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
} from "./tool-specs.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("插件清单工具与运行时注册规格完全一致", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, "openclaw.plugin.json"), "utf8"),
  ) as { contracts?: { tools?: unknown } };
  const expectedToolNames = [
    RUNTIME_STATUS_TOOL_NAME,
    TOOL_SCHEMA_TOOL_NAME,
    ...DINGTALK_TOOL_SPECS.map((spec) => spec.name),
  ];

  assert.deepEqual(manifest.contracts?.tools, expectedToolNames);
});
