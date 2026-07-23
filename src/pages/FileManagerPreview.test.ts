import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fileManager = readFileSync(new URL('./FileManager.tsx', import.meta.url), 'utf8');

test('FILE-01 binary file-manager previews use a scoped URL rather than the text reader', () => {
  const binaryEffectStart = fileManager.indexOf('useEffect(() => {\n    setBinaryPreview(null);');
  const binaryEffect = fileManager.slice(
    binaryEffectStart,
    fileManager.indexOf('\n  useEffect(() => {', binaryEffectStart + 1),
  );
  assert.match(binaryEffect, /loadLocalBinaryPreview\(selected\.path, selected\.name\)/);
  assert.doesNotMatch(binaryEffect, /managedFiles\?\.read/);
  assert.match(fileManager, /src=\{binaryPreview\.url\}/);
  assert.match(fileManager, /PDF_EXTS\.has\(selected\.ext\) && binaryPreview/);
});

test('FILE-02 HTML file-manager previews use the scoped protocol or a scriptless static fallback', () => {
  assert.match(fileManager, /loadLocalFilePreview\(selected\.path, selected\.name\)/);
  assert.match(fileManager, /HTML_EXTS\.has\(selected\.ext\) && selected\.exists && htmlPreview\?\.kind === 'html'/);
  assert.match(fileManager, /htmlPreview\.mode === 'interactive' \? htmlPreview\.url/);
  assert.match(fileManager, /htmlPreview\.mode === 'interactive' \? undefined : htmlPreview\.content/);
  assert.match(fileManager, /htmlPreview\.mode === 'interactive' \? 'allow-scripts' : ''/);
  assert.match(fileManager, /if \(HTML_EXTS\.has\(selected\.ext\)\) return;/);
});

test('FILE-03 changing the selected file clears stale preview loading states', () => {
  assert.match(fileManager, /setBinaryPreview\(null\);\n    setBinaryLoading\(false\);/);
  assert.match(fileManager, /setHtmlPreview\(null\);\n    setHtmlPreviewLoading\(false\);/);
  assert.match(fileManager, /binaryLoading \|\| htmlPreviewLoading \|\| textPreviewLoading/);
});
