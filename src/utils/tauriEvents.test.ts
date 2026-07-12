import assert from 'node:assert/strict';
import test from 'node:test';
import { hasTauriEventBridge, subscribeTauriEvent } from './tauriEvents';

test('plain browser previews do not register Tauri listeners', () => {
  const host = globalThis.window as Window & { __TAURI_INTERNALS__?: unknown };
  const previous = host.__TAURI_INTERNALS__;
  delete host.__TAURI_INTERNALS__;
  try {
    assert.equal(hasTauriEventBridge(), false);
    assert.doesNotThrow(() => subscribeTauriEvent('task-status', () => {}));
  } finally {
    host.__TAURI_INTERNALS__ = previous;
  }
});
