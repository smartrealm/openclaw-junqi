import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceFileScope } from '../domain/types';
import { EditorDocumentController, EditorDocumentManager, type EditorDocumentIO } from './editorDocumentManager';

const scope: WorkspaceFileScope = {
  hostId: 'local', hostRevision: 1, workspaceId: 'workspace-1',
  rootPath: '/repo', rootRevision: 1, policy: 'workspace',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('late loads cannot replace the newest document generation', async () => {
  const first = deferred<{ content: string; revision: string | null }>();
  const second = deferred<{ content: string; revision: string | null }>();
  let reads = 0;
  const document = new EditorDocumentController({
    read: async () => (++reads === 1 ? first.promise : second.promise),
    write: async () => ({ revision: null }),
  }, scope, '/repo/a.ts');
  const firstLoad = document.load();
  const secondLoad = document.load();
  second.resolve({ content: 'new', revision: '2' });
  await secondLoad;
  first.resolve({ content: 'old', revision: '1' });
  await firstLoad;
  assert.equal(document.snapshot().draftContent, 'new');
  assert.equal(document.snapshot().diskRevision, '2');
});

test('writes are serialized per document and edits during save remain dirty', async () => {
  const firstWrite = deferred<{ revision: string | null }>();
  const calls: string[] = [];
  const io: EditorDocumentIO = {
    read: async () => ({ content: 'base', revision: '1' }),
    write: async (_scope, _path, content) => {
      calls.push(content);
      if (calls.length === 1) return firstWrite.promise;
      return { revision: String(calls.length + 1) };
    },
  };
  const document = new EditorDocumentController(io, scope, '/repo/a.ts');
  await document.load();
  document.edit('first');
  const savingFirst = document.save();
  document.edit('second');
  const savingSecond = document.save();
  await Promise.resolve();
  assert.deepEqual(calls, ['first']);
  firstWrite.resolve({ revision: '2' });
  await savingFirst;
  assert.equal(document.snapshot().status, 'dirty');
  await savingSecond;
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(document.snapshot().diskContent, 'second');
  assert.equal(document.snapshot().status, 'saved');
});

test('external changes distinguish self-write echoes, clean reloads and conflicts', async () => {
  const document = new EditorDocumentController({
    read: async () => ({ content: 'base', revision: '1' }),
    write: async () => ({ revision: '2' }),
  }, scope, '/repo/a.ts');
  await document.load();
  document.applyExternalChange('external', '2');
  assert.equal(document.snapshot().draftContent, 'external');
  document.edit('draft');
  document.applyExternalChange('other', '3');
  assert.equal(document.snapshot().status, 'conflicted');
  assert.equal(document.snapshot().draftContent, 'draft');
  document.edit('mine');
  void document.save();
  const operationId = document.snapshot().lastWriteOperationId;
  document.applyExternalChange('echo', '4', operationId);
  assert.equal(document.snapshot().draftContent, 'mine');
});

test('deleted documents fence pending loads and saves', async () => {
  const read = deferred<{ content: string; revision: string | null }>();
  let writes = 0;
  const document = new EditorDocumentController({
    read: async () => read.promise,
    write: async () => { writes += 1; return { revision: null }; },
  }, scope, '/repo/deleted.ts');
  const loading = document.load();
  document.markDeleted();
  read.resolve({ content: 'late', revision: '1' });
  await loading;
  document.edit('resurrect');
  await document.save();
  assert.equal(document.snapshot().status, 'deleted');
  assert.equal(writes, 0);
});

test('manager isolates documents by owner revision and reuses exact identities', () => {
  const manager = new EditorDocumentManager({
    read: async () => ({ content: '', revision: null }),
    write: async () => ({ revision: null }),
  });
  const first = manager.open(scope, '/repo/a.ts');
  assert.equal(manager.open(scope, '/repo/a.ts'), first);
  assert.notEqual(manager.open({ ...scope, hostRevision: 2 }, '/repo/a.ts'), first);
  manager.dispose();
});
