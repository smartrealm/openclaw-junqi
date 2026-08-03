import assert from 'node:assert/strict';
import test from 'node:test';
import { latestAgentRunTerminalStatus, listAuditEvents, listAuditLedger, parseAuditListPage } from './auditLedger';

const event = {
  eventId: 'event-1',
  sequence: 12,
  sourceSequence: 8,
  occurredAt: 1_754_000_000_000,
  kind: 'tool_action',
  action: 'tool.action.finished',
  status: 'succeeded',
  actor: { type: 'agent', id: 'main' },
  agentId: 'main',
  sessionKey: 'agent:main:main',
  runId: 'run-1',
  toolName: 'exec',
  redaction: 'metadata_only',
} as const;

test('decodes the bounded metadata-only audit page without accepting content fields', () => {
  const page = parseAuditListPage({ events: [{ ...event, prompt: 'must not be persisted' }], nextCursor: '13' });
  assert.equal(page.events[0]?.eventId, 'event-1');
  assert.equal('prompt' in (page.events[0] ?? {}), false);
  assert.equal(page.nextCursor, '13');
});

test('fails closed on malformed audit records and wrong redaction markers', () => {
  assert.throws(() => parseAuditListPage({ events: [{ ...event, sequence: 1.5 }] }), /sequence/);
  assert.throws(() => parseAuditListPage({ events: [{ ...event, redaction: 'full' }] }), /redaction/);
});

test('builds an exact run-scoped read-only request and clamps the page size', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const page = await listAuditEvents(async (method, params) => {
    calls.push({ method, params });
    return { events: [event] };
  }, { runId: ' run-1 ', limit: 999 });

  assert.equal(page.events.length, 1);
  assert.deepEqual(calls, [{
    method: 'audit.list',
    params: { runId: 'run-1', limit: 500 },
  }]);
});

test('does not guess a run when the trace has no upstream run identity', async () => {
  await assert.rejects(
    () => listAuditEvents(async () => ({ events: [] }), {}),
    /requires a runId/,
  );
});

test('builds a cross-run audit query without inventing a run identity', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  await listAuditLedger(async (method, params) => {
    calls.push({ method, params });
    return { events: [], nextCursor: '42' };
  }, { kind: 'tool_action', status: 'blocked', limit: 5, cursor: '17' });

  assert.deepEqual(calls, [{
    method: 'audit.list',
    params: { kind: 'tool_action', status: 'blocked', limit: 5, cursor: '17' },
  }]);
});

test('projects only the newest authoritative agent terminal status', () => {
  assert.equal(latestAgentRunTerminalStatus([
    { ...event, kind: 'tool_action', action: 'tool.action.finished', sequence: 30, status: 'failed' },
    { ...event, kind: 'agent_run', action: 'agent.run.finished', sequence: 31, status: 'blocked' },
    { ...event, kind: 'agent_run', action: 'agent.run.finished', sequence: 32, status: 'timed_out' },
    { ...event, kind: 'agent_run', action: 'agent.run.started', sequence: 33, status: 'started' },
  ]), 'timed_out');
  assert.equal(latestAgentRunTerminalStatus([
    { ...event, kind: 'agent_run', action: 'agent.run.started', status: 'started' },
  ]), null);
});
