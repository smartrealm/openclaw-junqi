import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TerminalHookNotificationTracker,
  terminalNotificationFocusShellId,
  terminalNotificationTarget,
} from './terminalNotifications';

test('terminal hook notifications use only verified lifecycle transitions', () => {
  const tracker = new TerminalHookNotificationTracker();
  const running = { shellId: 'shell 1', runId: 'run-1', agent: 'claude', kind: 'lifecycle' as const, event: 'running' as const };
  const attention = { ...running, event: 'attention' as const };

  assert.equal(tracker.next(running, 'shell 1', 'repo'), null);
  assert.deepEqual(tracker.next(attention, 'shell 1', 'repo'), {
    level: 'attention',
    agent: 'claude',
    title: 'Claude Code is waiting on you',
    body: 'repo',
    url: '/terminal?focusShell=shell%201',
  });
  assert.equal(tracker.next(attention, 'shell 1', 'repo'), null);
  assert.equal(tracker.next(running, 'shell 1', 'repo'), null);
  assert.ok(tracker.next(attention, 'shell 1', 'repo'));
});

test('terminal hook notifications preserve real tool failures and reject unknown agents', () => {
  const tracker = new TerminalHookNotificationTracker();
  assert.deepEqual(tracker.next({
    shellId: 'shell-1', runId: 'run-1', agent: 'claude', kind: 'tool', event: 'post', toolName: 'Bash', toolUseId: 'tool-1', success: false,
  }, 'shell-1', 'repo'), {
    level: 'error', agent: 'claude', title: 'Command failed', body: 'repo', url: '/terminal?focusShell=shell-1',
  });
  assert.equal(tracker.next({
    shellId: 'shell-1', runId: 'run-1', agent: 'claude', kind: 'tool', event: 'post', toolName: 'Bash', toolUseId: 'tool-1', success: false,
  }, 'shell-1', 'repo'), null);
  assert.equal(tracker.next({
    shellId: 'shell-1', runId: 'run-1', agent: 'unknown', kind: 'lifecycle', event: 'attention',
  }, 'shell-1', 'repo'), null);
});

test('terminal focus targets round-trip through a route query', () => {
  assert.equal(terminalNotificationTarget(' shell / one '), '/terminal?focusShell=shell%20%2F%20one');
  assert.equal(terminalNotificationFocusShellId('?focusShell=shell%20%2F%20one'), 'shell / one');
  assert.equal(terminalNotificationFocusShellId('?focusShell='), null);
});
