import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usePetStore, type PomodoroState } from '@/stores/petStore';
import { startPomodoro, stopPomodoro, togglePausePomodoro } from './petActions';

const NOW = 1_700_000_000_000;

function resetPomodoro(overrides: Partial<PomodoroState> = {}) {
  usePetStore.setState((state) => ({
    pomodoro: {
      ...state.pomodoro,
      enabled: true,
      workMin: 30,
      breakMin: 5,
      longBreakMin: 15,
      running: false,
      paused: false,
      phase: 'work',
      endsAt: null,
      pausedRemainingMs: null,
      lastDoneTs: 0,
      workRounds: 0,
      completedToday: 0,
      completedDate: '2026-07-07',
      ...overrides,
    },
  }));
}

test('startPomodoro starts a fresh protected work phase', () => {
  const originalNow = Date.now;
  Date.now = () => NOW;
  try {
    resetPomodoro({ workMin: 0, lastDoneTs: 123 });

    startPomodoro();

    const p = usePetStore.getState().pomodoro;
    assert.equal(p.running, true);
    assert.equal(p.paused, false);
    assert.equal(p.phase, 'work');
    assert.equal(p.endsAt, NOW + 60_000);
    assert.equal(p.lastDoneTs, 0);
  } finally {
    Date.now = originalNow;
  }
});

test('togglePausePomodoro ignores stopped timers', () => {
  resetPomodoro({ running: false, paused: false, endsAt: null });

  togglePausePomodoro();

  const p = usePetStore.getState().pomodoro;
  assert.equal(p.running, false);
  assert.equal(p.paused, false);
  assert.equal(p.endsAt, null);
});

test('togglePausePomodoro pauses and resumes with a positive remaining duration', () => {
  const originalNow = Date.now;
  Date.now = () => NOW;
  try {
    resetPomodoro({ running: true, paused: false, endsAt: NOW - 500 });

    togglePausePomodoro();

    let p = usePetStore.getState().pomodoro;
    assert.equal(p.paused, true);
    assert.equal(p.pausedRemainingMs, -500);
    assert.equal(p.endsAt, null);

    togglePausePomodoro();

    p = usePetStore.getState().pomodoro;
    assert.equal(p.paused, false);
    assert.equal(p.pausedRemainingMs, null);
    assert.equal(p.endsAt, NOW + 1_000);
  } finally {
    Date.now = originalNow;
  }
});

test('stopPomodoro clears runtime state', () => {
  resetPomodoro({ running: true, paused: true, endsAt: NOW + 10_000, pausedRemainingMs: 10_000 });

  stopPomodoro();

  const p = usePetStore.getState().pomodoro;
  assert.equal(p.running, false);
  assert.equal(p.paused, false);
  assert.equal(p.endsAt, null);
  assert.equal(p.pausedRemainingMs, null);
});
