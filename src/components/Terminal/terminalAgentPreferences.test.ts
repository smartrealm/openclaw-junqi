import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTerminalAgentPreferencesSnapshot,
  moveTerminalAgent,
  resetTerminalAgentPreferences,
  setTerminalAgentHidden,
  setTerminalDefaultLauncher,
  visibleTerminalAgentIds,
} from './terminalAgentPreferences';

test('terminal agent preferences keep one ordered source of truth', () => {
  resetTerminalAgentPreferences();
  assert.equal(visibleTerminalAgentIds()[0], 'claude');

  setTerminalAgentHidden('claude', true);
  assert.equal(visibleTerminalAgentIds().includes('claude'), false);

  setTerminalDefaultLauncher('codex');
  assert.equal(getTerminalAgentPreferencesSnapshot().defaultLauncherId, 'codex');
  moveTerminalAgent('codex', -1);
  assert.equal(visibleTerminalAgentIds()[0], 'codex');

  setTerminalAgentHidden('codex', true);
  assert.equal(getTerminalAgentPreferencesSnapshot().defaultLauncherId, null);
  resetTerminalAgentPreferences();
});
