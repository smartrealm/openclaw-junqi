import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVoiceWakeStandbySessionRestore } from './VoiceWakeStandbySessionRestore';

test('待命恢复只选择认证 Gateway 已投影的精确会话', () => {
  const restore = resolveVoiceWakeStandbySessionRestore({
    attestedConnectionId: 'connection-a',
    standbySessionKey: 'agent:main:jarvis',
    sessions: [{ key: 'agent:main:main' }, { key: 'agent:main:jarvis' }],
    restoredBinding: null,
  });

  assert.deepEqual(restore, {
    binding: 'connection-a\u0000agent:main:jarvis',
    sessionKey: 'agent:main:jarvis',
  });
});

test('待命恢复不会根据本地绑定虚构不存在的 Gateway 会话', () => {
  const restore = resolveVoiceWakeStandbySessionRestore({
    attestedConnectionId: 'connection-a',
    standbySessionKey: 'agent:main:jarvis',
    sessions: [{ key: 'agent:main:main' }],
    restoredBinding: null,
  });

  assert.equal(restore, null);
});

test('同一连接只恢复一次，重建认证连接后才允许重新恢复', () => {
  const currentBinding = 'connection-a\u0000agent:main:jarvis';
  const base = {
    standbySessionKey: 'agent:main:jarvis',
    sessions: [{ key: 'agent:main:jarvis' }],
  };

  assert.equal(resolveVoiceWakeStandbySessionRestore({
    ...base,
    attestedConnectionId: 'connection-a',
    restoredBinding: currentBinding,
  }), null);
  assert.deepEqual(resolveVoiceWakeStandbySessionRestore({
    ...base,
    attestedConnectionId: 'connection-b',
    restoredBinding: currentBinding,
  }), {
    binding: 'connection-b\u0000agent:main:jarvis',
    sessionKey: 'agent:main:jarvis',
  });
});

test('待命恢复在缺少认证连接或绑定时失败关闭', () => {
  const base = { sessions: [{ key: 'agent:main:jarvis' }], restoredBinding: null };
  assert.equal(resolveVoiceWakeStandbySessionRestore({
    ...base,
    attestedConnectionId: null,
    standbySessionKey: 'agent:main:jarvis',
  }), null);
  assert.equal(resolveVoiceWakeStandbySessionRestore({
    ...base,
    attestedConnectionId: 'connection-a',
    standbySessionKey: null,
  }), null);
});
