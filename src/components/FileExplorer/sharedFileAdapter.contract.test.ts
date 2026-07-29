import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const viewer = [
  './FileViewer.tsx',
  './FilePreviewPane.tsx',
  './useWorkspaceFileDocument.ts',
  './fileViewerCapabilities.ts',
].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

test('FileViewer text and image IO uses the shared workspace files facade', () => {
  for (const helper of ['readDir', 'readFileText', 'readFilePreview', 'acquireLocalEditorDocument']) {
    assert.match(viewer, new RegExp(`\\b${helper}\\b`));
  }
  assert.doesNotMatch(viewer, /invoke(?:<[^>]+>)?\("(?:read_dir_entries|read_file_content|read_image_preview|write_file_content)"/);
});

test('FileViewer preview selection uses the shared preview resolver', () => {
  assert.match(viewer, /resolveWorkspacePreview\(/);
  assert.doesNotMatch(viewer, /function isMarkdownFile|function isPreviewableImageFile/);
});
