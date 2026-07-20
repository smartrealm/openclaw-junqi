import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('terminal preferences reach every shell terminal entry point', () => {
  const terminalPage = source('../../pages/TerminalPage/index.tsx');
  const agentWorkspace = source('../../pages/AgentWorkspace/index.tsx');
  const workspaceView = source('../Workspace/WorkspaceView.tsx');
  const shellPanel = source('../Terminal/ShellTerminalPanel.tsx');

  assert.match(terminalPage, /useTerminalPreferences\(\)/);
  assert.match(terminalPage, /terminalScrollback=\{terminalScrollback\}/);
  assert.match(terminalPage, /terminalShiftEnterNewline=\{terminalShiftEnterNewline\}/);
  assert.match(agentWorkspace, /terminalScrollback=\{terminalScrollback\}/);
  assert.match(agentWorkspace, /terminalShiftEnterNewline=\{terminalShiftEnterNewline\}/);
  assert.match(workspaceView, /terminalScrollback=\{terminalScrollback\}/);
  assert.match(workspaceView, /terminalShiftEnterNewline=\{terminalShiftEnterNewline\}/);
  assert.match(shellPanel, /options\.scrollback = terminalScrollback/);
  assert.match(shellPanel, /matchesTerminalNewline\(event, terminalShiftEnterNewlineRef\.current\)/);
});

test('terminal settings have native persistence and a deep-linkable settings tab', () => {
  const appSettings = source('../../../src-tauri/src/commands/app_settings.rs');
  const commandRegistry = source('../../../src-tauri/src/lib.rs');
  const settingsPage = source('../../pages/SettingsPage.tsx');

  assert.match(appSettings, /save_terminal_scrollback/);
  assert.match(appSettings, /save_terminal_shift_enter_newline/);
  assert.match(commandRegistry, /commands::app_settings::save_terminal_scrollback/);
  assert.match(commandRegistry, /commands::app_settings::save_terminal_shift_enter_newline/);
  assert.match(settingsPage, /useSearchParams\(\)/);
  assert.match(settingsPage, /activeTab === 'terminal'/);
  assert.match(settingsPage, /<TerminalSettingsPanel \/>/);
});

test('terminal settings are translated in every supported locale', () => {
  const locales = ['zh', 'zh-TW', 'en', 'ar'] as const;
  const openTerminalMarkers: Record<(typeof locales)[number], string> = {
    zh: '已打开',
    'zh-TW': '已打開',
    en: 'open',
    ar: 'المفتوحة',
  };
  const keys = [
    'settings.tab.terminal',
    'terminalSettings.title',
    'terminalSettings.description',
    'terminalSettings.scrollback',
    'terminalSettings.scrollbackHint',
    'terminalSettings.shiftEnter',
    'terminalSettings.saveFailed',
  ];

  for (const locale of locales) {
    const messages = JSON.parse(source(`../../locales/${locale}.json`)) as Record<string, unknown>;
    for (const key of keys) {
      const nested = key.split('.').reduce<unknown>((value, part) => {
        if (!value || typeof value !== 'object') return undefined;
        return (value as Record<string, unknown>)[part];
      }, messages);
      const value = messages[key] ?? nested;
      assert.equal(typeof value, 'string', `${locale} is missing ${key}`);
      assert.notEqual((value as string).trim(), '', `${locale} has an empty ${key}`);
    }

    const scrollbackHint = (messages.terminalSettings as Record<string, unknown>).scrollbackHint;
    assert.match(String(scrollbackHint), new RegExp(openTerminalMarkers[locale]));
  }
});
