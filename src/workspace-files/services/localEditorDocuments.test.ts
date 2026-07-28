import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('./localEditorDocuments.ts', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../../components/FileExplorer/FileViewer.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../../pages/AgentWorkspace/index.tsx', import.meta.url), 'utf8');

test('FileViewer detach retains the shared document while explicit tab close releases it', () => {
  assert.match(viewer, /openLocalEditorDocument\(projectPath, filePath\)/);
  assert.doesNotMatch(viewer, /document\.dispose\(\)/);
  assert.match(workspace, /await closeLocalEditorDocument\(localPath, tab\.filePath\)/);
});

test('document release checkpoints drafts and refuses unresolved conflicts', () => {
  assert.match(service, /status === 'conflicted'/);
  assert.match(service, /status === 'dirty' \|\| status === 'saving' \|\| status === 'error'/);
  assert.ok(service.indexOf('await document.save()') < service.indexOf('manager.close(scope, path)'));
});
