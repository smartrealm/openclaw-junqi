import assert from 'node:assert/strict';
import test from 'node:test';
import { presentVoiceWakeWindow, type VoiceWakeWindow } from './VoiceWakeWindowPresenter';

function windowWith(overrides: Partial<VoiceWakeWindow> = {}): VoiceWakeWindow {
  return {
    show: async () => undefined,
    unminimize: async () => undefined,
    setFocus: async () => undefined,
    ...overrides,
  };
}

test('wake presentation makes the window visible and then requests focus', async () => {
  const calls: string[] = [];
  const result = await presentVoiceWakeWindow(windowWith({
    show: async () => { calls.push('show'); },
    unminimize: async () => { calls.push('unminimize'); },
    setFocus: async () => { calls.push('focus'); },
  }));

  assert.deepEqual(result, { visible: true, focused: true });
  assert.equal(calls.at(-1), 'focus');
  assert.deepEqual(new Set(calls.slice(0, 2)), new Set(['show', 'unminimize']));
});

test('a focus denial leaves the wake surface visible', async () => {
  const result = await presentVoiceWakeWindow(windowWith({
    setFocus: async () => { throw new Error('focus denied'); },
  }));

  assert.deepEqual(result, { visible: true, focused: false });
});

test('a visibility failure never reports a usable full-window surface', async () => {
  const result = await presentVoiceWakeWindow(windowWith({
    show: async () => { throw new Error('show failed'); },
  }));

  assert.deepEqual(result, { visible: false, focused: false });
});
