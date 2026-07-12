import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findWorkspaceForDirectory,
  migrateLegacyProjectPaths,
  workspacePathsEqual,
} from './projectWorkspace';
import type { Workspace } from './types';

test('workspace paths preserve Unix case sensitivity and ignore trailing separators', () => {
  assert.equal(workspacePathsEqual('/Users/wei/project/', '/Users/wei/project'), true);
  assert.equal(workspacePathsEqual('/Users/wei/Project', '/Users/wei/project'), false);
});

test('workspace paths preserve legal leading and trailing whitespace', () => {
  assert.equal(workspacePathsEqual('/projects/report ', '/projects/report'), false);
  assert.equal(workspacePathsEqual(' /projects/report', '/projects/report'), false);
});

test('workspace paths compare Windows drive and extended paths case-insensitively', () => {
  assert.equal(workspacePathsEqual('C:\\Work\\JunQi\\', 'c:/work/junqi'), true);
  assert.equal(workspacePathsEqual('\\\\?\\C:\\Work\\JunQi', 'c:/work/junqi'), true);
});

test('workspace paths normalize Windows extended UNC prefixes', () => {
  assert.equal(
    workspacePathsEqual('\\\\?\\UNC\\Server\\Share\\Repo', '\\\\server\\share\\repo\\'),
    true,
  );
});

test('findWorkspaceForDirectory reuses an existing canonical project workspace', () => {
  const workspace = {
    id: 'workspace-1',
    name: 'JunQi',
    projectDirectory: 'C:\\Work\\JunQi',
    workingDirectory: 'C:\\Work\\JunQi',
  } as Workspace;

  assert.equal(findWorkspaceForDirectory([workspace], 'c:/work/junqi')?.id, workspace.id);
  assert.equal(findWorkspaceForDirectory([workspace], 'c:/work/other'), undefined);
});

test('workspace reuse is stable after the focused terminal changes directory', () => {
  const workspace = {
    id: 'workspace-1',
    name: 'JunQi',
    projectDirectory: '/repo',
    workingDirectory: '/repo/packages/web',
  } as Workspace;

  assert.equal(findWorkspaceForDirectory([workspace], '/repo')?.id, workspace.id);
  assert.equal(findWorkspaceForDirectory([workspace], '/repo/packages/web'), undefined);
});

test('legacy migration continues past missing directories and preserves recency order', async () => {
  const calls: string[] = [];
  const retry = await migrateLegacyProjectPaths(
    ['/newest', '/missing', '/oldest'],
    async (path) => {
      calls.push(path);
      if (path === '/missing') throw new Error('terminal workspace directory does not exist');
    },
  );

  assert.deepEqual(calls, ['/oldest', '/missing', '/newest']);
  assert.deepEqual(retry, []);
});

test('legacy migration replays valid paths after a transient failure without changing LRU order', async () => {
  const retry = await migrateLegacyProjectPaths(['/newest', '/older'], async (path) => {
    if (path === '/older') throw new Error('save terminal recent workspaces: access denied');
  });

  assert.deepEqual(retry, ['/newest', '/older']);
});
