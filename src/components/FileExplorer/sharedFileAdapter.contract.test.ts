import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const viewer = readFileSync(new URL('./FileViewer.tsx', import.meta.url), 'utf8');

test('FileViewer text and image IO uses the shared workspace files facade', () => {
  for (const helper of ['readDir', 'readFileText', 'readImagePreview', 'writeFileText']) {
    assert.match(viewer, new RegExp(`\\b${helper}\\b`));
  }
  assert.doesNotMatch(viewer, /invoke(?:<[^>]+>)?\("(?:read_dir_entries|read_file_content|read_image_preview|write_file_content)"/);
});
