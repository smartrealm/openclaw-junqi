import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_FILE_VIEWER_TABS,
  reduceFileViewerTabs,
  type FileViewerTabsState,
} from "./fileViewerTabsState";

const tabs: FileViewerTabsState = {
  tabs: [
    { path: "/repo/A.md", name: "A.md" },
    { path: "/repo/docs/B.md", name: "B.md" },
    { path: "/repo/docs/C.md", name: "C.md" },
  ],
  activePath: "/repo/docs/B.md",
};

test("file viewer tab state opens each path once and selects it", () => {
  const opened = reduceFileViewerTabs(EMPTY_FILE_VIEWER_TABS, {
    type: "open",
    tab: { path: "/repo/SOUL.md", name: "SOUL.md" },
  });
  const reopened = reduceFileViewerTabs(opened, {
    type: "open",
    tab: { path: "/repo/SOUL.md", name: "SOUL.md" },
  });

  assert.deepEqual(reopened, opened);
  assert.equal(reopened.activePath, "/repo/SOUL.md");
});

test("file viewer tab state keeps a valid neighbor active after close and delete", () => {
  const closed = reduceFileViewerTabs(tabs, { type: "close", path: "/repo/docs/B.md" });
  assert.deepEqual(closed.tabs.map((tab) => tab.name), ["A.md", "C.md"]);
  assert.equal(closed.activePath, "/repo/docs/C.md");

  const removed = reduceFileViewerTabs(tabs, {
    type: "remove",
    path: "/repo/docs",
    isDirectory: true,
  });
  assert.deepEqual(removed.tabs.map((tab) => tab.name), ["A.md"]);
  assert.equal(removed.activePath, "/repo/A.md");
});

test("file viewer tab state rebases active Markdown tabs with renamed directories", () => {
  const rebased = reduceFileViewerTabs(tabs, {
    type: "rebase",
    oldPath: "/repo/docs",
    newPath: "/repo/manual",
    isDirectory: true,
  });

  assert.equal(rebased.activePath, "/repo/manual/B.md");
  assert.deepEqual(rebased.tabs.map((tab) => tab.path), [
    "/repo/A.md",
    "/repo/manual/B.md",
    "/repo/manual/C.md",
  ]);
});

test("file viewer tab state applies left, right, other, and all close commands", () => {
  assert.deepEqual(
    reduceFileViewerTabs(tabs, { type: "close-left", path: "/repo/docs/B.md" }).tabs.map((tab) => tab.name),
    ["B.md", "C.md"],
  );
  assert.deepEqual(
    reduceFileViewerTabs(tabs, { type: "close-right", path: "/repo/docs/B.md" }).tabs.map((tab) => tab.name),
    ["A.md", "B.md"],
  );
  assert.deepEqual(
    reduceFileViewerTabs(tabs, { type: "close-others", path: "/repo/docs/B.md" }),
    { tabs: [tabs.tabs[1]], activePath: "/repo/docs/B.md" },
  );
  assert.deepEqual(reduceFileViewerTabs(tabs, { type: "close-all" }), EMPTY_FILE_VIEWER_TABS);
});
