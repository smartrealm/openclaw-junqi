import assert from 'node:assert/strict';
import test from 'node:test';
import { SETUP_CONTENT_PRESENCE_MODE, setupContentEntryState, setupContentExitState, setupContentMotionDirection, setupStepEntryState, setupStepMotionDirection, setupStepMotionMode, setupStepScene, setupStepScrollKey } from './setupStepTransition';

test('setup step transition moves forward from left to right and back from right to left', () => {
  assert.equal(setupStepMotionDirection('welcome', 'environment-review'), -1);
  assert.equal(setupStepMotionDirection('environment-review', 'welcome'), 1);
  assert.equal(setupStepMotionDirection('configure-openclaw', 'ready'), -1);
  assert.equal(setupStepMotionDirection('ready', 'configure-openclaw'), 1);
});

test('setup step transition keeps the initial scene stationary', () => {
  assert.equal(setupStepMotionDirection(null, 'welcome'), 0);
  assert.equal(setupStepMotionDirection('ready', 'ready'), 0);
});

test('Gateway 配置核验与运行时安装共享一个视觉场景', () => {
  assert.equal(setupStepScene('gateway-ready'), 'checking');
  assert.equal(setupStepScene('configure-openclaw'), 'configure-openclaw');
});

test('欢迎、环境探测与结果复核共享一个常驻视觉场景', () => {
  assert.equal(setupStepScene('welcome'), 'environment-review');
  assert.equal(setupStepScene('detecting'), 'environment-review');
  assert.equal(setupStepScene('environment-review'), 'environment-review');
});

test('共享视觉场景的环境探测与结果复核仍使用独立滚动位置', () => {
  assert.notEqual(setupStepScrollKey('detecting'), setupStepScrollKey('environment-review'));
});

test('共享视觉场景的配置核验与官方向导仍使用独立滚动位置', () => {
  assert.notEqual(setupStepScrollKey('gateway-ready'), setupStepScrollKey('configure-openclaw'));
});

test('同一官方向导中的不同结构化步骤使用独立滚动位置', () => {
  assert.notEqual(
    setupStepScrollKey('configure-openclaw', 'channel-selection'),
    setupStepScrollKey('configure-openclaw', 'channel-authorization'),
  );
});

test('setup step transition animates only the entering current scene', () => {
  assert.deepEqual(setupStepEntryState(-1, false), { opacity: 0.96, x: -12, y: 0 });
  assert.deepEqual(setupStepEntryState(1, false), { opacity: 0.96, x: 12, y: 0 });
  assert.deepEqual(setupStepEntryState(0, false), { opacity: 1, x: 0, y: 0 });
});

test('setup step transition presents reduced motion immediately', () => {
  assert.deepEqual(setupStepEntryState(-1, true), { opacity: 1, x: 0, y: 0 });
});

test('运行时状态不位移动画，避免探测进度交接时闪动', () => {
  assert.equal(setupStepMotionMode('decision'), 'directional');
  assert.equal(setupStepMotionMode('official-wizard'), 'directional');
  assert.equal(setupStepMotionMode('operation'), 'ambient');
  assert.equal(setupStepMotionMode('failure'), 'ambient');
  assert.deepEqual(setupStepEntryState(1, false, 'ambient'), { opacity: 1, x: 0, y: 0 });
});

test('同一向导场景按用户导航方向切换内容', () => {
  assert.equal(SETUP_CONTENT_PRESENCE_MODE, 'wait');
  assert.equal(setupContentMotionDirection('forward'), -1);
  assert.equal(setupContentMotionDirection('backward'), 1);
  assert.equal(setupContentMotionDirection('ambient'), 0);
  assert.deepEqual(setupContentEntryState(-1, false), { opacity: 0.97, x: -14 });
  assert.deepEqual(setupContentExitState(-1, false), { opacity: 0.97, x: 10 });
});

test('后台状态和减少动态效果不产生内容位移', () => {
  assert.deepEqual(setupContentEntryState(0, false), { opacity: 1, x: 0 });
  assert.deepEqual(setupContentEntryState(-1, true), { opacity: 1, x: 0 });
  assert.deepEqual(setupContentExitState(-1, true), { opacity: 1, x: 0 });
});
