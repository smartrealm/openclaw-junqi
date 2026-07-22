import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearTerminalSessionOverview,
  focusTerminalSessionOverview,
  getTerminalSessionOverviewSnapshot,
  subscribeTerminalSessionOverview,
  upsertTerminalSessionOverview,
} from './terminalSessionRegistry';

test('terminal notification focus resolves only a live shell', () => {
  clearTerminalSessionOverview();
  let focused = false;
  upsertTerminalSessionOverview({
    shellId: 'shell-1', paneId: 'pane-1', title: 'Terminal', projectPath: '/repo', focus: () => { focused = true; },
  });

  assert.equal(focusTerminalSessionOverview('shell-1'), true);
  assert.equal(focused, true);
  assert.equal(focusTerminalSessionOverview('closed-shell'), false);
  clearTerminalSessionOverview();
});

test('refreshing a terminal focus closure keeps the session snapshot stable', () => {
  clearTerminalSessionOverview();
  let notifications = 0;
  const unsubscribe = subscribeTerminalSessionOverview(() => { notifications += 1; });
  let focused = 'first';
  const entry = { shellId: 'shell-1', paneId: 'pane-1', title: 'Terminal', projectPath: '/repo' };

  upsertTerminalSessionOverview({ ...entry, focus: () => { focused = 'first'; } });
  const firstSnapshot = getTerminalSessionOverviewSnapshot();
  upsertTerminalSessionOverview({ ...entry, focus: () => { focused = 'latest'; } });

  assert.strictEqual(getTerminalSessionOverviewSnapshot(), firstSnapshot);
  assert.equal(notifications, 1);
  assert.equal(focusTerminalSessionOverview('shell-1'), true);
  assert.equal(focused, 'latest');

  unsubscribe();
  clearTerminalSessionOverview();
});
