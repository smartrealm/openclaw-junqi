import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fileManager = readFileSync(new URL('./FileManager.tsx', import.meta.url), 'utf8');
const workspaceManager = readFileSync(new URL('./file-manager/WorkspaceFileManager.tsx', import.meta.url), 'utf8');

test('FILE-01 file-manager exposes only the typed workspace tree', () => {
  assert.match(fileManager, /<WorkspaceFileManager/);
  assert.match(workspaceManager, /<FileExplorer/);
  assert.match(workspaceManager, /<FileViewer/);
  assert.doesNotMatch(fileManager, /managedFiles|uploads|loadLocalFilePreview/);
});

test('FILE-02 workspace tabs retain rename, deletion and durable-save boundaries', () => {
  assert.match(workspaceManager, /rebaseOpenFileTabs/);
  assert.match(workspaceManager, /removeOpenFileTabs/);
  assert.match(workspaceManager, /onBeforePathMutation=\{\(path, isDirectory\) => viewerRef\.current\?\.flushPath/);
  assert.match(workspaceManager, /onFileMissing=\{closeTab\}/);
  assert.match(workspaceManager, /index < 0 \? current/);
});
