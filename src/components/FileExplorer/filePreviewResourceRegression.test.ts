import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releasePdfDocument } from "./pdfDocumentLifecycle";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const previewPane = read("./FilePreviewPane.tsx");
const workspaceDocument = read("./useWorkspaceFileDocument.ts");
const editorDocuments = read("../../workspace-files/services/editorDocumentManager.ts");
const localEditorDocuments = read("../../workspace-files/services/localEditorDocuments.ts");

test("BUG-PREVIEW-PDF-01 文档缓存会在关闭标签时释放", async () => {
  let cleanupCalls = 0;
  await releasePdfDocument({
    cleanup: async () => {
      cleanupCalls += 1;
    },
  });
  assert.equal(cleanupCalls, 1);
});

test("BUG-PREVIEW-PDF-02 清理失败不会遮蔽预览的原始结果", async () => {
  await assert.doesNotReject(
    releasePdfDocument({
      cleanup: async () => {
        throw new Error("cleanup failed");
      },
    }),
  );
});

test("BUG-PREVIEW-SAVE-02 guarded saves read the file again only after a rejected compare-and-swap", () => {
  assert.match(localEditorDocuments, /if \(written\) return \{ revision: null \};/);
  assert.match(localEditorDocuments, /conflictContent: await readFileText\(path, scope\.rootPath\)/);
  assert.match(editorDocuments, /if \(result\.conflictContent !== undefined\)/);
});

test("BUG-PREVIEW-MISSING-04 a file that leaves the disk pauses saving instead of closing its tab", () => {
  assert.match(workspaceDocument, /diskUnavailableRef\.current = true/);
  assert.match(workspaceDocument, /if \(diskUnavailableRef\.current\) return/);
  assert.match(previewPane, /\{diskReadError \? <FileUnavailableBanner onRetry=\{\(\) => void reloadFromDisk\(\)\}/);
});
