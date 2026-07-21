import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTerminalAppearancePreferencesSnapshot,
  resetTerminalAppearancePreferences,
  setTerminalCursorStyle,
} from './terminalAppearancePreferences';

test('terminal cursor preference uses an xterm-supported style and resets to block', () => {
  resetTerminalAppearancePreferences();
  setTerminalCursorStyle('underline');
  assert.equal(getTerminalAppearancePreferencesSnapshot().cursorStyle, 'underline');
  resetTerminalAppearancePreferences();
  assert.equal(getTerminalAppearancePreferencesSnapshot().cursorStyle, 'block');
});
