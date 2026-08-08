import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "openclaw.plugin.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

assert.equal(manifest.id, "junqi-dingtalk");
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.activation?.onStartup, true);
assert.equal(manifest.configSchema?.additionalProperties, false);
assert.equal(manifest.contracts?.tools?.length, 30);
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
