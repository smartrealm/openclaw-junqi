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
  assert.match(dashboard, /resolveNewSessionAgentId\(activeSessionKey/);
  assert.doesNotMatch(dashboard, /\/chat\?agent=main&new=1/);

  const sidebar = readFileSync('src/components/Layout/NavSidebar.tsx', 'utf8');
  assert.match(sidebar, /resolveNewSessionAgentId\(activeKey, agents\.map\(\(agent\) => agent\.id\)\)/);
  assert.doesNotMatch(sidebar, /createNativeSession\(\{\s*agentId: 'main'/);
});

test('the placeholder session label is localised and shared by every creation entry', () => {
  for (const file of [
    'src/hooks/useAgentScopedSession.ts',
    'src/components/Chat/ChatTabs.tsx',
    'src/components/Layout/NavSidebar.tsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /label: t\('chat\.newSessionLabel'/, `${file} must use the persistent session label`);
    assert.doesNotMatch(source, /label: '新会话'/);
  }
  for (const locale of ['zh', 'zh-TW', 'en']) {
    const bundle = JSON.parse(readFileSync(`src/locales/${locale}.json`, 'utf8'));
    assert.equal(typeof bundle.chat?.newSessionLabel, 'string', `${locale} is missing chat.newSessionLabel`);
  }
});
