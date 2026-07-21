import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "openclaw.plugin.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const versionModuleUrl = `${pathToFileURL(path.join(root, "dist", "version.js")).href}?validate=${Date.now()}`;
const { PLUGIN_VERSION: runtimePluginVersion } = await import(versionModuleUrl);

assert.equal(manifest.id, "junqi-collab");
assert.equal(manifest.version, packageJson.version);
assert.equal(runtimePluginVersion, packageJson.version);
assert.equal(manifest.activation?.onStartup, true);
assert.equal(manifest.configSchema?.additionalProperties, false);
assert.ok(manifest.configSchema?.properties?.coordinatorAgentId);
assert.ok(manifest.configSchema?.properties?.allowedAgentIds);
assert.deepEqual(packageJson.openclaw?.extensions, ["./dist/index.js"]);
assert.equal(packageJson.main, "./dist/index.js");
assert.equal(packageJson.types, "./dist/index.d.ts");
assert.deepEqual(packageJson.exports, {
  ".": {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  },
});
assert.equal(packageJson.engines?.node, ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0");
// OpenClaw's plugin API parser requires a fully-qualified upper comparator.
const supportedOpenClawRange = ">=2026.7.1 <2027.0.0";
assert.equal(packageJson.peerDependencies?.openclaw, supportedOpenClawRange);
assert.equal(packageJson.openclaw?.compat?.pluginApi, supportedOpenClawRange);
assert.equal(packageJson.openclaw?.compat?.minGatewayVersion, "2026.7.1");
assert.deepEqual(packageJson.dependencies ?? {}, {});
assert.deepEqual(packageJson.optionalDependencies ?? {}, {});

for (const file of [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/openclaw-adapter.js",
  "dist/service.js",
  "dist/rpc.js",
  "dist/schema.js",
  "dist/sdk-types.js",
  "dist/sdk-types.d.ts",
  "dist/version.js",
]) {
  await access(path.join(root, file));
}

const distEntries = await readdir(path.join(root, "dist"), { recursive: true });
assert.equal(distEntries.some((file) => file.endsWith(".tgz")), false, "dist must not contain a nested archive");
const serviceSource = await readFile(path.join(root, "dist", "service.js"), "utf8");
assert.equal(serviceSource.includes("requeueUnknownDispatchAttempt"), false);
assert.equal(serviceSource.includes("reconcileUnknownDispatchAttempt"), true);
assert.equal(serviceSource.includes("reconcileKnownTaskAttempt"), true);
assert.equal(serviceSource.includes("requeueUnknownDeliveryAttempt"), true);

console.log("junqi-collab package contract: ok");
