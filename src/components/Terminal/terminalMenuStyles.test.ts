import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { TERMINAL_CONTEXT_MENU_STYLE } from './terminalMenuStyles';

const workspaceFilesSource = readFileSync(
  new URL('./TerminalWorkspaceFiles.tsx', import.meta.url),
  'utf8',
);

test('terminal context menu surface uses valid theme menu tokens', () => {
  assert.equal(TERMINAL_CONTEXT_MENU_STYLE.background, 'var(--aegis-menu-bg)');
  assert.equal(TERMINAL_CONTEXT_MENU_STYLE.border, '1px solid var(--aegis-menu-border)');
  assert.equal(TERMINAL_CONTEXT_MENU_STYLE.boxShadow, 'var(--aegis-menu-shadow)');
  assert.equal(TERMINAL_CONTEXT_MENU_STYLE.color, 'rgb(var(--aegis-menu-text))');
});

test('workspace file watching uses the lifecycle-safe Tauri event subscriber', () => {
  assert.match(workspaceFilesSource, /subscribeTauriEvent<\{ watchId\?: unknown \}>/);
  assert.doesNotMatch(workspaceFilesSource, /import \{ listen \} from '@tauri-apps\/api\/event'/);
});
