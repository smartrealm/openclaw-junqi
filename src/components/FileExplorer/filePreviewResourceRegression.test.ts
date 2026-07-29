import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const pdfPreview = read("./PdfPreview.tsx");
const previewPane = read("./FilePreviewPane.tsx");
const workspaceDocument = read("./useWorkspaceFileDocument.ts");
const editorDocuments = read("../../workspace-files/services/editorDocumentManager.ts");
const localEditorDocuments = read("../../workspace-files/services/localEditorDocuments.ts");

test("BUG-PREVIEW-PDF-01 a loaded PDF document is destroyed with its tab", () => {
  // The loading task was disposed, but the PDFDocumentProxy it produced was
  // only dropped from state — leaving its worker-side document alive for every
  // PDF ever opened.
  assert.match(
    pdfPreview,
    /useEffect\(\(\) => \(\) => \{\s*void doc\?\.destroy\(\)[\s\S]{0,40}\}, \[doc\]\)/,
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
