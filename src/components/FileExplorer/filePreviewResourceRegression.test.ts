import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const pdfPreview = read("./PdfPreview.tsx");
const previewDocument = read("./useFilePreviewDocument.ts");

test("BUG-PREVIEW-PDF-01 a loaded PDF document is destroyed with its tab", () => {
  // The loading task was disposed, but the PDFDocumentProxy it produced was
  // only dropped from state — leaving its worker-side document alive for every
  // PDF ever opened.
  assert.match(
    pdfPreview,
    /useEffect\(\(\) => \(\) => \{\s*void doc\?\.destroy\(\)[\s\S]{0,40}\}, \[doc\]\)/,
  );
});

test("BUG-PREVIEW-SAVE-02 a successful save does not re-read the whole file", () => {
  // A compare-and-swap that reports success already establishes what the file
  // holds, so re-reading it made every 1.5s autosave tick cost a full read.
  assert.match(
    previewDocument,
    /if \(written\) \{\s*diskContent = snapshot\.content;\s*\} else \{[\s\S]*?read_file_preview/,
  );
  // The read must still happen on the rejected path — that is the only way to
  // learn what the file actually contains now.
  assert.match(previewDocument, /\} else \{[\s\S]{0,400}diskContent = diskPreview\.text;/);
});

test("BUG-PREVIEW-UNMOUNT-03 the flush-on-unmount handler only runs on unmount", () => {
  // Depending on `preview?.kind` re-ran the cleanup on every change, using the
  // previous closure: a file that stopped being text would still take the
  // "flush the text" branch and write the stale buffer back over it.
  assert.match(previewDocument, /previewKindRef\.current === "text"/);
  assert.match(previewDocument, /void persistLatestContentRef\.current\(\)/);
  const unmountEffect = previewDocument.slice(previewDocument.indexOf("previewKindRef.current === \"text\""));
  assert.match(
    unmountEffect.slice(0, unmountEffect.indexOf("return {")),
    /\}, \[\]\);/,
    "the unmount effect must not depend on changing values",
  );
});
