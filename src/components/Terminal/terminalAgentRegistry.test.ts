import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearTerminalAgentOverview,
  getTerminalAgentOverviewSnapshot,
  nextTerminalAgentPanelMode,
  removeTerminalAgentOverview,
  subscribeTerminalAgentOverview,
  upsertTerminalAgentOverview,
} from './terminalAgentRegistry';

test('terminal agent panel follows Kooky full, compact, hidden order', () => {
  assert.equal(nextTerminalAgentPanelMode('full'), 'compact');
  assert.equal(nextTerminalAgentPanelMode('compact'), 'hidden');
  assert.equal(nextTerminalAgentPanelMode('hidden'), 'full');
});

test('terminal agent registry prioritizes attention and removes ended shells', () => {
  clearTerminalAgentOverview();
  let notifications = 0;
  const unsubscribe = subscribeTerminalAgentOverview(() => { notifications += 1; });
  let focused = '';

  upsertTerminalAgentOverview({
    shellId: 'shell-running', agent: 'codex', state: 'running', title: 'API', projectPath: '/repo/api',
    updatedAt: 20, focus: () => { focused = 'shell-running'; },
  });
  upsertTerminalAgentOverview({
    shellId: 'shell-attention', agent: 'claude', state: 'attention', title: 'Web', projectPath: '/repo/web',
    updatedAt: 10, focus: () => { focused = 'shell-attention'; },
  });

  const entries = getTerminalAgentOverviewSnapshot();
  assert.deepEqual(entries.map((entry) => entry.shellId), ['shell-attention', 'shell-running']);
  entries[0]?.focus();
  assert.equal(focused, 'shell-attention');

  removeTerminalAgentOverview('shell-attention');
  assert.deepEqual(getTerminalAgentOverviewSnapshot().map((entry) => entry.shellId), ['shell-running']);
  assert.ok(notifications >= 3);

  unsubscribe();
  clearTerminalAgentOverview();
});

test('refreshing an agent focus closure keeps the overview snapshot stable', () => {
  clearTerminalAgentOverview();
  let notifications = 0;
  const unsubscribe = subscribeTerminalAgentOverview(() => { notifications += 1; });
  const entry = {
    shellId: 'shell-1', agent: 'codex' as const, state: 'running' as const,
    title: 'Terminal', projectPath: '/repo',
  };

  upsertTerminalAgentOverview({ ...entry, focus: () => undefined });
  const firstSnapshot = getTerminalAgentOverviewSnapshot();
  upsertTerminalAgentOverview({ ...entry, focus: () => undefined });

  assert.strictEqual(getTerminalAgentOverviewSnapshot(), firstSnapshot);
  assert.equal(notifications, 1);

  unsubscribe();
  clearTerminalAgentOverview();
});
