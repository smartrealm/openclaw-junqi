import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { FALLBACK_NEW_SESSION_AGENT_ID, resolveNewSessionAgentId } from './sessionLifecycle';

test('a new session starts on the agent of the session in view', () => {
  assert.equal(resolveNewSessionAgentId('agent:research:desktop-abc', ['main', 'research']), 'research');
  assert.equal(resolveNewSessionAgentId('agent:main:main', ['main', 'research']), 'main');
});

test('unresolvable context falls back to the main agent', () => {
  for (const key of [null, undefined, '', 'not-a-session-key', 'agent:', ':::']) {
    assert.equal(resolveNewSessionAgentId(key, ['main', 'research']), FALLBACK_NEW_SESSION_AGENT_ID);
  }
});

// A stale tab must not create a session on an agent the gateway dropped.
test('an agent the gateway no longer reports is not reused', () => {
  assert.equal(resolveNewSessionAgentId('agent:removed:desktop-1', ['main', 'research']), 'main');
  // An empty roster means the list has not loaded yet; the key is still the
  // best available context and must not be discarded.
  assert.equal(resolveNewSessionAgentId('agent:research:desktop-1', []), 'research');
});

// Regression: the picker seeded from `agentList[0]`, an arbitrary gateway-ordered
// entry, and never re-synced once `agents.list` arrived after mount.
test('the new-session picker seeds from session context, not list order', () => {
  const source = readFileSync('src/components/Chat/ChatTabs.tsx', 'utf8');
  assert.match(source, /resolveNewSessionAgentId\(activeSessionKey/);
  assert.doesNotMatch(source, /useState\(agentList\[0\]\?\.id \?\? 'main'\)/);
  assert.match(source, /if \(open && !wasOpenRef\.current\) setSelectedAgentId\(seedAgentId\)/);
});

// Regression: the dashboard shortcut hard-coded `agent=main`, so the same
// action produced a different agent depending on which surface started it.
test('every new-session entry resolves the agent the same way', () => {
  const dashboard = readFileSync('src/pages/Dashboard/index.tsx', 'utf8');
  const sidebar = readFileSync('src/components/Layout/NavSidebar.tsx', 'utf8');
  assert.match(dashboard, /resolveNewSessionAgentId\(activeSessionKey/);
  assert.doesNotMatch(dashboard, /\/chat\?agent=main&new=1/);
  assert.match(sidebar, /resolveNewSessionAgentId\(activeKey, agents\.map\(\(agent\) => agent\.id\)\)/);
  assert.match(sidebar, /agentId: newSessionAgentId/);
  assert.doesNotMatch(sidebar, /agentId: 'main'/);
});

test('ordinary creation leaves title generation to OpenClaw and forks keep an explicit title', () => {
  const route = readFileSync('src/hooks/useAgentScopedSession.ts', 'utf8');
  const picker = readFileSync('src/components/Chat/ChatTabs.tsx', 'utf8');
  const sidebar = readFileSync('src/components/Layout/NavSidebar.tsx', 'utf8');
  const actions = readFileSync('src/components/Chat/session-actions/SessionActionsMenu.tsx', 'utf8');
  for (const source of [route, picker, sidebar]) {
    assert.doesNotMatch(source, /label: t\('chat\.newSessionLabel'\)/);
    assert.doesNotMatch(source, /label: '新会话'/);
  }
  assert.match(actions, /label: t\('chat\.forkedSessionLabel'\)/);
  assert.match(actions, /parentSessionKey: session\.key,\s+fork: true/);
  for (const locale of ['zh', 'zh-TW', 'en']) {
    const bundle = JSON.parse(readFileSync(`src/locales/${locale}.json`, 'utf8'));
    assert.equal(typeof bundle.chat?.newSessionLabel, 'string', `${locale} is missing chat.newSessionLabel`);
    assert.equal(typeof bundle.chat?.newSessionCreationFailed, 'string', `${locale} is missing chat.newSessionCreationFailed`);
  }
});
