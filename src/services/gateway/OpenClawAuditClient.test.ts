import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OpenClawAuditClient,
  OpenClawAuditResponseError,
  OpenClawAuditUnsupportedError,
  parseOpenClawAuditActivityPage,
} from './OpenClawAuditClient';

const legacyEvent = {
  eventId: 'legacy-event-1',
  sequence: 1,
  sourceSequence: 1,
  occurredAt: 1_700_000_000_000,
  kind: 'agent_run',
  action: 'agent.run.finished',
  status: 'succeeded',
  actor: { type: 'agent', id: 'main' },
  agentId: 'main',
  sessionKey: 'agent:main:desktop',
  sessionId: 'session-1',
  runId: 'run-1',
  redaction: 'metadata_only',
};

const activityEvent = {
  eventType: 'tool_action',
  schemaVersion: 1,
  eventId: 'activity-event-1',
  sequence: 2,
  sourceSequence: 3,
  occurredAt: 1_700_000_000_100,
  kind: 'tool_action',
  action: 'tool.action.finished',
  status: 'cancelled',
  errorCode: 'tool_cancelled',
  actor: { type: 'agent', id: 'main' },
  agentId: 'main',
  sessionKey: 'agent:main:desktop',
  sessionId: 'session-1',
  runId: 'run-1',
  toolCallId: 'call-1',
  toolName: 'exec',
  redaction: 'metadata_only',
};

describe('OpenClawAuditClient', () => {
  it('prefers the versioned activity ledger when the Gateway advertises it', async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawAuditClient(
      async <T>(method: string, params: Record<string, unknown>) => {
        requests.push({ method, params });
        return { events: [activityEvent] } as T;
      },
      (method) => method === 'audit.activity.list',
    );

    const page = await client.list({ runId: 'run-1', kind: 'tool_action', limit: 10 });
    assert.equal(requests[0]?.method, 'audit.activity.list');
    assert.deepEqual(requests[0]?.params, { runId: 'run-1', kind: 'tool_action', limit: 10 });
    assert.equal(page.source, 'activity');
    assert.equal(page.events[0]?.toolName, 'exec');
    assert.equal(page.events[0]?.errorCode, 'tool_cancelled');
  });

  it('uses the compatibility audit.list method when capabilities are unknown', async () => {
    const methods: string[] = [];
    const client = new OpenClawAuditClient(
      async <T>(method: string) => {
        methods.push(method);
        return { events: [legacyEvent], nextCursor: 'next-1' } as T;
      },
    );

    const page = await client.list({ runId: 'run-1', kind: 'agent_run' });
    assert.deepEqual(methods, ['audit.list']);
    assert.equal(page.source, 'legacy');
    assert.equal(page.nextCursor, 'next-1');
    assert.equal(page.events[0]?.sessionId, 'session-1');
  });

  it('does not pretend that a legacy Gateway supports activity-only filters', async () => {
    const client = new OpenClawAuditClient(
      async <T>() => ({ events: [] } as unknown as T),
      (method) => method === 'audit.list',
    );

    await assert.rejects(
      client.list({ runId: 'run-1', kind: 'message' }),
      (error: unknown) => error instanceof OpenClawAuditUnsupportedError,
    );
    await assert.rejects(
      client.list({ runId: 'run-1', direction: 'inbound' }),
      (error: unknown) => error instanceof OpenClawAuditUnsupportedError,
    );
  });

  it('fails closed when neither audit method is advertised', async () => {
    const client = new OpenClawAuditClient(async <T>() => ({ events: [] } as unknown as T), () => false);
    await assert.rejects(
      client.list({ runId: 'run-1' }),
      (error: unknown) => error instanceof OpenClawAuditUnsupportedError,
    );
  });

  it('enforces activity terminal error-code correlations', () => {
    assert.throws(
      () => parseOpenClawAuditActivityPage({
        events: [{
          ...activityEvent,
          status: 'failed',
          errorCode: 'tool_cancelled',
        }],
      }),
      (error: unknown) => error instanceof OpenClawAuditResponseError,
    );
  });

  it('keeps metadata-only activity fields and drops no contract boundary into raw payloads', () => {
    const page = parseOpenClawAuditActivityPage({ events: [{ ...activityEvent, prompt: 'must-not-be-consumed' }] });
    assert.equal('prompt' in page.events[0]!, false);
    assert.equal(page.events[0]?.redaction, 'metadata_only');
  });
});
