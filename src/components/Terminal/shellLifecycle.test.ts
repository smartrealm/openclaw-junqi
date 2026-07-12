import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceShellLaunchPath,
  applyTerminalToolCallEvent,
  formatTerminalToolDuration,
  markStalledTerminalToolCalls,
  clearRecentlyClosedTerminalShells,
  isGeneratedShellTitle,
  migrateShellTitleState,
  normalizeShellCustomTitle,
  parseOsc7Cwd,
  parseJunqiAgentStatusTitle,
  recordClosedTerminalShell,
  resolveShellDisplayTitle,
  shellStateFromExit,
  terminalAgentLaunchCommand,
  takeRecentlyClosedTerminalShell,
} from './shellLifecycle';

test('parseOsc7Cwd accepts local and localhost file URLs', () => {
  assert.equal(parseOsc7Cwd('file:///Users/wei/project'), '/Users/wei/project');
  assert.equal(parseOsc7Cwd('file://localhost/Users/wei/project%20one'), '/Users/wei/project one');
  assert.equal(parseOsc7Cwd('file://my-mac/Users/wei/project'), '/Users/wei/project');
  assert.equal(parseOsc7Cwd('file:///C:/work/junqi'), 'C:/work/junqi');
  assert.equal(
    parseOsc7Cwd('file://server/share/project%20one', 'windows'),
    '//server/share/project one',
  );
  assert.equal(
    parseOsc7Cwd('file://localhost/C%3A/work/100%2520real%23one%3Ftwo'),
    'C:/work/100%20real#one?two',
  );
  assert.equal(parseOsc7Cwd('file://localhost/tmp/%E9%A1%B9%E7%9B%AE%20one'), '/tmp/\u9879\u76ee one');
});

test('parseOsc7Cwd rejects non-file and malformed payloads', () => {
  assert.equal(parseOsc7Cwd('https://example.com/repo'), null);
  assert.equal(parseOsc7Cwd('not a url'), null);
  assert.equal(parseOsc7Cwd('file://localhost/tmp/bad%00path'), null);
});

test('shell exit state marks transport failures distinctly', () => {
  assert.equal(shellStateFromExit({ shell_id: 'a', run_id: 'r', exit_code: 0, reason: 'exited' }), 'exited');
  assert.equal(shellStateFromExit({ shell_id: 'a', run_id: 'r', exit_code: null, reason: 'io_error' }), 'failed');
  assert.equal(isGeneratedShellTitle('Terminal 3'), true);
  assert.equal(isGeneratedShellTitle('API terminal'), false);
});

test('agent OSC title markers only affect JunQi-owned agent state', () => {
  assert.deepEqual(parseJunqiAgentStatusTitle('junqi-agent:claude:running'), {
    agent: 'claude', state: 'running',
  });
  assert.equal(parseJunqiAgentStatusTitle('junqi-agent:codex:ended'), null);
  assert.equal(parseJunqiAgentStatusTitle('plain terminal title'), undefined);
  assert.equal(parseJunqiAgentStatusTitle('junqi-agent:gemini:running'), undefined);
});

test('tool hook events retain a bounded per-shell timeline and complete matching calls', () => {
  const started = applyTerminalToolCallEvent([], {
    shellId: 'shell-1', runId: 'run-1', agent: 'claude', kind: 'tool', event: 'pre',
    toolName: 'Bash', identifier: 'pnpm test', toolUseId: 'tool-1',
  }, 100);
  assert.deepEqual(started, [{
    id: 'tool-1', toolName: 'Bash', identifier: 'pnpm test', state: 'running', startedAt: 100,
  }]);
  const completed = applyTerminalToolCallEvent(started, {
    shellId: 'shell-1', runId: 'run-1', agent: 'claude', kind: 'tool', event: 'post',
    toolName: 'Bash', identifier: 'pnpm test', toolUseId: 'tool-1', success: true,
  }, 240);
  assert.deepEqual(completed, [{
    id: 'tool-1', toolName: 'Bash', identifier: 'pnpm test', state: 'success', startedAt: 100, completedAt: 240,
  }]);
});

