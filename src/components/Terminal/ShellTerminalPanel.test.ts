import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ShellTerminalPanel.tsx', import.meta.url), 'utf8');

test('terminal tab context menu mirrors Kooky’s command set and shortcut layout', () => {
  assert.match(source, /TerminalKookyMenuItem/);
  assert.match(source, /shortcut=\{closeShortcut\}/);
  assert.match(source, /shortcut=\{splitRightShortcut\}/);
  assert.match(source, /shortcut=\{splitDownShortcut\}/);
  assert.match(source, /shortcut=\{renameShortcut\}/);
  assert.match(source, /minWidth: 240/);
  assert.doesNotMatch(source, /onCloseAll/);
  assert.doesNotMatch(source, /file\.closeAllTabs/);
});

test('terminal tab context menu stays within the viewport and dismisses predictably', () => {
  assert.match(source, /Math\.max\(4, Math\.min\(ctxMenu\.x/);
  assert.match(source, /Math\.max\(4, Math\.min\(ctxMenu\.y/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /window\.addEventListener\('resize', dismiss\)/);
  assert.match(source, /window\.addEventListener\('blur', dismiss\)/);
});

test('terminal menus use the shared opaque theme surface', () => {
  assert.match(source, /TERMINAL_CONTEXT_MENU_STYLE/);
  assert.doesNotMatch(source, /role="menu"[^>]*rgb\(var\(--aegis-elevated\)\)/);
});

test('terminal rename disables tab dragging while the input owns focus', () => {
  assert.match(source, /draggable=\{!renaming\}/);
  assert.match(source, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(source, /const \[renameSession, setRenameSession\]/);
  assert.match(source, /if \(result\.changed\) onRename\?\.\(result\.value\)/);
  assert.match(source, /cancelRename\(\)/);
});

test('terminal activity updates cannot steal focus from a rename input', () => {
  assert.match(source, /const onActiveTermChangeRef = useRef\(onActiveTermChange\)/);
  assert.match(source, /onActiveTermChangeRef\.current = onActiveTermChange/);
  assert.match(source, /onActiveTermChangeRef\.current\?\.\(terminalRef\.current as unknown as XTermType\)/);
  assert.match(source, /\}, \[isActive, isFocused, requestResize\]\);/);
  assert.doesNotMatch(source, /\}, \[isActive, isFocused, onActiveTermChange, requestResize\]\);/);
});

test('context-menu rename waits for the menu click to finish before focusing the input', () => {
  assert.match(source, /const startRename = \(deferred = false\) =>/);
  assert.match(source, /if \(deferred\) pendingRenameFrameRef\.current = requestAnimationFrame\(open\)/);
  assert.match(source, /onClick=\{\(\) => startRename\(true\)\}/);
  assert.match(source, /cancelAnimationFrame\(pendingRenameFrameRef\.current\)/);
});

test('terminal launcher menu is portaled and shares CLI availability with launch preferences', () => {
  assert.match(source, /ensureTerminalAgentAvailability/);
  assert.match(source, /subscribeTerminalAgentAvailability/);
  assert.match(source, /subscribeTerminalAgentPreferences/);
  assert.match(source, /visibleTerminalAgentIds/);
  assert.match(source, /addMenuOpen && createPortal/);
  assert.match(source, /defaultLauncher/);
  assert.match(source, /terminalLauncherIcon/);
});

test('terminal PTY subscriptions fail locally instead of becoming global promise rejections', () => {
  assert.match(source, /if \(hasTauriEventBridge\(\)\)/);
  assert.match(source, /void subscribe\(\)\.catch\(\(error\) =>/);
  assert.match(source, /unable to subscribe to PTY events/);
});

test('context-menu copy shares the smart copy fallback path', () => {
  assert.match(source, /await smartCopy\(terminal\)/);
  assert.match(source, /disabled=\{!selectedText\}/);
});

test('terminal content keeps Kooky’s uniform eight-point pane inset', () => {
  assert.match(source, /padding: "8px"/);
  assert.doesNotMatch(source, /padding: "4px 0 16px 6px"/);
});
