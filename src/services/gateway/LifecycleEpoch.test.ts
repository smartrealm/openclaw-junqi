import test from 'node:test';
import assert from 'node:assert/strict';
import { LifecycleEpoch } from './LifecycleEpoch';

test('BUG-GL09 reset invalidates work from the previous lifecycle', () => {
  const epoch = new LifecycleEpoch();
  const first = epoch.activate();
  assert.equal(epoch.isCurrent(first), true);

  const second = epoch.invalidate();
  assert.equal(epoch.isCurrent(first), false);
  assert.equal(epoch.isCurrent(second), true);
});

test('BUG-GL09 deactivation rejects every outstanding token', () => {
  const epoch = new LifecycleEpoch();
  const token = epoch.activate();
  epoch.deactivate();

  assert.equal(epoch.isCurrent(token), false);
  assert.equal(epoch.isCurrent(epoch.capture()), false);
});
