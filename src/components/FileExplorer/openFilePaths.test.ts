import assert from "node:assert/strict";
import test from "node:test";
import {
  pathIsTargetOrDescendant,
  rebaseOpenFilePath,
  rebaseOpenFileTabs,
  removeOpenFileTabs,
} from "./openFilePaths";

test("renaming a directory rebases every open descendant tab", () => {
  const tabs = [
    { path: "/repo/docs/guide.md", name: "guide.md" },
    { path: "/repo/docs/nested/a.ts", name: "a.ts" },
    { path: "/repo/docs-old/keep.md", name: "keep.md" },
  ];

  assert.deepEqual(rebaseOpenFileTabs(tabs, "/repo/docs", "/repo/manual", true), [
    { path: "/repo/manual/guide.md", name: "guide.md" },
    { path: "/repo/manual/nested/a.ts", name: "a.ts" },
    tabs[2],
  ]);
});
test("renaming a file updates its tab name and supports Windows paths", () => {
  assert.deepEqual(
    rebaseOpenFileTabs(
      [{ path: "C:\\repo\\README.md", name: "README.md" }],
      "C:\\repo\\README.md",
      "C:\\repo\\GUIDE.md",
      false,
    ),
    [{ path: "C:\\repo\\GUIDE.md", name: "GUIDE.md" }],
  );
  assert.equal(
    rebaseOpenFilePath("C:\\repo\\docs\\a.md", "C:\\repo\\docs", "C:\\repo\\manual", true),
    "C:\\repo\\manual\\a.md",
  );
});

test("deleting a directory closes only that directory's open tabs", () => {
  const tabs = [
    { path: "/repo/docs/a.md", name: "a.md" },
    { path: "/repo/docs-old/b.md", name: "b.md" },
  ];

  assert.deepEqual(removeOpenFileTabs(tabs, "/repo/docs", true), [tabs[1]]);
  assert.equal(pathIsTargetOrDescendant("/repo/docs/a.md", "/repo/docs", true), true);
  assert.equal(pathIsTargetOrDescendant("/repo/docs/a.md", "/repo/docs", false), false);
});
