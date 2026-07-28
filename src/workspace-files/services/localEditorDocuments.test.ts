import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('./localEditorDocuments.ts', import.meta.url), 'utf8');
const viewer = readFileSync(new URL('../../components/FileExplorer/FileViewer.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../../pages/AgentWorkspace/index.tsx', import.meta.url), 'utf8');

test('FileViewer detach retains the shared document while explicit tab close releases it', () => {
  assert.match(viewer, /acquireLocalEditorDocument\(projectPath, filePath, ownerId\)/);
  assert.doesNotMatch(viewer, /document\.dispose\(\)/);
  assert.match(viewer, /await releaseLocalEditorDocuments\(paths\.map/);
  assert.match(workspace, /await releaseLocalEditorDocument\(localPath, tab\.filePath/);
});

test('deleted files tombstone the shared controller before releasing the final owner', () => {
  assert.match(viewer, /deleteLocalEditorDocument\(/);
  const deletion = service.slice(service.indexOf('export async function deleteLocalEditorDocument'));
  assert.ok(deletion.indexOf('.markDeleted()') < deletion.indexOf('manager.close(scope, path)'));
  assert.doesNotMatch(deletion, /\.save\(\)/);
});

test('document release checkpoints drafts and refuses unresolved conflicts', () => {
  assert.match(service, /status === 'conflicted'/);
  assert.match(service, /status === 'dirty' \|\| status === 'saving' \|\| status === 'error'/);
  assert.match(service, /Validate every lease before checkpointing any document/);
  assert.match(service, /Lease mutation is the commit phase/);
  assert.ok(service.indexOf('await item.document.save()') < service.indexOf('export function commitLocalEditorDocumentRelease'));
  assert.ok(service.indexOf('export function commitLocalEditorDocumentRelease') < service.indexOf('item.documentOwners.delete'));
  assert.match(service, /item\.documentOwners\.size > 1/);
});
