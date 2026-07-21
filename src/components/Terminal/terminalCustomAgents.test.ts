import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTerminalCustomAgent,
  resetTerminalCustomAgentPreferences,
  terminalCustomAgentCommand,
  updateTerminalCustomAgent,
  visibleTerminalCustomAgents,
} from './terminalCustomAgents';

test('custom terminal agents inherit a real base CLI and prefix only valid environment assignments', () => {
  resetTerminalCustomAgentPreferences();
  const custom = addTerminalCustomAgent();
  updateTerminalCustomAgent(custom.id, {
    title: 'Claude Opus',
    baseAgentId: 'claude',
    env: 'MODEL=opus\nnot an assignment',
  });

  const visible = visibleTerminalCustomAgents();
  assert.equal(visible.length, 1);
  assert.equal(terminalCustomAgentCommand(visible[0]!, 'posix'), "MODEL='opus' claude");
  assert.equal(terminalCustomAgentCommand(visible[0]!, 'windows'), 'set "MODEL=opus" && claude');
  resetTerminalCustomAgentPreferences();
});
