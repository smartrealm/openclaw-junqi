import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeVoiceWakeRouteTarget,
  decodeVoiceWakeRoutingConfig,
  decodeVoiceWakeTriggerSnapshot,
  isCanonicalVoiceWakeSessionKey,
  isValidVoiceWakeAgentId,
  isValidVoiceWakeRouteTarget,
  MAX_VOICE_WAKE_TRIGGER_LENGTH,
  MAX_VOICE_WAKE_TRIGGERS,
  normalizeVoiceWakeListTrigger,
  normalizeVoiceWakeRouteTrigger,
} from '@/types/voiceWake';

test('全局唤醒词只裁剪空白而路由键遵循官方匹配规范', () => {
  assert.equal(normalizeVoiceWakeListTrigger(' Hey,  JunQi!! '), 'Hey,  JunQi!!');
  assert.equal(normalizeVoiceWakeRouteTrigger(' Hey,  JunQi!! '), 'hey junqi');
});

test('唤醒词快照只接受官方数量和 UTF-16 长度边界', () => {
  assert.deepEqual(decodeVoiceWakeTriggerSnapshot({ triggers: ['junqi', 'computer'] }), {
    triggers: ['junqi', 'computer'],
  });
  assert.equal(decodeVoiceWakeTriggerSnapshot({ triggers: [] }), null);
  assert.equal(decodeVoiceWakeTriggerSnapshot({
    triggers: Array.from({ length: MAX_VOICE_WAKE_TRIGGERS + 1 }, (_, index) => `wake-${index}`),
  }), null);
  assert.equal(decodeVoiceWakeTriggerSnapshot({
    triggers: ['x'.repeat(MAX_VOICE_WAKE_TRIGGER_LENGTH + 1)],
  }), null);
});

test('路由目标必须且只能指定当前会话、智能体或规范会话之一', () => {
  assert.deepEqual(decodeVoiceWakeRouteTarget({ mode: 'current' }), { mode: 'current' });
  assert.deepEqual(decodeVoiceWakeRouteTarget({ agentId: 'main' }), { agentId: 'main' });
  assert.deepEqual(decodeVoiceWakeRouteTarget({ sessionKey: 'agent:main:main' }), {
    sessionKey: 'agent:main:main',
  });
  assert.equal(decodeVoiceWakeRouteTarget({ mode: 'current', agentId: 'main' }), null);
  assert.equal(decodeVoiceWakeRouteTarget({ mode: 'other' }), null);
  assert.equal(decodeVoiceWakeRouteTarget({ agentId: '../main' }), null);
  assert.equal(decodeVoiceWakeRouteTarget({ sessionKey: 'main' }), null);
  assert.equal(decodeVoiceWakeRouteTarget({ sessionKey: 'agent:main:' }), null);
  assert.equal(decodeVoiceWakeRouteTarget({}), null);
  assert.equal(isValidVoiceWakeAgentId('agent_01'), true);
  assert.equal(isCanonicalVoiceWakeSessionKey('agent:agent_01:main'), true);
  assert.equal(isValidVoiceWakeRouteTarget({ sessionKey: 'agent:agent_01:main' }), true);
});

test('路由配置解码保留 Gateway 的版本、时间和目标结构', () => {
  const config = {
    version: 1,
    defaultTarget: { mode: 'current' },
    routes: [{ trigger: 'hey junqi', target: { sessionKey: 'agent:main:main' } }],
    updatedAtMs: 100,
  };
  assert.deepEqual(decodeVoiceWakeRoutingConfig(config), config);
  assert.equal(decodeVoiceWakeRoutingConfig({ ...config, version: 2 }), null);
  assert.equal(decodeVoiceWakeRoutingConfig({ ...config, updatedAtMs: -1 }), null);
  assert.equal(decodeVoiceWakeRoutingConfig({ ...config, updatedAtMs: 1.5 }), null);
  assert.equal(decodeVoiceWakeRoutingConfig({
    ...config,
    routes: [{ trigger: 'Hey, JunQi!!', target: { mode: 'current' } }],
  }), null);
  assert.equal(decodeVoiceWakeRoutingConfig({
    ...config,
    routes: [
      { trigger: 'hey junqi', target: { mode: 'current' } },
      { trigger: 'hey junqi', target: { mode: 'current' } },
    ],
  }), null);
});
