import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneRecoveryTracker } from './sceneRecovery';

test('scene recovery emits only on a disconnected to connected edge', () => {
  const tracker = new SceneRecoveryTracker(true);
  assert.equal(tracker.connectionChanged(true, 1_000), null);
  assert.equal(tracker.connectionChanged(false, 2_000), null);
  assert.equal(tracker.connectionChanged(true, 3_000), 'reconnect');
});

test('scene recovery waits for a meaningful background interval', () => {
  const tracker = new SceneRecoveryTracker(true);
  tracker.enterBackground(1_000);
  assert.equal(tracker.enterForeground(5_000, 8_000), null);
  tracker.enterBackground(10_000);
  assert.equal(tracker.enterForeground(20_000, 8_000), 'foreground');
});

test('scene recovery ignores foreground events while disconnected and deduplicates focus events', () => {
  const tracker = new SceneRecoveryTracker(false);
  tracker.enterBackground(1_000);
  assert.equal(tracker.enterForeground(20_000, 8_000), null);
  assert.equal(tracker.connectionChanged(true, 21_000), 'reconnect');
  tracker.enterBackground(21_100);
  assert.equal(tracker.enterForeground(21_500, 0), null);
});
