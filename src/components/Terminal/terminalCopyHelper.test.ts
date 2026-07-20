import assert from 'node:assert/strict';
import test from 'node:test';
import { isTerminalCopyShortcut } from './terminalCopyHelper';

function key(overrides: Partial<KeyboardEvent> = {}) {
  return {
    type: 'keydown',
    key: 'c',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

test('terminal copy uses Command on macOS without stealing Ctrl+C', () => {
  assert.equal(isTerminalCopyShortcut(key({ metaKey: true }), 'macos'), true);
  assert.equal(isTerminalCopyShortcut(key({ ctrlKey: true }), 'macos'), false);
});

test('terminal copy uses Ctrl on Windows and Linux', () => {
  assert.equal(isTerminalCopyShortcut(key({ ctrlKey: true }), 'windows'), true);
  assert.equal(isTerminalCopyShortcut(key({ ctrlKey: true }), 'other'), true);
  assert.equal(isTerminalCopyShortcut(key({ metaKey: true }), 'windows'), false);
});
