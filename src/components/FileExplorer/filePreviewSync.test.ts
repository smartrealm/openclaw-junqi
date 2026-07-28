import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_TEXT_DOCUMENT,
  completeTextSave,
  editTextDocument,
  keepLocalTextEdits,
  loadTextDocument,
  reconcileDiskTextDocument,
  textDocumentIsDirty,
} from "./filePreviewSync";

test("clean documents reload when disk content changes", () => {
  const result = reconcileDiskTextDocument(loadTextDocument("original"), "agent update");

  assert.equal(result.decision, "reload");
  assert.deepEqual(result.document, loadTextDocument("agent update"));
});

test("dirty documents retain their draft and record the conflicting disk version", () => {
  const draft = editTextDocument(loadTextDocument("original"), "my draft");
  const result = reconcileDiskTextDocument(draft, "agent update");

  assert.equal(result.decision, "conflict");
  assert.equal(result.document.content, "my draft");
  assert.equal(result.document.diskBaseline, "original");
  assert.equal(result.document.conflictDiskContent, "agent update");
  assert.equal(textDocumentIsDirty(result.document), true);
});

test("watcher echoes clear stale conflicts without changing a dirty draft", () => {
  const conflicted = reconcileDiskTextDocument(
    editTextDocument(loadTextDocument("saved"), "new draft"),
    "external update",
  ).document;
  const result = reconcileDiskTextDocument(conflicted, "saved");

  assert.equal(result.decision, "unchanged");
  assert.equal(result.document.content, "new draft");
  assert.equal(result.document.conflictDiskContent, null);
});

test("matching disk and draft content becomes the new clean baseline", () => {
  const draft = editTextDocument(loadTextDocument("original"), "same update");
  const result = reconcileDiskTextDocument(draft, "same update");

  assert.equal(result.decision, "reload");
  assert.equal(textDocumentIsDirty(result.document), false);
});

test("keeping local edits advances the baseline and leaves the draft dirty", () => {
  const conflicted = reconcileDiskTextDocument(
    editTextDocument(loadTextDocument("original"), "my draft"),
    "agent update",
  ).document;
  const kept = keepLocalTextEdits(conflicted);

  assert.equal(kept.content, "my draft");
  assert.equal(kept.diskBaseline, "agent update");
  assert.equal(kept.conflictDiskContent, null);
  assert.equal(textDocumentIsDirty(kept), true);
});

test("successful saves advance only the baseline when newer typing exists", () => {
  const saving = editTextDocument(loadTextDocument("original"), "first draft");
  const typedAgain = editTextDocument(saving, "second draft");
  const completed = completeTextSave(typedAgain, "first draft");

  assert.equal(completed.content, "second draft");
  assert.equal(completed.diskBaseline, "first draft");
  assert.equal(textDocumentIsDirty(completed), true);
});

test("disk reconciliation is inert until initial loading has established a baseline", () => {
  const result = reconcileDiskTextDocument(EMPTY_TEXT_DOCUMENT, "disk");

  assert.equal(result.decision, "not-ready");
  assert.equal(result.document, EMPTY_TEXT_DOCUMENT);
});
