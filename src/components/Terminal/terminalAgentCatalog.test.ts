import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TERMINAL_AGENT_LAUNCHERS,
  isTerminalAgentId,
  terminalAgentLauncher,
} from './terminalAgentCatalog';

test('terminal agent catalog stays aligned with Kooky builtins', () => {
  assert.deepEqual(
    TERMINAL_AGENT_LAUNCHERS.map((agent) => agent.id),
    ['claude', 'codex', 'gemini', 'opencode', 'amp', 'cursor-agent', 'copilot', 'grok', 'agy', 'kimi', 'pi', 'kiro-cli', 'droid'],
  );
  assert.equal(isTerminalAgentId('droid'), true);
  assert.equal(isTerminalAgentId('aider'), false);
  const copilot = terminalAgentLauncher('copilot');
  assert.equal('promptFlag' in copilot ? copilot.promptFlag : undefined, '-p');
});
