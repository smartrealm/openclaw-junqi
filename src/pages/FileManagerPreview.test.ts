import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fileManager = readFileSync(new URL('./FileManager.tsx', import.meta.url), 'utf8');
const managedPreview = readFileSync(new URL('../components/FileExplorer/ManagedFilePreview.tsx', import.meta.url), 'utf8');

test('FILE-01 file-manager formats share one cancellable preview load', () => {
  assert.match(fileManager, /setManagedPreviewState\(\{ path: selectedPath, status: 'loading' \}\);[\s\S]*loadLocalFilePreview\(selected\.path, selected\.name\)/);
  assert.match(fileManager, /<ManagedFilePreview[\s\S]*preview=\{activeManagedPreview\}/);
  assert.doesNotMatch(fileManager, /binaryPreview|htmlPreview|textPreview|loadLocalBinaryPreview/);
});

test('FILE-02 shared HTML previews preserve scoped interactive and scriptless static modes', () => {
  assert.match(managedPreview, /preview\.mode === 'interactive' \? preview\.url/);
  assert.match(managedPreview, /preview\.mode === 'static' \? preview\.content/);
  assert.match(managedPreview, /preview\.mode === 'interactive' \? 'allow-scripts' : ''/);
});

test('FILE-03 changing the selected file clears stale content and ignores obsolete loads', () => {
  assert.match(fileManager, /managedPreviewState\?\.path === selected\.path/);
  assert.match(fileManager, /let cancelled = false;[\s\S]*if \(!cancelled\) setManagedPreviewState\(\{ path: selectedPath, status: 'ready', preview \}\)/);
  assert.match(fileManager, /return \(\) => \{\n      cancelled = true;/);
});

test('FILE-04 managed Markdown uses the shared renderer and preserves local-link opening', () => {
  assert.match(managedPreview, /import \{ MarkdownPreview \} from '.\/MarkdownPreview'/);
  assert.match(managedPreview, /onOpenLocalLink=\{onOpenLocalLink\}/);
  assert.match(managedPreview, /resolveImageSource=\{resolveMarkdownImage\}/);
  assert.doesNotMatch(fileManager, /ReactMarkdown|remarkGfm|markdownPreviewComponents/);
});
