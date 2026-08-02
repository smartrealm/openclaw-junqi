import assert from 'node:assert/strict';
import test from 'node:test';
import {
  includesVoiceWakeTrigger,
  normalizeVoiceWakeTrigger,
  resolveVoiceWakeRoute,
  type VoiceWakeRoutingConfig,
} from './voiceWakeTypes';

test('voice wake trigger matching follows the Gateway route normalization', () => {
  assert.equal(normalizeVoiceWakeTrigger(' Hey,  JunQi!! '), 'hey junqi');
  assert.equal(includesVoiceWakeTrigger(['Hey, JunQi!!'], 'hey junqi'), true);
  assert.equal(includesVoiceWakeTrigger(['junqi'], 'another assistant'), false);
});

test('voice wake route uses a normalized trigger match before the configured default', () => {
  const config: VoiceWakeRoutingConfig = {
    version: 1,
    defaultTarget: { mode: 'current' },
    routes: [{ trigger: 'Hey, JunQi!!', target: { sessionKey: 'agent:main:workspace' } }],
    updatedAtMs: 1,
  };

  assert.deepEqual(resolveVoiceWakeRoute(config, 'hey junqi'), { sessionKey: 'agent:main:workspace' });
  assert.deepEqual(resolveVoiceWakeRoute(config, 'other'), { mode: 'current' });
});
