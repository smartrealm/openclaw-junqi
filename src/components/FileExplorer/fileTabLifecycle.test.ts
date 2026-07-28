import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewer = readFileSync(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const explorer = readFileSync(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const fileManager = readFileSync(new URL("../../pages/FileManager.tsx", import.meta.url), "utf8");

test("BUG-FILE-STALE-01 an open file follows the file on disk", () => {
  // The pane loaded once and never looked again: an agent writing to the
  // workspace left the tab showing a stale snapshot, and the next keystroke
  // wrote that snapshot back over the newer content.
  assert.match(viewer, /subscribeLocalWorkspacePath\(projectPath, directory/);
  assert.match(viewer, /if \(alive\) void reload\(\)/);
  assert.match(viewer, /release\?\.\(\)/);

  // Shared Document Controller owns self-write echo, dirty conflict and serialized saves.
  assert.match(viewer, /new EditorDocumentController\(/);
  assert.match(viewer, /document\?\.applyExternalChange\(next, null\)/);
  assert.match(viewer, /document\.edit\(value\)/);
  assert.match(viewer, /document\.save\(\)/);
  assert.match(viewer, /documentSnapshot\?\.status === 'conflicted'/);
  assert.match(viewer, /file\.changedOnDisk/);
});

test("BUG-FILE-STALE-02 a tab whose file disappeared is taken down", () => {
  // Deleting a file left its tab open and editable; every later save failed
  // against a path the write validator refuses, losing the user's input with
  // only a generic "Save failed" to show for it.
  assert.match(viewer, /onFileMissing\?: \(path: string\) => void;/);
  // Routed through a ref so an unstable callback cannot re-run the load.
  assert.match(viewer, /const onFileMissingRef = useRef\(onFileMissing\)/);
  assert.match(viewer, /if \(alive\) onFileMissingRef\.current\?\.\(filePath\)/);

  // A read can fail while the file is still there (too large, not UTF-8), so
  // only a genuinely missing file costs its tab.
  assert.match(viewer, /async function fileIsGone\(/);
  assert.match(viewer, /document\.snapshot\(\)\.status === 'error' && await fileIsGone/);
  assert.match(viewer, /return !entries\.some\(\(entry\) => !entry\.is_dir && entry\.name === fileName\)/);

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
  for (const locale of ["en", "zh", "zh-TW", "ar"]) {
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
