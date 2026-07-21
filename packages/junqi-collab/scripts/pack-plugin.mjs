import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

for (const name of await readdir(dist)) {
  if (name.endsWith(".tgz")) await rm(path.join(dist, name));
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const output = execFileSync(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", dist], {
  cwd: root,
  encoding: "utf8",
});
const packed = JSON.parse(output);
assert.ok(Array.isArray(packed) && packed.length === 1, "npm pack must produce exactly one archive");
const files = packed[0].files.map((entry) => entry.path);
for (const file of files) {
  assert.ok(!file.endsWith(".tgz"), `Nested archive is forbidden: ${file}`);
  assert.ok(!file.includes("node_modules/"), `node_modules entry is forbidden: ${file}`);
  assert.ok(!/(^|\/)src\//.test(file), `Source entry is forbidden: ${file}`);
  assert.ok(!/\.test\.[cm]?[jt]sx?$/.test(file), `Test entry is forbidden: ${file}`);
}
for (const required of ["package.json", "openclaw.plugin.json", "README.md", "dist/index.js", "dist/index.d.ts", "dist/sdk-types.d.ts"]) {
  assert.ok(files.includes(required), `Packed archive is missing ${required}`);
}
console.log(`Packed ${packed[0].filename} with ${files.length} verified files`);
