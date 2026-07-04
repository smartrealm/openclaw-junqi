import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePetState, type PetInputs } from './pet-states';

/** Build a PetInputs with sane defaults, overriding only what a case cares about. */
const base = (over: Partial<PetInputs> = {}): PetInputs => ({
  connected: true,
  connectionError: null,
  thinking: false,
  typing: false,
  tool: false,
  running: false,
  lastReplyTs: 0,
  lastTaskDoneTs: 0,
  lastCompactionTs: 0,
  pomodoroDoneTs: 0,
  lastSwallowTs: 0,
  swallowTick: 0,
  lastDragEnterTs: 0,
  lastDragLeaveTs: 0,
  dragOver: false,
  dragCount: 0,
  dragKind: null,
  lastActivityTs: 1000,
  now: 2000,
  progress: 0,
  ...over,
});

test('disconnected → sleep', () => {
  assert.equal(derivePetState(base({ connected: false })).emotion, 'sleep');
});

test('connection error → error (beats active states)', () => {
  assert.equal(derivePetState(base({ connectionError: 'boom', typing: true })).emotion, 'error');
});

test('thinking has top active priority', () => {
  assert.equal(derivePetState(base({ thinking: true, typing: true, running: true })).emotion, 'thinking');
});

test('typing beats running', () => {
  assert.equal(derivePetState(base({ typing: true, running: true })).emotion, 'typing');
});

test('running → working', () => {
  assert.equal(derivePetState(base({ running: true })).emotion, 'working');
});

test('recently completed task → celebrate', () => {
  assert.equal(derivePetState(base({ lastTaskDoneTs: 1800 })).emotion, 'celebrate');
});

test('recent reply → happy', () => {
  assert.equal(derivePetState(base({ lastReplyTs: 1800 })).emotion, 'happy');
});

test('celebrate wins over happy when both recent', () => {
  assert.equal(derivePetState(base({ lastTaskDoneTs: 1800, lastReplyTs: 1800 })).emotion, 'celebrate');
});

test('active state suppresses the happy window', () => {
  assert.equal(derivePetState(base({ typing: true, lastReplyTs: 1900 })).emotion, 'typing');
});

test('idle a while → sleepy', () => {
  assert.equal(derivePetState(base({ lastActivityTs: 0, now: 120_000 })).emotion, 'sleepy');
});

test('idle long enough → sleep', () => {
  assert.equal(derivePetState(base({ lastActivityTs: 0, now: 6 * 60_000 })).emotion, 'sleep');
});

test('default → idle', () => {
  assert.equal(derivePetState(base()).emotion, 'idle');
});

test('expired happy window falls back to idle', () => {
  assert.equal(derivePetState(base({ lastReplyTs: 0, now: 10_000 })).emotion, 'idle');
});

test('task celebrate carries kind=task', () => {
  assert.equal(derivePetState(base({ lastTaskDoneTs: 1800 })).celebrateKind, 'task');
});

test('pomodoro celebrate carries the given kind', () => {
  assert.equal(
    derivePetState(base({ pomodoroDoneTs: 1800, pomodoroDoneKind: 'pomodoroWorkLong' })).celebrateKind,
    'pomodoroWorkLong',
  );
});

test('pomodoro celebrate defaults to pomodoroWork kind', () => {
  assert.equal(derivePetState(base({ pomodoroDoneTs: 1800 })).celebrateKind, 'pomodoroWork');
});
