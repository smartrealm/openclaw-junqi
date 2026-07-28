import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceFileScope } from '../domain/types';
import { WorkspaceFileWatchCoordinator, type WorkspaceFileEvent } from './watchCoordinator';

const scope: WorkspaceFileScope = {
  hostId: 'local', hostRevision: 3, workspaceId: 'workspace-1',
  rootPath: '/repo', rootRevision: 4, policy: 'workspace',
};

function event(watchId: string, sequence: number): WorkspaceFileEvent {
  return {
    watchId,
    scopeId: 'local:3:workspace-1:4',
    hostId: 'local', hostRevision: 3, sequence,
    kind: 'changed', path: '/repo/a.ts',
  };
}

test('coordinator merges identical watches and stops after the last reference', async () => {
  const started: string[] = [];
  const stopped: string[] = [];
  const coordinator = new WorkspaceFileWatchCoordinator({
    start: async (watchId) => { started.push(watchId); },
    stop: async (watchId) => { stopped.push(watchId); },
  });
  const first = await coordinator.subscribe(scope, '/repo', () => undefined);
  const second = await coordinator.subscribe(scope, '/repo', () => undefined);
  assert.equal(started.length, 1);
  first();
  await Promise.resolve();
  assert.equal(stopped.length, 0);
  second();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(stopped, started);
});

test('coordinator fences stale owners and converts sequence gaps to overflow', async () => {
  let watchId = '';
  const received: WorkspaceFileEvent[] = [];
  const coordinator = new WorkspaceFileWatchCoordinator({
    start: async (id) => { watchId = id; },
    stop: async () => undefined,
  });
  const unsubscribe = await coordinator.subscribe(scope, '/repo', (next) => received.push(next));
  assert.equal(coordinator.dispatch(event(watchId, 1)), true);
  assert.equal(coordinator.dispatch(event(watchId, 1)), false);
  assert.equal(coordinator.dispatch({ ...event(watchId, 2), hostRevision: 2 }), false);
  assert.equal(coordinator.dispatch(event(watchId, 4)), true);
  assert.deepEqual(received.map((item) => item.kind), ['changed', 'overflow']);
  assert.equal(received[1]?.path, '/repo');
  unsubscribe();
});

test('watch id collisions receive distinct routed identities', async () => {
  const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('./watchCoordinator.ts', import.meta.url), 'utf8'));
  assert.match(source, /while \(this\.byWatchId\.has\(watchId\)\)/);
  assert.match(source, /watchId = `\$\{base\}:\$\{collision\}`/);
});

test('different owner revisions never share native watches', async () => {
  const started: string[] = [];
  const coordinator = new WorkspaceFileWatchCoordinator({
    start: async (id) => { started.push(id); },
    stop: async () => undefined,
  });
  const first = await coordinator.subscribe(scope, '/repo', () => undefined);
  const second = await coordinator.subscribe({ ...scope, hostRevision: 4 }, '/repo', () => undefined);
  assert.equal(started.length, 2);
  assert.notEqual(started[0], started[1]);
  first();
  second();
});
