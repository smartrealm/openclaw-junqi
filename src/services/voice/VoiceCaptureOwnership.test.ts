import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceCaptureOwnership } from './VoiceCaptureOwnership';

test('过期采集租约不能释放后续启动的原生所有者', () => {
  const ownership = new VoiceCaptureOwnership();
  const first = ownership.begin('capture-first');
  assert.equal(ownership.takeCurrent(), first);

  const second = ownership.begin('capture-second');
  assert.equal(ownership.release(first), false);
  assert.equal(ownership.owns(second), true);
  assert.equal(ownership.getCurrent()?.ownerId, 'capture-second');
});

test('当前采集租约只允许被取走一次', () => {
  const ownership = new VoiceCaptureOwnership();
  const active = ownership.begin('capture-active');
  assert.equal(ownership.takeCurrent(), active);
  assert.equal(ownership.takeCurrent(), null);
  assert.equal(ownership.owns(active), false);
});
