import assert from 'node:assert/strict';
import test from 'node:test';
import {
  localWorkbenchHost,
  unavailableWorkbenchHost,
  WorkbenchHostRouter,
  WorkbenchHostUnavailableError,
} from './hostAdapter';

test('host router resolves only the exact owner revision', () => {
  const router = new WorkbenchHostRouter([localWorkbenchHost(3)]);
  assert.equal(router.resolve('local', 3).host.kind, 'local');
  assert.throws(() => router.resolve('local', 2), WorkbenchHostUnavailableError);
  assert.throws(() => router.resolve('missing', 0), WorkbenchHostUnavailableError);
});

test('SSH and Runtime hosts fail closed instead of falling back to local files', () => {
  const router = new WorkbenchHostRouter([
    localWorkbenchHost(),
    unavailableWorkbenchHost('ssh:server', 'ssh', 1),
    unavailableWorkbenchHost('runtime:remote', 'runtime', 2),
  ]);
  assert.throws(() => router.requireFiles('ssh:server', 1), /does not provide files/);
  assert.throws(() => router.requireFiles('runtime:remote', 2), /does not provide files/);
  assert.ok(router.requireFiles('local', 0));
});

test('a stale adapter registration cannot roll back a newer host revision', () => {
  const router = new WorkbenchHostRouter([localWorkbenchHost(4)]);
  router.register(localWorkbenchHost(3));
  assert.equal(router.resolve('local', 4).host.revision, 4);
  assert.throws(() => router.resolve('local', 3));
});
