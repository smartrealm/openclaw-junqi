import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTerminalPreset,
  getTerminalPresetPreferencesSnapshot,
  resetTerminalPresetPreferences,
  setTerminalPresetHidden,
  terminalPresetDisplayTitle,
  updateTerminalPreset,
  visibleTerminalPresets,
} from './terminalPresets';

test('terminal presets retain a stable configuration but only expose valid visible paths', () => {
  resetTerminalPresetPreferences();
  const preset = addTerminalPreset();
  updateTerminalPreset(preset.id, { path: '/repo/workspace' });

  assert.equal(terminalPresetDisplayTitle(getTerminalPresetPreferencesSnapshot().presets[0]!), 'workspace');
  assert.deepEqual(visibleTerminalPresets().map((entry) => entry.id), [preset.id]);

  setTerminalPresetHidden(preset.id, true);
  assert.deepEqual(visibleTerminalPresets(), []);
  resetTerminalPresetPreferences();
});
