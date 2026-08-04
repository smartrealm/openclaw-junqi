import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("agent hub only blocks the first load and keeps view shells mounted", async () => {
  const source = await read("./index.tsx");

  assert.match(source, /hasHydratedAgentData/);
  assert.match(source, /const initialLoading = loading && !hasHydratedAgentData/);
  assert.match(source, /\{initialLoading \?/);
  assert.match(source, /<div hidden=\{viewMode !== 'tree'\}/);
  assert.match(source, /<div hidden=\{viewMode !== 'activity'\}/);
  assert.match(source, /<div hidden=\{viewMode !== 'grid'\}/);
  assert.doesNotMatch(source, /\{viewMode === 'tree' &&/);
  assert.doesNotMatch(source, /\{viewMode === 'activity' &&/);
  assert.doesNotMatch(source, /\{viewMode === 'grid' &&/);
});
