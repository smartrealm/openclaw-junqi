import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeNativeVoiceWakeCapability,
  decodeNativeVoiceWakeCommandResult,
  decodeNativeVoiceWakeEvent,
  normalizeNativeVoiceWakeTriggers,
} from './nativeVoiceWakeContract';

test('Windows 本地唤醒能力只接受明确的 SAPI 契约', () => {
  assert.deepEqual(decodeNativeVoiceWakeCapability({
    supported: true,
    engine: 'windows-sapi',
  }), {
    supported: true,
    engine: 'windows-sapi',
  });
  assert.deepEqual(decodeNativeVoiceWakeCapability({
    supported: false,
    engine: null,
  }), {
    supported: false,
    engine: null,
  });
  assert.equal(decodeNativeVoiceWakeCapability({ supported: true, engine: null }), null);
  assert.equal(decodeNativeVoiceWakeCapability({ supported: false, engine: 'windows-sapi' }), null);
});

test('Windows 本地唤醒命令结果严格保留所有者围栏', () => {
  assert.deepEqual(decodeNativeVoiceWakeCommandResult({
    ownerId: 'voice-wake:1',
    supported: true,
    listening: true,
    reused: false,
    stopped: false,
  }), {
    ownerId: 'voice-wake:1',
    supported: true,
    listening: true,
    reused: false,
    stopped: false,
  });
  assert.equal(decodeNativeVoiceWakeCommandResult({
    supported: true,
    listening: true,
    reused: false,
    stopped: false,
  }), null);
  assert.equal(decodeNativeVoiceWakeCommandResult({
    ownerId: 'voice-wake:1',
    supported: false,
    listening: true,
    reused: false,
    stopped: false,
  }), null);
});

test('Windows 本地唤醒事件不接受自由文本或未知状态', () => {
  assert.deepEqual(decodeNativeVoiceWakeEvent({
    ownerId: 'voice-wake:1',
    state: 'detected',
    trigger: 'openclaw',
  }), {
    ownerId: 'voice-wake:1',
    state: 'detected',
    trigger: 'openclaw',
  });
  assert.deepEqual(decodeNativeVoiceWakeEvent({
    ownerId: 'voice-wake:1',
    state: 'error',
    error: '没有可用语言包',
  }), {
    ownerId: 'voice-wake:1',
    state: 'error',
    error: '没有可用语言包',
  });
  assert.equal(decodeNativeVoiceWakeEvent({
    ownerId: 'voice-wake:1',
    state: 'recognized',
    text: 'openclaw 请打开文件',
  }), null);
});

test('Windows 本地唤醒词按 UTF-16 长度校验并忽略大小写去重', () => {
  assert.deepEqual(normalizeNativeVoiceWakeTriggers([
    ' OpenClaw ',
    'openclaw',
    '君旗',
  ]), ['OpenClaw', '君旗']);
  assert.equal(normalizeNativeVoiceWakeTriggers([]), null);
  assert.equal(normalizeNativeVoiceWakeTriggers(['a'.repeat(65)]), null);
  assert.equal(normalizeNativeVoiceWakeTriggers(['𠮷'.repeat(33)]), null);
});
