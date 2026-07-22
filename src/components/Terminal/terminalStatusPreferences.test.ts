import assert from 'node:assert/strict';
import test from 'node:test';
import {
  moveTerminalStatusItem,
  resetTerminalStatusPreferences,
  setTerminalStatusItemHidden,
  visibleTerminalStatusItems,
} from './terminalStatusPreferences';

test('terminal status preferences keep a complete ordered real-signal list', () => {
  resetTerminalStatusPreferences();
  moveTerminalStatusItem('git-diff', -1);
  setTerminalStatusItemHidden('proxy', true);

  const visible = visibleTerminalStatusItems();
  assert.equal(visible.includes('proxy'), false);
  assert.equal(visible.indexOf('git-diff') < visible.indexOf('git-branch'), true);
  resetTerminalStatusPreferences();
});
