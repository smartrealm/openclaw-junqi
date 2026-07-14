import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSidebarChannel, isWorkspaceSidebarMode, nextWorkspaceSidebarMode } from './workspaceSidebarChannel';

test('workspace sidebar channels use isolated event and storage namespaces', () => {
  const terminal = createWorkspaceSidebarChannel('terminal');
  const agent = createWorkspaceSidebarChannel('agent-workspace');
  assert.equal(terminal.toggleEvent, 'junqi:toggle-terminal-sidebar');
  assert.equal(agent.modeEvent, 'junqi:agent-workspace-sidebar-mode');
  assert.notEqual(terminal.storageKey, agent.storageKey);
});

test('workspace sidebar cycles through full, compact and hidden modes', () => {
  assert.equal(nextWorkspaceSidebarMode('full'), 'compact');
  assert.equal(nextWorkspaceSidebarMode('compact'), 'hidden');
  assert.equal(nextWorkspaceSidebarMode('hidden'), 'full');
});

test('workspace sidebar mode validation rejects persisted garbage', () => {
  assert.equal(isWorkspaceSidebarMode('full'), true);
  assert.equal(isWorkspaceSidebarMode('compact'), true);
  assert.equal(isWorkspaceSidebarMode('hidden'), true);
  assert.equal(isWorkspaceSidebarMode('collapsed'), false);
});
