import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("agent workspace delegates every file format to the shared FileViewer", async () => {
  const source = await read("./WorkspacePanel.tsx");

  assert.match(source, /import \{[\s\S]*FileViewer,[\s\S]*type FileViewerHandle,[\s\S]*\} from "@\/components\/FileExplorer\/FileViewer"/);
  assert.match(source, /<FileViewer[\s\S]*projectPath=\{root\}[\s\S]*themeVariant=\{themeVariant\}/);
  assert.doesNotMatch(source, /CodeMirror|FileReadOnlyPreview|readFilePreview|writeFileText/);
});

test("agent workspace keeps the explorer visible beside shared tabbed previews", async () => {
  const source = await read("./WorkspacePanel.tsx");

  assert.match(source, /<aside className=/);
  assert.match(source, /<WorkspaceFileTree[\s\S]*activePath=\{files\.activePath\}/);
  assert.match(source, /<section className="flex min-w-0 flex-1 flex-col/);
  assert.match(source, /tabs=\{files\.tabs\}/);
  assert.match(source, /activeFilePath=\{files\.activePath\}/);
  assert.match(source, /key=\{root\}/);
  assert.match(source, /refreshVersion=\{treeKey\}/);
  assert.match(source, /onPromoteFile=\{promoteFile\}/);
});

test("workspace mutations flush and synchronize all affected preview tabs", async () => {
  const source = await read("./WorkspacePanel.tsx");
  const treeSource = await read("./WorkspaceFileTree.tsx");

  assert.match(treeSource, /<FileExplorerContextMenu/);
  assert.match(treeSource, /useFileExplorerContextActions/);
  assert.match(source, /fileViewerRef\.current\?\.flushPath\(path, isDirectory\)/);
  assert.match(source, /dispatchFiles\(\{ type: "rebase"/);
  assert.match(source, /dispatchFiles\(\{ type: "remove"/);
});

test("agent polling with an unchanged workspace cannot reset open tabs", async () => {
  const source = await read("./WorkspacePanel.tsx");

  assert.match(source, /const agentWorkspace = useMemo/);
  assert.match(source, /rootRef\.current === target\.root/);
  assert.match(source, /dispatchFiles\(\{ type: "reset" \}\)/);
  assert.doesNotMatch(source, /\[agentId, agents, rootOverride\]/);
});

test("closing or switching a workspace flushes shared pending edits first", async () => {
  const source = await read("./WorkspacePanel.tsx");

  assert.ok((source.match(/fileViewerRef\.current\?\.flushPath\(rootRef\.current, true\)/g) ?? []).length >= 2);
  assert.match(source, /const requestClose = useCallback\(async/);
  assert.match(source, /onClick=\{\(\) => void requestClose\(\)\}/);
  assert.match(source, /workspace\.saveFailed/);
});

test("a failed workspace switch stays retryable without resetting open tabs", async () => {
  const source = await read("./WorkspacePanel.tsx");
  const failureStart = source.indexOf("catch (error)", source.indexOf("const switchRoot"));
  const commitStart = source.indexOf("rootRef.current = target.root", failureStart);
  const failureBranch = source.slice(failureStart, commitStart);

  assert.match(failureBranch, /setPendingRootSwitch\(target\)/);
  assert.doesNotMatch(failureBranch, /dispatchFiles\(\{ type: "reset" \}\)/);
  assert.match(source, /onClick=\{\(\) => void switchRoot\(pendingRootSwitch\)\}/);
  assert.match(source, /workspace\.switchPending/);
});

test("workspace file opening distinguishes preview, promotion, and linked-file navigation", async () => {
  const source = await read("./WorkspacePanel.tsx");
  const treeSource = await read("./WorkspaceFileTree.tsx");

  assert.match(source, /preview: options\?\.preview \?\? true/);
  assert.match(source, /dispatchFiles\(\{ type: "promote", path: entry\.path \}\)/);
  assert.match(source, /onOpenFile=\{openLinkedFile\}/);
  assert.match(treeSource, /onOpenFile\(entry, \{ preview: true \}\)/);
  assert.match(treeSource, /onDoubleClick=\{\(\) => \{/);
  assert.match(treeSource, /onOpenFile: \(path, name\) => onOpenFile\([\s\S]*\{ preview: false \}\)/);
});

test("workspace refresh keeps stale rows visible and ignores late directory responses", async () => {
  const treeSource = await read("./WorkspaceFileTree.tsx");

  assert.match(treeSource, /const loadRequestRef = useRef\(0\)/);
  assert.match(treeSource, /if \(requestId !== loadRequestRef\.current\) return/);
  assert.match(treeSource, /setEntries\(\(current\) => current \?\? \[\]\)/);
});
