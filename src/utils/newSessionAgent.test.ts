import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveNewSessionAgentId } from './sessionLifecycle';

test('a new session starts on the agent of the session in view', () => {
  assert.equal(resolveNewSessionAgentId('agent:research:desktop-abc', ['main', 'research'], 'main'), 'research');
  assert.equal(resolveNewSessionAgentId('agent:main:main', ['main', 'research'], 'research'), 'main');
});

test('unresolvable context falls back to the main agent', () => {
  for (const key of [null, undefined, '', 'not-a-session-key', 'agent:', ':::']) {
    assert.equal(resolveNewSessionAgentId(key, ['main', 'research'], 'research'), 'research');
  }
});

// A stale tab must not create a session on an agent the gateway dropped.
test('an agent the gateway no longer reports is not reused', () => {
    assert.equal(resolveNewSessionAgentId('agent:removed:desktop-1', ['main', 'research'], 'research'), 'research');
  // An empty roster means the list has not loaded yet; the key is still the
  // best available context and must not be discarded.
    assert.equal(resolveNewSessionAgentId('agent:research:desktop-1', [], 'research'), null);
});

// Regression: the picker seeded from `agentList[0]`, an arbitrary gateway-ordered
// entry, and never re-synced once `agents.list` arrived after mount.
test('the new-session picker seeds from session context, not list order', () => {
  const source = readFileSync('src/components/Chat/ChatTabs.tsx', 'utf8');
  assert.match(source, /resolveNewSessionAgentId\(\s*activeSessionKey/);
  assert.doesNotMatch(source, /useState\(agentList\[0\]\?\.id \?\? 'main'\)/);
  assert.match(source, /setSelectedAgentId\(seedAgentId\s*\?\?/);
});

// Dashboard 从当前会话解析智能体；侧栏存在显式选择器时必须使用用户选中的智能体。
test('各新建会话入口使用其界面已经确认的智能体身份', () => {
  const dashboard = readFileSync('src/pages/Dashboard/index.tsx', 'utf8');
  const sidebar = readFileSync('src/components/Layout/NavSidebar.tsx', 'utf8');
  assert.match(dashboard, /resolveNewSessionAgentId\(\s*activeSessionKey/);
  assert.doesNotMatch(dashboard, /\/chat\?agent=main&new=1/);
  assert.match(sidebar, /resolveNewSessionAgentId\(\s*activeKey[\s\S]*defaultAgentId/);
  assert.match(sidebar, /createNativeSession\(\{ agentId: selectedAgentId \}\)/);
  assert.doesNotMatch(sidebar, /agentId: 'main'/);
});

test('ordinary creation and forks leave title generation to OpenClaw', () => {
  const route = readFileSync('src/hooks/useAgentScopedSession.ts', 'utf8');
  const picker = readFileSync('src/components/Chat/ChatTabs.tsx', 'utf8');
  const sidebar = readFileSync('src/components/Layout/NavSidebar.tsx', 'utf8');
  const actions = readFileSync('src/components/Chat/session-actions/SessionActionsMenu.tsx', 'utf8');
  for (const source of [route, picker, sidebar]) {
    assert.doesNotMatch(source, /label: t\('chat\.newSessionLabel'\)/);
    assert.doesNotMatch(source, /label: '新会话'/);
  }
  assert.doesNotMatch(actions, /label: t\('chat\.forkedSessionLabel'\)/);
  assert.match(actions, /parentSessionKey: session\.key,\s+fork: true/);
  for (const locale of ['zh', 'zh-TW', 'en']) {
    const bundle = JSON.parse(readFileSync(`src/locales/${locale}.json`, 'utf8'));
    assert.equal(typeof bundle.chat?.newSessionLabel, 'string', `${locale} is missing chat.newSessionLabel`);
    assert.equal(typeof bundle.chat?.newSessionCreationFailed, 'string', `${locale} is missing chat.newSessionCreationFailed`);
  }
});
