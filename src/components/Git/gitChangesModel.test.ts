import assert from "node:assert/strict";
import test from "node:test";
import { filterGitChanges } from "./gitChangesModel";
import type { GitFileChange } from "./types";

const changes: GitFileChange[] = [
  { path: "src/App.tsx", status: "M", staged: false },
  { path: "src/App.tsx", status: "M", staged: true },
  { path: "docs/README.md", status: "?", staged: false },
];

test("empty Git change filters preserve every status record", () => {
  assert.deepEqual(filterGitChanges(changes, "  "), changes);
});

test("Git change filters match the complete path without case sensitivity", () => {
  assert.deepEqual(filterGitChanges(changes, "APP.TSX"), changes.slice(0, 2));
  assert.deepEqual(filterGitChanges(changes, "docs/"), [changes[2]]);
});

test("Git change filters return an empty list when no path matches", () => {
  assert.deepEqual(filterGitChanges(changes, "missing"), []);
});
