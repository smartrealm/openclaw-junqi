import assert from 'node:assert/strict';
import test from 'node:test';
import { setupStepEntryState, setupStepMotionDirection, setupStepMotionMode, setupStepScene } from './setupStepTransition';

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

test('Gateway 配置核验与官方向导共享一个视觉场景', () => {
  assert.equal(setupStepScene('gateway-ready'), 'configure-openclaw');
  assert.equal(setupStepScene('configure-openclaw'), 'configure-openclaw');
});

test('setup step transition animates only the entering current scene', () => {
  assert.deepEqual(setupStepEntryState(-1, false), { opacity: 0.96, x: 12, y: 0 });
  assert.deepEqual(setupStepEntryState(1, false), { opacity: 0.96, x: -12, y: 0 });
  assert.deepEqual(setupStepEntryState(0, false), { opacity: 1, x: 0, y: 0 });
});

test('setup step transition presents reduced motion immediately', () => {
  assert.deepEqual(setupStepEntryState(-1, true), { opacity: 1, x: 0, y: 0 });
});

test('setup step transition uses ambient motion for runtime states', () => {
  assert.equal(setupStepMotionMode('decision'), 'directional');
  assert.equal(setupStepMotionMode('official-wizard'), 'directional');
  assert.equal(setupStepMotionMode('operation'), 'ambient');
  assert.equal(setupStepMotionMode('gateway-ready'), 'ambient');
  assert.equal(setupStepMotionMode('failure'), 'ambient');
  assert.deepEqual(setupStepEntryState(1, false, 'ambient'), { opacity: 0.98, x: 0, y: 4 });
});
