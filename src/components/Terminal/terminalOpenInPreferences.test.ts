import assert from 'node:assert/strict';
import test from 'node:test';
import {
  moveTerminalOpenInApp,
  resetTerminalOpenInPreferences,
  setTerminalOpenInAppHidden,
  setTerminalOpenInLastUsed,
  visibleTerminalOpenInApps,
} from './terminalOpenInPreferences';

const apps = [
  { id: 'finder', label: 'Finder' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'zed', label: 'Zed' },
];

test('Open In preferences order installed apps, hide rows, and retain a real primary target', () => {
  resetTerminalOpenInPreferences();
  moveTerminalOpenInApp('zed', -1, apps.map((app) => app.id));
  assert.deepEqual(visibleTerminalOpenInApps(apps).map((app) => app.id), ['finder', 'zed', 'vscode']);

  setTerminalOpenInLastUsed('zed');
  setTerminalOpenInAppHidden('zed', true);
  assert.deepEqual(visibleTerminalOpenInApps(apps).map((app) => app.id), ['finder', 'vscode']);
  resetTerminalOpenInPreferences();
});
