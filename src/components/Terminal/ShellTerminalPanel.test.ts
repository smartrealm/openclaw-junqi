import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ShellTerminalPanel.tsx', import.meta.url), 'utf8');

test('terminal tab context menu exposes every documented close operation', () => {
  assert.match(source, /onCloseAll\?: \(\) => void/);
  assert.match(source, /file\.closeAllTabs/);
  assert.match(source, /shells\.forEach\(recordClosedTerminalShell\)/);
  assert.match(source, /setShells\(\[\]\)/);
  assert.match(source, /onClose\(\)/);
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

test('context-menu rename waits for the menu click to finish before focusing the input', () => {
  assert.match(source, /const startRename = \(deferred = false\) =>/);
  assert.match(source, /if \(deferred\) pendingRenameFrameRef\.current = requestAnimationFrame\(open\)/);
  assert.match(source, /onClick=\{\(\) => startRename\(true\)\}/);
  assert.match(source, /cancelAnimationFrame\(pendingRenameFrameRef\.current\)/);
});

test('terminal launcher menu is portaled and populated from detected CLI tools', () => {
  assert.match(source, /invoke<DetectedCliTool\[]>\('detect_cli_tools'\)/);
  assert.match(source, /addMenuOpen && createPortal/);
  assert.match(source, /TERMINAL_AGENT_LAUNCHERS/);
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
