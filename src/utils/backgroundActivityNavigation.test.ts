import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBackgroundActivityNavigation } from './backgroundActivityNavigation';

test('cron-backed background activity opens the matching scheduled task', () => {
  const sessionKey = 'agent:main:cron:dream-job:run:2026-07-21';

  assert.deepEqual(resolveBackgroundActivityNavigation('dreaming', sessionKey), {
    kind: 'route',
    to: '/cron?job=dream-job&session=agent%3Amain%3Acron%3Adream-job%3Arun%3A2026-07-21',
  });
  assert.deepEqual(resolveBackgroundActivityNavigation('cron', sessionKey), {
    kind: 'route',
    to: '/cron?job=dream-job&session=agent%3Amain%3Acron%3Adream-job%3Arun%3A2026-07-21',
  });
});

test('subagent and system activity use their owning surfaces', () => {
  assert.deepEqual(resolveBackgroundActivityNavigation('subagent', 'agent:main:subagent:worker'), {
    kind: 'chat',
    sessionKey: 'agent:main:subagent:worker',
  });
  assert.deepEqual(resolveBackgroundActivityNavigation('system', 'global'), {
    kind: 'route',
    to: '/activity?session=global',
  });
});
