import assert from 'node:assert/strict';
import test from 'node:test';
import { isRunningSubagentSession } from './gatewayDataStore';

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0);

test('sub-agent activity follows explicit OpenClaw run fields before timestamp compatibility fallback', () => {
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:a', hasActiveRun: true }, NOW), true);
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:b', hasActiveRun: false }, NOW), false);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:authoritative-active',
    hasActiveRun: true,
    status: 'done',
  }, NOW), true);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:authoritative-settled',
    hasActiveRun: false,
    status: 'running',
  }, NOW), false);
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:c', status: 'done' }, NOW), false);
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:d', running: false }, NOW), false);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:e',
    updatedAt: new Date(NOW - 30_000).toISOString(),
  }, NOW), true);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:f',
    updatedAt: new Date(NOW - 61_000).toISOString(),
  }, NOW), false);
});
