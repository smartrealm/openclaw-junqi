import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTerminalKeepAwakeMode,
  nextTerminalKeepAwakeMode,
  shouldKeepTerminalAwake,
} from './terminalKeepAwake';

test('terminal keep-awake follows Kooky off, auto, always dial order', () => {
  assert.equal(nextTerminalKeepAwakeMode('off'), 'auto');
  assert.equal(nextTerminalKeepAwakeMode('auto'), 'always');
  assert.equal(nextTerminalKeepAwakeMode('always'), 'off');
  assert.equal(isTerminalKeepAwakeMode('auto'), true);
  assert.equal(isTerminalKeepAwakeMode('active'), false);
});

test('auto keep-awake follows only real terminal work', () => {
  assert.equal(shouldKeepTerminalAwake('off', true), false);
  assert.equal(shouldKeepTerminalAwake('auto', false), false);
  assert.equal(shouldKeepTerminalAwake('auto', true), true);
  assert.equal(shouldKeepTerminalAwake('always', false), true);
});
