import assert from 'node:assert/strict';
import test from 'node:test';
import { decideVoiceWakeRoute } from './VoiceWakeRoutePolicy';

const configuration = {
  triggers: { triggers: ['Hey, JunQi!!', 'other agent'] },
  routing: {
    version: 1 as const,
    defaultTarget: { mode: 'current' as const },
    routes: [{ trigger: 'other agent', target: { sessionKey: 'agent:main:other' } }],
    updatedAtMs: 1,
  },
};

test('wake route policy rejects a local keyword absent from the Gateway trigger list', () => {
  assert.equal(decideVoiceWakeRoute(configuration, 'unconfigured word', 'agent:main:main'), 'unknown_trigger');
});

test('wake route policy allows the configured current route', () => {
  assert.equal(decideVoiceWakeRoute(configuration, 'hey junqi', 'agent:main:main'), 'accepted');
});

test('wake route policy fails closed for another session target', () => {
  assert.equal(decideVoiceWakeRoute(configuration, 'other agent', 'agent:main:main'), 'target_changed');
});
