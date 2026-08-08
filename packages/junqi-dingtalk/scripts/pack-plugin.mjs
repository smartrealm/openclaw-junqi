import assert from "node:assert/strict";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNpmCommand } from "../../../scripts/npm-command.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

for (const name of await readdir(dist)) {
  if (name.endsWith(".tgz")) await rm(path.join(dist, name));
}

const output = runNpmCommand(["pack", "--ignore-scripts", "--json", "--pack-destination", dist], {
  cwd: root,
  encoding: "utf8",
});
const packed = JSON.parse(output);
assert.ok(Array.isArray(packed) && packed.length === 1);
const files = packed[0].files.map((entry) => entry.path);
for (const file of files) {
  assert.ok(!file.endsWith(".tgz"));
  assert.ok(!file.includes("node_modules/"));
  assert.ok(!/(^|\/)src\//.test(file));
  assert.ok(!/\.test\.[cm]?[jt]sx?$/.test(file));
}
for (const required of ["package.json", "openclaw.plugin.json", "README.md", "dist/index.js", "dist/index.d.ts"]) {
  assert.ok(files.includes(required));
}
console.log(`Packed ${packed[0].filename} with ${files.length} verified files`);
