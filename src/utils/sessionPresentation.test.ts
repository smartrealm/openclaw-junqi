import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Session } from '@/stores/chatStore';
import {
  agentIdFromSessionKey,
  classifySessionPresentation,
  cronJobIdFromSessionKey,
  isIsolatedExecutionSessionKey,
  isSessionExecutionActive,
  partitionSessionsForPresentation,
  parentSessionKeyForSession,
  projectSessionActivity,
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

test('local chat signals override stale gateway run flags in both directions', () => {
  const localRun = 'agent:main:desktop-local';
  const staleRemoteRun = 'agent:main:desktop-stale';
  const staleUnknownRun = 'agent:main:desktop-stale-unknown';
  const projection = projectSessionActivity({
    sessions: [
      session({ key: localRun, hasActiveRun: false }),
      session({ key: staleRemoteRun, hasActiveRun: true, status: 'done' }),
      session({ key: staleUnknownRun, hasActiveRun: true }),
    ],
    typingBySession: {
      [localRun]: true,
      [staleRemoteRun]: false,
      [staleUnknownRun]: false,
    },
    typingStartedAtBySession: { [localRun]: 1_234 },
  });

  assert.equal(projection.bySessionKey.get(localRun)?.state, 'running');
  assert.equal(projection.bySessionKey.get(localRun)?.startedAt, 1_234);
  assert.equal(projection.bySessionKey.get(staleRemoteRun)?.state, 'done');
  assert.equal(projection.bySessionKey.get(staleUnknownRun)?.state, 'unknown');
  assert.deepEqual(projection.active.map((activity) => activity.sessionKey), [localRun]);
});

test('an unobserved ordinary session keeps official external run activity', () => {
  const external = 'agent:main:desktop-external';
  const projection = projectSessionActivity({
    sessions: [session({ key: external, hasActiveRun: true })],
  });

  assert.equal(projection.bySessionKey.get(external)?.state, 'running');
  assert.equal(projection.bySessionKey.get(external)?.phase, 'background');
});

test('thinking and sending are first-class local activity signals', () => {
  const thinking = 'agent:writer:desktop-thinking';
  const sending = 'agent:main:desktop-sending';
  const projection = projectSessionActivity({
    sessions: [session({ key: thinking }), session({ key: sending })],
    thinkingBySession: { [thinking]: { runId: 'run-1', text: '' } },
    sendingBySession: { [sending]: true },
  });

  assert.equal(projection.bySessionKey.get(thinking)?.phase, 'thinking');
  assert.equal(projection.bySessionKey.get(sending)?.phase, 'sending');
});

test('background subagent and cron state remains authoritative without local chat signals', () => {
  const cron = 'agent:main:cron:job-1:run:run-1';
  const subagent = 'agent:writer:subagent:run-2';
  const projection = projectSessionActivity({
    sessions: [
      session({ key: cron, status: 'running' }),
      session({ key: subagent, hasActiveRun: true }),
    ],
  });

  assert.equal(projection.bySessionKey.get(cron)?.state, 'running');
  assert.equal(projection.bySessionKey.get(subagent)?.state, 'running');
  assert.deepEqual(
    new Set(projection.active.map((activity) => activity.sessionKey)),
    new Set([cron, subagent]),
  );
});

test('working display selection follows the selected active session then a thinking run', () => {
  const selected = 'agent:main:desktop-selected';
  const thinking = 'agent:writer:desktop-thinking';
  const signals = {
    sessions: [session({ key: selected }), session({ key: thinking })],
    typingBySession: { [selected]: true, [thinking]: true },
    thinkingBySession: { [thinking]: { runId: 'run-thinking', text: 'plan' } },
  };

  assert.equal(projectSessionActivity({ ...signals, activeSessionKey: selected }).workingDisplayKey, selected);
  assert.equal(projectSessionActivity(signals).workingDisplayKey, thinking);
});

test('local activity remains visible before its session row reaches sessions.list', () => {
  const sessionKey = 'agent:main:desktop-new';
  const projection = projectSessionActivity({
    sessions: [],
    sendingBySession: { [sessionKey]: true },
  });

  assert.equal(projection.workingDisplayKey, sessionKey);
  assert.equal(projection.bySessionKey.get(sessionKey)?.session, null);
});

test('session activity surfaces consume the shared projection contract', () => {
  const consumers = [
    '../components/Layout/TopBar.tsx',
    '../components/Layout/NavSidebar.tsx',
    '../components/Layout/NavSidebarPanels.tsx',
    '../dynamic-island/DynamicIslandRuntime.tsx',
    '../pages/ActivityCenter.tsx',
    '../components/Layout/StatusBar.tsx',
    '../pages/Dashboard/index.tsx',
  ];

  for (const relativePath of consumers) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /projectSessionActivity\(/, relativePath);
  }

  const topBar = readFileSync(new URL('../components/Layout/TopBar.tsx', import.meta.url), 'utf8');
  assert.match(topBar, /typingStartedAtBySession/);
  assert.match(topBar, /openTab\(workingDisplayKey\)/);
  assert.doesNotMatch(topBar, /startRef/);

  for (const relativePath of [
    '../components/Layout/StatusBar.tsx',
    '../pages/Dashboard/index.tsx',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /typingStartedAtBySession/, relativePath);
    assert.doesNotMatch(source, /sessions\.filter\(\(sx\) => sx\.running\)/, relativePath);
    assert.doesNotMatch(source, /sessions\.some\(\(s: any\) => Boolean\(s\.running\)\)/, relativePath);
  }
});
