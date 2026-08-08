import assert from 'node:assert/strict';
import test from 'node:test';
import { setupStepEntryState, setupStepMotionDirection } from './setupStepTransition';

test('setup step transition moves forward from right to left and back from left to right', () => {
  assert.equal(setupStepMotionDirection('welcome', 'environment-review'), -1);
  assert.equal(setupStepMotionDirection('environment-review', 'welcome'), 1);
  assert.equal(setupStepMotionDirection('configure-openclaw', 'ready'), -1);
  assert.equal(setupStepMotionDirection('ready', 'configure-openclaw'), 1);
});

test('setup step transition keeps the initial scene stationary', () => {
  assert.equal(setupStepMotionDirection(null, 'welcome'), 0);
  assert.equal(setupStepMotionDirection('ready', 'ready'), 0);
});

test('setup step transition animates only the entering current scene', () => {
  assert.deepEqual(setupStepEntryState(-1, false), { opacity: 0, x: 28 });
  assert.deepEqual(setupStepEntryState(1, false), { opacity: 0, x: -28 });
  assert.deepEqual(setupStepEntryState(0, false), { opacity: 0, x: 0 });
});

test('setup step transition presents reduced motion immediately', () => {
  assert.deepEqual(setupStepEntryState(-1, true), { opacity: 1, x: 0 });
});