test('orphan tool calls stall after one minute and accept a late completion', () => {
  const running = [{ id: 'tool-1', toolName: 'Read', state: 'running' as const, startedAt: 0 }];
  const stalled = markStalledTerminalToolCalls(running, 60_001)!;
  assert.equal(stalled[0].state, 'stalled');
  assert.equal(formatTerminalToolDuration(stalled[0]), '1:00');
  const recovered = applyTerminalToolCallEvent(stalled, {
    shellId: 'shell-1', runId: 'run-1', agent: 'claude', kind: 'tool', event: 'post', toolName: 'Read', success: true,
  }, 61_000)!;
  assert.equal(recovered[0].state, 'success');
});

test('OSC cwd changes do not replace a running shell launch path', () => {
  const initial = advanceShellLaunchPath(null, '/workspace', 0);
  const afterCwdChange = advanceShellLaunchPath(initial, '/workspace/packages/app', 0);
  const afterRestart = advanceShellLaunchPath(afterCwdChange, '/workspace/packages/app', 1);

  assert.equal(afterCwdChange, initial);
  assert.equal(afterCwdChange.path, '/workspace');
  assert.deepEqual(afterRestart, { restartNonce: 1, path: '/workspace/packages/app' });
});

test('manual shell titles are independent from generated labels', () => {
  assert.equal(normalizeShellCustomTitle('  API logs  '), 'API logs');
  assert.equal(normalizeShellCustomTitle('  \n '), undefined);
  assert.equal(resolveShellDisplayTitle({
    customTitle: 'Terminal 7',
    cwd: '/workspace/server',
    generatedTitle: 'Terminal 1',
  }), 'Terminal 7');
});

test('clearing a manual shell title resumes directory tracking', () => {
  assert.equal(resolveShellDisplayTitle({
    customTitle: '  ',
    cwd: 'C:\\work\\junqi',
    generatedTitle: 'Terminal 1',
  }), 'junqi');
  assert.equal(resolveShellDisplayTitle({ generatedTitle: 'Terminal 2' }), 'Terminal 2');
});

test('legacy persisted titles migrate without losing manual renames', () => {
  assert.deepEqual(migrateShellTitleState({ title: 'API logs' }, 'Terminal 1'), {
    generatedTitle: 'Terminal 1',
    customTitle: 'API logs',
  });
  assert.deepEqual(migrateShellTitleState({ title: 'Terminal 3' }, 'Terminal 1'), {
    generatedTitle: 'Terminal 3',
  });
  assert.deepEqual(migrateShellTitleState({
    generatedTitle: 'Terminal 1',
    customTitle: 'Terminal 7',
  }, 'Terminal 9'), {
    generatedTitle: 'Terminal 1',
    customTitle: 'Terminal 7',
  });
});

test('Ask Agent preserves the selected terminal text as exactly one shell argument', () => {
  assert.equal(
    terminalAgentLaunchCommand('claude', "fix 'quoted' value\nand keep spacing", 'posix'),
    "claude 'fix '\"'\"'quoted'\"'\"' value\nand keep spacing'",
  );
  assert.equal(
    terminalAgentLaunchCommand('codex', "it's a path with spaces", 'windows'),
    "codex 'it''s a path with spaces'",
  );
});

test('recently closed terminal tabs reopen as a bounded LIFO runtime history', () => {
  clearRecentlyClosedTerminalShells();
  recordClosedTerminalShell({ generatedTitle: 'Terminal 1', cwd: '/repo/api' });
  recordClosedTerminalShell({ generatedTitle: 'Codex', customTitle: 'Fix release', cwd: '/repo/web' });

  assert.deepEqual(takeRecentlyClosedTerminalShell(), {
    generatedTitle: 'Codex',
    customTitle: 'Fix release',
    cwd: '/repo/web',
  });
  assert.deepEqual(takeRecentlyClosedTerminalShell(), {
    generatedTitle: 'Terminal 1',
    cwd: '/repo/api',
  });
  assert.equal(takeRecentlyClosedTerminalShell(), null);
});
