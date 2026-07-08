import test from 'node:test';
import assert from 'node:assert/strict';
import '../../test-setup';
import { debugError, debugLog, debugWarn, isDebugLogEnabled } from './debugLog';

test('debugLog is disabled by default', () => {
  localStorage.clear();
  assert.equal(isDebugLogEnabled('gateway'), false);
});

test('debugLog enables a single scope', () => {
  localStorage.clear();
  localStorage.setItem('aegis:debug:gateway', 'true');
  assert.equal(isDebugLogEnabled('gateway'), true);
  assert.equal(isDebugLogEnabled('datastore'), false);
});

test('debugLog enables every scope with wildcard flag', () => {
  localStorage.clear();
  localStorage.setItem('aegis:debug:*', 'true');
  assert.equal(isDebugLogEnabled('gateway'), true);
  assert.equal(isDebugLogEnabled('datastore'), true);
});

test('debugLog only writes when enabled', () => {
  localStorage.clear();
  const calls: unknown[][] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    debugLog('gateway', 'hidden');
    localStorage.setItem('aegis:debug:gateway', 'true');
    debugLog('gateway', 'visible', 1);
  } finally {
    console.log = original;
  }

  assert.deepEqual(calls, [['visible', 1]]);
});

test('debugWarn and debugError keep warn/error levels behind the same flag', () => {
  localStorage.clear();
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    debugWarn('gateway', 'hidden warning');
    debugError('gateway', 'hidden error');
    localStorage.setItem('aegis:debug:gateway', 'true');
    debugWarn('gateway', 'visible warning');
    debugError('gateway', 'visible error', 2);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.deepEqual(warnings, [['visible warning']]);
  assert.deepEqual(errors, [['visible error', 2]]);
});
