import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@/stores/chatStore';
import {
  agentIdFromSessionKey,
  classifySessionPresentation,
  cronJobIdFromSessionKey,
  isIsolatedExecutionSessionKey,
  isSessionExecutionActive,
  partitionSessionsForPresentation,
  parentSessionKeyForSession,
  sessionExecutionState,
} from './sessionPresentation';

function session(partial: Partial<Session> & { key: string }): Session {
  return { label: partial.key, ...partial };
}

test('classifies official cron and subagent keys without hiding normal channel sessions', () => {
  assert.equal(classifySessionPresentation(session({ key: 'agent:main:cron:job-1:run:run-1' })), 'cron');
  assert.equal(classifySessionPresentation(session({ key: 'agent:main:subagent:run-1' })), 'subagent');
  assert.equal(classifySessionPresentation(session({ key: 'agent:main:telegram:dm:42' })), 'conversation');
  assert.equal(classifySessionPresentation(session({ key: 'agent:main:slack:cron:channel-name' })), 'conversation');
  assert.equal(classifySessionPresentation(session({ key: 'agent:main:legacy', origin: { surface: 'heartbeat' } })), 'system');
  assert.equal(isIsolatedExecutionSessionKey('agent:main:cron:job-1:run:run-1'), true);
  assert.equal(isIsolatedExecutionSessionKey('cron:legacy-job'), true);
  assert.equal(isIsolatedExecutionSessionKey('subagent:legacy-run'), true);
  assert.equal(isIsolatedExecutionSessionKey('agent:main:telegram:dm:42'), false);
});

test('uses cron job metadata to group memory dreaming separately', () => {
  const dreaming = session({ key: 'agent:main:cron:memory-dream:run:run-1' });
  assert.equal(cronJobIdFromSessionKey(dreaming.key), 'memory-dream');
  assert.equal(classifySessionPresentation(dreaming, new Map([
    ['memory-dream', { id: 'memory-dream', name: 'Memory Dreaming Promotion' }],
  ])), 'dreaming');
});

test('partitions background sessions and preserves unknown sessions as conversations', () => {
  const result = partitionSessionsForPresentation([
    session({ key: 'agent:main:main' }),
    session({ key: 'agent:main:cron:job-1:run:run-1' }),
    session({ key: 'agent:main:subagent:run-1' }),
    session({ key: 'agent:main:legacy:session', kind: 'unknown' }),
  ]);

  assert.deepEqual(result.conversations.map((item) => item.key), ['agent:main:main', 'agent:main:legacy:session']);
  assert.equal(result.background.cron.length, 1);
  assert.equal(result.background.subagent.length, 1);
  assert.equal(isSessionExecutionActive(session({ key: 'agent:main:cron:job', status: 'running' })), true);
  assert.equal(isSessionExecutionActive(session({ key: 'agent:main:cron:job', status: 'done' })), false);
  assert.equal(sessionExecutionState(session({ key: 'agent:main:subagent:run-1', subagentRunState: 'done' })), 'done');
  assert.equal(sessionExecutionState(session({ key: 'agent:main:subagent:run-2', status: 'cancelled' })), 'failed');
});

test('resolves subagent ownership from OpenClaw parent metadata', () => {
  const child = session({
    key: 'agent:research:subagent:913a829b-fb76-4bc3-972c-97f12e3508dd',
    parentSessionKey: 'agent:main:desktop-parent',
    spawnedBy: 'agent:legacy:main',
  });

  assert.equal(agentIdFromSessionKey(child.key), 'research');
  assert.equal(parentSessionKeyForSession(child), 'agent:main:desktop-parent');
  assert.equal(agentIdFromSessionKey(parentSessionKeyForSession(child) ?? ''), 'main');
});
