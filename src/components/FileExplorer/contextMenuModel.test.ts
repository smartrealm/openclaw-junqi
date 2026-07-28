import assert from "node:assert/strict";
import test from "node:test";
import { getFileExplorerMenuSections } from "./contextMenuModel";

test("project root context menu only exposes root-safe actions", () => {
  assert.deepEqual(getFileExplorerMenuSections({ isDir: true, isRoot: true }), [
    ["new-file", "new-folder"],
    ["copy-path", "copy-at-path", "reveal"],
  ]);
});

test("directory context menu uses the complete shared mutation matrix", () => {
  assert.deepEqual(getFileExplorerMenuSections({ isDir: true, isRoot: false }), [
    ["new-file", "new-folder", "rename"],
    ["copy-path", "copy-at-path", "reveal"],
    ["delete"],
  ]);
});

test("file context menu opens files and creates siblings", () => {
  assert.deepEqual(getFileExplorerMenuSections({ isDir: false, isRoot: false }), [
    ["new-file", "new-folder", "open", "rename"],
    ["copy-path", "copy-at-path", "reveal"],
    ["delete"],
  ]);
});
