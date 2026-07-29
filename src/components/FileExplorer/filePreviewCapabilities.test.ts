import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeWorkspaceFilePreview,
  fileExtension,
  imageDataUrl,
  isMarkdownFile,
  isRichSourceFile,
} from "../../utils/filePreviewCapabilities";

test("file preview capability matching is case-insensitive and filename-safe", () => {
  assert.equal(fileExtension("/tmp/README.MDX"), "mdx");
  assert.equal(fileExtension(".env"), "");
  assert.equal(isMarkdownFile("guide.markdown"), true);
  assert.equal(isRichSourceFile("flow.MERMAID"), true);
  assert.equal(isRichSourceFile("table.tsv"), true);
  assert.equal(isRichSourceFile("book.ipynb"), true);
});

test("structured preview decoder rejects incomplete IPC payloads", () => {
  const image = decodeWorkspaceFilePreview({
    kind: "image",
    text: null,
    base64: "AAE=",
    mimeType: "image/x-icon",
    byteLength: 2,
  });
  assert.equal(image.kind, "image");
  if (image.kind === "image") assert.equal(imageDataUrl(image), "data:image/x-icon;base64,AAE=");

  assert.throws(
    () => decodeWorkspaceFilePreview({ kind: "text", text: null, base64: null, byteLength: 0 }),
    /Invalid file preview response/,
  );
  assert.throws(
    () => decodeWorkspaceFilePreview({ kind: "binary", text: null, base64: null, mimeType: null }),
    /byte length/,
  );
});
