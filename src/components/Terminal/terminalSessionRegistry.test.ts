import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearTerminalSessionOverview,
  focusTerminalSessionOverview,
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
