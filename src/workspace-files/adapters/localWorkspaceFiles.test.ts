import assert from 'node:assert/strict';
import test from 'node:test';
import { localWorkspaceFiles } from './localWorkspaceFiles';
import type { WorkspaceFileScope } from '../domain/types';

const scope: WorkspaceFileScope = {
  hostId: 'local',
  hostRevision: 1,
  workspaceId: 'workspace-1',
  rootPath: '/repo',
  rootRevision: 1,
  policy: 'workspace',
};

test('local adapter capabilities fail closed for non-workspace policies', () => {
  assert.equal(localWorkspaceFiles.capabilities(scope).write, true);
  assert.equal(localWorkspaceFiles.capabilities({ ...scope, policy: 'managed-readonly' }).write, false);
  assert.equal(localWorkspaceFiles.capabilities({ ...scope, policy: 'terminal-strict' }).search, false);
});

test('local adapter rejects mismatched owners before invoking native IO', async () => {
  await assert.rejects(
    localWorkspaceFiles.readText({ ...scope, hostId: 'runtime:remote' }, '/repo/file.ts'),
    /cannot serve host/,
  );
  await assert.rejects(
    localWorkspaceFiles.writeText({ ...scope, policy: 'managed-readonly' }, '/repo/file.ts', 'x'),
    /read-only/,
  );
  await assert.rejects(
    localWorkspaceFiles.readText({ ...scope, hostRevision: Number.NaN }, '/repo/file.ts'),
    /finite owner revisions/,
  );
});
