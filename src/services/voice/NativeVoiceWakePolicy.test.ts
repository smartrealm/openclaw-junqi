import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNativeVoiceWakePolicy } from './NativeVoiceWakePolicy';

const ready = {
  capability: true,
  enabled: true,
  connected: true,
  voiceBusy: false,
  triggersReady: true,
  error: null,
} as const;

test('Windows 本地唤醒只在全部前置条件成立时监听', () => {
  assert.deepEqual(resolveNativeVoiceWakePolicy(ready), {
    phase: 'preparing',
    shouldListen: true,
  });
  assert.deepEqual(resolveNativeVoiceWakePolicy({ ...ready, enabled: false }), {
    phase: 'disabled',
    shouldListen: false,
  });
  assert.deepEqual(resolveNativeVoiceWakePolicy({ ...ready, connected: false }), {
    phase: 'waiting_gateway',
    shouldListen: false,
  });
  assert.deepEqual(resolveNativeVoiceWakePolicy({ ...ready, voiceBusy: true }), {
    phase: 'paused_busy',
    shouldListen: false,
  });
});

test('Windows 本地唤醒对不支持平台和配置错误保持失败关闭', () => {
  assert.deepEqual(resolveNativeVoiceWakePolicy({ ...ready, capability: false }), {
    phase: 'unsupported',
    shouldListen: false,
  });
  assert.deepEqual(resolveNativeVoiceWakePolicy({
    ...ready,
    triggersReady: false,
    error: 'Gateway 唤醒词无效',
  }), {
    phase: 'error',
    shouldListen: false,
  });
});
