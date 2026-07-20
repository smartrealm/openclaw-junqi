import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  dispatchFileTreePointerDrag,
  FILE_TREE_POINTER_DRAG_EVENT,
  type FileTreePointerDragDetail,
} from "./pathDrag";

test("file tree pointer drag publishes exact paths and drop coordinates", () => {
  let received: FileTreePointerDragDetail | null = null;
  const target = new EventTarget();
  const listener = (event: Event) => {
    received = (event as CustomEvent<FileTreePointerDragDetail>).detail;
  };
  target.addEventListener(FILE_TREE_POINTER_DRAG_EVENT, listener);
  dispatchFileTreePointerDrag({ type: "drop", paths: ["/tmp/a b.txt"], x: 120, y: 80 }, target);
  target.removeEventListener(FILE_TREE_POINTER_DRAG_EVENT, listener);

  assert.deepEqual(received, { type: "drop", paths: ["/tmp/a b.txt"], x: 120, y: 80 });
});

test("file tree directories toggle without opening in the file viewer", () => {
  const source = readFileSync(new URL("./TreeItem.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(isDir\) \{\s*onToggle\(node\.path\);\s*\} else \{\s*onSelect\(node\);/);
});
