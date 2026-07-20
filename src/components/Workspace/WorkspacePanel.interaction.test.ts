import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('switching files with unsaved edits uses the application confirmation dialog', async () => {
  const source = await read('./WorkspacePanel.tsx');

  assert.match(source, /showConfirm\(/);
  assert.match(source, /workspace\.discardUnsavedTitle/);
  assert.doesNotMatch(source, /window\.confirm/);
});

test('workspace keeps the explorer visible beside the editor and preview', async () => {
  const source = await read('./WorkspacePanel.tsx');

  assert.match(source, /<aside className=/);
  assert.match(source, /<WorkspaceFileTree[\s\S]*activePath=\{open\?\.entry\.path \?\? null\}/);
  assert.match(source, /<section className="flex min-w-0 flex-1 flex-col/);
  assert.match(source, /<CodeMirror/);
  assert.match(source, /open\.image\.data_url/);
});

test('agent polling with an unchanged workspace cannot reset the editor', async () => {
  const source = await read('./WorkspacePanel.tsx');

  assert.match(source, /const agentWorkspace = useMemo/);
  assert.match(source, /\[agentId, agentWorkspace, dirty, rootOverride\]/);
  assert.doesNotMatch(source, /\[agentId, agents, rootOverride\]/);
  assert.match(source, /rootRef\.current === nextRoot/);
});

test('closing a dirty workspace uses the application confirmation dialog', async () => {
  const source = await read('./WorkspacePanel.tsx');

  assert.match(source, /const requestClose = useCallback/);
  assert.match(source, /workspace\.closeUnsavedConfirm/);
  assert.match(source, /onClick=\{requestClose\}/);
  assert.doesNotMatch(source, /<button onClick=\{onClose\}/);
});

test('only the latest asynchronous file read may update the editor', async () => {
  const source = await read('./WorkspacePanel.tsx');

  assert.match(source, /const requestId = \+\+loadRequestRef\.current/);
  assert.ok((source.match(/requestId !== loadRequestRef\.current/g) ?? []).length >= 3);
  assert.match(source, /requestId === loadRequestRef\.current\) setLoadingFile\(false\)/);
});
