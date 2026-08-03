import assert from 'node:assert/strict';
import test from 'node:test';
import {
  includesVoiceWakeTrigger,
  normalizeVoiceWakeListTrigger,
  normalizeVoiceWakeRouteTrigger,
  resolveVoiceWakeRoute,
  type VoiceWakeRoutingConfig,
} from './voiceWakeTypes';

test('voice wake keeps global triggers exact while routing normalizes route keys', () => {
  assert.equal(normalizeVoiceWakeListTrigger(' Hey,  JunQi!! '), 'Hey,  JunQi!!');
  assert.equal(normalizeVoiceWakeRouteTrigger(' Hey,  JunQi!! '), 'hey junqi');
  assert.equal(includesVoiceWakeTrigger(['Hey, JunQi!!'], 'hey junqi'), false);
  assert.equal(includesVoiceWakeTrigger(['Hey, JunQi!!'], ' Hey, JunQi!! '), true);
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
