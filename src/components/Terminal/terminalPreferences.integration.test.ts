import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('shell terminals consume shared scrollback and newline preferences', async () => {
  const shell = await read('./ShellTerminalPanel.tsx');
  const terminalPage = await read('../../pages/TerminalPage/index.tsx');
  const workspace = await read('../Workspace/WorkspaceView.tsx');

  const initialization = shell.slice(
    shell.indexOf('const { term, fitAddon, whenFontsReady } = initTerminal('),
    shell.indexOf('applyTerminalThemeOnPanel', shell.indexOf('const { term, fitAddon, whenFontsReady } = initTerminal(')),
  );
  assert.match(initialization, /terminalScrollbackRef\.current/);
  assert.doesNotMatch(initialization, /5000/);
  assert.match(shell, /matchesTerminalNewline\(event, terminalShiftEnterNewlineRef\.current\)/);
  assert.match(shell, /sendInput\(TERMINAL_NEWLINE_SEQUENCE\)/);
  assert.match(terminalPage, /useTerminalPreferences\(\)/);
  assert.match(terminalPage, /terminalScrollback=\{terminalScrollback\}/);
  assert.match(workspace, /useTerminalPreferences\(\)/);
  assert.match(workspace, /terminalFontSize=\{terminalFontSize\}/);
});
