import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const pdfPreview = read("./PdfPreview.tsx");
const previewDocument = read("./useFilePreviewDocument.ts");

/**
 * Slice out one top-level `const <name> = ...` declaration, up to the next one.
 * Assertions that span the whole file match a neighbour's code and stay green
 * after the line they were written to protect is deleted.
 */
function declarationBody(source: string, name: string): string {
  const start = source.indexOf(`  const ${name} = `);
  assert.notEqual(start, -1, `${name} not found`);
  const next = source.indexOf("\n  const ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

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

test("BUG-PREVIEW-MISSING-04 a file that leaves the disk pauses saving instead of closing its tab", () => {
  const previewPane = read("./FilePreviewPane.tsx");

  // A failed disk read after the file was already loaded means the file left
  // the disk. The tab stays — the buffer may be the only copy of that content
  // left — but nothing may be written back to a path that no longer resolves.
  assert.match(
    previewDocument,
    /\} catch \(readError\) \{[\s\S]*?diskUnavailableRef\.current = true;[\s\S]*?setDiskReadError\(String\(readError\)\)/,
  );
  // Any autosave already armed for this buffer has to be disarmed with it.
  assert.match(
    previewDocument,
    /diskUnavailableRef\.current = true;[\s\S]*?clearTimeout\(saveTimerRef\.current\)[\s\S]*?saveRequestedRef\.current = false/,
  );

  // Every write entry point honours the flag: the timer, the immediate save,
  // the external flush, and the write itself. Each is checked inside its own
  // body — a regex spanning the whole file would happily match a neighbour's
  // guard and pass while the one under test is gone.
  for (const name of [
    "persistLatestContent",
    "schedulePersist",
    "saveNow",
    "flushContent",
  ]) {
    assert.match(
      declarationBody(previewDocument, name),
      /diskUnavailableRef\.current/,
      `${name} must refuse to write while the file is unreadable`,
    );
  }

  // The banner is the way back, and manual save stays locked while it shows.
  assert.match(previewPane, /\{diskReadError \? <FileUnavailableBanner onRetry=\{\(\) => void reloadFromDisk\(\)\}/);
  assert.match(previewPane, /retrySaveDisabled=\{Boolean\(diskReadError\)\}/);

  // Once the file is readable again the flag clears, and a buffer that is still
  // dirty gets its autosave re-armed rather than sitting unsaved forever.
  assert.match(previewDocument, /const wasUnavailable = diskUnavailableRef\.current;[\s\S]*?diskUnavailableRef\.current = false/);
  assert.match(
    previewDocument,
    /\(wasConflicted \|\| wasUnavailable\)\s*&& textDocumentIsDirty\(reconciled\.document\)\s*\) \{\s*schedulePersist\(\)/,
  );
});
