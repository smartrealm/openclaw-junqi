import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveNativeVoiceWakeSessionKey,
  resolveNativeVoiceWakeTarget,
} from './NativeVoiceWakeRouting';
import type { VoiceWakeRoutingConfig } from '@/types/voiceWake';

const config: VoiceWakeRoutingConfig = {
  version: 1,
  defaultTarget: { mode: 'current' },
  routes: [{ trigger: 'hey junqi', target: { agentId: 'jarvis' } }],
  updatedAtMs: 1,
};

test('Windows 本地唤醒按 Gateway 的规范化触发词选择路由', () => {
  assert.deepEqual(resolveNativeVoiceWakeTarget(config, ' Hey,   JunQi!! '), {
    agentId: 'jarvis',
  });
  assert.deepEqual(resolveNativeVoiceWakeTarget(config, 'openclaw'), {
    mode: 'current',
  });
});

test('Windows 本地唤醒只从已有 Gateway 会话投影解析目标', () => {
  const projection = {
    activeSessionKey: 'agent:main:work',
    sessions: [
      { key: 'agent:main:main', label: 'Main', agentId: 'main', kind: 'main' },
      { key: 'agent:main:work', label: 'Work', agentId: 'main' },
      { key: 'gateway-session-7', label: 'Jarvis', agentId: 'jarvis' },
    ],
  };
  assert.equal(resolveNativeVoiceWakeSessionKey({ mode: 'current' }, projection), 'agent:main:work');
  assert.equal(resolveNativeVoiceWakeSessionKey({ sessionKey: 'agent:main:main' }, projection), 'agent:main:main');
  assert.equal(
    resolveNativeVoiceWakeSessionKey({ agentId: 'jarvis' }, projection, 'gateway-session-7'),
    'gateway-session-7',
  );
  assert.equal(resolveNativeVoiceWakeSessionKey({ agentId: 'missing' }, projection), null);
  assert.equal(resolveNativeVoiceWakeSessionKey({ sessionKey: 'agent:missing:main' }, projection), null);
});

test('Windows 本地唤醒拒绝猜测未由 Gateway 解析的智能体目标', () => {
  assert.equal(resolveNativeVoiceWakeSessionKey({ agentId: 'jarvis' }, {
    activeSessionKey: 'session-a',
    sessions: [
      { key: 'session-a', agentId: 'jarvis' },
      { key: 'session-b', agentId: 'jarvis' },
    ],
  }), null);
  assert.equal(resolveNativeVoiceWakeSessionKey({ agentId: 'jarvis' }, {
    activeSessionKey: 'session-a',
    sessions: [
      { key: 'session-a', agentId: 'jarvis' },
      { key: 'session-b', agentId: 'jarvis' },
    ],
  }, 'session-b'), 'session-b');
});

test('Windows 本地唤醒在全局范围内按规范键匹配智能体作用域别名', () => {
  assert.equal(resolveNativeVoiceWakeSessionKey({ agentId: 'jarvis' }, {
    activeSessionKey: 'agent:main:global',
    sessions: [
      { key: 'agent:main:global', agentId: 'main' },
      { key: 'agent:jarvis:global', agentId: 'jarvis' },
    ],
  }, 'agent:jarvis:global'), 'agent:jarvis:global');
});
