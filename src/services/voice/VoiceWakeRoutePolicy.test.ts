import assert from 'node:assert/strict';
import test from 'node:test';
import { decideVoiceWakeRoute, hasCompatibleVoiceWakeTrigger } from './VoiceWakeRoutePolicy';

const configuration = {
  triggers: { triggers: ['Jarvis', 'other agent', 'research agent'] },
  routing: {
    version: 1 as const,
    defaultTarget: { mode: 'current' as const },
    routes: [
      { trigger: 'JARVIS!!', target: { mode: 'current' as const } },
      { trigger: 'other agent', target: { sessionKey: 'agent:main:other' } },
      { trigger: 'research agent', target: { agentId: 'research' } },
    ],
    updatedAtMs: 1,
  },
};

test('wake route policy rejects a local keyword absent from the Gateway trigger list', () => {
  assert.equal(decideVoiceWakeRoute(configuration, 'unconfigured word', { sessionKey: 'agent:main:main', agentId: 'main' }), 'unknown_trigger');
});

test('wake route policy allows the configured current route', () => {
  assert.equal(decideVoiceWakeRoute(configuration, 'Jarvis', { sessionKey: 'agent:main:main', agentId: 'main' }), 'accepted');
});

test('wake route policy never broadens a global trigger into a route-normalized match', () => {
  assert.equal(decideVoiceWakeRoute(configuration, 'jarvis', { sessionKey: 'agent:main:main', agentId: 'main' }), 'unknown_trigger');
});

test('wake route policy fails closed for another session target', () => {
  assert.equal(decideVoiceWakeRoute(configuration, 'other agent', { sessionKey: 'agent:main:main', agentId: 'main' }), 'target_changed');
});

test('wake route policy matches an agent route only against the Gateway-projected session identity', () => {
  assert.equal(
    decideVoiceWakeRoute(configuration, 'research agent', { sessionKey: 'noncanonical-key', agentId: 'research' }),
    'accepted',
  );
});

test('wake route policy fails closed when the selected session has no matching Gateway agent identity', () => {
  assert.equal(
    decideVoiceWakeRoute(configuration, 'research agent', { sessionKey: 'agent:research:main' }),
    'target_changed',
  );
  assert.equal(
    decideVoiceWakeRoute(configuration, 'research agent', { sessionKey: 'agent:main:main', agentId: 'main' }),
    'target_changed',
  );
});

test('wake model must expose at least one Gateway-owned trigger before it can arm', () => {
  assert.equal(hasCompatibleVoiceWakeTrigger(['HEY_JUNQI'], configuration), false);
  assert.equal(hasCompatibleVoiceWakeTrigger(['other agent'], configuration), true);
});
