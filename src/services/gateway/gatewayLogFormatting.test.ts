import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGatewayLogs } from './gatewayLogFormatting';

test('formatGatewayLogs preserves lifecycle progress and separates errors', () => {
  const logs = formatGatewayLogs([
    { level: 'info', source: 'lifecycle', message: 'starting native gateway' },
    { level: 'info', source: 'child_stdout', message: 'gateway ready' },
    { level: 'warn', source: 'child_stderr', message: 'plugin warning' },
    { level: 'error', source: 'lifecycle', message: 'health check failed' },
  ]);

  assert.match(logs.stdout, /starting native gateway/);
  assert.match(logs.stdout, /gateway ready/);
  assert.match(logs.stderr, /plugin warning/);
  assert.match(logs.stderr, /health check failed/);
});

test('formatGatewayLogs limits output to the newest entries', () => {
  const logs = formatGatewayLogs([
    { level: 'info', source: 'lifecycle', message: 'old' },
    { level: 'info', source: 'lifecycle', message: 'new' },
  ], 1);

  assert.doesNotMatch(logs.stdout, /old/);
  assert.match(logs.stdout, /new/);
});
