import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "openclaw.plugin.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const toolSpecsModuleUrl = `${pathToFileURL(path.join(root, "dist", "tool-specs.js")).href}?validate=${Date.now()}`;
const {
  DINGTALK_TOOL_SPECS,
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
} = await import(toolSpecsModuleUrl);
const registeredToolNames = [
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
  ...DINGTALK_TOOL_SPECS.map((spec) => spec.name),
];

assert.equal(manifest.id, "junqi-dingtalk");
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.activation?.onStartup, true);
assert.equal(manifest.configSchema?.additionalProperties, false);
assert.deepEqual(manifest.contracts?.tools, registeredToolNames);
assert.deepEqual(manifest.configSchema?.properties?.allowedAgentIds?.default, []);
assert.deepEqual(packageJson.openclaw?.extensions, ["./dist/index.js"]);
assert.equal(packageJson.dependencies?.typebox, "1.3.3");
assert.equal(packageJson.peerDependencies?.openclaw, ">=2026.7.1");

for (const file of ["dist/index.js", "dist/index.d.ts", "dist/dws-runner.js", "dist/schema-contract.js", "dist/tool-specs.js"]) {
  await access(path.join(root, file));
}

const distEntries = await readdir(path.join(root, "dist"), { recursive: true });
assert.equal(distEntries.some((file) => file.endsWith(".tgz")), false);

console.log("junqi-dingtalk package contract: ok");
