import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewer = readFileSync(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const previewPane = readFileSync(new URL("./FilePreviewPane.tsx", import.meta.url), "utf8");
const documentHook = readFileSync(new URL("./useWorkspaceFileDocument.ts", import.meta.url), "utf8");
const capabilities = readFileSync(new URL("./fileViewerCapabilities.ts", import.meta.url), "utf8");
const explorer = readFileSync(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const fileManager = readFileSync(new URL("../../pages/FileManager.tsx", import.meta.url), "utf8");

test("BUG-FILE-STALE-01 an open file follows the file on disk", () => {
  // The pane loaded once and never looked again: an agent writing to the
  // workspace left the tab showing a stale snapshot, and the next keystroke
  // wrote that snapshot back over the newer content.
  assert.match(documentHook, /subscribeLocalWorkspacePath\(projectPath, directory/);
  assert.match(documentHook, /if \(alive\) void reload\(\)/);
  assert.match(documentHook, /release\?\.\(\)/);

  // Shared Document Controller owns self-write echo, dirty conflict and serialized saves.
  assert.match(documentHook, /acquireLocalEditorDocument\(projectPath, filePath, ownerId\)/);
  assert.match(documentHook, /document\?\.applyExternalChange\(next, null\)/);
  assert.match(documentHook, /document\.edit\(value\)/);
  assert.match(documentHook, /document\.save\(\)/);
  assert.match(documentHook, /diskUnavailableRef\.current = true;[\s\S]*clearTimeout\(saveTimerRef\.current\)/);
  assert.match(documentHook, /if \(diskUnavailableRef\.current\) return;[\s\S]*document\.save\(\)/);
  assert.match(previewPane, /snapshot\?\.status === "conflicted"/);
  assert.match(previewPane, /onRetrySave=\{\(\) => void saveNow\(\)\}/);
  assert.match(previewPane, /file\.changedOnDisk/);
});

test("BUG-FILE-STALE-02 a tab whose file disappeared is taken down", () => {
  // Deleting a file left its tab open and editable; every later save failed
  // against a path the write validator refuses, losing the user's input with
  // only a generic "Save failed" to show for it.
  assert.match(documentHook, /onFileMissing\?: \(path: string\) => void;/);
  // Routed through a ref so an unstable callback cannot re-run the load.
  assert.match(documentHook, /const onFileMissingRef = useRef\(onFileMissing\)/);
  assert.match(documentHook, /onFileMissingRef\.current\?\.\(filePath\)/);

  // A read can fail while the file is still there (too large, not UTF-8), so
  // only a genuinely missing file costs its tab.
  assert.match(capabilities, /export async function fileIsGone\(/);
  assert.match(documentHook, /document\.snapshot\(\)\.status === "error"/);
  assert.match(capabilities, /return !entries\.some\(\(entry\) => !entry\.is_dir && entry\.name === fileName\)/);

  // FileManager remains the legacy FileViewer host and closes missing tabs.
  // The new AI workspace owns documents through EditorDocumentManager instead.
  assert.match(fileManager, /onFileMissing=\{closeTreeTab\}/);
  const documentManager = readFileSync(
    new URL("../../workspace-files/services/editorDocumentManager.ts", import.meta.url),
    "utf8",
  );
  assert.match(documentManager, /markDeleted\(\)/);
  assert.match(documentManager, /status: 'deleted'/);
});

test("BUG-FILE-FEEDBACK-03 create and delete failures reach the user", () => {
  // Both paths logged to the debug console and showed nothing: a duplicate
  // name looked like the input row simply vanished.
  assert.match(explorer, /showAlert\(\s*t\("file\.createFailed"/);
  assert.match(explorer, /showAlert\(\s*t\("file\.deleteFailed"/);
  assert.match(explorer, /showAlert\(\s*t\("file\.createFailed"[\s\S]*?file\.nameHasSeparator/);
});

test("BUG-FILE-FEEDBACK-04 the delete confirmation is not raw i18n keys", () => {
  // These three had neither a translation nor a default value, so the dialog
  // rendered the key strings themselves.
  const keys = [
    "file.confirmDeleteTitle",
    "file.confirmDeleteFile",
    "file.confirmDeleteFolder",
    "file.delete",
  ];
  for (const locale of ["en", "zh", "zh-TW"]) {
    const messages = JSON.parse(
      readFileSync(new URL(`../../locales/${locale}.json`, import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    for (const key of keys) {
      assert.equal(typeof messages[key], "string", `${locale} is missing ${key}`);
    }
    assert.match(String(messages["file.confirmDeleteFile"]), /\{\{name\}\}/, locale);
    assert.match(String(messages["file.confirmDeleteFolder"]), /\{\{name\}\}/, locale);
  }
});
